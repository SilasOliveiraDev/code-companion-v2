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

  /**
   * Generate a text-based tree representation of the project structure
   */
  generateTreeText(dirPath?: string, prefix = '', depth = 0, maxDepth = 5): string[] {
    const targetPath = dirPath ? path.resolve(dirPath) : this.rootPath;
    const lines: string[] = [];

    if (depth > maxDepth) return lines;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(targetPath, { withFileTypes: true });
    } catch {
      return lines;
    }

    // Sort entries: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // Filter out ignored items
    const filtered = entries.filter(e => {
      if (IGNORED_FILES.has(e.name)) return false;
      if (e.isDirectory() && IGNORED_DIRS.has(e.name)) return false;
      return true;
    });

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const newPrefix = prefix + (isLast ? '    ' : '│   ');

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        const subLines = this.generateTreeText(
          path.join(targetPath, entry.name),
          newPrefix,
          depth + 1,
          maxDepth
        );
        lines.push(...subLines);
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }

    return lines;
  }

  /**
   * Get project context including package.json, README, and key files
   */
  getProjectContext(): {
    packageJson?: Record<string, unknown>;
    readme?: string;
    keyFiles: { path: string; preview: string }[];
    tree: string;
  } {
    const context: {
      packageJson?: Record<string, unknown>;
      readme?: string;
      keyFiles: { path: string; preview: string }[];
      tree: string;
    } = {
      keyFiles: [],
      tree: this.generateTreeText().join('\n'),
    };

    // Read package.json
    const pkgPath = path.join(this.rootPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        context.packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch { /* ignore */ }
    }

    // Read README
    const readmeCandidates = ['README.md', 'README.txt', 'README', 'readme.md'];
    for (const name of readmeCandidates) {
      const readmePath = path.join(this.rootPath, name);
      if (fs.existsSync(readmePath)) {
        try {
          const content = fs.readFileSync(readmePath, 'utf8');
          // Truncate if too long
          context.readme = content.length > 3000 
            ? content.slice(0, 3000) + '\n...(truncated)'
            : content;
        } catch { /* ignore */ }
        break;
      }
    }

    // Get key files (entry points, configs)
    const keyFilePatterns = [
      'src/index.ts', 'src/index.tsx', 'src/main.ts', 'src/main.tsx',
      'src/App.tsx', 'src/app.tsx', 'index.ts', 'index.js',
      'src/server.ts', 'server.ts', 'app.ts', 'main.py', 'app.py',
      'tsconfig.json', 'vite.config.ts', 'next.config.js', 'webpack.config.js',
    ];

    for (const pattern of keyFilePatterns) {
      const filePath = path.join(this.rootPath, pattern);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          context.keyFiles.push({
            path: pattern,
            preview: content.slice(0, 1500) + (content.length > 1500 ? '\n...(truncated)' : ''),
          });
        } catch { /* ignore */ }
      }
    }

    return context;
  }

  /**
   * Generate comprehensive context string for the AI agent
   */
  generateAgentContext(): string {
    const context = this.getProjectContext();
    const lines: string[] = [];

    lines.push('# Project Structure');
    lines.push(`\nRoot: ${this.rootPath}\n`);
    lines.push('```');
    lines.push(...this.generateTreeText());
    lines.push('```\n');

    if (context.packageJson) {
      const pkg = context.packageJson;
      lines.push('## Package Info');
      if (pkg.name) lines.push(`- Name: ${pkg.name}`);
      if (pkg.version) lines.push(`- Version: ${pkg.version}`);
      if (pkg.description) lines.push(`- Description: ${pkg.description}`);
      
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        const scriptNames = Object.keys(pkg.scripts as Record<string, string>).slice(0, 10);
        lines.push(`- Scripts: ${scriptNames.join(', ')}`);
      }
      
      if (pkg.dependencies && typeof pkg.dependencies === 'object') {
        const deps = Object.keys(pkg.dependencies as Record<string, string>).slice(0, 15);
        lines.push(`- Dependencies: ${deps.join(', ')}${deps.length >= 15 ? '...' : ''}`);
      }
      lines.push('');
    }

    if (context.readme) {
      lines.push('## README Preview\n');
      lines.push(context.readme);
      lines.push('');
    }

    if (context.keyFiles.length > 0) {
      lines.push('## Key Files\n');
      for (const file of context.keyFiles.slice(0, 5)) {
        lines.push(`### ${file.path}`);
        lines.push('```typescript');
        lines.push(file.preview);
        lines.push('```\n');
      }
    }

    return lines.join('\n');
  }
}
