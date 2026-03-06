import { Router, Request, Response } from 'express';
import { AIEngineerAgent } from '../agent';
import { AgentMode, WorkspaceState } from '../types';
import { ToolRouter, MCP_TOOLS } from '../mcp/toolRouter';
import pdfParse from 'pdf-parse';

type ChatAttachment = {
  name: string;
  mimeType: string;
  data: string; // data URL preferred, else raw base64
};

function parseDataUrl(data: string): { mimeType?: string; base64: string } {
  const trimmed = (data || '').trim();
  if (!trimmed.startsWith('data:')) {
    return { base64: trimmed };
  }

  // data:<mime>;base64,<payload>
  const match = /^data:([^;]+);base64,(.*)$/i.exec(trimmed);
  if (!match) return { base64: trimmed };
  return { mimeType: match[1], base64: match[2] };
}

function isLikelyBase64(data: string): boolean {
  const s = (data || '').trim();
  if (!s) return false;
  if (s.startsWith('data:')) return true;
  return /^[a-z0-9+/\n\r]+={0,2}$/i.test(s);
}

function safeBase64ToBuffer(data: string): Buffer | null {
  if (!isLikelyBase64(data)) return null;
  const { base64 } = parseDataUrl(data);
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

async function extractPdfTextFromAttachments(attachments: ChatAttachment[]): Promise<string> {
  const MAX_FILES = 3;
  const MAX_BYTES_PER_FILE = 5 * 1024 * 1024; // 5MB
  const MAX_CHARS_PER_FILE = 20_000;

  const pdfs = attachments
    .filter((a) => (a.mimeType === 'application/pdf') || a.data.startsWith('data:application/pdf'))
    .slice(0, MAX_FILES);

  const parts: string[] = [];

  for (const att of pdfs) {
    const buffer = safeBase64ToBuffer(att.data);
    if (!buffer) continue;
    if (buffer.byteLength > MAX_BYTES_PER_FILE) {
      parts.push(`[${att.name}] (skipped: file too large)`);
      continue;
    }

    try {
      const parsed = await pdfParse(buffer);
      const text = (parsed.text || '').replace(/\s+\n/g, '\n').trim();
      const clipped = text.length > MAX_CHARS_PER_FILE ? `${text.slice(0, MAX_CHARS_PER_FILE)}\n…(truncated)` : text;
      if (clipped) {
        parts.push(`[${att.name}]\n${clipped}`);
      }
    } catch (e) {
      parts.push(`[${att.name}] (failed to parse PDF)`);
    }
  }

  if (parts.length === 0) return '';
  return `\n\n---\nAttached PDFs (extracted text):\n\n${parts.join('\n\n---\n\n')}\n---\n`;
}

function mergeImageAttachments(images: string[] | undefined, attachments: ChatAttachment[] | undefined): string[] | undefined {
  const base = Array.isArray(images) ? images : [];
  const extra = (attachments || []).filter(a => a.mimeType.startsWith('image/') || a.data.startsWith('data:image/')).map(a => a.data);
  const merged = [...base, ...extra].filter(Boolean);
  return merged.length > 0 ? merged : undefined;
}

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
  const { message, images, attachments } = req.body as { message: string, images?: string[]; attachments?: ChatAttachment[] };

  const hasImages = Array.isArray(images) && images.length > 0;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!message?.trim() && !hasImages && !hasAttachments) {
    res.status(400).json({ error: 'Message, images, or attachments are required' });
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

    const mergedImages = mergeImageAttachments(images, attachments);
    const pdfText = hasAttachments ? await extractPdfTextFromAttachments(attachments!) : '';
    const fullMessage = pdfText ? `${message || ''}${pdfText}` : (message || '');

    const result = await agent.processMessage(
      req.params.id,
      fullMessage,
      mergedImages,
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

// POST /api/agent/sessions/:id/plan/approve - Approve current plan (SSE stream)
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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const result = await agent.approvePlan(req.params.id, (event) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: event })}\n\n`);
    });

    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        message: { content: result.message },
        plan: session.currentPlan,
        success: result.success,
        errors: result.errors,
      })}\n\n`
    );
    res.end();
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to execute plan';
    // If headers already sent (SSE started), send error as event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: errMsg });
    }
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
