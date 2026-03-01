import { v4 as uuidv4 } from 'uuid';
import {
  AgentMode,
  AgentSession,
  ChatMessage,
  ExecutionPlan,
  WorkspaceState,
  StreamEvent,
} from '../types';
import { ExecutionPlanner } from './planner';
import { PlanExecutor } from './executor';
import { ToolRouter } from '../mcp/toolRouter';
import { getOpenRouterClient, OpenRouterClient, OpenRouterMessage } from '../integrations/openrouter';
import { getMemoryService, MemoryService } from '../services/memoryService';
import { FileSystemService } from '../workspace/fileSystem';
import { applyWorkspaceBasePath } from './toolArgs';

const ASK_SYSTEM_PROMPT = `You are a senior full-stack software engineer assistant.
Answer questions about software development, architecture, code, and best practices.
Be concise, accurate, and helpful. Use code examples when appropriate.

IMPORTANT: You have access to READ-ONLY tools to explore the codebase and answer questions:
- read_file: Read file contents
- list_directory: List directory contents  
- search_files: Search for patterns in files
- get_file_info: Get file metadata

When the user asks about files, code, or the project structure, USE THESE TOOLS to get the actual information.
Do NOT say you cannot access files - you CAN and SHOULD use the tools available to you.
Do not make destructive changes (write, delete, move) in this mode — only read and provide information.`;

const AGENT_SYSTEM_PROMPT = `You are a senior full-stack software engineer with autonomous development capabilities.
You have access to powerful tools to interact with the filesystem and manage projects.

IMPORTANT: You MUST use your tools to accomplish tasks. When asked to:
- Read a file: use the read_file tool
- List directory contents: use the list_directory tool
- Create/write files: use the write_files tool
- Search for code: use the search_files tool
- Delete files: use the delete_file tool
- Move/rename files: use the move_file tool
- Copy files: use the copy_file tool
- Create directories: use the create_directory tool
- Get file info: use the get_file_info tool
- Create a new project: use the create_repo tool

When given a task:
1. First, use tools to understand the current codebase (list_directory, read_file)
2. Plan your changes
3. Execute changes using appropriate tools (write_files, etc.)
4. Verify results if needed

1. ALWAYS start by calling list_directory on the workspace root 
   before attempting to read any specific file.

2. Complete the full task in one go — do not stop mid-execution 
   to narrate what you are about to do. Act, then summarize.

IMPORTANT RELIABILITY RULE:
- Never assume file paths exist. If you need a file, first use list_directory or search_files to confirm the actual structure.

Always use the tools - do NOT just describe what you would do. Actually DO it using the available tools.
Be proactive and complete tasks autonomously.`;

export class AIEngineerAgent {
  private sessions = new Map<string, AgentSession>();
  private planner: ExecutionPlanner;
  private executor: PlanExecutor;
  private toolRouter: ToolRouter;
  private client: OpenRouterClient;
  private memory: MemoryService;
  private persistMemory: boolean;

  constructor(persistMemory = true) {
    this.client = getOpenRouterClient();
    this.toolRouter = new ToolRouter();
    this.planner = new ExecutionPlanner();
    this.executor = new PlanExecutor(this.toolRouter);
    this.persistMemory = persistMemory;
    
    // Initialize memory service (may fail if Supabase not configured)
    try {
      this.memory = getMemoryService();
    } catch (error) {
      console.warn('Memory service not available, running without persistence');
      this.persistMemory = false;
      this.memory = null as unknown as MemoryService;
    }
  }

