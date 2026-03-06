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
import { ValidationService } from './validationService';
import { ProjectAnalyzer } from './projectAnalyzer';
import { CodeStyleEnforcer } from './codeStyleEnforcer';
import { ImportValidator } from './importValidator';
import * as path from 'path';

const UI_FRONTEND_CONTEXT = `
## Frontend Stack & Conventions

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS + Zustand

**Design System (Tailwind custom classes — use estas, não invente outras):**
- Botões: \`btn-primary\`, \`btn-ghost\`, \`btn-success\`, \`btn-danger\`
- Inputs: \`input\` (classe utilitária definida em index.css)
- Badges: \`badge\`, \`badge-purple\`, \`badge-green\`, \`badge-yellow\`, \`badge-red\`
- Headers de painel: \`panel-header\`

**Tokens de cor (use via Tailwind, ex: \`bg-surface-2\`, \`text-accent-light\`):**
- Superfícies: surface-0 (#0d0d0f), surface-1 (#111113), surface-2 (#18181b), surface-3 (#222226), surface-4 (#2c2c31)
- Bordas: border-subtle (#2c2c31), border (#3f3f46)
- Accent: accent (#7c3aed), accent-hover (#6d28d9), accent-light (#a78bfa)
- Estado: success (#10b981), warning (#f59e0b), error (#ef4444), info (#3b82f6)

**Tipografia:**
- Sans: Inter (padrão) — use \`font-sans\`
- Mono: JetBrains Mono — use \`font-mono\`
- Tamanhos: \`text-xs\`, \`text-sm\` (predominantes), \`text-base\`

**Estado Global (Zustand):**
- Store principal: \`frontend/src/store/agentStore.ts\` — exporta \`useAgentStore\`
- Para ler estado: \`const { campo } = useAgentStore()\`
- Para actions: \`const { action } = useAgentStore()\`
- Tipos: definidos em \`frontend/src/types/index.ts\`

**Chamadas de API:**
- Sempre usar o cliente \`api\` de \`frontend/src/services/api.ts\`
- Padrão: \`const data = await api.nomeDoMetodo(params)\`
- Adicionar novos métodos seguindo o padrão \`request<T>(path, options)\`

**Padrão de Componente:**
\`\`\`tsx
// frontend/src/components/categoria/NomeComponente.tsx
import React from 'react';
import { useAgentStore } from '../../store/agentStore';

export function NomeComponente() {
  const { campo, action } = useAgentStore();
  return (
    <div className="...">
      {/* conteúdo */}
    </div>
  );
}
\`\`\`

**Dados do Supabase:**
- Backend expõe dados via REST em \`backend/src/routes/\`
- Frontend consome via \`services/api.ts\`
- Para nova tabela: criar rota no backend → adicionar ao api.ts → consumir no componente via store ou hook local

**Estrutura de pastas do frontend:**
\`\`\`
frontend/src/
├── components/
│   ├── chat/       # Chat, mensagens, planos
│   ├── editor/     # Monaco editor
│   ├── explorer/   # Árvore de arquivos
│   ├── git/        # Git status/commits
│   ├── layout/     # Sidebar, Workspace, UserProfile
│   ├── preview/    # Preview de app
│   ├── terminal/   # Terminal emulado
│   └── workspace/  # RepoSelector
├── store/          # agentStore.ts (Zustand)
├── services/       # api.ts
└── types/          # index.ts
\`\`\`
`;

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
- Edit existing files surgically: use the edit_file tool
- Execute a terminal command (npm, npx, scripts): use the run_command tool
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
3. Execute changes using appropriate tools (edit_file for existing files; write_files only for new files)
4. Verify results if needed

1. ALWAYS start by calling list_directory on the workspace root 
   before attempting to read any specific file.

2. Complete the full task in one go — do not stop mid-execution 
   to narrate what you are about to do. Act, then summarize.

CRITICAL EDITING RULE:
- For EXISTING files, ALWAYS use edit_file. NEVER use write_files to overwrite.
- write_files is ONLY for creating NEW files that do not exist yet.

IMPORTANT RELIABILITY RULE:
- Never assume file paths exist. If you need a file, first use list_directory or search_files to confirm the actual structure.

Always use the tools - do NOT just describe what you would do. Actually DO it using the available tools.
Be proactive and complete tasks autonomously.

CODE QUALITY RULE:
For any function you write that has more than 15 lines, you MUST add a JSDoc comment explaining:
- The purpose of the function
- @param descriptions for each parameter
- @returns description of the return value
For complex logic blocks (conditionals with 3+ branches, data transformations, algorithms), add a short inline comment explaining the reasoning.

