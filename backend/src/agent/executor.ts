import { v4 as uuidv4 } from 'uuid';
import { ExecutionPlan, PlanStep, ChatMessage, MCPToolCall } from '../types';
import { ToolRouter } from '../mcp/toolRouter';
import { getOpenRouterClient, OpenRouterClient, OpenRouterMessage, OpenRouterTool } from '../integrations/openrouter';

const EXECUTOR_SYSTEM_PROMPT = `You are a senior full-stack software engineer executing an approved development plan.

You have access to tools to create files, run commands, and interact with external services.

Guidelines:
- Execute each step methodically and in order
- Use tools to make concrete changes, do not just describe what to do
- Write clean, modular, well-structured code
- Follow established patterns in the existing codebase
- Prioritize security: never expose secrets, validate inputs, use environment variables
- After each major step, confirm what was done
- If a step fails, report the error clearly and suggest remediation

When writing code:
- Use TypeScript where possible
- Follow the project's existing style and conventions
- Write reusable, maintainable components
- Include proper error handling
- Keep UI consistent and professional`;

export class PlanExecutor {
  private client: OpenRouterClient;
  private toolRouter: ToolRouter;

  constructor(toolRouter: ToolRouter) {
    this.client = getOpenRouterClient();
    this.toolRouter = toolRouter;
  }

  async executeStep(
    step: PlanStep,
    plan: ExecutionPlan,
    workspaceContext: string,
    onProgress?: (message: string) => void,
    model?: string
  ): Promise<{ success: boolean; message: string; toolCalls: MCPToolCall[] }> {
    const toolCalls: MCPToolCall[] = [];

    const prompt = `Execute this step from the approved plan:

Plan Goal: ${plan.goal}

Current Step (${step.order}/${plan.steps.length}):
- Description: ${step.description}
- Action: ${step.action}
- Files: ${step.files.join(', ') || 'none specified'}

Workspace context:
${workspaceContext}

Execute this step now using the available tools.`;

    const tools = OpenRouterClient.convertAnthropicTools(this.toolRouter.getToolDefinitionsForClaude());

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: EXECUTOR_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    let continueLoop = true;
    let finalMessage = '';

    while (continueLoop) {
      const response = await this.client.chat({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 8192,
      });

      const choice = response.choices[0];
      const assistantMessage = choice.message;

      if (assistantMessage.content) {
        finalMessage = assistantMessage.content;
        onProgress?.(assistantMessage.content);
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          tool_calls: assistantMessage.tool_calls,
        });

        for (const toolCall of assistantMessage.tool_calls) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }

          const mcpToolCall: MCPToolCall = {
            toolName: toolCall.function.name,
            parameters: args,
            sessionId: uuidv4(),
          };

          toolCalls.push(mcpToolCall);
          onProgress?.(`Executing tool: ${toolCall.function.name}`);

          const result = await this.toolRouter.execute(mcpToolCall);

          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
          });
        }

        continueLoop = true;
      } else {
        continueLoop = false;
      }
    }

    return {
      success: true,
      message: finalMessage,
      toolCalls,
    };
  }

  async executePlan(
    plan: ExecutionPlan,
    workspaceContext: string,
    onStepProgress?: (step: PlanStep, message: string) => void,
    model?: string
  ): Promise<{ success: boolean; completedSteps: string[]; errors: string[] }> {
    const completedSteps: string[] = [];
    const errors: string[] = [];

    for (const step of plan.steps.sort((a, b) => a.order - b.order)) {
      step.status = 'in_progress';

      try {
        const result = await this.executeStep(
          step,
          plan,
          workspaceContext,
          (message) => onStepProgress?.(step, message),
          model
        );

        if (result.success) {
          step.status = 'completed';
          completedSteps.push(step.id);
        } else {
          step.status = 'failed';
          step.error = result.message;
          errors.push(`Step ${step.order}: ${result.message}`);
        }
      } catch (error) {
        step.status = 'failed';
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        step.error = errMsg;
        errors.push(`Step ${step.order}: ${errMsg}`);
      }
    }

    plan.status = errors.length === 0 ? 'completed' : 'failed';
    plan.updatedAt = new Date();

    return {
      success: errors.length === 0,
      completedSteps,
      errors,
    };
  }
}
