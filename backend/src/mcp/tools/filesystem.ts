import { MCPToolResult } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

function resolvePathWithinBase(inputPath: string, basePath?: string): { ok: true; absolutePath: string } | { ok: false; error: string } {
  if (!basePath) {
    return { ok: true, absolutePath: inputPath };
  }

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

// ============================================
// Read File Tool
// ============================================

export interface ReadFileParams {
  filePath: string;
  basePath?: string;
  encoding?: BufferEncoding;
  startLine?: number;
  endLine?: number;
}

export async function readFile(params: ReadFileParams): Promise<MCPToolResult> {
  const { filePath, basePath, encoding = 'utf8', startLine, endLine } = params;

  try {
    const resolved = resolvePathWithinBase(filePath, basePath);
    if (!resolved.ok) {
      return { success: false, error: resolved.error };
    }
    const absolutePath = resolved.absolutePath;

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `File not found: ${absolutePath}`,
      };
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      return {
        success: false,
        error: `Path is a directory, not a file: ${absolutePath}`,
      };
    }

    let content = fs.readFileSync(absolutePath, encoding);

    // Handle line range if specified
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = (startLine || 1) - 1;
      const end = endLine || lines.length;
      content = lines.slice(start, end).join('\n');
    }

    return {
      success: true,
      data: {
        path: absolutePath,
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================
// List Directory Tool
// ============================================

export interface ListDirectoryParams {
  dirPath: string;
  basePath?: string;
  recursive?: boolean;
  maxDepth?: number;
  includeHidden?: boolean;
  pattern?: string;
}

interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  extension?: string;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 
  '.cache', 'coverage', '.turbo', '.venv', 'venv',
]);

