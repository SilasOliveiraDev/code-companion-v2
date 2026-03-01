import { MCPToolResult } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

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
      const absolutePath = path.isAbsolute(file.path)
        ? file.path
        : path.join(basePath, file.path);

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
