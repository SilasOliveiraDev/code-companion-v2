import { getSupabaseClient } from '../integrations/supabase';
import { ChatMessage, AgentMode, ExecutionPlan, PlanStep } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getOpenRouterClient, OpenRouterClient } from '../integrations/openrouter';

// Database types
interface DbSession {
  id: string;
  mode: string;
  selected_model: string;
  workspace_path: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  token_count: number | null;
  created_at: string;
}

interface DbPlan {
  id: string;
  session_id: string;
  goal: string;
  impacted_files: string[];
  architecture_decisions: string[];
  steps: PlanStep[];
  validation_method: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DbMemory {
  id: string;
  session_id: string | null;
  type: 'fact' | 'preference' | 'code_pattern' | 'decision';
  content: string;
  importance: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
}

export class MemoryService {
  private supabase = getSupabaseClient();
  private openRouterClient: OpenRouterClient | null = null;

  private getLLMClient(): OpenRouterClient {
    if (!this.openRouterClient) {
      this.openRouterClient = getOpenRouterClient();
    }
    return this.openRouterClient;
  }

  // ==================== SESSION MANAGEMENT ====================

  async createSession(
    mode: AgentMode = 'PLAN',
    workspacePath?: string,
    selectedModel?: string
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('agent_sessions')
      .insert({
        mode,
        workspace_path: workspacePath,
        selected_model: selectedModel || 'anthropic/claude-sonnet-4',
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create session: ${error.message}`);
    return data.id;
  }

  async getSession(sessionId: string): Promise<DbSession | null> {
    const { data, error } = await this.supabase
      .from('agent_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Failed to get session: ${error.message}`);
    }
    return data;
  }

  async updateSession(
    sessionId: string,
    updates: Partial<Pick<DbSession, 'mode' | 'selected_model' | 'summary' | 'metadata'>>
  ): Promise<void> {
    const { error } = await this.supabase
      .from('agent_sessions')
      .update(updates)
      .eq('id', sessionId);

    if (error) throw new Error(`Failed to update session: ${error.message}`);
  }

  async listSessions(limit = 20): Promise<DbSession[]> {
    const { data, error } = await this.supabase
      .from('agent_sessions')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to list sessions: ${error.message}`);
    return data || [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    const { error } = await this.supabase
      .from('agent_sessions')
      .delete()
      .eq('id', sessionId);

    if (error) throw new Error(`Failed to delete session: ${error.message}`);
  }

  // ==================== MESSAGE MANAGEMENT ====================

  async saveMessage(
    sessionId: string,
    message: ChatMessage
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('agent_messages')
      .insert({
        id: message.id,
        session_id: sessionId,
        role: message.role,
        content: message.content,
        metadata: message.metadata || {},
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save message: ${error.message}`);
    return data.id;
  }

  async getMessages(
    sessionId: string,
    limit?: number
  ): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('agent_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to get messages: ${error.message}`);
    
    return (data || []).map((msg: DbMessage) => ({
      id: msg.id,
      role: msg.role as ChatMessage['role'],
      content: msg.content,
      timestamp: new Date(msg.created_at),
      metadata: msg.metadata,
    }));
  }

  async getRecentMessages(
    sessionId: string,
    count: number
  ): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .from('agent_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(count);

    if (error) throw new Error(`Failed to get recent messages: ${error.message}`);
    
    // Reverse to get chronological order
    return (data || []).reverse().map((msg: DbMessage) => ({
      id: msg.id,
      role: msg.role as ChatMessage['role'],
      content: msg.content,
      timestamp: new Date(msg.created_at),
      metadata: msg.metadata,
    }));
  }

  // ==================== PLAN MANAGEMENT ====================

  async savePlan(sessionId: string, plan: ExecutionPlan): Promise<string> {
    const { data, error } = await this.supabase
      .from('agent_plans')
      .insert({
        id: plan.id,
        session_id: sessionId,
        goal: plan.goal,
        impacted_files: plan.impactedFiles,
        architecture_decisions: plan.architectureDecisions,
        steps: plan.steps,
        validation_method: plan.validationMethod,
        status: plan.status,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save plan: ${error.message}`);
    return data.id;
  }

  async updatePlanStatus(
    planId: string,
    status: string,
    steps?: PlanStep[]
  ): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (steps) updates.steps = steps;

    const { error } = await this.supabase
      .from('agent_plans')
      .update(updates)
      .eq('id', planId);

    if (error) throw new Error(`Failed to update plan: ${error.message}`);
  }

  async getActivePlan(sessionId: string): Promise<ExecutionPlan | null> {
    const { data, error } = await this.supabase
      .from('agent_plans')
      .select('*')
      .eq('session_id', sessionId)
      .in('status', ['pending', 'approved', 'executing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get active plan: ${error.message}`);
    }

    return this.dbPlanToExecutionPlan(data);
  }

