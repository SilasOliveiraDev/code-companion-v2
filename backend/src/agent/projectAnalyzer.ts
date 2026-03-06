import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// ProjectIntelligence — deep understanding of any project
// ============================================================

export interface ProjectIntelligence {
  stack: string[];
  language: string;
  testFramework: string | null;
  uiLibrary: string | null;
  stateManagement: string | null;
  database: string | null;
  existingPatterns: PatternExample[];
  entryPoints: string[];
  envVariables: string[];
}

export interface PatternExample {
  type: string;
  filePath: string;
  snippet: string;
}

// Markers used to detect technologies from package.json deps and file presence
const STACK_MARKERS: Array<{ names: string[]; label: string }> = [
  { names: ['react', 'react-dom'], label: 'React' },
  { names: ['next'], label: 'Next.js' },
  { names: ['vue'], label: 'Vue' },
  { names: ['nuxt'], label: 'Nuxt' },
  { names: ['svelte'], label: 'Svelte' },
  { names: ['@angular/core'], label: 'Angular' },
  { names: ['express'], label: 'Express' },
  { names: ['fastify'], label: 'Fastify' },
  { names: ['hono'], label: 'Hono' },
  { names: ['nestjs', '@nestjs/core'], label: 'NestJS' },
  { names: ['vite'], label: 'Vite' },
  { names: ['webpack'], label: 'Webpack' },
  { names: ['tailwindcss'], label: 'Tailwind CSS' },
  { names: ['@mui/material', '@mui/core'], label: 'Material UI' },
  { names: ['@chakra-ui/react'], label: 'Chakra UI' },
  { names: ['@mantine/core'], label: 'Mantine' },
  { names: ['zustand'], label: 'Zustand' },
  { names: ['redux', '@reduxjs/toolkit'], label: 'Redux' },
  { names: ['mobx'], label: 'MobX' },
  { names: ['@supabase/supabase-js'], label: 'Supabase' },
  { names: ['prisma', '@prisma/client'], label: 'Prisma' },
  { names: ['mongoose'], label: 'MongoDB/Mongoose' },
  { names: ['typeorm'], label: 'TypeORM' },
  { names: ['drizzle-orm'], label: 'Drizzle' },
  { names: ['sequelize'], label: 'Sequelize' },
];

const TEST_MARKERS: Array<{ names: string[]; label: string }> = [
  { names: ['jest', 'ts-jest'], label: 'Jest' },
  { names: ['vitest'], label: 'Vitest' },
  { names: ['mocha'], label: 'Mocha' },
  { names: ['pytest'], label: 'Pytest' },
  { names: ['@playwright/test'], label: 'Playwright' },
  { names: ['cypress'], label: 'Cypress' },
];

const UI_LIB_LABELS = new Set(['Tailwind CSS', 'Material UI', 'Chakra UI', 'Mantine']);
const STATE_LABELS = new Set(['Zustand', 'Redux', 'MobX']);
const DB_LABELS = new Set(['Supabase', 'Prisma', 'MongoDB/Mongoose', 'TypeORM', 'Drizzle', 'Sequelize']);

const ENTRY_POINT_CANDIDATES = [
  'src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/index.ts',
  'src/App.tsx', 'src/app.tsx',
  'src/server.ts', 'src/app.ts', 'server.ts', 'app.ts',
  'index.ts', 'index.js',
  'main.py', 'app.py', 'manage.py',
];

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.cache', 'coverage', '.turbo', '.venv', 'venv',
]);

export class ProjectAnalyzer {
  /**
   * Analyse the project at `rootPath` and return a `ProjectIntelligence`
   * snapshot. The analysis is **synchronous and fast** — it reads
   * package.json(s), scans for key config files and samples a handful
   * of source files — so it can safely run on every session creation.
   */
  analyze(rootPath: string): ProjectIntelligence {
    const allDeps = this.collectDeps(rootPath);
    const stack = this.detectStack(allDeps);
    const language = this.detectLanguage(rootPath);
    const testFramework = this.detectTest(allDeps);
    const uiLibrary = stack.find((s) => UI_LIB_LABELS.has(s)) ?? null;
    const stateManagement = stack.find((s) => STATE_LABELS.has(s)) ?? null;
    const database = stack.find((s) => DB_LABELS.has(s)) ?? null;
    const entryPoints = this.findEntryPoints(rootPath);
    const existingPatterns = this.extractPatterns(rootPath);
    const envVariables = this.readDotEnvExample(rootPath);

    return {
      stack,
      language,
      testFramework,
      uiLibrary,
      stateManagement,
      database,
      existingPatterns,
      entryPoints,
      envVariables,
    };
  }

  /** Produce a compact text block suitable for injection into an LLM prompt. */
  formatForPrompt(intel: ProjectIntelligence): string {
    const lines: string[] = ['## Project Intelligence (auto-detected)'];

    lines.push(`- **Stack:** ${intel.stack.join(', ') || 'unknown'}`);
    lines.push(`- **Language:** ${intel.language}`);
    if (intel.testFramework) lines.push(`- **Tests:** ${intel.testFramework}`);
    if (intel.uiLibrary) lines.push(`- **UI Library:** ${intel.uiLibrary}`);
    if (intel.stateManagement) lines.push(`- **State:** ${intel.stateManagement}`);
    if (intel.database) lines.push(`- **Database:** ${intel.database}`);

    if (intel.entryPoints.length > 0) {
      lines.push(`- **Entry points:** ${intel.entryPoints.join(', ')}`);
    }

    if (intel.envVariables.length > 0) {
      lines.push(`- **Env vars:** ${intel.envVariables.join(', ')}`);
    }

    if (intel.existingPatterns.length > 0) {
      lines.push('');
      lines.push('### Existing code patterns (follow these)');
      for (const p of intel.existingPatterns) {
        lines.push(`\n**${p.type}** — \`${p.filePath}\`\n\`\`\`\n${p.snippet}\n\`\`\``);
      }
    }

    return lines.join('\n');
  }

