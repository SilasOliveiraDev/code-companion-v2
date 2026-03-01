import { v4 as uuidv4 } from 'uuid';
import { ExecutionPlan, PlanStep, ChatMessage } from '../types';
import { getOpenRouterClient, OpenRouterClient, OpenRouterMessage } from '../integrations/openrouter';

const PLANNER_SYSTEM_PROMPT = `You are a senior full-stack software engineer acting as an AI planning agent.

When given a user request, you must produce a precise, actionable execution plan in JSON format.

The plan MUST follow this exact schema:
{
  "goal": "Clear, concise goal statement",
  "impactedFiles": ["list", "of", "file", "paths"],
  "architectureDecisions": ["decision 1", "decision 2"],
  "steps": [
    {
      "order": 1,
      "description": "What this step does",
      "files": ["files affected"],
      "action": "create|modify|delete|run|install|migrate"
    }
  ],
  "validationMethod": "How to verify the implementation works"
}

Rules:
- Be specific about file paths
- List all impacted files, including existing ones that need modification
- Architecture decisions should explain WHY, not just WHAT
- Steps must be ordered and atomic
- Validation method must be concrete and testable
- Respond ONLY with valid JSON, no markdown fences`;

export class ExecutionPlanner {
  private client: OpenRouterClient;

  constructor() {
    this.client = getOpenRouterClient();
  }

  async generatePlan(
    userRequest: string,
    conversationHistory: ChatMessage[],
    workspaceContext?: string,
    model?: string
  ): Promise<ExecutionPlan> {
    const systemContext = workspaceContext
      ? `${PLANNER_SYSTEM_PROMPT}\n\nWorkspace context:\n${workspaceContext}`
      : PLANNER_SYSTEM_PROMPT;

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      {
        role: 'user',
        content: `Generate an execution plan for: ${userRequest}`,
      },
    ];

    const response = await this.client.chat({
      model,
      messages,
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from planner');
    }

    let rawPlan: {
      goal: string;
      impactedFiles: string[];
      architectureDecisions: string[];
      steps: Array<{
        order: number;
        description: string;
        files: string[];
        action: PlanStep['action'];
      }>;
      validationMethod: string;
    };

    try {
      const jsonText = content.replace(/```json\n?|\n?```/g, '').trim();
      rawPlan = JSON.parse(jsonText);
    } catch {
      throw new Error(`Failed to parse plan JSON: ${content}`);
    }

    const plan: ExecutionPlan = {
      id: uuidv4(),
      goal: rawPlan.goal,
      impactedFiles: rawPlan.impactedFiles || [],
      architectureDecisions: rawPlan.architectureDecisions || [],
      steps: rawPlan.steps.map((step) => ({
        id: uuidv4(),
        order: step.order,
        description: step.description,
        files: step.files || [],
        action: step.action,
        status: 'pending',
      })),
      validationMethod: rawPlan.validationMethod,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return plan;
  }

  formatPlanForDisplay(plan: ExecutionPlan): string {
    const lines: string[] = [
      `## Execution Plan`,
      ``,
      `**Goal:** ${plan.goal}`,
      ``,
      `**Impacted Files:**`,
      ...plan.impactedFiles.map((f) => `- \`${f}\``),
      ``,
      `**Architecture Decisions:**`,
      ...plan.architectureDecisions.map((d) => `- ${d}`),
      ``,
      `**Steps:**`,
      ...plan.steps.map(
        (s) =>
          `${s.order}. [${s.action.toUpperCase()}] ${s.description}${s.files.length > 0 ? `\n   Files: ${s.files.map((f) => `\`${f}\``).join(', ')}` : ''}`
      ),
      ``,
      `**Validation:** ${plan.validationMethod}`,
    ];

    return lines.join('\n');
  }
}
