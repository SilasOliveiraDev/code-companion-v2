import { Router, Request, Response } from 'express';
import { getOpenRouterClient, OpenRouterClient } from '../integrations/openrouter';

const router = Router();

// GET /api/openrouter/models - List available models
router.get('/models', async (_req: Request, res: Response) => {
  try {
    const client = getOpenRouterClient();
    const models = await client.getModels();
    
    // Filter to show popular/useful models
    const popularModels = models.filter((m: { id: string }) => 
      m.id.includes('claude') || 
      m.id.includes('gpt-4') || 
      m.id.includes('gemini') ||
      m.id.includes('llama') ||
      m.id.includes('mistral') ||
      m.id.includes('deepseek')
    );

    res.json({ 
      models: popularModels,
      total: models.length,
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4'
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch models' 
    });
  }
});

// GET /api/openrouter/status - Check API connection
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      res.json({ 
        connected: false, 
        error: 'OPENROUTER_API_KEY not configured' 
      });
      return;
    }

    const client = getOpenRouterClient();
    // Simple test to verify API key works
    await client.getModels();

    res.json({ 
      connected: true,
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4'
    });
  } catch (error) {
    res.json({ 
      connected: false, 
      error: error instanceof Error ? error.message : 'Connection failed' 
    });
  }
});

// POST /api/openrouter/chat - Simple chat completion (for testing)
router.post('/chat', async (req: Request, res: Response) => {
  const { message, model, systemPrompt } = req.body as {
    message: string;
    model?: string;
    systemPrompt?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  try {
    const client = getOpenRouterClient();
    
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system' as const, content: systemPrompt });
    }
    messages.push({ role: 'user' as const, content: message });

    const response = await client.chat({
      model: model || undefined,
      messages,
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content || '';
    
    res.json({
      content,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Chat failed' 
    });
  }
});

// POST /api/openrouter/stream - Streaming chat completion
router.post('/stream', async (req: Request, res: Response) => {
  const { message, model, systemPrompt } = req.body as {
    message: string;
    model?: string;
    systemPrompt?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  try {
    const client = getOpenRouterClient();
    
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system' as const, content: systemPrompt });
    }
    messages.push({ role: 'user' as const, content: message });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of client.streamChat({
      model: model || undefined,
      messages,
      max_tokens: 2048,
    })) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ 
      type: 'error', 
      error: error instanceof Error ? error.message : 'Stream failed' 
    })}\n\n`);
    res.end();
  }
});

export default router;