  async createSession(workspaceState: WorkspaceState, mode: AgentMode = 'PLAN'): Promise<AgentSession> {
    const selectedModel = process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4';
    let sessionId = uuidv4();
    
    // Create session in database if memory is enabled
    if (this.persistMemory && this.memory) {
      try {
        sessionId = await this.memory.createSession(
          mode,
          workspaceState.rootPath,
          selectedModel
        );
      } catch (error) {
        console.warn('Failed to persist session:', error);
      }
    }
    
    const session: AgentSession = {
      id: sessionId,
      mode,
      selectedModel,
      messages: [],
      workspace: workspaceState,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async loadSession(sessionId: string, workspaceState: WorkspaceState): Promise<AgentSession | null> {
    // Check if already loaded in memory
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    // Try to load from database
    if (!this.persistMemory || !this.memory) {
      return null;
    }

    try {
      const dbSession = await this.memory.getSession(sessionId);
      if (!dbSession) return null;

      // Load messages
      const messages = await this.memory.getMessages(sessionId);
      const activePlan = await this.memory.getActivePlan(sessionId);

      const effectiveWorkspace: WorkspaceState = {
        ...workspaceState,
        rootPath: dbSession.workspace_path || workspaceState.rootPath,
      };

      const session: AgentSession = {
        id: dbSession.id,
        mode: dbSession.mode as AgentMode,
        selectedModel: dbSession.selected_model,
        messages,
        currentPlan: activePlan || undefined,
        workspace: effectiveWorkspace,
        createdAt: new Date(dbSession.created_at),
        updatedAt: new Date(dbSession.updated_at),
      };

      this.sessions.set(sessionId, session);
      return session;
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  }

  async listSessions(limit = 20): Promise<Array<{ id: string; mode: string; summary: string | null; updatedAt: Date }>> {
    if (!this.persistMemory || !this.memory) {
      return Array.from(this.sessions.values()).map(s => ({
        id: s.id,
        mode: s.mode,
        summary: null,
        updatedAt: s.updatedAt,
      }));
    }

    try {
      const sessions = await this.memory.listSessions(limit);
      return sessions.map(s => ({
        id: s.id,
        mode: s.mode,
        summary: s.summary,
        updatedAt: new Date(s.updated_at),
      }));
    } catch (error) {
      console.error('Failed to list sessions:', error);
      return [];
    }
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  async getOrLoadSession(sessionId: string, workspaceState?: WorkspaceState): Promise<AgentSession | null> {
    // Try memory first
    const memSession = this.sessions.get(sessionId);
    if (memSession) return memSession;

    // Try to load from database
    const defaultWorkspace: WorkspaceState = workspaceState || {
      rootPath: process.env.REPOS_ROOT || 'C:/Users/Silas/Documents/GitHub',
      files: [],
      openFiles: [],
      
    };
    
    return this.loadSession(sessionId, defaultWorkspace);
  }

  async processMessage(
    sessionId: string,
    userMessage: string,
    images?: string[],
    onStream?: (chunk: StreamEvent) => void
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
      images: images,
      timestamp: new Date(),
    };
    session.messages.push(userMsg);

    // Persist user message
    if (this.persistMemory && this.memory) {
      try {
        await this.memory.saveMessage(sessionId, userMsg);
      } catch (error) {
        console.warn('Failed to persist user message:', error);
      }
    }

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

    // Persist assistant message and plan
    if (this.persistMemory && this.memory) {
      try {
        await this.memory.saveMessage(sessionId, assistantMsg);
        if (plan) {
          await this.memory.savePlan(sessionId, plan);
        }
        // Update session summary periodically (every 10 messages)
        if (session.messages.length % 10 === 0) {
          this.memory.generateSessionSummary(sessionId).catch(console.warn);
        }
      } catch (error) {
        console.warn('Failed to persist assistant message:', error);
      }
    }

    return { message: assistantMsg, plan };
  }

  private async handleAskMode(
    session: AgentSession,
    userMessage: string,
    onStream?: (chunk: StreamEvent) => void
  ): Promise<string> {
    // Get read-only tools for ASK mode
    const readOnlyTools = this.toolRouter.getToolDefinitionsForClaude()
      .filter(t => ['read_file', 'list_directory', 'search_files', 'get_file_info'].includes(t.name));
    const tools = OpenRouterClient.convertAnthropicTools(readOnlyTools);
    
    console.log(`[Agent] ASK mode - Read-only tools available: ${tools.length}`);

    const messages: OpenRouterMessage[] = [
      ...OpenRouterClient.convertMessages(session.messages.slice(-20), ASK_SYSTEM_PROMPT)
    ];

    let fullResponse = '';
    let iteration = 0;
    const maxIterations = 5; // Limit for ASK mode

    while (iteration < maxIterations) {
      iteration++;
      console.log(`[Agent ASK] Iteration ${iteration}`);

      const response = await this.client.chat({
        model: session.selectedModel,
        messages,
        max_tokens: 4096,
        tools: tools.length > 0 ? tools : undefined,
      });

      const choice = response.choices[0];
      const finishReason = choice?.finish_reason;
      const toolCalls = choice?.message?.tool_calls;

      // Add text content
      if (choice?.message?.content) {
        fullResponse += choice.message.content;
        if (onStream) {
          onStream(choice.message.content);
        }
      }

      // Process tool calls if any
      if (finishReason === 'tool_calls' && toolCalls && toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: choice.message.content || '',
          tool_calls: toolCalls,
        } as OpenRouterMessage);

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          console.log(`[Agent ASK] Executing tool: ${toolName}`);

          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(toolCall.function.arguments || '{}');
          } catch (e) {
            console.error('Failed to parse tool args:', e);
          }

          toolArgs = applyWorkspaceBasePath(toolName, toolArgs, session.workspace.rootPath);

          if (onStream) {
            onStream({
              type: 'tool',
              toolName,
              state: 'start',
              args: toolArgs,
              toolCallId: toolCall.id,
            });
          }

          const result = await this.toolRouter.execute({
            toolName,
            parameters: toolArgs,
            sessionId: session.id,
          });

          console.log(`[Agent ASK] Tool result: success=${result.success}`);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
          
          if (onStream) {
             onStream({
               type: 'tool',
               toolName,
               state: result.success ? 'success' : 'failed',
               result: result.success ? result.data : undefined,
               error: result.error,
               args: toolArgs,
               toolCallId: toolCall.id
             });
          }
        }
        continue; // Go to next iteration with tool results
      }

      // No tool calls, we're done
      break;
    }

