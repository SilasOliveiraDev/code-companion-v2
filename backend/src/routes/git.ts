import { Router, Request, Response } from 'express';
import { GitService } from '../integrations/git';
import path from 'path';

const router = Router();

function requireRepo(
  req: Request,
  res: Response
): { repoPath: string } | null {
  const repo =
    (req.method === 'GET'
      ? (req.query as { repo?: string }).repo
      : (req.body as { repo?: string }).repo) ||
    '';

  if (!repo.trim()) {
    res.status(400).json({ error: 'repo is required' });
    return null;
  }

  if (!path.isAbsolute(repo)) {
    res.status(400).json({ error: 'repo must be an absolute path' });
    return null;
  }

  return { repoPath: repo };
}

async function getGitValidated(repoPath: string): Promise<GitService> {
  const git = new GitService(repoPath);
  const isRepo = await git.isRepo();
  if (!isRepo) {
    throw new Error('Not a git repository');
  }
  return git;
}

// GET /api/git/status - Get git status
router.get('/status', async (req: Request, res: Response) => {
  const required = requireRepo(req, res);
  if (!required) return;

  try {
    const git = await getGitValidated(required.repoPath);
    const status = await git.getStatus();
    res.json(status);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Git error' });
  }
});

// GET /api/git/log - Get commit log
router.get('/log', async (req: Request, res: Response) => {
  const required = requireRepo(req, res);
  if (!required) return;
  const { limit } = req.query as { limit?: string };

  try {
    const git = await getGitValidated(required.repoPath);
    const log = await git.getLog(limit ? parseInt(limit, 10) : 20);
    res.json({ commits: log });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Git log error' });
  }
});

// GET /api/git/branches - Get branches
router.get('/branches', async (req: Request, res: Response) => {
  const required = requireRepo(req, res);
  if (!required) return;

  try {
    const git = await getGitValidated(required.repoPath);
    const branches = await git.getBranches();
    res.json(branches);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Git branches error' });
  }
});

// POST /api/git/branch - Create a branch
router.post('/branch', async (req: Request, res: Response) => {
  const { name, checkout, repo } = req.body as {
    name: string;
    checkout?: boolean;
    repo?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'Branch name is required' });
    return;
  }

  if (!repo?.trim()) {
    res.status(400).json({ error: 'repo is required' });
    return;
  }

  try {
    const git = await getGitValidated(repo);
    await git.createBranch(name, checkout !== false);
    res.json({ success: true, branch: name });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create branch' });
  }
});

// POST /api/git/checkout - Checkout a branch
router.post('/checkout', async (req: Request, res: Response) => {
  const { branch, repo } = req.body as { branch: string; repo?: string };

  if (!branch?.trim()) {
    res.status(400).json({ error: 'Branch name is required' });
    return;
  }

  if (!repo?.trim()) {
    res.status(400).json({ error: 'repo is required' });
    return;
  }

  try {
    const git = await getGitValidated(repo);
    await git.checkout(branch);
    res.json({ success: true, branch });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Checkout failed' });
  }
});

// POST /api/git/stage - Stage files
router.post('/stage', async (req: Request, res: Response) => {
  const { files, all, repo } = req.body as {
    files?: string[];
    all?: boolean;
    repo?: string;
  };

  if (!repo?.trim()) {
    res.status(400).json({ error: 'repo is required' });
    return;
  }

  try {
    const git = await getGitValidated(repo);
    if (all) {
      await git.stageAll();
    } else if (files && files.length > 0) {
      await git.stageFiles(files);
    } else {
      res.status(400).json({ error: 'Specify files or set all=true' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Stage failed' });
  }
});

// POST /api/git/commit - Commit staged changes
router.post('/commit', async (req: Request, res: Response) => {
  const { message, author, repo } = req.body as {
    message: string;
    author?: string;
    repo?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: 'Commit message is required' });
    return;
  }

  if (!repo?.trim()) {
    res.status(400).json({ error: 'repo is required' });
    return;
  }

  try {
    const git = await getGitValidated(repo);
    if (!author) {
      const cfg = await git.getConfig();
      if (!cfg.name?.trim() || !cfg.email?.trim()) {
        res.status(400).json({
          error: 'Git user.name and user.email must be configured for this repository before committing',
        });
        return;
      }
    }
    const hash = await git.commit(message, author);
    res.json({ success: true, hash });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Commit failed' });
  }
});

// GET /api/git/diff - Get diff
router.get('/diff', async (req: Request, res: Response) => {
  const required = requireRepo(req, res);
  if (!required) return;
  const { file, staged } = req.query as {
    file?: string;
    staged?: string;
  };

  try {
    const git = await getGitValidated(required.repoPath);
    const diff = staged === 'true' ? await git.getStagedDiff() : await git.getDiff(file);
    res.json({ diff });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Diff failed' });
  }
});

// POST /api/git/push - Push commits
router.post('/push', async (req: Request, res: Response) => {
  const { remote, branch, repo } = req.body as {
    remote?: string;
    branch?: string;
    repo?: string;
  };

  if (!repo?.trim()) {
    res.status(400).json({ error: 'repo is required' });
    return;
  }

  try {
    const git = await getGitValidated(repo);
    const remotes = await git.getRemotes();
    if (remotes.length === 0) {
      res.status(400).json({ error: 'No git remotes configured for this repository' });
      return;
    }
    if (remote && !remotes.includes(remote)) {
      res.status(400).json({ error: `Remote '${remote}' not found in this repository` });
      return;
    }
    await git.push(remote, branch);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Push failed' });
  }
});

// GET /api/git/config - Get git config
router.get('/config', async (req: Request, res: Response) => {
  const required = requireRepo(req, res);
  if (!required) return;

  try {
    const git = await getGitValidated(required.repoPath);
    const config = await git.getConfig();
    res.json(config);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Config fetch failed' });
  }
});

// POST /api/git/config - Set git config
router.post('/config', async (req: Request, res: Response) => {
  const { name, email, repo } = req.body as {
    name: string;
    email: string;
    repo?: string;
  };

  if (!repo?.trim()) {
    res.status(400).json({ error: 'repo is required' });
    return;
  }

  try {
    const git = await getGitValidated(repo);
    await git.setConfig(name, email);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Config set failed' });
  }
});

export default router;
