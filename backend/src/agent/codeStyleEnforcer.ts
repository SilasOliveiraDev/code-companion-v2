import { ToolRouter } from '../mcp/toolRouter';
import * as path from 'path';

export interface StyleEnforcerResult {
  tool: string;
  success: boolean;
  fixed: boolean;
  output: string;
}

export interface CodeQualityReport {
  prettier: StyleEnforcerResult | null;
  eslint: StyleEnforcerResult | null;
  typescript: StyleEnforcerResult | null;
  allPassed: boolean;
}

const TS_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx']);

function isFormattableFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return TS_EXTENSIONS.has(ext) || ['css', 'json', 'md', 'html'].includes(ext);
}

/**
 * Detects which sub-project root contains the given file path.
 */
function detectProjectRoot(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, path.resolve(workspaceRoot, filePath)).replace(/\\/g, '/');
  if (rel.startsWith('frontend/')) return path.join(workspaceRoot, 'frontend');
  if (rel.startsWith('backend/')) return path.join(workspaceRoot, 'backend');
  return workspaceRoot;
}

/**
 * Checks whether a tool binary/config exists in the project before attempting to run it.
 */
async function toolAvailable(
  toolRouter: ToolRouter,
  command: string,
  cwd: string
): Promise<boolean> {
  const result = await toolRouter.execute({
    toolName: 'run_command',
    sessionId: 'style-enforcer',
    parameters: { command, cwd, timeout: 10_000 },
  });
  return result.success;
}

export class CodeStyleEnforcer {
  private toolRouter: ToolRouter;

  constructor(toolRouter: ToolRouter) {
    this.toolRouter = toolRouter;
  }

  /**
   * Runs available code quality tools (Prettier, ESLint --fix, tsc --noEmit)
   * on the given files after code generation. Returns a report of what ran
   * and whether issues were found/fixed.
   */
  async enforceStyle(
    touchedFiles: string[],
    workspaceRoot: string
  ): Promise<CodeQualityReport> {
    const report: CodeQualityReport = {
      prettier: null,
      eslint: null,
      typescript: null,
      allPassed: true,
    };

    if (touchedFiles.length === 0) return report;

    // Group files by sub-project
    const projectRoots = new Set(
      touchedFiles.map((f) => detectProjectRoot(f, workspaceRoot))
    );

    for (const projectRoot of projectRoots) {
      const filesInProject = touchedFiles.filter(
        (f) => detectProjectRoot(f, workspaceRoot) === projectRoot
      );

      const formattableFiles = filesInProject.filter(isFormattableFile);
      const relativePaths = formattableFiles.map((f) =>
        path.relative(projectRoot, path.resolve(workspaceRoot, f)).replace(/\\/g, '/')
      );

      if (relativePaths.length === 0) continue;

      const fileArgs = relativePaths.map((p) => `"${p}"`).join(' ');

      // 1. Prettier
      const prettierResult = await this.runPrettier(projectRoot, fileArgs);
      if (prettierResult) {
        report.prettier = prettierResult;
        if (!prettierResult.success) report.allPassed = false;
      }

      // 2. ESLint --fix
      const tsFiles = relativePaths.filter((f) => {
        const ext = path.extname(f).slice(1).toLowerCase();
        return TS_EXTENSIONS.has(ext);
      });
      if (tsFiles.length > 0) {
        const tsFileArgs = tsFiles.map((p) => `"${p}"`).join(' ');
        const eslintResult = await this.runEslint(projectRoot, tsFileArgs);
        if (eslintResult) {
          report.eslint = eslintResult;
          if (!eslintResult.success) report.allPassed = false;
        }
      }

      // 3. tsc --noEmit (already done by ValidationService, but run here for completeness per project)
      const hasTsFiles = filesInProject.some((f) => {
        const ext = path.extname(f).slice(1).toLowerCase();
        return TS_EXTENSIONS.has(ext);
      });
      if (hasTsFiles) {
        const tscResult = await this.runTsc(projectRoot);
        if (tscResult) {
          report.typescript = tscResult;
          if (!tscResult.success) report.allPassed = false;
        }
      }
    }

    return report;
  }

  private async runPrettier(
    projectRoot: string,
    fileArgs: string
  ): Promise<StyleEnforcerResult | null> {
    // Check if prettier config or dependency exists
    const hasConfig = await toolAvailable(
      this.toolRouter,
      'npx prettier --version',
      projectRoot
    );
    if (!hasConfig) return null;

    const result = await this.toolRouter.execute({
      toolName: 'run_command',
      sessionId: 'style-enforcer',
      parameters: {
        command: `npx prettier --write ${fileArgs}`,
        cwd: projectRoot,
        timeout: 30_000,
      },
    });

    const data = result.data as { stdout?: string; stderr?: string } | undefined;
    const output = [data?.stdout, data?.stderr].filter(Boolean).join('\n');

    return {
      tool: 'prettier',
      success: result.success,
      fixed: result.success,
      output: output.slice(0, 2000),
    };
  }

  private async runEslint(
    projectRoot: string,
    fileArgs: string
  ): Promise<StyleEnforcerResult | null> {
    const hasEslint = await toolAvailable(
      this.toolRouter,
      'npx eslint --version',
      projectRoot
    );
    if (!hasEslint) return null;

    const result = await this.toolRouter.execute({
      toolName: 'run_command',
      sessionId: 'style-enforcer',
      parameters: {
        command: `npx eslint --fix ${fileArgs}`,
        cwd: projectRoot,
        timeout: 60_000,
      },
    });

    const data = result.data as { stdout?: string; stderr?: string } | undefined;
    const output = [data?.stdout, data?.stderr].filter(Boolean).join('\n');

    return {
      tool: 'eslint',
      success: result.success,
      fixed: result.success,
      output: output.slice(0, 2000),
    };
  }

  private async runTsc(projectRoot: string): Promise<StyleEnforcerResult | null> {
    const result = await this.toolRouter.execute({
      toolName: 'run_command',
      sessionId: 'style-enforcer',
      parameters: {
        command: 'npx tsc --noEmit --skipLibCheck --pretty false',
        cwd: projectRoot,
        timeout: 60_000,
      },
    });

    const data = result.data as { stdout?: string; stderr?: string } | undefined;
    const output = [data?.stdout, data?.stderr].filter(Boolean).join('\n');

    return {
      tool: 'tsc',
      success: result.success,
      fixed: false,
      output: output.slice(0, 3000),
    };
  }
}
