import { MCPToolResult } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

function resolvePathWithinBase(inputPath: string, basePath: string): { ok: true; absolutePath: string } | { ok: false; error: string } {
  const base = path.resolve(basePath);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(base, inputPath);
  const relative = path.relative(base, candidate);

  const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (!isInside) {
    return {
      ok: false,
      error: `Path escapes basePath: ${inputPath}`,
    };
  }

  return { ok: true, absolutePath: candidate };
}

export interface FileWrite {
  path: string;
  content: string;
  encoding?: BufferEncoding;
}

export interface WriteFilesParams {
  files: FileWrite[];
  basePath: string;
}

export async function writeFiles(params: WriteFilesParams): Promise<MCPToolResult> {
  const { files, basePath } = params;
  const written: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const resolved = resolvePathWithinBase(file.path, basePath);
      if (!resolved.ok) {
        errors.push(`${file.path}: ${resolved.error}`);
        continue;
      }
      const absolutePath = resolved.absolutePath;

      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(absolutePath, file.content, file.encoding || 'utf8');
      written.push(absolutePath);
    } catch (error) {
      errors.push(
        `${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  if (errors.length > 0 && written.length === 0) {
    return {
      success: false,
      error: `Failed to write files: ${errors.join('; ')}`,
    };
  }

  return {
    success: true,
    data: {
      written,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully wrote ${written.length} file(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`,
    },
  };
}
