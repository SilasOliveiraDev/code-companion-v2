import { Router, Request, Response } from 'express';
import { AIEngineerAgent } from '../agent';
import { AgentMode, WorkspaceState } from '../types';
import { ToolRouter, MCP_TOOLS } from '../mcp/toolRouter';

const router = Router();
const agent = new AIEngineerAgent();
const toolRouter = new ToolRouter();

// GET /api/agent/sessions - List all sessions
router.get('/sessions', async (_req: Request, res: Response) => {
  try {
    const sessions = await agent.listSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list sessions' });
  }
});

// POST /api/agent/sessions - Create a new agent session
router.post('/sessions', async (req: Request, res: Response) => {
  const { rootPath, mode } = req.body as { rootPath?: string; mode?: AgentMode };

  const workspaceState: WorkspaceState = {
    rootPath: rootPath || process.env.WORKSPACE_ROOT || '/tmp/workspace',
    files: [],
    openFiles: [],
  };

  try {
    const session = await agent.createSession(workspaceState, mode || 'PLAN');
    res.json({
      sessionId: session.id,
      mode: session.mode,
      createdAt: session.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create session' });
  }
});

// GET /api/agent/sessions/:id - Get session details
router.get('/sessions/:id', async (req: Request, res: Response) => {
  const session = await agent.getOrLoadSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

// POST /api/agent/sessions/:id/message - Send message to agent
router.post('/sessions/:id/message', async (req: Request, res: Response) => {
  const { message, images } = req.body as { message: string, images?: string[] };

  if (!message?.trim() && (!images || images.length === 0)) {
    res.status(400).json({ error: 'Message or images are required' });
    return;
  }

  const session = await agent.getOrLoadSession(req.params.id);
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
      images,
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
  const session = await agent.getOrLoadSession(req.params.id);
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
router.post('/sessions/:id/plan/reject', async (req: Request, res: Response) => {
  const session = await agent.getOrLoadSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  agent.rejectPlan(req.params.id);
  res.json({ success: true, message: 'Plan rejected' });
});

// PATCH /api/agent/sessions/:id/mode - Change agent mode
router.patch('/sessions/:id/mode', async (req: Request, res: Response) => {
  const { mode } = req.body as { mode: AgentMode };

  if (!['ASK', 'PLAN', 'AGENT'].includes(mode)) {
    res.status(400).json({ error: 'Invalid mode. Must be ASK, PLAN, or AGENT' });
    return;
  }

  const session = await agent.getOrLoadSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  agent.setMode(req.params.id, mode);
  res.json({ success: true, mode });
});

// PATCH /api/agent/sessions/:id/model - Change LLM model
router.patch('/sessions/:id/model', async (req: Request, res: Response) => {
  const { model } = req.body as { model: string };

  if (!model?.trim()) {
    res.status(400).json({ error: 'Model is required' });
    return;
  }

  const session = await agent.getOrLoadSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  agent.setModel(req.params.id, model);
  res.json({ success: true, model });
});

// GET /api/agent/tools - List all available MCP tools
router.get('/tools', (_req: Request, res: Response) => {
  const tools = MCP_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: Object.entries(tool.parameters).map(([key, param]) => ({
      name: key,
      type: param.type,
      description: param.description,
      required: param.required || false,
    })),
  }));

  res.json({ tools, total: tools.length });
});

// POST /api/agent/tools/execute - Execute a tool directly (for testing)
router.post('/tools/execute', async (req: Request, res: Response) => {
  const { toolName, parameters } = req.body as { toolName: string; parameters: Record<string, unknown> };

  if (!toolName) {
    res.status(400).json({ error: 'toolName is required' });
    return;
  }

  try {
    const result = await toolRouter.execute({
      toolName,
      parameters: parameters || {},
      sessionId: 'test-session',
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Tool execution failed' });
  }
});

export default router;
