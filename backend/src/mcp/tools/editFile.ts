import { MCPToolResult } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

function resolvePathWithinBase(
  inputPath: string,
  basePath: string
): { ok: true; absolutePath: string } | { ok: false; error: string } {
  const base = path.resolve(basePath);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(base, inputPath);
  const relative = path.relative(base, candidate);

  const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (!isInside) {
    return { ok: false, error: `Path escapes basePath: ${inputPath}` };
  }

  return { ok: true, absolutePath: candidate };
}

export type EditFileOperation = 'replace' | 'insert_after' | 'delete';

export interface EditFileParams {
  filePath: string;
  basePath: string;
  operation: EditFileOperation;
  target: string;
  replacement?: string;
  content?: string;
  encoding?: BufferEncoding;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    count++;
    idx = found + needle.length;
  }
  return count;
}

function insertAfterExact(source: string, anchor: string, insertContent: string): string {
  const idx = source.indexOf(anchor);
  if (idx === -1) return source;

  const insertPos = idx + anchor.length;
  const needsLeadingNewline =
    insertPos < source.length && source[insertPos] !== '\n' && !insertContent.startsWith('\n');

  const safeInsert = needsLeadingNewline ? `\n${insertContent}` : insertContent;
  return source.slice(0, insertPos) + safeInsert + source.slice(insertPos);
}

export async function editFile(params: EditFileParams): Promise<MCPToolResult> {
  const { filePath, basePath, operation, target, replacement, content, encoding = 'utf8' } = params;

  if (!filePath || !filePath.trim()) return { success: false, error: 'filePath is required' };
  if (!basePath || !basePath.trim()) return { success: false, error: 'basePath is required' };
  if (!operation) return { success: false, error: 'operation is required' };
  if (typeof target !== 'string' || target.length === 0) return { success: false, error: 'target is required' };

  const resolved = resolvePathWithinBase(filePath, basePath);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const absolutePath = resolved.absolutePath;

  if (!fs.existsSync(absolutePath)) {
    return { success: false, error: `File not found (use write_files to create new files): ${absolutePath}` };
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    return { success: false, error: `Path is a directory, not a file: ${absolutePath}` };
  }

  let original: string;
  try {
    original = fs.readFileSync(absolutePath, encoding);
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  const occurrences = countOccurrences(original, target);
  if (occurrences !== 1) {
    return {
      success: false,
      error: occurrences === 0
        ? 'Target string not found (must match exactly once)'
        : `Target string is ambiguous (found ${occurrences} occurrences; must match exactly once)`,
      data: {
        filePath: absolutePath,
        operation,
        occurrences,
      },
    };
  }

  let updated = original;
  if (operation === 'replace') {
    if (typeof replacement !== 'string') return { success: false, error: 'replacement is required for replace' };
    updated = original.replace(target, replacement);
  } else if (operation === 'insert_after') {
    if (typeof content !== 'string') return { success: false, error: 'content is required for insert_after' };
    updated = insertAfterExact(original, target, content);
  } else if (operation === 'delete') {
    updated = original.replace(target, '');
  } else {
    return { success: false, error: `Unknown operation: ${operation}` };
  }

  try {
    fs.writeFileSync(absolutePath, updated, encoding);
  } catch (error) {
    return {
      success: false,
      error: `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  return {
    success: true,
    data: {
      filePath: absolutePath,
      operation,
      occurrences,
      changed: updated !== original,
    },
  };
}