${UI_FRONTEND_CONTEXT}`;

export class AIEngineerAgent {
  private sessions = new Map<string, AgentSession>();
  private planner: ExecutionPlanner;
  private executor: PlanExecutor;
  private toolRouter: ToolRouter;
  private client: OpenRouterClient;
  private memory: MemoryService;
  private persistMemory: boolean;
  private validation: ValidationService;
  private projectAnalyzer: ProjectAnalyzer;
  private styleEnforcer: CodeStyleEnforcer;
  private importValidator: ImportValidator;

  constructor(persistMemory = true) {
    this.client = getOpenRouterClient();
    this.toolRouter = new ToolRouter();
    this.planner = new ExecutionPlanner(this.toolRouter);
    this.executor = new PlanExecutor(this.toolRouter);
    this.validation = new ValidationService(this.toolRouter);
    this.projectAnalyzer = new ProjectAnalyzer();
    this.styleEnforcer = new CodeStyleEnforcer(this.toolRouter);
    this.importValidator = new ImportValidator(this.toolRouter);
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
    
    // --- Project Intelligence (Fase 3.1) ---
    let projectIntelligence = '';
    try {
      const intel = this.projectAnalyzer.analyze(workspaceState.rootPath);
      projectIntelligence = this.projectAnalyzer.formatForPrompt(intel);
      console.log(`[Agent] Project intelligence detected: ${intel.stack.join(', ')} / ${intel.language}`);
    } catch (error) {
      console.warn('[Agent] Project analysis failed:', error);
    }

    const session: AgentSession = {
      id: sessionId,
      mode,
      selectedModel,
      messages: [],
      workspace: workspaceState,
      projectIntelligence: projectIntelligence || undefined,
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
      rootPath: process.env.REPOS_ROOT || process.env.WORKSPACE_ROOT || '/tmp/workspace',
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
      session.workspace.rootPath,
      session.selectedModel,
      session.projectIntelligence
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
      /.*\?$/,  // Messages that end with a question mark are usually not implementation requests
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

    // --- 5.1: Smart Clarification ---
    const clarification = await this.maybeClarify(session, userMessage);
    if (clarification) {
      onStream?.(clarification);
      return clarification;
    }

    // --- Project Intelligence context (Fase 3.1) ---
    const intelligenceCtx = session.projectIntelligence
      ? `\n\n${session.projectIntelligence}`
      : '';

    // --- Full-Stack Checklist (Fase 3.3) ---
    const fullStackChecklist = this.isFullStackTask(userMessage) ? `

CHECKLIST FULL-STACK (não pule nenhum item):
□ 1. Criar/verificar tabela no Supabase (migration SQL se necessário)
□ 2. Criar rota REST no backend: backend/src/routes/[nome].ts
□ 3. Registrar rota no server.ts
□ 4. Adicionar método no frontend/src/services/api.ts
□ 5. Adicionar estado + action no agentStore.ts (ou hook local)
□ 6. Criar/modificar componente React que consome os dados
□ 7. Adicionar loading state e empty state no componente
□ 8. Adicionar error handling com mensagem amigável` : '';

    // --- Pattern Extractor instructions (Fase 3.2) ---
    const patternInstructions = `

PATTERN MATCHING RULE:
Before creating any new component or route, you MUST:
1. Use search_files or list_directory to find 2-3 similar existing files
2. Use read_file to read those examples
3. Follow the EXACT same patterns (imports, naming, structure, classes)
Do NOT invent new conventions — match what already exists.`;

    // UI context
    let extraContext = '';
    if (this.isUITask(userMessage)) {
      onStream?.({ type: 'progress', stage: 'context', message: 'Loading UI design system context...' });
      extraContext = await this.buildUIContext(session.workspace);
    }

    if (this.isFullStackTask(userMessage)) {
      onStream?.({ type: 'progress', stage: 'analyzing', message: 'Full-stack task detected — applying checklist...' });
    }

    // --- 5.2: Intent Summary ---
    const intentSummary = await this.generateIntentSummary(session, userMessage, workspaceContext);
    if (intentSummary) {
      onStream?.(intentSummary);
    }

    const tools = OpenRouterClient.convertAnthropicTools(this.toolRouter.getToolDefinitionsForClaude());

    console.log(`[Agent] AGENT mode - Tools available: ${tools.length}`);
    console.log(`[Agent] Tools: ${tools.map(t => t.function.name).join(', ')}`);

    const converted = OpenRouterClient.convertMessages(session.messages.slice(-10), AGENT_SYSTEM_PROMPT);
    
    // Modify the last user message to include workspace context
    const messages = [...converted];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      const uiInstructions = this.isUITask(userMessage) ? `

