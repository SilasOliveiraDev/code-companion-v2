import * as path from 'path';

function isPathInsideBase(basePath: string, candidatePath: string): boolean {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Normalizes tool arguments so relative paths resolve against the selected workspace root.
 *
 * This prevents common failures where the model emits paths like "src/..." but omits basePath,
 * causing tools to resolve against the backend process cwd instead of the selected repo.
 */
export function applyWorkspaceBasePath(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRootPath: string
): Record<string, unknown> {
  if (!workspaceRootPath?.trim()) return args;

  const normalized: Record<string, unknown> = { ...args };
  const workspaceBase = path.resolve(workspaceRootPath);

  // Special-case: run_command uses `cwd` rather than `basePath`.
  if (toolName === 'run_command') {
    const providedCwd = typeof normalized.cwd === 'string' ? normalized.cwd : undefined;
    if (!providedCwd) {
      normalized.cwd = workspaceBase;
      return normalized;
    }

    const resolved = path.isAbsolute(providedCwd)
      ? path.resolve(providedCwd)
      : path.resolve(workspaceBase, providedCwd);

    normalized.cwd = isPathInsideBase(workspaceBase, resolved) ? resolved : workspaceBase;
    return normalized;
  }

  // Tools that support or require basePath.
  const supportsBasePath = new Set([
    'read_file',
    'list_directory',
    'delete_file',
    'move_file',
    'copy_file',
    'search_files',
    'create_directory',
    'get_file_info',
    'write_files',
    'edit_file',
  ]);

  if (!supportsBasePath.has(toolName)) return normalized;

  const providedBasePath = typeof normalized.basePath === 'string' ? normalized.basePath : undefined;
  if (!providedBasePath) {
    normalized.basePath = workspaceBase;
    return normalized;
  }

  // If model passes a relative basePath (e.g. "src"), resolve it under the workspace root.
  const resolved = path.isAbsolute(providedBasePath)
    ? path.resolve(providedBasePath)
    : path.resolve(workspaceBase, providedBasePath);

  // Never allow tools to escape the selected workspace root via basePath.
  normalized.basePath = isPathInsideBase(workspaceBase, resolved) ? resolved : workspaceBase;
  return normalized;
}
