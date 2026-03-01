import { Router, Request, Response } from 'express';
import { FileSystemService } from '../workspace/fileSystem';
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn } from 'child_process';

const router = Router();

// Repository/Workspace Management
interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  lastAccessedAt: string;
}

const workspaces = new Map<string, WorkspaceInfo>();

// Scan for repositories in the GitHub directory
function scanForRepos() {
  const reposRoot = process.env.REPOS_ROOT || path.dirname(process.env.WORKSPACE_ROOT || process.cwd());
  
  if (!fs.existsSync(reposRoot)) {
    console.warn(`REPOS_ROOT not found: ${reposRoot}`);
    return;
  }

  try {
    const entries = fs.readdirSync(reposRoot, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const repoPath = path.join(reposRoot, entry.name);
      const gitPath = path.join(repoPath, '.git');
      const pkgPath = path.join(repoPath, 'package.json');
      
      // Check if it's a git repo or has package.json
      if (fs.existsSync(gitPath) || fs.existsSync(pkgPath)) {
        const id = `ws-${entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
        workspaces.set(id, {
          id,
          name: entry.name,
          path: repoPath,
          lastAccessedAt: new Date().toISOString(),
        });
      }
    }
    
    console.log(`Found ${workspaces.size} repositories in ${reposRoot}`);
  } catch (error) {
    console.error('Error scanning for repos:', error);
  }
}

// Run scan on startup
scanForRepos();

function getFs(rootPath: string): FileSystemService {
  return new FileSystemService(rootPath || process.env.WORKSPACE_ROOT || '/tmp/workspace');
}

// GET /api/workspace/files - List workspace files
router.get('/files', (req: Request, res: Response) => {
  const { root } = req.query as { root?: string };
  const fs = getFs(root || '');

  try {
    const files = fs.getFileTree();
    res.json({ files, rootPath: fs.getRootPath() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list files' });
  }
});

// GET /api/workspace/file - Read a file
router.get('/file', (req: Request, res: Response) => {
  const { path: filePath, root } = req.query as { path: string; root?: string };

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  const fs = getFs(root || '');

  try {
    const content = fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1);
    res.json({ path: filePath, content, extension: ext });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'File not found' });
  }
});

// PUT /api/workspace/file - Write a file
router.put('/file', (req: Request, res: Response) => {
  const { path: filePath, content, root } = req.body as {
    path: string;
    content: string;
    root?: string;
  };

  if (!filePath || content === undefined) {
    res.status(400).json({ error: 'Path and content are required' });
    return;
  }

  const fs = getFs(root || '');

  try {
    fs.writeFile(filePath, content);
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to write file' });
  }
});

// DELETE /api/workspace/file - Delete a file
router.delete('/file', (req: Request, res: Response) => {
  const { path: filePath, root } = req.query as { path: string; root?: string };

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  const fs = getFs(root || '');

  try {
    fs.deleteFile(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete file' });
  }
});

// POST /api/workspace/search - Search files
router.post('/search', (req: Request, res: Response) => {
  const { query, extensions, root } = req.body as {
    query: string;
    extensions?: string[];
    root?: string;
  };

  if (!query?.trim()) {
    res.status(400).json({ error: 'Search query is required' });
    return;
  }

  const fs = getFs(root || '');

  try {
    const results = fs.searchFiles(query, extensions);
    res.json({ results, query });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Search failed' });
  }
});

// POST /api/workspace/directory - Create directory
router.post('/directory', (req: Request, res: Response) => {
  const { path: dirPath, root } = req.body as { path: string; root?: string };

  if (!dirPath) {
    res.status(400).json({ error: 'Directory path is required' });
    return;
  }

  const fsService = getFs(root || '');

  try {
    fsService.createDirectory(dirPath);
    res.json({ success: true, path: dirPath });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create directory' });
  }
});

// ============================================
// Repository Management Routes
// ============================================

// GET /api/workspace/repos - List all known repositories
router.get('/repos', (_req: Request, res: Response) => {
  const repos = Array.from(workspaces.values()).map(ws => ({
    id: ws.id,
    name: ws.name,
    path: ws.path,
    lastAccessedAt: ws.lastAccessedAt,
  }));
  
  res.json({ repos, total: repos.length });
});

// POST /api/workspace/repos/scan - Rescan for repositories
router.post('/repos/scan', (_req: Request, res: Response) => {
  workspaces.clear();
  scanForRepos();
  
  const repos = Array.from(workspaces.values());
  res.json({ repos, total: repos.length });
});

// GET /api/workspace/repos/:id - Get repository info
router.get('/repos/:id', (req: Request, res: Response) => {
  const ws = workspaces.get(req.params.id);
  
  if (!ws) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  
  try {
    const fsService = new FileSystemService(ws.path);
    const context = fsService.getProjectContext();
    
    // Update last accessed
    ws.lastAccessedAt = new Date().toISOString();
    
    res.json({
      ...ws,
      packageJson: context.packageJson,
      readme: context.readme?.slice(0, 500),
      tree: context.tree,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get workspace info' });
  }
});

// GET /api/workspace/repos/:id/context - Get full AI context for a repository
router.get('/repos/:id/context', (req: Request, res: Response) => {
  const ws = workspaces.get(req.params.id);
  
  if (!ws) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  
  try {
    const fsService = new FileSystemService(ws.path);
    const context = fsService.generateAgentContext();
    
    // Update last accessed
    ws.lastAccessedAt = new Date().toISOString();
    
    res.json({
      context,
      workspaceId: ws.id,
      workspacePath: ws.path,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate context' });
  }
});

// POST /api/workspace/repos - Create a new repository
router.post('/repos', async (req: Request, res: Response) => {
  const { name, template, initGit = true } = req.body as { 
    name: string; 
    template?: 'empty' | 'react' | 'node' | 'nextjs';
    initGit?: boolean;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'Repository name is required' });
    return;
  }

  // Validate name
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    res.status(400).json({ error: 'Invalid repository name. Use only letters, numbers, hyphens, and underscores.' });
    return;
  }

  const reposRoot = process.env.REPOS_ROOT || path.dirname(process.env.WORKSPACE_ROOT || process.cwd());
  const repoPath = path.join(reposRoot, name);

  if (fs.existsSync(repoPath)) {
    res.status(409).json({ error: 'Repository already exists' });
    return;
  }

  try {
    // Create directory
    fs.mkdirSync(repoPath, { recursive: true });

    // Initialize based on template
    if (template === 'react') {
      // Create basic React project structure
      fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repoPath, 'public'), { recursive: true });
      
      fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
        name,
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        },
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.2.0',
          vite: '^5.0.0'
        }
      }, null, 2));

      fs.writeFileSync(path.join(repoPath, 'src', 'App.tsx'), `export default function App() {
  return (
    <div>
      <h1>Hello ${name}!</h1>
    </div>
  );
}
`);
      fs.writeFileSync(path.join(repoPath, 'src', 'main.tsx'), `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`);
      fs.writeFileSync(path.join(repoPath, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);
    } else if (template === 'node') {
      // Create basic Node.js project
      fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
      
      fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        scripts: {
          start: 'node src/index.js',
          dev: 'node --watch src/index.js'
        }
      }, null, 2));

      fs.writeFileSync(path.join(repoPath, 'src', 'index.js'), `console.log('Hello from ${name}!');
`);
    } else if (template === 'nextjs') {
      // Create basic Next.js structure
      fs.mkdirSync(path.join(repoPath, 'app'), { recursive: true });
      
      fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
        name,
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start'
        },
        dependencies: {
          next: '^14.0.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        }
      }, null, 2));

      fs.writeFileSync(path.join(repoPath, 'app', 'page.tsx'), `export default function Home() {
  return (
    <main>
      <h1>Welcome to ${name}</h1>
    </main>
  );
}
`);
      fs.writeFileSync(path.join(repoPath, 'app', 'layout.tsx'), `export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`);
    } else {
      // Empty or unspecified - create minimal structure
      fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${name}\n\nA new project.\n`);
    }

    // Create .gitignore
    fs.writeFileSync(path.join(repoPath, '.gitignore'), `node_modules/
dist/
.env
.env.local
.DS_Store
*.log
`);

    // Initialize git if requested
    if (initGit) {
      await new Promise<void>((resolve, reject) => {
        exec('git init', { cwd: repoPath }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    // Add to workspaces
    const id = `ws-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    workspaces.set(id, {
      id,
      name,
      path: repoPath,
      lastAccessedAt: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      repo: {
        id,
        name,
        path: repoPath,
        template: template || 'empty',
      },
    });
  } catch (error) {
    // Cleanup on error
    try {
      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true });
      }
    } catch { /* ignore cleanup errors */ }
    
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create repository' });
  }
});

// POST /api/workspace/repos/clone - Clone a repository from URL
router.post('/repos/clone', async (req: Request, res: Response) => {
  const { url, name } = req.body as { url: string; name?: string };

  if (!url?.trim()) {
    res.status(400).json({ error: 'Repository URL is required' });
    return;
  }

  // Extract name from URL if not provided
  const repoName = name || url.split('/').pop()?.replace(/\.git$/, '') || 'cloned-repo';
  
  // Validate name
  if (!/^[a-zA-Z0-9_-]+$/.test(repoName)) {
    res.status(400).json({ error: 'Invalid repository name derived from URL. Please provide a custom name.' });
    return;
  }

  const reposRoot = process.env.REPOS_ROOT || path.dirname(process.env.WORKSPACE_ROOT || process.cwd());
  const repoPath = path.join(reposRoot, repoName);

  if (fs.existsSync(repoPath)) {
    res.status(409).json({ error: 'A repository with this name already exists' });
    return;
  }

  try {
    // Clone the repository
    await new Promise<void>((resolve, reject) => {
      const gitClone = spawn('git', ['clone', url, repoPath], {
        stdio: 'pipe',
      });

      let stderr = '';
      gitClone.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitClone.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed: ${stderr}`));
        }
      });

      gitClone.on('error', reject);
    });

    // Add to workspaces
    const id = `ws-${repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    workspaces.set(id, {
      id,
      name: repoName,
      path: repoPath,
      lastAccessedAt: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      repo: {
        id,
        name: repoName,
        path: repoPath,
        url,
      },
    });
  } catch (error) {
    // Cleanup on error
    try {
      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true });
      }
    } catch { /* ignore cleanup errors */ }
    
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to clone repository' });
  }
});

// DELETE /api/workspace/repos/:id - Remove a repository from the list (doesn't delete files)
router.delete('/repos/:id', (req: Request, res: Response) => {
  const ws = workspaces.get(req.params.id);
  
  if (!ws) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  
  workspaces.delete(req.params.id);
  res.json({ success: true, message: 'Repository removed from list' });
});

export default router;