    return fullResponse;
  }

  private async handlePlanMode(
    session: AgentSession,
    userMessage: string
  ): Promise<{ responseContent: string; plan?: ExecutionPlan }> {
    // First, check if this is a conversational message or an implementation request
    const isImplementationRequest = await this.classifyMessage(userMessage, session);
    
    if (!isImplementationRequest) {
      // Handle as conversation, not as a plan request
      const conversationalResponse = await this.handleConversation(session, userMessage);
      return { responseContent: conversationalResponse };
    }
    
    const workspaceContext = this.buildWorkspaceContext(session.workspace);

    const plan = await this.planner.generatePlan(
      userMessage,
      session.messages,
      workspaceContext,
      session.selectedModel
    );

    const formatted = this.planner.formatPlanForDisplay(plan);
    const responseContent = `I've analyzed your request and created an execution plan:\n\n${formatted}\n\n---\n*Review the plan above. You can **approve** to execute, **reject** to discard, or request modifications.*`;

    return { responseContent, plan };
  }

  private async classifyMessage(message: string, session: AgentSession): Promise<boolean> {
    // Quick heuristic checks first
    const lowerMessage = message.toLowerCase();
    
    // Conversational patterns (not implementation requests)
    const conversationalPatterns = [
      /^(oi|olá|hello|hi|hey|e aí|fala)\b/i,
      /^(obrigado|thanks|valeu|brigado)/i,
      /\b(quem é você|who are you|qual seu nome|what is your name)\b/i,
      /\b(como você|how do you|você pode|can you)\b.*\?$/i,
      /^(sim|não|yes|no|ok|okay|certo|entendi)$/i,
      /\b(vamos|let's|stop|para|conversar|talk|falar|speak|português|english|idioma|language)\b/i,
      /\b(o que é|what is|me explica|explain|me conta|tell me about)\b/i,
      /\?$/,  // Questions are usually not implementation requests
    ];

    for (const pattern of conversationalPatterns) {
      if (pattern.test(lowerMessage)) {
        // Verify with LLM for ambiguous cases
        return this.verifyWithLLM(message, session);
      }
    }

    // Implementation patterns (likely requests)
    const implementationPatterns = [
      /\b(crie|create|implement|add|build|make|desenvolva|faça|faz)\b/i,
      /\b(modifique|modify|change|update|altere|mude)\b/i,
      /\b(delete|remove|remova|apague)\b/i,
      /\b(feature|funcionalidade|componente|component|página|page|tela|screen)\b/i,
      /\b(api|endpoint|route|rota|banco|database|tabela|table)\b/i,
      /\b(instale|install|configure|setup)\b/i,
    ];

    for (const pattern of implementationPatterns) {
      if (pattern.test(lowerMessage)) {
        return true;
      }
    }

    // If unclear, use LLM to classify
    return this.verifyWithLLM(message, session);
  }

  private async verifyWithLLM(message: string, session: AgentSession): Promise<boolean> {
    const classifierPrompt = `You are a message classifier. Determine if the following user message is:
1. A REQUEST FOR CODE/IMPLEMENTATION (user wants you to build, create, modify, or implement something)
2. A CONVERSATIONAL MESSAGE (greeting, question, request to change language, simple chat, etc.)

Respond with ONLY "IMPLEMENTATION" or "CONVERSATION" - nothing else.

User message: "${message}"`;

    try {
      const response = await this.client.chat({
        model: session.selectedModel,
        messages: [{ role: 'user', content: classifierPrompt }],
        max_tokens: 20,
        temperature: 0,
      });

      const result = response.choices[0]?.message?.content?.trim().toUpperCase() || '';
      return result.includes('IMPLEMENTATION');
    } catch {
      // Default to conversation if classification fails
      return false;
    }
  }

  private async handleConversation(session: AgentSession, userMessage: string): Promise<string> {
    const sysPrompt = `You are a friendly AI software engineering assistant. You're currently in PLAN mode, which means you can help create execution plans for implementing features.

However, you should respond naturally to conversational messages. If the user wants to chat, answer questions, or asks you to speak in a different language - do that!

When the user asks you to implement, create, build, or modify something, let them know you'll create an execution plan.

Be helpful, concise, and match the user's language (if they speak Portuguese, respond in Portuguese).`;

    const recentMessages = session.messages.slice(-10);
    // Since processMessage pushed the userMessage directly to session.messages, we already have it at the end.
    // However, if we need to modify the array, we can just use the converted directly.
    const messages = OpenRouterClient.convertMessages(recentMessages, sysPrompt);
    const response = await this.client.chat({
      model: session.selectedModel,
      messages,
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content || 'Desculpe, não consegui processar sua mensagem.';
  }

  private async handleAgentMode(
    session: AgentSession,
    userMessage: string,
    onStream?: (chunk: StreamEvent) => void
  ): Promise<string> {
    const workspaceContext = this.buildWorkspaceContext(session.workspace);
    const tools = OpenRouterClient.convertAnthropicTools(this.toolRouter.getToolDefinitionsForClaude());

    console.log(`[Agent] AGENT mode - Tools available: ${tools.length}`);
    console.log(`[Agent] Tools: ${tools.map(t => t.function.name).join(', ')}`);

    const converted = OpenRouterClient.convertMessages(session.messages.slice(-10), AGENT_SYSTEM_PROMPT);
    
    // Modify the last user message to include workspace context
    const messages = [...converted];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      if (typeof lastMsg.content === 'string') {
        lastMsg.content = `${lastMsg.content}\n\nWorkspace context:\n${workspaceContext}`;
      } else if (Array.isArray(lastMsg.content)) {
        const textPart = lastMsg.content.find(c => c.type === 'text');
        if (textPart) {
          textPart.text = `${textPart.text}\n\nWorkspace context:\n${workspaceContext}`;
        }
      }
    }

    let continueLoop = true;
    const responseParts: string[] = [];
    let iterations = 0;
    const maxIterations = 10;

    while (continueLoop && iterations < maxIterations) {
      iterations++;
      console.log(`[Agent] Iteration ${iterations}, sending request with tools...`);

      const response = await this.client.chat({
        model: session.selectedModel,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 8192,
      });

      const choice = response.choices[0];
      const assistantMessage = choice.message;

      console.log(`[Agent] Response finish_reason: ${choice.finish_reason}`);
      console.log(`[Agent] Has tool_calls: ${!!assistantMessage.tool_calls}, count: ${assistantMessage.tool_calls?.length || 0}`);

      if (assistantMessage.content) {
        responseParts.push(assistantMessage.content);
        onStream?.(assistantMessage.content);
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          tool_calls: assistantMessage.tool_calls,
        });

        for (const toolCall of assistantMessage.tool_calls) {
          console.log(`[Agent] Executing tool: ${toolCall.function.name}`);

            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
              console.log(`[Agent] Tool args: ${JSON.stringify(args)}`);
            } catch {
              console.warn(`[Agent] Failed to parse tool arguments`);
            }

            args = applyWorkspaceBasePath(toolCall.function.name, args, session.workspace.rootPath);

            onStream?.({
              type: 'tool',
              toolName: toolCall.function.name,
              state: 'start',
              args,
              toolCallId: toolCall.id
            });

            const result = await this.toolRouter.execute({
              toolName: toolCall.function.name,
              parameters: args,
              sessionId: session.id,
            });

            console.log(`[Agent] Tool result: success=${result.success}`);

            messages.push({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: toolCall.id,
            });

            onStream?.({
              type: 'tool',
              toolName: toolCall.function.name,
              state: result.success ? 'success' : 'failed',
              result: result.success ? result.data : undefined,
              error: result.error,
              args,
              toolCallId: toolCall.id
            });
          }
        continueLoop = true;
      } else {
        continueLoop = false;
      }
    }

    if (iterations >= maxIterations) {
      console.warn('[Agent] Max iterations reached');
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
      session.id,
      session.workspace.rootPath,
      (step, message) => {
        const progressMsg: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: `[Step ${step.order}] ${step.description}\n${message}`,
          timestamp: new Date(),
          metadata: { stepId: step.id, type: 'progress' },
        };
        session.messages.push(progressMsg);
      },
      session.selectedModel
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

  setModel(sessionId: string, model: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.selectedModel = model;
    session.updatedAt = new Date();
  }

  updateWorkspace(sessionId: string, workspace: Partial<WorkspaceState>): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.workspace = { ...session.workspace, ...workspace };
  }

  private buildWorkspaceContext(workspace: WorkspaceState): string {
    try {
      // Use FileSystemService to generate comprehensive context
      const fsService = new FileSystemService(workspace.rootPath);
      return fsService.generateAgentContext();
    } catch (error) {
      console.warn('Error generating workspace context:', error);
      // Fallback to basic context
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
