import { MCPToolResult } from '../../types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface RunCommandParams {
  command: string;
  cwd: string;
  timeout?: number;
  env?: Record<string, string>;
}

export async function runCommand(params: RunCommandParams): Promise<MCPToolResult> {
  const { command, cwd, timeout, env } = params;

  if (!command || !command.trim()) {
    return { success: false, error: 'command is required' };
  }

  if (!cwd || !cwd.trim()) {
    return { success: false, error: 'cwd is required' };
  }

  const resolvedCwd = path.resolve(cwd);
  if (!fs.existsSync(resolvedCwd)) {
    return { success: false, error: `cwd does not exist: ${resolvedCwd}` };
  }

  const stat = fs.statSync(resolvedCwd);
  if (!stat.isDirectory()) {
    return { success: false, error: `cwd is not a directory: ${resolvedCwd}` };
  }

  const effectiveTimeout = typeof timeout === 'number' && timeout > 0 ? timeout : 10 * 60 * 1000;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: resolvedCwd,
      timeout: effectiveTimeout,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        ...(env || {}),
      },
    });

    return {
      success: true,
      data: {
        cwd: resolvedCwd,
        command,
        stdout,
        stderr,
        exitCode: 0,
        success: true,
      },
    };
  } catch (error: any) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    const code = typeof error?.code === 'number' ? error.code : undefined;
    const signal = typeof error?.signal === 'string' ? error.signal : undefined;
    const message = error instanceof Error ? error.message : 'Unknown run_command error';

    return {
      success: false,
      error: [
        `Command failed: ${message}`,
        code !== undefined ? `Exit code: ${code}` : null,
        signal ? `Signal: ${signal}` : null,
      ].filter(Boolean).join('\n'),
      data: {
        cwd: resolvedCwd,
        command,
        stdout,
        stderr,
        code,
        signal,
        exitCode: typeof code === 'number' ? code : 1,
        success: false,
      },
    };
  }
}