ATENÇÃO - TAREFA DE UI DETECTADA:
Antes de escrever qualquer código:
1. Use list_directory para entender a estrutura de components/ existente
2. Use read_file para ler 1-2 componentes similares ao que será criado
3. Siga EXATAMENTE os padrões visuais do design system (classes: btn-primary, input, badge, etc.)
4. Se precisar de dados do banco: crie rota backend → adicione ao api.ts → consuma no componente
5. Se precisar de estado: adicione ao agentStore.ts seguindo o padrão Zustand existente
6. Não use classes Tailwind genéricas quando existir uma classe utilitária do projeto` : '';

      if (typeof lastMsg.content === 'string') {
        lastMsg.content = `${lastMsg.content}\n\nWorkspace context:\n${workspaceContext}${intelligenceCtx}${extraContext}${patternInstructions}${fullStackChecklist}${uiInstructions}`;
      } else if (Array.isArray(lastMsg.content)) {
        const textPart = lastMsg.content.find(c => c.type === 'text');
        if (textPart) {
          textPart.text = `${textPart.text}\n\nWorkspace context:\n${workspaceContext}${intelligenceCtx}${extraContext}${patternInstructions}${fullStackChecklist}${uiInstructions}`;
        }
      }
    }

    let continueLoop = true;
    const responseParts: string[] = [];
    let iterations = 0;

    // --- 5.4 Camada 1: Dynamic iteration limit ---
    const maxIterations = this.estimateMaxIterations(userMessage);
    console.log(`[Agent] Dynamic maxIterations: ${maxIterations}`);

    while (continueLoop && iterations < maxIterations) {
      iterations++;
      console.log(`[Agent] Iteration ${iterations}, sending request with tools...`);

      onStream?.({
        type: 'progress',
        stage: 'thinking',
        message: iterations === 1 ? 'Reasoning about approach...' : `Continuing reasoning (iteration ${iterations}/${maxIterations})...`,
        stepCurrent: iterations,
        stepTotal: maxIterations,
      });

      // --- 5.3: tool_choice: required for first 3 turns ---
      const toolChoice: 'auto' | 'required' = iterations <= 3 ? 'required' : 'auto';

      const response = await this.client.chat({
        model: session.selectedModel,
        messages,
        tools,
        tool_choice: toolChoice,
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

        // --- Self-Healing Loop (Fase 2.2) ---
        // Collect TS/TSX files touched by write_files or edit_file in this batch
        const touchedFiles = this.extractTouchedFiles(assistantMessage.tool_calls, session.workspace.rootPath);
        if (touchedFiles.length > 0) {
          const tsFiles = this.validation.filterValidatableFiles(touchedFiles);
          if (tsFiles.length > 0) {
            const healed = await this.selfHealLoop(
              tsFiles,
              session,
              messages,
              tools,
              onStream
            );
            if (!healed) {
              // Append error context so subsequent LLM iterations are aware
              messages.push({
                role: 'user',
                content: 'TypeScript validation still failing after auto-repair attempts. Please investigate and fix remaining errors.',
              });
            }
          }
        }

        // --- 6.2: Import Validation ---
        if (touchedFiles.length > 0) {
          const importResult = await this.importValidator.validateImports(touchedFiles, session.workspace.rootPath);
          if (!importResult.valid) {
            console.log(`[Agent] Found ${importResult.brokenImports.length} broken import(s), attempting auto-fix...`);
            onStream?.({ type: 'progress', stage: 'healing', message: `Fixing ${importResult.brokenImports.length} broken import(s)...` });
            const fixed = await this.importValidator.fixBrokenImports(importResult.brokenImports, session.workspace.rootPath);
            if (fixed.length > 0) {
              onStream?.({ type: 'progress', stage: 'complete', message: `Auto-fixed imports in ${fixed.length} file(s)` });
            } else {
              // Feed broken imports into context so the LLM can fix them
              const brokenList = importResult.brokenImports
                .map(bi => `  ${bi.filePath}:${bi.line} → import '${bi.importPath}'${bi.suggestion ? ` (suggestion: '${bi.suggestion}')` : ''}`)
                .join('\n');
              messages.push({
                role: 'user',
                content: `Broken imports detected. Please fix these:\n${brokenList}`,
              });
            }
          }
        }

        // --- 5.4 Camada 2: Loop detection ---
        if (this.isLooping(messages)) {
          console.warn('[Agent] Loop detected — same tool calls repeated 3 times');
          const loopWarning = '🔄 Loop detected — the same action was repeated 3 times. Stopping to prevent waste.';
          onStream?.({ type: 'progress', stage: 'complete', message: loopWarning });
          responseParts.push(`\n\n${loopWarning}`);
          break;
        }

        continueLoop = true;
      } else {
        continueLoop = false;
      }
    }

    // --- 6.1: Code Style Enforcement ---
    const allTouchedFiles = messages
      .filter((m: any) => m.role === 'assistant' && m.tool_calls?.length)
      .flatMap((m: any) => {
        const calls = m.tool_calls || [];
        return this.extractTouchedFiles(calls, session.workspace.rootPath);
      });

    if (allTouchedFiles.length > 0) {
      const uniqueFiles = [...new Set(allTouchedFiles)];
      onStream?.({ type: 'progress', stage: 'analyzing', message: 'Running code quality checks (Prettier, ESLint, tsc)...' });

      const qualityReport = await this.styleEnforcer.enforceStyle(uniqueFiles, session.workspace.rootPath);

      const parts: string[] = [];
      if (qualityReport.prettier?.success) parts.push('✅ Prettier');
      if (qualityReport.eslint?.success) parts.push('✅ ESLint');
      if (qualityReport.typescript?.success) parts.push('✅ TypeScript');
      if (qualityReport.prettier && !qualityReport.prettier.success) parts.push('⚠️ Prettier (issues)');
      if (qualityReport.eslint && !qualityReport.eslint.success) parts.push('⚠️ ESLint (issues)');
      if (qualityReport.typescript && !qualityReport.typescript.success) parts.push('⚠️ TypeScript (errors)');

      if (parts.length > 0) {
        const summary = parts.join(' | ');
        onStream?.({ type: 'progress', stage: 'complete', message: `Code quality: ${summary}` });
      }

      // If ESLint or tsc still have errors after --fix, feed them back for one more LLM pass
      if (!qualityReport.allPassed && qualityReport.eslint && !qualityReport.eslint.success) {
        const lintErrors = qualityReport.eslint.output.slice(0, 2000);
        responseParts.push(`\n\n⚠️ ESLint issues remaining:\n${lintErrors}`);
      }
    }

    // --- 5.4 Camada 3: Checkpoint instead of hard stop ---
    if (iterations >= maxIterations) {
      console.warn(`[Agent] Max iterations reached (${maxIterations})`);

      const completedTools = messages
        .filter((m: any) => m.tool_calls)
        .flatMap((m: any) => m.tool_calls!.map((t: any) => t.function.name));
      const uniqueTools = [...new Set(completedTools)];
      const summary = responseParts.join('').slice(-500);

      onStream?.({
        type: 'checkpoint',
        message: `Completed ${iterations} cycles but the task may not be finished.`,
        completedTools: uniqueTools,
        summary,
        iterationsUsed: iterations,
        canContinue: true,
      });
    }

    return responseParts.join('');
  }

  // --- 5.1: Smart Clarification ---
  private async maybeClarify(
    session: AgentSession,
    userMessage: string
  ): Promise<string | null> {
    const prompt = `The user said: "${userMessage}"