  private dbPlanToExecutionPlan(dbPlan: DbPlan): ExecutionPlan {
    return {
      id: dbPlan.id,
      goal: dbPlan.goal,
      impactedFiles: dbPlan.impacted_files,
      architectureDecisions: dbPlan.architecture_decisions,
      steps: dbPlan.steps,
      validationMethod: dbPlan.validation_method || '',
      status: dbPlan.status as ExecutionPlan['status'],
      createdAt: new Date(dbPlan.created_at),
      updatedAt: new Date(dbPlan.updated_at),
    };
  }

  // ==================== LONG-TERM MEMORY ====================

  async saveMemory(
    content: string,
    type: DbMemory['type'],
    sessionId?: string,
    importance = 0.5
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('agent_memory')
      .insert({
        session_id: sessionId,
        type,
        content,
        importance,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save memory: ${error.message}`);
    return data.id;
  }

  async searchMemories(
    query: string,
    types?: DbMemory['type'][],
    limit = 10
  ): Promise<DbMemory[]> {
    let dbQuery = this.supabase
      .from('agent_memory')
      .select('*')
      .ilike('content', `%${query}%`)
      .order('importance', { ascending: false })
      .limit(limit);

    if (types && types.length > 0) {
      dbQuery = dbQuery.in('type', types);
    }

    const { data, error } = await dbQuery;

    if (error) throw new Error(`Failed to search memories: ${error.message}`);

    // Update access count and last_accessed_at
    if (data && data.length > 0) {
      const ids = data.map((m: DbMemory) => m.id);
      try {
        const { error: rpcError } = await this.supabase.rpc('increment_memory_access', {
          memory_ids: ids,
        });
        if (rpcError) {
          console.warn('Failed to increment memory access counts:', rpcError);
        }
      } catch (e) {
        console.warn('Failed to increment memory access counts:', e);
      }
    }

    return data || [];
  }

  async getImportantMemories(limit = 20): Promise<DbMemory[]> {
    const { data, error } = await this.supabase
      .from('agent_memory')
      .select('*')
      .order('importance', { ascending: false })
      .order('access_count', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to get important memories: ${error.message}`);
    return data || [];
  }

  // ==================== CONTEXT BUILDING ====================

  async buildSessionContext(
    sessionId: string,
    maxMessages = 50
  ): Promise<{
    session: DbSession;
    messages: ChatMessage[];
    activePlan: ExecutionPlan | null;
    relevantMemories: DbMemory[];
  }> {
    const [session, messages, activePlan, memories] = await Promise.all([
      this.getSession(sessionId),
      this.getRecentMessages(sessionId, maxMessages),
      this.getActivePlan(sessionId),
      this.getImportantMemories(10),
    ]);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return {
      session,
      messages,
      activePlan,
      relevantMemories: memories,
    };
  }

  // Generate a summary of the conversation for long context
  async generateSessionSummary(sessionId: string): Promise<string> {
    const messages = await this.getMessages(sessionId);
    
    if (messages.length === 0) return '';

    const recent = messages.slice(-30);
    const transcript = recent
      .map((m) => {
        const role = m.role;
        const content = (m.content || '').replace(/\s+/g, ' ').trim();
        const clipped = content.length > 800 ? `${content.slice(0, 800)}…` : content;
        return `${role.toUpperCase()}: ${clipped}`;
      })
      .join('\n');

    let summary = '';
    try {
      const client = this.getLLMClient();
      const response = await client.chat({
        model: process.env.OPENROUTER_SUMMARY_MODEL || process.env.OPENROUTER_DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content:
              `Summarize the key topics, decisions, and any TODOs from this conversation in 2-3 sentences. ` +
              `Use the same language as the conversation.\n\nConversation:\n${transcript}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.2,
      });
      summary = (response.choices[0]?.message?.content || '').trim();
    } catch (e) {
      // Fallback summary if LLM is unavailable
      const userMessages = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .slice(-10);
      summary = `Conversation topics: ${userMessages.join(' | ').slice(0, 500)}`;
      console.warn('Failed to generate LLM session summary, using fallback:', e);
    }
    
    // Save summary to session
    await this.updateSession(sessionId, { summary });
    
    return summary;
  }
}

// Singleton instance
let memoryService: MemoryService | null = null;

export function getMemoryService(): MemoryService {
  if (!memoryService) {
    memoryService = new MemoryService();
  }
  return memoryService;
}