export async function listDirectory(params: ListDirectoryParams): Promise<MCPToolResult> {
  const { 
    dirPath, 
    basePath, 
    recursive = false, 
    maxDepth = 3, 
    includeHidden = false,
    pattern 
  } = params;

  try {
    const resolved = resolvePathWithinBase(dirPath, basePath);
    if (!resolved.ok) {
      return { success: false, error: resolved.error };
    }
    const absolutePath = resolved.absolutePath;

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `Directory not found: ${absolutePath}`,
      };
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      return {
        success: false,
        error: `Path is not a directory: ${absolutePath}`,
      };
    }

    const regex = pattern ? new RegExp(pattern, 'i') : null;
    const items: FileInfo[] = [];

    function scanDir(currentPath: string, depth: number) {
      if (depth > maxDepth) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        // Skip hidden files unless requested
        if (!includeHidden && entry.name.startsWith('.')) continue;
        
        // Skip ignored directories
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(absolutePath, fullPath);

        // Apply pattern filter if specified
        if (regex && !regex.test(entry.name)) continue;

        const info: FileInfo = {
          name: entry.name,
          path: relativePath || entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        };

        if (entry.isFile()) {
          try {
            const fileStat = fs.statSync(fullPath);
            info.size = fileStat.size;
            info.modified = fileStat.mtime.toISOString();
            info.extension = path.extname(entry.name).slice(1) || undefined;
          } catch { /* ignore */ }
        }

        items.push(info);

        if (recursive && entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        }
      }
    }

    scanDir(absolutePath, 0);

    // Sort: directories first, then alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      success: true,
      data: {
        path: absolutePath,
        items,
        totalFiles: items.filter(i => i.type === 'file').length,
        totalDirs: items.filter(i => i.type === 'directory').length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to list directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================
// Delete File/Directory Tool
// ============================================

export interface DeleteParams {
  targetPath: string;
  basePath?: string;
  recursive?: boolean;
}

export async function deleteFileOrDir(params: DeleteParams): Promise<MCPToolResult> {
  const { targetPath, basePath, recursive = false } = params;

  try {
    const resolved = resolvePathWithinBase(targetPath, basePath);
    if (!resolved.ok) {
      return { success: false, error: resolved.error };
    }
    const absolutePath = resolved.absolutePath;

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `Path not found: ${absolutePath}`,
      };
    }

    const stat = fs.statSync(absolutePath);

    if (stat.isDirectory()) {
      if (recursive) {
        fs.rmSync(absolutePath, { recursive: true, force: true });
      } else {
        fs.rmdirSync(absolutePath);
      }
    } else {
      fs.unlinkSync(absolutePath);
    }

    return {
      success: true,
      data: {
        deleted: absolutePath,
        type: stat.isDirectory() ? 'directory' : 'file',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================
// Move/Rename Tool
// ============================================

export interface MoveParams {
  sourcePath: string;
  destPath: string;
  basePath?: string;
  overwrite?: boolean;
}

export async function moveFile(params: MoveParams): Promise<MCPToolResult> {
  const { sourcePath, destPath, basePath, overwrite = false } = params;

  try {
    const resolvedSource = resolvePathWithinBase(sourcePath, basePath);
    if (!resolvedSource.ok) {
      return { success: false, error: resolvedSource.error };
    }
    const resolvedDest = resolvePathWithinBase(destPath, basePath);
    if (!resolvedDest.ok) {
      return { success: false, error: resolvedDest.error };
    }

    const absoluteSource = resolvedSource.absolutePath;
    const absoluteDest = resolvedDest.absolutePath;

    if (!fs.existsSync(absoluteSource)) {
      return {
        success: false,
        error: `Source not found: ${absoluteSource}`,
      };
    }

    if (fs.existsSync(absoluteDest) && !overwrite) {
      return {
        success: false,
        error: `Destination already exists: ${absoluteDest}. Set overwrite=true to replace.`,
      };
    }

    // Ensure destination directory exists
    const destDir = path.dirname(absoluteDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.renameSync(absoluteSource, absoluteDest);

    return {
      success: true,
      data: {
        source: absoluteSource,
        destination: absoluteDest,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to move: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================
// Copy Tool
// ============================================

export interface CopyParams {
  sourcePath: string;
  destPath: string;
  basePath?: string;
  recursive?: boolean;
  overwrite?: boolean;
}

export async function copyFile(params: CopyParams): Promise<MCPToolResult> {
  const { sourcePath, destPath, basePath, recursive = true, overwrite = false } = params;

  try {
    const resolvedSource = resolvePathWithinBase(sourcePath, basePath);
    if (!resolvedSource.ok) {
      return { success: false, error: resolvedSource.error };
    }
    const resolvedDest = resolvePathWithinBase(destPath, basePath);
    if (!resolvedDest.ok) {
      return { success: false, error: resolvedDest.error };
    }

    const absoluteSource = resolvedSource.absolutePath;
    const absoluteDest = resolvedDest.absolutePath;

    if (!fs.existsSync(absoluteSource)) {
      return {
        success: false,
        error: `Source not found: ${absoluteSource}`,
      };
    }

    if (fs.existsSync(absoluteDest) && !overwrite) {
      return {
        success: false,
        error: `Destination already exists: ${absoluteDest}. Set overwrite=true to replace.`,
      };
    }

    const stat = fs.statSync(absoluteSource);

    if (stat.isDirectory()) {
      if (!recursive) {
        return {
          success: false,
          error: `Source is a directory. Set recursive=true to copy directories.`,
        };
      }
      fs.cpSync(absoluteSource, absoluteDest, { recursive: true, force: overwrite });
    } else {
      const destDir = path.dirname(absoluteDest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(absoluteSource, absoluteDest);
    }

    return {
      success: true,
      data: {
        source: absoluteSource,
        destination: absoluteDest,
        type: stat.isDirectory() ? 'directory' : 'file',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to copy: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================
// Search Files Tool
// ============================================

export interface SearchFilesParams {
  query: string;
  basePath: string;
  extensions?: string[];
  maxResults?: number;
  caseSensitive?: boolean;
}

interface SearchMatch {
  file: string;
  line: number;
  content: string;
  column?: number;
}

export async function searchFiles(params: SearchFilesParams): Promise<MCPToolResult> {
  const { 
    query, 
    basePath, 
    extensions, 
    maxResults = 50,
    caseSensitive = false 
  } = params;

  try {
    if (!fs.existsSync(basePath)) {
      return {
        success: false,
        error: `Base path not found: ${basePath}`,
      };
    }

    const searchQuery = caseSensitive ? query : query.toLowerCase();
    const matches: SearchMatch[] = [];

    function searchInFile(filePath: string) {
      if (matches.length >= maxResults) return;

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          const line = lines[i];
          const searchLine = caseSensitive ? line : line.toLowerCase();
          
          if (searchLine.includes(searchQuery)) {
            const column = searchLine.indexOf(searchQuery);
            matches.push({
              file: path.relative(basePath, filePath),
              line: i + 1,
              content: line.trim().slice(0, 200),
              column: column >= 0 ? column + 1 : undefined,
            });
          }
        }
      } catch {
        // Skip binary or unreadable files
      }
    }

    function scanDir(dirPath: string) {
      if (matches.length >= maxResults) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= maxResults) return;
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).slice(1);
          if (extensions && extensions.length > 0 && !extensions.includes(ext)) {
            continue;
          }
          searchInFile(fullPath);
        }
      }
    }

    scanDir(basePath);

    return {
      success: true,
      data: {
        query,
        matches,
        totalMatches: matches.length,
        truncated: matches.length >= maxResults,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================
// Create Directory Tool
// ============================================

export interface CreateDirectoryParams {
  dirPath: string;
  basePath?: string;
}

export async function createDirectory(params: CreateDirectoryParams): Promise<MCPToolResult> {
  const { dirPath, basePath } = params;

  try {
    const resolved = resolvePathWithinBase(dirPath, basePath);
    if (!resolved.ok) {
      return { success: false, error: resolved.error };
    }
    const absolutePath = resolved.absolutePath;

    if (fs.existsSync(absolutePath)) {
      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        return {
          success: true,
          data: {
            path: absolutePath,
            created: false,
            message: 'Directory already exists',
          },
        };
      }
      return {
        success: false,
        error: `Path exists but is not a directory: ${absolutePath}`,
      };
    }

    fs.mkdirSync(absolutePath, { recursive: true });

    return {
      success: true,
      data: {
        path: absolutePath,
        created: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================
// Get File Info Tool
// ============================================

export interface FileInfoParams {
  filePath: string;
  basePath?: string;
}

export async function getFileInfo(params: FileInfoParams): Promise<MCPToolResult> {
  const { filePath, basePath } = params;

  try {
    const resolved = resolvePathWithinBase(filePath, basePath);
    if (!resolved.ok) {
      return { success: false, error: resolved.error };
    }
    const absolutePath = resolved.absolutePath;

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `Path not found: ${absolutePath}`,
      };
    }

    const stat = fs.statSync(absolutePath);

    return {
      success: true,
      data: {
        path: absolutePath,
        name: path.basename(absolutePath),
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        accessed: stat.atime.toISOString(),
        extension: stat.isFile() ? path.extname(absolutePath).slice(1) || undefined : undefined,
        permissions: stat.mode.toString(8).slice(-3),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get file info: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
