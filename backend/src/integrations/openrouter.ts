import { ChatMessage } from '../types';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
}

export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterStreamChunk {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Partial<OpenRouterToolCall>[];
    };
    finish_reason: string | null;
  }[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  context_length?: number;
  top_provider?: {
    max_completion_tokens?: number;
  };
}

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  siteUrl?: string;
  siteName?: string;
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private siteUrl: string;
  private siteName: string;

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    this.defaultModel = config.defaultModel || 'anthropic/claude-sonnet-4';
    this.siteUrl = config.siteUrl || 'http://localhost:5173';
    this.siteName = config.siteName || 'Code Companion';
  }

  async chat(params: {
    model?: string;
    messages: OpenRouterMessage[];
    tools?: OpenRouterTool[];
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    max_tokens?: number;
    temperature?: number;
    stream?: false;
  }): Promise<OpenRouterResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.siteName,
      },
      body: JSON.stringify({
        model: params.model || this.defaultModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        max_tokens: params.max_tokens || 4096,
        temperature: params.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: { message?: string } };
      throw new Error(`OpenRouter API error: ${error.error?.message || JSON.stringify(error)}`);
    }

    return response.json() as Promise<OpenRouterResponse>;
  }

  async *streamChat(params: {
    model?: string;
    messages: OpenRouterMessage[];
    tools?: OpenRouterTool[];
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
    max_tokens?: number;
    temperature?: number;
  }): AsyncGenerator<OpenRouterStreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.siteName,
      },
      body: JSON.stringify({
        model: params.model || this.defaultModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        max_tokens: params.max_tokens || 4096,
        temperature: params.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: { message?: string } };
      throw new Error(`OpenRouter API error: ${error.error?.message || JSON.stringify(error)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as OpenRouterStreamChunk;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }
  }

  // Helper to convert Anthropic-style tool definitions to OpenRouter format
  static convertAnthropicTools(anthropicTools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>): OpenRouterTool[] {
    return anthropicTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  // Helper to convert chat messages to OpenRouter format
  static convertMessages(messages: ChatMessage[], systemPrompt?: string): OpenRouterMessage[] {
    const result: OpenRouterMessage[] = [];
    
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        if (msg.role === 'user' && msg.images && msg.images.length > 0) {
          const contentArray: Array<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } }> = [
            { type: 'text', text: msg.content }
          ];
          for (const img of msg.images) {
            contentArray.push({
              type: 'image_url',
              image_url: { url: img }
            });
          }
          result.push({
            role: msg.role,
            content: contentArray,
          });
        } else {
          result.push({
            role: msg.role,
            content: msg.content,
          });
        }
      } else if (msg.role === 'tool') {
        const toolCallId = ((): string | undefined => {
          const meta = msg.metadata as Record<string, unknown> | undefined;
          const candidates = [
            meta?.tool_call_id,
            meta?.toolCallId,
            meta?.toolCallID,
          ];
          for (const c of candidates) {
            if (typeof c === 'string' && c.trim()) return c;
          }
          return undefined;
        })();

        result.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: toolCallId,
        });
      }
    }

    return result;
  }

  // Get list of available models
  async getModels(): Promise<Array<{ id: string; name: string; context_length: number }>> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json() as { data?: OpenRouterModel[] };
    return (data.data || []).map(model => ({
      id: model.id,
      name: model.name,
      context_length: model.context_length || 4096,
    }));
  }
}

// Singleton instance
let openRouterClient: OpenRouterClient | null = null;

export function getOpenRouterClient(): OpenRouterClient {
  if (!openRouterClient) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is not set');
    }
    openRouterClient = new OpenRouterClient({
      apiKey,
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4',
      siteUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
      siteName: 'Code Companion',
    });
  }
  return openRouterClient;
}
