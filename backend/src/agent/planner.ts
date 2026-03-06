import { v4 as uuidv4 } from 'uuid';
import { ExecutionPlan, PlanStep, ChatMessage } from '../types';
import { getOpenRouterClient, OpenRouterClient, OpenRouterMessage } from '../integrations/openrouter';
import { ToolRouter } from '../mcp/toolRouter';
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
- Respond ONLY with valid JSON, no markdown fences

CRITICAL EDITING RULE:
- For EXISTING files, steps must use edit_file.
- write_files is ONLY for creating NEW files (never overwrite existing files).

${UI_FRONTEND_CONTEXT}

**Regras adicionais para tarefas de UI:**
- Sempre identificar qual componente pai precisa ser modificado
- Listar o arquivo de store se o novo campo precisar de estado
- Se exibir dados do banco, incluir step para rota de backend + step para api.ts + step para o componente
- Para onboarding ou fluxos novos, criar componente dedicado em components/[categoria]/
- Usar exclusivamente as classes do design system listadas acima`;

export class ExecutionPlanner {
  private client: OpenRouterClient;
  private toolRouter?: ToolRouter;

  constructor(toolRouter?: ToolRouter) {
    this.client = getOpenRouterClient();
    this.toolRouter = toolRouter;
  }

  private async listProjectFilesForContext(workspaceRootPath: string): Promise<string> {
    if (!this.toolRouter) return '';

    const result = await this.toolRouter.execute({
      toolName: 'list_directory',
      sessionId: 'planner',
      parameters: {
        dirPath: '.',
        basePath: workspaceRootPath,
        recursive: true,
        maxDepth: 4,
        includeHidden: false,
      },
    });

    if (!result.success) {
      return `Project listing failed: ${result.error || 'Unknown error'}`;
    }

    const items = (result.data as any)?.items as Array<{ path: string; type: 'file' | 'directory'; extension?: string }> | undefined;
    if (!items || items.length === 0) return 'Project listing returned no items.';

    const allowedExt = new Set(['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'sql', 'css', 'html', 'yml', 'yaml']);
    const files = items
      .filter((i) => i.type === 'file')
      .filter((i) => {
        const ext = (i.extension || path.extname(i.path).slice(1)).toLowerCase();
        return !ext || allowedExt.has(ext);
      })
      .map((i) => i.path)
      .sort();

    const maxLines = 500;
    const truncated = files.length > maxLines ? files.slice(0, maxLines) : files;

    return [
      'Project files (truncated):',
      ...truncated.map((p) => `- ${p}`),
      files.length > maxLines ? `... (${files.length - maxLines} more)` : '',
    ].filter(Boolean).join('\n');
  }

  private async readExistingImpactedFiles(
    workspaceRootPath: string,
    existingImpactedFiles: string[]
  ): Promise<string> {
    if (!this.toolRouter) return '';
    const maxFiles = 10;
    const filesToRead = (existingImpactedFiles || []).filter(Boolean).slice(0, maxFiles);
    if (filesToRead.length === 0) return '';

    const chunks: string[] = ['\nImpacted file contents (for planning):'];

    for (const filePath of filesToRead) {
      const res = await this.toolRouter.execute({
        toolName: 'read_file',
        sessionId: 'planner',
        parameters: {
          filePath,
          basePath: workspaceRootPath,
        },
      });

      if (!res.success) {
        chunks.push(`\n### ${filePath}\n[read_file failed] ${res.error || 'Unknown error'}`);
        continue;
      }

      const content = (res.data as any)?.content as string | undefined;
      const safeContent = (content || '').slice(0, 12000);
      chunks.push(`\n### ${filePath}\n${safeContent}${(content && content.length > 12000) ? '\n... [truncated]' : ''}`);
    }

    return chunks.join('\n');
  }

  private async inferExistingImpactedFiles(
    userRequest: string,
    workspaceContext: string,
    workspaceRootPath: string,
    model?: string
  ): Promise<string[]> {
    const projectFiles = await this.listProjectFilesForContext(workspaceRootPath);
    if (!projectFiles) return [];

    const prompt = `You are selecting existing files to read BEFORE generating a development plan.

Return ONLY valid JSON with this exact schema:
{ "existingImpactedFiles": ["path1", "path2"] }

Rules:
- existingImpactedFiles MUST contain ONLY file paths that appear in the provided project file list.
- Choose the MINIMUM set of existing files needed to understand the change.
- Prefer key entrypoints, stores, routers, and the most relevant components.
- Max 10 files.

User request:\n${userRequest}\n\nWorkspace context:\n${workspaceContext}\n\n${projectFiles}`;

    let lastAttempt = '';
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const messages: OpenRouterMessage[] = attempt === 1
        ? [{ role: 'user', content: prompt }]
        : [
            { role: 'user', content: prompt },
            { role: 'assistant', content: lastAttempt },
            {
              role: 'user',
              content:
                `The previous response was not valid JSON. Return ONLY valid JSON with schema {"existingImpactedFiles": [...]}.\n\nPrevious attempt:\n${lastAttempt}`,
            },
          ];

      const response = await this.client.chat({
        model,
        messages,
        max_tokens: 1200,
        temperature: 0,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return [];

      try {
        const jsonText = content.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(jsonText) as { existingImpactedFiles?: unknown };
        const list = Array.isArray(parsed.existingImpactedFiles) ? parsed.existingImpactedFiles : [];
        return list.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
      } catch {
        lastAttempt = content;
        if (attempt === maxAttempts) return [];
      }
    }

    return [];
  }

  async generatePlan(
    userRequest: string,
    conversationHistory: ChatMessage[],
    workspaceContext?: string,
    workspaceRootPath?: string,
    model?: string,
    projectIntelligence?: string
  ): Promise<ExecutionPlan> {
    const intelligenceBlock = projectIntelligence ? `\n\n${projectIntelligence}` : '';
    const systemContextBase = workspaceContext
      ? `${PLANNER_SYSTEM_PROMPT}\n\nWorkspace context:\n${workspaceContext}${intelligenceBlock}`
      : `${PLANNER_SYSTEM_PROMPT}${intelligenceBlock}`;

    // Pre-read phase: list project files, infer existing impacted files, read them, and append their contents.
    let systemContext = systemContextBase;
    if (this.toolRouter && workspaceRootPath) {
      try {
        const existingImpactedFiles = await this.inferExistingImpactedFiles(
          userRequest,
          workspaceContext || '',
          workspaceRootPath,
          model
        );
        const impactedContents = await this.readExistingImpactedFiles(workspaceRootPath, existingImpactedFiles);
        if (impactedContents) {
          systemContext = `${systemContextBase}\n\n${impactedContents}`;
        }
      } catch (error) {
        // Planner should remain resilient: if pre-read fails, fall back to normal planning.
        systemContext = systemContextBase;
      }
    }

    const recentHistory = conversationHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10);

    // Avoid duplicating the most recent user request: processMessage already appended it to session.messages
    const dedupedHistory = (() => {
      const last = recentHistory[recentHistory.length - 1];
      if (last && last.role === 'user' && last.content.trim() === userRequest.trim()) {
        return recentHistory.slice(0, -1);
      }
      return recentHistory;
    })();

    const baseMessages: OpenRouterMessage[] = [
      { role: 'system', content: systemContext },
      ...dedupedHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: `Generate an execution plan for: ${userRequest}` },
    ];

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
    } | null = null;

    let content: string | null | undefined;
    let lastAttempt = '';
    const maxAttempts = 3; // initial + up to 2 retries

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptMessages: OpenRouterMessage[] = attempt === 1
        ? baseMessages
        : [
            ...baseMessages,
            { role: 'assistant', content: lastAttempt },
            {
              role: 'user',
              content:
                `The previous response was not valid JSON. Please return ONLY valid JSON matching the required schema, with no explanation and no markdown fences.\n\nPrevious attempt:\n${lastAttempt}`,
            },
          ];

      const response = await this.client.chat({
        model,
        messages: attemptMessages,
        max_tokens: 4096,
        temperature: 0,
      });

      content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from planner');
      }

      // Try parsing; if it fails, loop and retry.
      try {
        const jsonText = content.replace(/```json\n?|\n?```/g, '').trim();
        rawPlan = JSON.parse(jsonText);
        break;
      } catch {
        lastAttempt = content;
        if (attempt === maxAttempts) {
          throw new Error(`Failed to parse plan JSON after ${maxAttempts} attempts: ${content}`);
        }
      }
    }

    if (!rawPlan) {
      throw new Error('Planner did not return a plan');
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
