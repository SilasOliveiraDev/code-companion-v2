import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionPlan, PlanStep, ChatMessage, MCPToolCall } from '../types';
import { ToolRouter } from '../mcp/toolRouter';

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
  private client: Anthropic;
  private toolRouter: ToolRouter;

  constructor(toolRouter: ToolRouter) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.toolRouter = toolRouter;
  }

  async executeStep(
    step: PlanStep,
    plan: ExecutionPlan,
    workspaceContext: string,
    onProgress?: (message: string) => void
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

    const tools = this.toolRouter.getToolDefinitionsForClaude();

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: prompt },
    ];

    let continueLoop = true;
    let finalMessage = '';

    while (continueLoop) {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: EXECUTOR_SYSTEM_PROMPT,
        tools,
        messages,
      });

      const assistantContent: Anthropic.Messages.ContentBlock[] = [];

      for (const block of response.content) {
        assistantContent.push(block);

        if (block.type === 'text') {
          finalMessage = block.text;
          onProgress?.(block.text);
        } else if (block.type === 'tool_use') {
          const toolCall: MCPToolCall = {
            toolName: block.name,
            parameters: block.input as Record<string, unknown>,
            sessionId: uuidv4(),
          };

          toolCalls.push(toolCall);
          onProgress?.(`Executing tool: ${block.name}`);

          const result = await this.toolRouter.execute(toolCall);

          messages.push(
            { role: 'assistant', content: assistantContent },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify(result),
                },
              ],
            }
          );

          assistantContent.length = 0;
        }
      }

      if (assistantContent.length > 0 && !messages.some((m) => m.role === 'assistant' && m.content === assistantContent)) {
        messages.push({ role: 'assistant', content: assistantContent });
      }

      continueLoop = response.stop_reason === 'tool_use';
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
    onStepProgress?: (step: PlanStep, message: string) => void
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
          (message) => onStepProgress?.(step, message)
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
