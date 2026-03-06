import { ExecutionPlan, PlanStep, MCPToolCall } from '../types';
import { ToolRouter } from '../mcp/toolRouter';
import { getOpenRouterClient, OpenRouterClient, OpenRouterMessage } from '../integrations/openrouter';
import { applyWorkspaceBasePath } from './toolArgs';
import { FileSystemService } from '../workspace/fileSystem';
import { ValidationService } from './validationService';
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

const EXECUTOR_SYSTEM_PROMPT = `You are a senior full-stack software engineer executing an approved development plan.

You have access to tools to create files, run commands, and interact with external services.

When you need to execute terminal commands (npm, npx, scripts, builds, tests), use the run_command tool.

CRITICAL EDITING RULE:
- For EXISTING files, ALWAYS use edit_file (surgical edits).
- write_files is ONLY for creating NEW files. Never overwrite existing files with write_files.

Guidelines:
- Execute each step methodically and in order
- Use tools to make concrete changes, do not just describe what to do
- Write clean, modular, well-structured code
- Follow established patterns in the existing codebase
- Prioritize security: never expose secrets, validate inputs, use environment variables
- After each major step, confirm what was done
- If a step fails, report the error clearly and suggest remediation

IMPORTANT RELIABILITY RULE:
- Never assume file paths exist. If you need a file, first use list_directory or search_files to confirm the actual structure.

When writing code:
- Use TypeScript where possible
- Follow the project's existing style and conventions
- Write reusable, maintainable components
- Include proper error handling
- Keep UI consistent and professional

${UI_FRONTEND_CONTEXT}`;

const MAX_REPAIR_ATTEMPTS = 3;

export class PlanExecutor {
  private client: OpenRouterClient;
  private toolRouter: ToolRouter;
  private validation: ValidationService;

  constructor(toolRouter: ToolRouter) {
    this.client = getOpenRouterClient();
    this.toolRouter = toolRouter;
    this.validation = new ValidationService(toolRouter);
  }

  async executeStep(
    step: PlanStep,
    plan: ExecutionPlan,
    workspaceContext: string,
    sessionId: string,
    workspaceRootPath: string,
    onProgress?: (message: string) => void,
    model?: string
  ): Promise<{ success: boolean; message: string; toolCalls: MCPToolCall[] }> {
    const toolCalls: MCPToolCall[] = [];
    const toolErrors: string[] = [];
    let anyToolFailed = false;

    const isUIStep = this.isUIStep(step, plan);
    const extraUIContext = isUIStep ? this.buildUIContext(workspaceRootPath) : '';
    const uiPreflightInstructions = isUIStep ? `

  ATENÇÃO - PASSO DE UI DETECTADO:
  Antes de escrever qualquer componente/estilo:
  1. Use list_directory para entender a estrutura existente em frontend/src/components/
  2. Use read_file para ler 1-2 componentes similares
  3. Use EXCLUSIVAMENTE as classes do design system (btn-primary, input, badge, panel-header, etc.)
  4. Evite inventar novas classes/tokens; use os tokens existentes (bg-surface-*, text-accent-*)` : '';

    const prompt = `Execute this step from the approved plan:

Plan Goal: ${plan.goal}

Current Step (${step.order}/${plan.steps.length}):
- Description: ${step.description}
- Action: ${step.action}
- Files: ${step.files.join(', ') || 'none specified'}

Workspace context:
${workspaceContext}

${extraUIContext}

${uiPreflightInstructions}

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

          args = applyWorkspaceBasePath(toolCall.function.name, args, workspaceRootPath);

          const mcpToolCall: MCPToolCall = {
            toolName: toolCall.function.name,
            parameters: args,
            sessionId,
          };

          toolCalls.push(mcpToolCall);
          onProgress?.(`Executing tool: ${toolCall.function.name}`);

          let result: Awaited<ReturnType<ToolRouter['execute']>>;
          try {
            result = await this.toolRouter.execute(mcpToolCall);
          } catch (error) {
            result = {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown tool execution error',
            };
          }

          if (!result.success) {
            anyToolFailed = true;
            const err = result.error || 'Unknown tool error';
            toolErrors.push(`${toolCall.function.name}: ${err}`);
            onProgress?.(`Tool failed: ${toolCall.function.name} - ${err}`);
          }

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
      success: !anyToolFailed,
      message:
        anyToolFailed
          ? `One or more tools failed while executing this step:\n${toolErrors.join('\n')}\n\n${finalMessage}`.trim()
          : finalMessage,
      toolCalls,
    };
  }

  private isUIStep(step: PlanStep, plan: ExecutionPlan): boolean {
    const text = `${plan.goal}\n${step.description}\n${step.action}\n${step.files.join(' ')}`.toLowerCase();
    const patterns = [
      /\b(ui|ux|interface|screen|page|component|layout|design)\b/i,
      /\b(frontend|react|tailwind|zustand|tsx|css)\b/i,
      /\b(button|input|modal|dialog|drawer|table|list|card|sidebar)\b/i,
      /frontend\//i,
      /\/components\//i,
      /\.tsx\b/i,
      /\.css\b/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  private buildUIContext(workspaceRootPath: string): string {
    const fsService = new FileSystemService(workspaceRootPath);
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
        // skip missing files
      }
    }

    return contextParts.length > 0
      ? `\n\n## Arquivos-chave do Frontend (leia antes de modificar)\n${contextParts.join('\n\n')}`
      : '';
  }

