import { Router, Request, Response } from 'express';
import { FileSystemService } from '../workspace/fileSystem';
import * as path from 'path';

const router = Router();

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

  const fs = getFs(root || '');

  try {
    fs.createDirectory(dirPath);
    res.json({ success: true, path: dirPath });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create directory' });
  }
});

export default router;
