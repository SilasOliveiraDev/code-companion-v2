import { Router, Request, Response } from 'express';
import { AIEngineerAgent } from '../agent';
import { AgentMode, WorkspaceState } from '../types';

const router = Router();
const agent = new AIEngineerAgent();

// POST /api/agent/sessions - Create a new agent session
router.post('/sessions', (req: Request, res: Response) => {
  const { rootPath, mode } = req.body as { rootPath?: string; mode?: AgentMode };

  const workspaceState: WorkspaceState = {
    rootPath: rootPath || process.env.WORKSPACE_ROOT || '/tmp/workspace',
    files: [],
    openFiles: [],
  };

  const session = agent.createSession(workspaceState, mode || 'PLAN');

  res.json({
    sessionId: session.id,
    mode: session.mode,
    createdAt: session.createdAt,
  });
});

// GET /api/agent/sessions/:id - Get session details
router.get('/sessions/:id', (req: Request, res: Response) => {
  const session = agent.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

// POST /api/agent/sessions/:id/message - Send message to agent
router.post('/sessions/:id/message', async (req: Request, res: Response) => {
  const { message } = req.body as { message: string };

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const session = agent.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    // Stream response via SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const result = await agent.processMessage(
      req.params.id,
      message,
      (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      }
    );

    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        message: result.message,
        plan: result.plan,
      })}\n\n`
    );
    res.end();
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Agent error';
    res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
    res.end();
  }
});

// POST /api/agent/sessions/:id/plan/approve - Approve current plan
router.post('/sessions/:id/plan/approve', async (req: Request, res: Response) => {
  const session = agent.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!session.currentPlan) {
    res.status(400).json({ error: 'No active plan to approve' });
    return;
  }

  try {
    const result = await agent.approvePlan(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to execute plan',
    });
  }
});

// POST /api/agent/sessions/:id/plan/reject - Reject current plan
router.post('/sessions/:id/plan/reject', (req: Request, res: Response) => {
  const session = agent.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  agent.rejectPlan(req.params.id);
  res.json({ success: true, message: 'Plan rejected' });
});

// PATCH /api/agent/sessions/:id/mode - Change agent mode
router.patch('/sessions/:id/mode', (req: Request, res: Response) => {
  const { mode } = req.body as { mode: AgentMode };

  if (!['ASK', 'PLAN', 'AGENT'].includes(mode)) {
    res.status(400).json({ error: 'Invalid mode. Must be ASK, PLAN, or AGENT' });
    return;
  }

  const session = agent.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  agent.setMode(req.params.id, mode);
  res.json({ success: true, mode });
});

export default router;