  // ---- private helpers ---------------------------------------------------

  /**
   * Collect all dependency names from the root package.json and any
   * workspace package.jsons (backend/package.json, frontend/package.json).
   */
  private collectDeps(rootPath: string): Set<string> {
    const deps = new Set<string>();
    const pkgPaths = [
      path.join(rootPath, 'package.json'),
      path.join(rootPath, 'backend', 'package.json'),
      path.join(rootPath, 'frontend', 'package.json'),
    ];

    for (const pkgPath of pkgPaths) {
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
          if (pkg[section] && typeof pkg[section] === 'object') {
            for (const name of Object.keys(pkg[section])) {
              deps.add(name);
            }
          }
        }
      } catch { /* corrupt package.json — skip */ }
    }

    return deps;
  }

  private detectStack(deps: Set<string>): string[] {
    const detected: string[] = [];
    for (const marker of STACK_MARKERS) {
      if (marker.names.some((n) => deps.has(n))) {
        detected.push(marker.label);
      }
    }
    return detected;
  }

  private detectLanguage(rootPath: string): string {
    const tsconfigs = [
      path.join(rootPath, 'tsconfig.json'),
      path.join(rootPath, 'backend', 'tsconfig.json'),
      path.join(rootPath, 'frontend', 'tsconfig.json'),
    ];
    if (tsconfigs.some((p) => fs.existsSync(p))) return 'TypeScript';

    const pyFiles = ['requirements.txt', 'pyproject.toml', 'setup.py'];
    if (pyFiles.some((f) => fs.existsSync(path.join(rootPath, f)))) return 'Python';

    return 'JavaScript';
  }

  private detectTest(deps: Set<string>): string | null {
    for (const marker of TEST_MARKERS) {
      if (marker.names.some((n) => deps.has(n))) return marker.label;
    }
    return null;
  }

  private findEntryPoints(rootPath: string): string[] {
    const found: string[] = [];

    const subRoots = ['', 'backend', 'frontend'];
    for (const sub of subRoots) {
      const base = sub ? path.join(rootPath, sub) : rootPath;
      for (const candidate of ENTRY_POINT_CANDIDATES) {
        const full = path.join(base, candidate);
        if (fs.existsSync(full)) {
          const rel = path.relative(rootPath, full).replace(/\\/g, '/');
          found.push(rel);
        }
      }
    }

    return [...new Set(found)];
  }

  /**
   * Samples 2-3 representative source files to give the LLM a sense of
   * the coding style used in the project.
   */
  private extractPatterns(rootPath: string): PatternExample[] {
    const patterns: PatternExample[] = [];

    // Try to find a React component example
    const componentDir = path.join(rootPath, 'frontend', 'src', 'components');
    if (fs.existsSync(componentDir)) {
      const sample = this.findFirstFile(componentDir, ['.tsx', '.jsx']);
      if (sample) {
        patterns.push(this.makePatternExample('React Component', rootPath, sample));
      }
    }

    // Try to find a backend route example
    const routesDir = path.join(rootPath, 'backend', 'src', 'routes');
    if (fs.existsSync(routesDir)) {
      const sample = this.findFirstFile(routesDir, ['.ts', '.js']);
      if (sample) {
        patterns.push(this.makePatternExample('Backend Route', rootPath, sample));
      }
    }

    // Try to find a store / state example
    const storeDir = path.join(rootPath, 'frontend', 'src', 'store');
    if (fs.existsSync(storeDir)) {
      const sample = this.findFirstFile(storeDir, ['.ts', '.tsx']);
      if (sample) {
        patterns.push(this.makePatternExample('State Store', rootPath, sample));
      }
    }

    return patterns;
  }

  private makePatternExample(type: string, rootPath: string, absolutePath: string): PatternExample {
    const content = fs.readFileSync(absolutePath, 'utf8');
    return {
      type,
      filePath: path.relative(rootPath, absolutePath).replace(/\\/g, '/'),
      snippet: content.slice(0, 1500) + (content.length > 1500 ? '\n// ...(truncated)' : ''),
    };
  }

  /** Find the first matching source file inside a directory (non-recursive shallow scan). */
  private findFirstFile(dir: string, extensions: string[]): string | null {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      // Try files in the directory first
      for (const entry of entries) {
        if (entry.isFile() && extensions.some((e) => entry.name.endsWith(e))) {
          return path.join(dir, entry.name);
        }
      }
      // Then recurse one level into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
          const subDir = path.join(dir, entry.name);
          const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile() && extensions.some((e) => sub.name.endsWith(e))) {
              return path.join(subDir, sub.name);
            }
          }
        }
      }
    } catch { /* skip */ }
    return null;
  }

  /** Read .env.example or .env.local.example to surface required env vars. */
  private readDotEnvExample(rootPath: string): string[] {
    const candidates = ['.env.example', '.env.local.example', '.env.sample'];
    for (const name of candidates) {
      const filePath = path.join(rootPath, name);
      if (!fs.existsSync(filePath)) continue;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => l.split('=')[0].trim())
          .filter(Boolean);
      } catch { /* skip */ }
    }
    return [];
  }
}
