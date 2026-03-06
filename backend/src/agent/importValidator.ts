import { ToolRouter } from '../mcp/toolRouter';
import * as path from 'path';

export interface ImportValidationResult {
  valid: boolean;
  brokenImports: BrokenImport[];
}

export interface BrokenImport {
  filePath: string;
  line: number;
  importPath: string;
  suggestion?: string;
}

const TS_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx']);
const IMPORT_REGEX = /^import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/gm;
const REQUIRE_REGEX = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

function isTypeScriptFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return TS_EXTENSIONS.has(ext);
}

/**
 * Determines if an import specifier is a relative path (starts with . or ..).
 */
function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * Extracts all import/require specifiers from TypeScript/JavaScript source code.
 */
function extractImportPaths(content: string): Array<{ specifier: string; line: number }> {
  const results: Array<{ specifier: string; line: number }> = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Static imports
    const importMatch = line.match(/import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/);
    if (importMatch) {
      results.push({ specifier: importMatch[1], line: i + 1 });
      continue;
    }

    // Dynamic imports
    const dynamicMatch = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamicMatch) {
      results.push({ specifier: dynamicMatch[1], line: i + 1 });
      continue;
    }

    // require()
    const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      results.push({ specifier: requireMatch[1], line: i + 1 });
    }
  }

  return results;
}

export class ImportValidator {
  private toolRouter: ToolRouter;

  constructor(toolRouter: ToolRouter) {
    this.toolRouter = toolRouter;
  }

  /**
   * Validates all relative imports in the given TypeScript/TSX files.
   * Returns broken imports with suggestions for correct paths found via search.
   */
  async validateImports(
    filePaths: string[],
    rootPath: string
  ): Promise<ImportValidationResult> {
    const brokenImports: BrokenImport[] = [];

    const tsFiles = filePaths.filter(isTypeScriptFile);

    for (const filePath of tsFiles) {
      const readResult = await this.toolRouter.execute({
        toolName: 'read_file',
        sessionId: 'import-validator',
        parameters: { filePath, basePath: rootPath },
      });

      if (!readResult.success) continue;

      const content = (readResult.data as any)?.content ?? '';
      const imports = extractImportPaths(content);

      for (const imp of imports) {
        if (!isRelativeImport(imp.specifier)) continue;

        const resolved = this.resolveImportPath(filePath, imp.specifier, rootPath);
        const exists = await this.fileExists(resolved, rootPath);

        if (!exists) {
          const suggestion = await this.findCorrectPath(imp.specifier, filePath, rootPath);
          brokenImports.push({
            filePath,
            line: imp.line,
            importPath: imp.specifier,
            suggestion: suggestion || undefined,
          });
        }
      }
    }

    return {
      valid: brokenImports.length === 0,
      brokenImports,
    };
  }

  /**
   * Attempts to auto-fix broken imports by replacing them with suggested paths.
   * Returns the list of files that were modified.
   */
  async fixBrokenImports(
    brokenImports: BrokenImport[],
    rootPath: string
  ): Promise<string[]> {
    const fixedFiles: string[] = [];

    // Group by file
    const byFile = new Map<string, BrokenImport[]>();
    for (const bi of brokenImports) {
      if (!bi.suggestion) continue;
      const existing = byFile.get(bi.filePath) || [];
      existing.push(bi);
      byFile.set(bi.filePath, existing);
    }

    for (const [filePath, imports] of byFile) {
      const readResult = await this.toolRouter.execute({
        toolName: 'read_file',
        sessionId: 'import-validator',
        parameters: { filePath, basePath: rootPath },
      });

      if (!readResult.success) continue;

      let content = (readResult.data as any)?.content ?? '';
      let modified = false;

      for (const bi of imports) {
        const escaped = bi.importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(['"])${escaped}(['"])`, 'g');
        const newContent = content.replace(regex, `$1${bi.suggestion}$2`);
        if (newContent !== content) {
          content = newContent;
          modified = true;
        }
      }

      if (modified) {
        // Use edit_file with full replacement via write
        const writeResult = await this.toolRouter.execute({
          toolName: 'run_command',
          sessionId: 'import-validator',
          parameters: {
            command: `node -e "require('fs').writeFileSync('${filePath.replace(/\\/g, '/')}', ${JSON.stringify(content)})"`,
            cwd: rootPath,
            timeout: 10_000,
          },
        });

        if (writeResult.success) {
          fixedFiles.push(filePath);
        }
      }
    }

    return fixedFiles;
  }

  /**
   * Resolves a relative import specifier to candidate absolute file paths.
   */
  private resolveImportPath(
    fromFile: string,
    specifier: string,
    rootPath: string
  ): string {
    const dir = path.dirname(path.resolve(rootPath, fromFile));
    return path.resolve(dir, specifier);
  }

  /**
   * Checks if a resolved import target exists (trying common extensions).
   */
  private async fileExists(resolved: string, rootPath: string): Promise<boolean> {
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

    for (const ext of extensions) {
      const candidate = resolved + ext;
      const result = await this.toolRouter.execute({
        toolName: 'get_file_info',
        sessionId: 'import-validator',
        parameters: { filePath: candidate, basePath: rootPath },
      });
      if (result.success) return true;
    }

    return false;
  }

  /**
   * Searches the project for a file matching the import basename
   * and returns a corrected relative path if found.
   */
  private async findCorrectPath(
    brokenSpecifier: string,
    fromFile: string,
    rootPath: string
  ): Promise<string | null> {
    const basename = path.basename(brokenSpecifier);
    const searchName = basename.replace(/\.(ts|tsx|js|jsx)$/, '');

    const searchResult = await this.toolRouter.execute({
      toolName: 'search_files',
      sessionId: 'import-validator',
      parameters: {
        pattern: searchName,
        path: rootPath,
        filePattern: `*.{ts,tsx,js,jsx}`,
      },
    });

    if (!searchResult.success || !searchResult.data) return null;

    const matches = searchResult.data as any[];
    if (!Array.isArray(matches) || matches.length === 0) return null;

    // Find the best match — exact filename match preferred
    const fromDir = path.dirname(path.resolve(rootPath, fromFile));

    for (const match of matches) {
      const matchPath = typeof match === 'string' ? match : match.file || match.path;
      if (!matchPath) continue;

      const matchBasename = path.basename(matchPath).replace(/\.(ts|tsx|js|jsx)$/, '');
      if (matchBasename.toLowerCase() !== searchName.toLowerCase()) continue;

      // Compute relative path from the importing file
      const absMatch = path.resolve(rootPath, matchPath);
      let relative = path.relative(fromDir, absMatch).replace(/\\/g, '/');

      // Remove extension for TS imports
      relative = relative.replace(/\.(ts|tsx)$/, '');

      // Ensure it starts with ./ or ../
      if (!relative.startsWith('.')) {
        relative = './' + relative;
      }

      return relative;
    }

    return null;
  }
}