Is this request ambiguous or missing critical information to proceed?
Answer ONLY with JSON: { "isAmbiguous": boolean, "question": "..." , "options": ["A","B","C"] }
If not ambiguous, return { "isAmbiguous": false }`;

    try {
      const response = await this.client.chat({
        model: session.selectedModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });

      const text = response.choices[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.isAmbiguous && parsed.question) {
        const options = (parsed.options || []).map((o: string, i: number) => `${i + 1}. ${o}`).join('\n');
        return `❓ Before proceeding:\n${parsed.question}\n${options}`;
      }
    } catch (err) {
      console.warn('[Agent] Clarification check failed, proceeding anyway:', err);
    }
    return null;
  }

  // --- 5.2: Intent Summary ---
  private async generateIntentSummary(
    session: AgentSession,
    userMessage: string,
    workspaceContext: string
  ): Promise<string | null> {
    const prompt = `Based on this user request and workspace context, summarize in 2-3 bullet points what you understand the user wants.
User: "${userMessage}"
Workspace: ${workspaceContext.slice(0, 500)}
Reply ONLY with the bullet points, no preamble.`;

    try {
      const response = await this.client.chat({
        model: session.selectedModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });

      const text = response.choices[0]?.message?.content || '';
      if (text.trim()) {
        return `🎯 Here's what I understand you want:\n${text.trim()}`;
      }
    } catch (err) {
      console.warn('[Agent] Intent summary failed, proceeding anyway:', err);
    }
    return null;
  }

  // --- 5.4 Camada 1: Dynamic iteration limit ---
  private estimateMaxIterations(userMessage: string): number {
    const lower = userMessage.toLowerCase();
    if (/\b(crud|full[- ]?stack|migration|deploy)\b/i.test(lower)) return 25;
    if (/\b(refactor|rewrite|redesign|reestrutur)\b/i.test(lower)) return 20;
    if (/\b(create|criar|add|adicionar|implement|implementar)\b/i.test(lower)) return 15;
    if (/\b(fix|corrigir|bug|erro|error)\b/i.test(lower)) return 12;
    return 10;
  }

  // --- 5.4 Camada 2: Loop detection ---
  private isLooping(messages: Array<{ role: string; tool_calls?: any[]; [key: string]: any }>): boolean {
    const toolMsgs = messages
      .filter(m => m.role === 'assistant' && m.tool_calls?.length)
      .slice(-3);

    if (toolMsgs.length < 3) return false;

    const signatures = toolMsgs.map(m =>
      m.tool_calls!.map((t: any) => `${t.function.name}:${t.function.arguments}`).sort().join('|')
    );

    return signatures[0] === signatures[1] && signatures[1] === signatures[2];
  }

  private isUITask(message: string): boolean {
    const uiPatterns = [
      /\b(ui|ux|interface|tela|screen|página|page|componente|component|layout|design)\b/i,
      /\b(botão|button|input|campo|field|formulário|form|modal|dialog|drawer)\b/i,
      /\b(lista|list|tabela|table|card|grid|sidebar|header|footer|navbar|menu)\b/i,
      /\b(onboarding|wizard|step|etapa|fluxo|flow|cadastro|signup|login)\b/i,
      /\b(exibir|mostrar|show|display|renderizar|render)\b.*\b(dados|data|informações|info)\b/i,
      /\b(banco de dados|database|supabase)\b.*\b(tela|página|lista|tabela)\b/i,
      /\b(estilo|style|cor|color|fonte|font|espaçamento|spacing|responsivo|responsive)\b/i,
    ];
    return uiPatterns.some((p) => p.test(message));
  }

  // --- Fase 3.3: Full-Stack task detector ---
  private isFullStackTask(message: string): boolean {
    return /\b(banco|database|supabase|tabela|table|dados|data|lista de|list of|buscar|fetch|exibir|mostrar|show|display)\b/i.test(message);
  }

  // =========================================================================
  // Self-Healing helpers  (Fase 2.2)
  // =========================================================================

  private static readonly MAX_HEAL_ATTEMPTS = 3;
  private static readonly WRITE_TOOL_NAMES = new Set(['write_files', 'edit_file']);

  /**
   * Extracts file paths touched by write_files / edit_file tool calls in the
   * current assistant message so we know which files to validate.
   */
  private extractTouchedFiles(
    toolCalls: Array<{ function: { name: string; arguments: string } }>,
    workspaceRoot: string
  ): string[] {
    const files: string[] = [];

    for (const tc of toolCalls) {
      if (!AIEngineerAgent.WRITE_TOOL_NAMES.has(tc.function.name)) continue;

      let args: any;
      try { args = JSON.parse(tc.function.arguments); } catch { continue; }

      if (tc.function.name === 'edit_file' && args.filePath) {
        files.push(args.filePath);
      } else if (tc.function.name === 'write_files' && Array.isArray(args.files)) {
        for (const f of args.files) {
          if (f.path) files.push(f.path);
        }
      }
    }

    return [...new Set(files)];
  }

  /**
   * Runs `tsc --noEmit` on the sub-project(s) that contain the touched files.
   * If errors are found, asks the LLM to repair them (up to MAX_HEAL_ATTEMPTS).
   * Returns true once validation passes (or no TS errors are detected).
   */
  private async selfHealLoop(
    tsFiles: string[],
    session: AgentSession,
    messages: OpenRouterMessage[],
    tools: any[],
    onStream?: (chunk: StreamEvent) => void
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= AIEngineerAgent.MAX_HEAL_ATTEMPTS; attempt++) {
      // Pick one file to trigger validation for the whole sub-project
      const vResult = await this.validation.validateTypeScript(
        tsFiles[0],
        session.workspace.rootPath
      );

      if (vResult.valid) return true;

      onStream?.({ type: 'progress', stage: 'healing', message: `TypeScript errors detected — auto-repair attempt ${attempt}/${AIEngineerAgent.MAX_HEAL_ATTEMPTS}...` });

      // Read affected files so the repair LLM has context
      const fileSnippets: string[] = [];
      for (const fp of tsFiles.slice(0, 5)) {
        const readRes = await this.toolRouter.execute({
          toolName: 'read_file',
          sessionId: session.id,
          parameters: { filePath: fp, basePath: session.workspace.rootPath },
        });
        if (readRes.success) {
          const c = (readRes.data as any)?.content ?? '';
          fileSnippets.push(`### ${fp}\n\`\`\`\n${c}\n\`\`\``);
        }
      }

      const repairRequest: OpenRouterMessage = {
        role: 'user',
        content: `TypeScript compilation errors were detected. Fix them using edit_file.\n\n## Errors\n${vResult.errors.join('\n')}\n\n## Files\n${fileSnippets.join('\n\n')}`,
      };

      messages.push(repairRequest);

      // Let the LLM repair
      let repairDone = false;
      let repairLoop = true;
      while (repairLoop) {
        const resp = await this.client.chat({
          model: session.selectedModel,
          messages,
          tools,
          tool_choice: 'auto',
          max_tokens: 4096,
        });

        const asst = resp.choices[0].message;

        if (asst.tool_calls && asst.tool_calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: asst.content || '',
            tool_calls: asst.tool_calls,
          });

          for (const tc of asst.tool_calls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
            args = applyWorkspaceBasePath(tc.function.name, args, session.workspace.rootPath);

            onStream?.({
              type: 'tool',
              toolName: tc.function.name,
              state: 'start',
              args,
              toolCallId: tc.id,
            });

            const result = await this.toolRouter.execute({
              toolName: tc.function.name,
              parameters: args,
              sessionId: session.id,
            });

            messages.push({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: tc.id,
            });

            onStream?.({
              type: 'tool',
              toolName: tc.function.name,
              state: result.success ? 'success' : 'failed',
              result: result.success ? result.data : undefined,
              error: result.error,
              args,
              toolCallId: tc.id,
            });

            if (result.success && AIEngineerAgent.WRITE_TOOL_NAMES.has(tc.function.name)) {
              repairDone = true;
            }
          }
          repairLoop = true;
        } else {
          repairLoop = false;
        }
      }

      if (!repairDone) {
        onStream?.({ type: 'progress', stage: 'healing', message: 'Repair produced no fixes' });
        return false;
      }
    }

    // Final check after last repair
    const final = await this.validation.validateTypeScript(tsFiles[0], session.workspace.rootPath);
    if (final.valid) {
      onStream?.({ type: 'progress', stage: 'complete', message: 'TypeScript validation passed after repair' });
    }
    return final.valid;
  }

  private async buildUIContext(workspace: WorkspaceState): Promise<string> {
    const fsService = new FileSystemService(workspace.rootPath);
    const contextParts: string[] = [];

    const filesToRead = [
      'frontend/tailwind.config.js',
      'frontend/src/index.css',
      'frontend/src/types/index.ts',
      'frontend/src/store/agentStore.ts',
      'frontend/src/services/api.ts',
    ];

    for (const relPath of filesToRead) {
      try {
        const content = fsService.readFile(relPath);
        contextParts.push(`### ${relPath}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``);
      } catch {
        // file doesn't exist - skip
      }
    }

    return contextParts.length > 0
      ? `\n\n## Arquivos-chave do Frontend (leia antes de modificar)\n${contextParts.join('\n\n')}`
      : '';
  }

  async approvePlan(sessionId: string, onStream?: (event: StreamEvent) => void): Promise<{
    success: boolean;
    message: string;
    errors?: string[];
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.currentPlan) throw new Error('No active plan to approve');

    session.currentPlan.status = 'approved';
    const workspaceContext = this.buildWorkspaceContext(session.workspace);

    onStream?.({
      type: 'progress',
      stage: 'executing',
      message: `Executing plan: ${session.currentPlan.goal}`,
      stepCurrent: 0,
      stepTotal: session.currentPlan.steps.length,
    });

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
      session.selectedModel,
      session.projectIntelligence,
      onStream
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
