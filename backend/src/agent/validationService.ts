import { ToolRouter } from '../mcp/toolRouter';
import * as path from 'path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BuildResult {
  success: boolean;
  output: string;
}

const TS_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx']);

function isTypeScriptFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return TS_EXTENSIONS.has(ext);
}

/**
 * Detects which sub-project root contains the given file
 * (e.g. "backend" or "frontend") so tsc runs from the right tsconfig.
 */
function detectProjectRoot(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, path.resolve(workspaceRoot, filePath)).replace(/\\/g, '/');

  if (rel.startsWith('frontend/') || rel.startsWith('frontend\\')) {
    return path.join(workspaceRoot, 'frontend');
  }
  if (rel.startsWith('backend/') || rel.startsWith('backend\\')) {
    return path.join(workspaceRoot, 'backend');
  }
  // fallback: use workspace root
  return workspaceRoot;
}

export class ValidationService {
  private toolRouter: ToolRouter;

  constructor(toolRouter: ToolRouter) {
    this.toolRouter = toolRouter;
  }

  /**
   * Runs `tsc --noEmit --skipLibCheck` in the sub-project that contains `filePath`
   * and returns parsed errors (if any).
   */
  async validateTypeScript(filePath: string, workspaceRoot: string): Promise<ValidationResult> {
    if (!isTypeScriptFile(filePath)) {
      return { valid: true, errors: [] };
    }

    const projectRoot = detectProjectRoot(filePath, workspaceRoot);

    const result = await this.toolRouter.execute({
      toolName: 'run_command',
      sessionId: 'validation',
      parameters: {
        command: 'npx tsc --noEmit --skipLibCheck --pretty false',
        cwd: projectRoot,
        timeout: 60_000,
      },
    });

    if (result.success) {
      return { valid: true, errors: [] };
    }

    // tsc returns exit code != 0 when there are errors; parse them from stdout/stderr
    const data = result.data as { stdout?: string; stderr?: string } | undefined;
    const output = [data?.stdout, data?.stderr].filter(Boolean).join('\n');

    const errors = output
      .split('\n')
      .filter((line) => /\.tsx?|\.jsx?\(\d+,\d+\):\s*error\s+TS\d+/.test(line) || /error TS\d+:/.test(line))
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : [output.slice(0, 3000)],
    };
  }

  /**
   * Runs the project build command and returns success/output.
   */
  async validateBuild(workspaceRoot: string, subProject?: 'frontend' | 'backend'): Promise<BuildResult> {
    const cwd = subProject ? path.join(workspaceRoot, subProject) : workspaceRoot;
    const command = subProject
      ? 'npx tsc --noEmit --skipLibCheck --pretty false'
      : 'npm run build';

    const result = await this.toolRouter.execute({
      toolName: 'run_command',
      sessionId: 'validation',
      parameters: { command, cwd, timeout: 120_000 },
    });

    const data = result.data as { stdout?: string; stderr?: string } | undefined;
    const output = [data?.stdout, data?.stderr].filter(Boolean).join('\n');

    return {
      success: result.success,
      output: output.slice(0, 5000),
    };
  }

  /**
   * Returns all TypeScript/TSX/JSX files from a list of touched paths.
   */
  filterValidatableFiles(touchedFiles: string[]): string[] {
    return touchedFiles.filter((f) => isTypeScriptFile(f));
  }
}