  async executePlan(
    plan: ExecutionPlan,
    workspaceContext: string,
    sessionId: string,
    workspaceRootPath: string,
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
          sessionId,
          workspaceRootPath,
          (message) => onStepProgress?.(step, message),
          model
        );

        if (result.success) {
          // --- Validation Loop (Fase 2.1) ---
          const needsValidation = step.action === 'create' || step.action === 'modify';
          const tsFiles = needsValidation
            ? this.validation.filterValidatableFiles(step.files)
            : [];

          if (tsFiles.length > 0) {
            onStepProgress?.(step, '🔍 Validating TypeScript...');
            const validationOk = await this.validateAndRepair(
              tsFiles,
              workspaceRootPath,
              sessionId,
              model,
              (msg) => onStepProgress?.(step, msg)
            );
            if (!validationOk) {
              step.status = 'failed';
              step.error = 'TypeScript validation failed after repair attempts';
              errors.push(`Step ${step.order}: TypeScript validation failed after ${MAX_REPAIR_ATTEMPTS} repair attempts`);
              continue;
            }
            onStepProgress?.(step, '✅ TypeScript validation passed');
          }

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

  // =========================================================================
  // Validation + Self-Healing Loop  (Fases 2.1 & 2.2)
  // =========================================================================

  /**
   * Validates TypeScript compilation for the given files.
   * If errors are found, asks the LLM to repair them and re-validates
   * for up to MAX_REPAIR_ATTEMPTS cycles.
   *
   * Returns `true` when validation passes (possibly after repairs).
   */
  async validateAndRepair(
    files: string[],
    workspaceRootPath: string,
    sessionId: string,
    model?: string,
    onProgress?: (message: string) => void
  ): Promise<boolean> {
    // Validate each unique sub-project root only once
    const projectRoots = new Set(
      files.map((f) => {
        const rel = path.relative(workspaceRootPath, path.resolve(workspaceRootPath, f)).replace(/\\/g, '/');
        if (rel.startsWith('frontend/')) return 'frontend';
        if (rel.startsWith('backend/')) return 'backend';
        return '';
      })
    );

    for (const subProject of projectRoots) {
      const projectRoot = subProject
        ? path.join(workspaceRootPath, subProject)
        : workspaceRootPath;

      for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
        const vResult = await this.validation.validateTypeScript(
          files[0], // any file — we validate the whole sub-project
          workspaceRootPath
        );

        if (vResult.valid) break;

        if (attempt === MAX_REPAIR_ATTEMPTS) {
          onProgress?.(`❌ TypeScript errors remain after ${MAX_REPAIR_ATTEMPTS} repair attempts`);
          return false;
        }

        onProgress?.(`🔧 TypeScript errors detected — repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}...`);

        const repaired = await this.attemptRepair(
          vResult.errors,
          files,
          workspaceRootPath,
          sessionId,
          model,
          onProgress
        );

        if (!repaired) {
          onProgress?.(`❌ Repair attempt ${attempt} produced no fixes`);
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Sends the TypeScript errors + affected file contents to the LLM and
   * lets it use tools (edit_file / write_files) to fix them.
   */
  private async attemptRepair(
    errors: string[],
    files: string[],
    workspaceRootPath: string,
    sessionId: string,
    model?: string,
    onProgress?: (message: string) => void
  ): Promise<boolean> {
    // Read the contents of affected files so the LLM has full context
    const fileContents: string[] = [];
    for (const filePath of files.slice(0, 5)) {
      const readResult = await this.toolRouter.execute({
        toolName: 'read_file',
        sessionId,
        parameters: { filePath, basePath: workspaceRootPath },
      });
      if (readResult.success) {
        const content = (readResult.data as any)?.content ?? '';
        fileContents.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
      }
    }

    const repairPrompt = `TypeScript compilation errors were detected after writing code.
Fix ALL the errors below. Use the edit_file tool to make surgical corrections.

## Errors
${errors.join('\n')}

## File Contents
${fileContents.join('\n\n')}

Fix every error now. Do NOT add comments explaining the fix — just fix the code.`;

    const tools = OpenRouterClient.convertAnthropicTools(this.toolRouter.getToolDefinitionsForClaude());

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content:
          'You are a TypeScript error repair agent. Your only job is to fix compilation errors using edit_file. Be precise and minimal.',
      },
      { role: 'user', content: repairPrompt },
    ];

    let madeChanges = false;
    let continueLoop = true;

    while (continueLoop) {
      const response = await this.client.chat({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 4096,
      });

      const choice = response.choices[0];
      const assistantMessage = choice.message;

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

          args = applyWorkspaceBasePath(toolCall.function.name, args, workspaceRootPath);

          onProgress?.(`🔧 Repair: ${toolCall.function.name} ${(args as any).filePath || ''}`);

          const result = await this.toolRouter.execute({
            toolName: toolCall.function.name,
            parameters: args,
            sessionId,
          });

          if (result.success && (toolCall.function.name === 'edit_file' || toolCall.function.name === 'write_files')) {
            madeChanges = true;
          }

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

    return madeChanges;
  }
}
