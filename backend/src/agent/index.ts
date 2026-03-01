import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import {
  AgentMode,
  AgentSession,
  ChatMessage,
  ExecutionPlan,
  WorkspaceState,
} from '../types';
import { ExecutionPlanner } from './planner';
import { PlanExecutor } from './executor';
import { ToolRouter } from '../mcp/toolRouter';

const ASK_SYSTEM_PROMPT = `You are a senior full-stack software engineer assistant.
Answer questions about software development, architecture, code, and best practices.
Be concise, accurate, and helpful. Use code examples when appropriate.
Do not make changes to the codebase in this mode — only provide information and guidance.`;

const AGENT_SYSTEM_PROMPT = `You are a senior full-stack software engineer with autonomous development capabilities.
You can create, modify, and manage files and services to implement features.

When given a task:
1. Analyze the existing codebase context
2. Plan the implementation
3. Execute using available tools
4. Validate the result

Always write clean, modular, secure code following the project's patterns.
Never expose secrets or overwrite critical files without analysis.`;

export class AIEngineerAgent {
  private sessions = new Map<string, AgentSession>();
  private planner: ExecutionPlanner;
  private executor: PlanExecutor;
  private toolRouter: ToolRouter;
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.toolRouter = new ToolRouter();
    this.planner = new ExecutionPlanner();
    this.executor = new PlanExecutor(this.toolRouter);
  }

  createSession(workspaceState: WorkspaceState, mode: AgentMode = 'PLAN'): AgentSession {
    const session: AgentSession = {
      id: uuidv4(),
      mode,
      messages: [],
      workspace: workspaceState,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  async processMessage(
    sessionId: string,
    userMessage: string,
    onStream?: (chunk: string) => void
  ): Promise<{
    message: ChatMessage;
    plan?: ExecutionPlan;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };
    session.messages.push(userMsg);

    let responseContent: string;
    let plan: ExecutionPlan | undefined;

    switch (session.mode) {
      case 'ASK':
        responseContent = await this.handleAskMode(session, userMessage, onStream);
        break;
      case 'PLAN':
        ({ responseContent, plan } = await this.handlePlanMode(session, userMessage));
        break;
      case 'AGENT':
        responseContent = await this.handleAgentMode(session, userMessage, onStream);
        break;
      default:
        responseContent = 'Unknown mode. Please set mode to ASK, PLAN, or AGENT.';
    }

    const assistantMsg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: responseContent,
      timestamp: new Date(),
      metadata: plan ? { planId: plan.id } : undefined,
    };

    session.messages.push(assistantMsg);
    if (plan) session.currentPlan = plan;
    session.updatedAt = new Date();

    return { message: assistantMsg, plan };
  }

  private async handleAskMode(
    session: AgentSession,
    userMessage: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    const messages: Anthropic.Messages.MessageParam[] = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    if (onStream) {
      const stream = this.client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: ASK_SYSTEM_PROMPT,
        messages,
      });

      let fullText = '';
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          fullText += event.delta.text;
          onStream(event.delta.text);
        }
      }
      return fullText;
    }

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: ASK_SYSTEM_PROMPT,
      messages,
    });

    const content = response.content[0];
    return content.type === 'text' ? content.text : '';
  }

  private async handlePlanMode(
    session: AgentSession,
    userMessage: string
  ): Promise<{ responseContent: string; plan?: ExecutionPlan }> {
    const workspaceContext = this.buildWorkspaceContext(session.workspace);

    const plan = await this.planner.generatePlan(
      userMessage,
      session.messages,
      workspaceContext
    );

    const formatted = this.planner.formatPlanForDisplay(plan);
    const responseContent = `I've analyzed your request and created an execution plan:\n\n${formatted}\n\n---\n*Review the plan above. You can **approve** to execute, **reject** to discard, or request modifications.*`;

    return { responseContent, plan };
  }

  private async handleAgentMode(
    session: AgentSession,
    userMessage: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    const workspaceContext = this.buildWorkspaceContext(session.workspace);
    const tools = this.toolRouter.getToolDefinitionsForClaude();

    const messages: Anthropic.Messages.MessageParam[] = [
      ...session.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: `${userMessage}\n\nWorkspace context:\n${workspaceContext}` },
    ];

    let continueLoop = true;
    const responseParts: string[] = [];

    while (continueLoop) {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: AGENT_SYSTEM_PROMPT,
        tools,
        messages,
      });

      const assistantContent: Anthropic.Messages.ContentBlock[] = [];
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        assistantContent.push(block);

        if (block.type === 'text') {
          responseParts.push(block.text);
          onStream?.(block.text);
        } else if (block.type === 'tool_use') {
          onStream?.(`\n[Executing: ${block.name}...]\n`);
          const result = await this.toolRouter.execute({
            toolName: block.name,
            parameters: block.input as Record<string, unknown>,
            sessionId: session.id,
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });

          onStream?.(
            result.success
              ? `[${block.name}: Success]\n`
              : `[${block.name}: Failed - ${result.error}]\n`
          );
        }
      }

      messages.push({ role: 'assistant', content: assistantContent });

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }

      continueLoop = response.stop_reason === 'tool_use';
    }

    return responseParts.join('');
  }

  async approvePlan(sessionId: string): Promise<{
    success: boolean;
    message: string;
    errors?: string[];
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.currentPlan) throw new Error('No active plan to approve');

    session.currentPlan.status = 'approved';
    const workspaceContext = this.buildWorkspaceContext(session.workspace);

    const result = await this.executor.executePlan(
      session.currentPlan,
      workspaceContext,
      (step, message) => {
        const progressMsg: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: `[Step ${step.order}] ${step.description}\n${message}`,
          timestamp: new Date(),
          metadata: { stepId: step.id, type: 'progress' },
        };
        session.messages.push(progressMsg);
      }
    );

    const summaryMsg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: result.success
        ? `Plan executed successfully. ${result.completedSteps.length} step(s) completed.\n\n**Validation:** ${session.currentPlan.validationMethod}`
        : `Plan execution completed with errors:\n${result.errors.join('\n')}\n\n${result.completedSteps.length} of ${session.currentPlan.steps.length} steps completed.`,
      timestamp: new Date(),
    };
    session.messages.push(summaryMsg);
    session.updatedAt = new Date();

    return {
      success: result.success,
      message: summaryMsg.content,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  }

  rejectPlan(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.currentPlan) {
      session.currentPlan.status = 'rejected';
      session.currentPlan = undefined;
    }
  }

  setMode(sessionId: string, mode: AgentMode): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.mode = mode;
    session.updatedAt = new Date();
  }

  updateWorkspace(sessionId: string, workspace: Partial<WorkspaceState>): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.workspace = { ...session.workspace, ...workspace };
  }

  private buildWorkspaceContext(workspace: WorkspaceState): string {
    const lines: string[] = [`Root: ${workspace.rootPath}`];

    if (workspace.files.length > 0) {
      lines.push('\nProject Structure:');
      this.appendFileTree(workspace.files, lines, '');
    }

    if (workspace.activeFile) {
      lines.push(`\nActive File: ${workspace.activeFile}`);
    }

    return lines.join('\n');
  }

  private appendFileTree(files: import('../types').FileNode[], lines: string[], prefix: string): void {
    for (const file of files) {
      lines.push(`${prefix}${file.type === 'directory' ? '📁' : '📄'} ${file.name}`);
      if (file.children) {
        this.appendFileTree(file.children, lines, `${prefix}  `);
      }
    }
  }
}
