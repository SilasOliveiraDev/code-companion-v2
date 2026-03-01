import * as fs from 'fs';
import * as path from 'path';
import { FileNode } from '../types';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.cache',
  'coverage',
  '.turbo',
]);

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', '.env.local']);

export class FileSystemService {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
  }

  getRootPath(): string {
    return this.rootPath;
  }

  getFileTree(dirPath?: string, depth = 0, maxDepth = 6): FileNode[] {
    const targetPath = dirPath ? path.resolve(dirPath) : this.rootPath;

    if (depth > maxDepth) return [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(targetPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: FileNode[] = [];

    for (const entry of entries) {
      if (IGNORED_FILES.has(entry.name)) continue;
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(targetPath, entry.name);
      const relativePath = path.relative(this.rootPath, fullPath);

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children: this.getFileTree(fullPath, depth + 1, maxDepth),
        });
      } else {
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          extension: path.extname(entry.name).slice(1),
        });
      }
    }

    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  readFile(filePath: string): string {
    const absolute = this.resolveSafe(filePath);
    return fs.readFileSync(absolute, 'utf8');
  }

  writeFile(filePath: string, content: string): void {
    const absolute = this.resolveSafe(filePath);
    const dir = path.dirname(absolute);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absolute, content, 'utf8');
  }

  deleteFile(filePath: string): void {
    const absolute = this.resolveSafe(filePath);
    fs.unlinkSync(absolute);
  }

  exists(filePath: string): boolean {
    try {
      const absolute = this.resolveSafe(filePath);
      return fs.existsSync(absolute);
    } catch {
      return false;
    }
  }

  isDirectory(filePath: string): boolean {
    const absolute = this.resolveSafe(filePath);
    return fs.statSync(absolute).isDirectory();
  }

  createDirectory(dirPath: string): void {
    const absolute = this.resolveSafe(dirPath);
    fs.mkdirSync(absolute, { recursive: true });
  }

  getFileInfo(filePath: string): { size: number; modified: Date; created: Date } {
    const absolute = this.resolveSafe(filePath);
    const stat = fs.statSync(absolute);
    return {
      size: stat.size,
      modified: stat.mtime,
      created: stat.birthtime,
    };
  }

  searchFiles(query: string, extensions?: string[]): string[] {
    const results: string[] = [];
    this.searchRecursive(this.rootPath, query.toLowerCase(), extensions, results);
    return results.slice(0, 50);
  }

  private searchRecursive(
    dir: string,
    query: string,
    extensions: string[] | undefined,
    results: string[]
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.searchRecursive(fullPath, query, extensions, results);
      } else {
        const ext = path.extname(entry.name).slice(1);
        if (extensions && !extensions.includes(ext)) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.toLowerCase().includes(query)) {
            results.push(path.relative(this.rootPath, fullPath));
          }
        } catch {
          // Skip binary or unreadable files
        }
      }
    }
  }

  private resolveSafe(filePath: string): string {
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.rootPath, filePath);

    const resolved = path.resolve(absolute);

    if (!resolved.startsWith(this.rootPath)) {
      throw new Error(`Access denied: path "${filePath}" is outside workspace`);
    }

    return resolved;
  }
}
