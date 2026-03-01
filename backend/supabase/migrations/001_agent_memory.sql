-- Supabase Migration: Agent Memory Tables
-- Run this in the Supabase SQL Editor

-- Sessions table
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode VARCHAR(20) NOT NULL DEFAULT 'PLAN',
  selected_model VARCHAR(100) DEFAULT 'anthropic/claude-sonnet-4',
  workspace_path TEXT,
  summary TEXT, -- Resumo da conversa para contexto rápido
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  token_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plans table
CREATE TABLE IF NOT EXISTS agent_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  impacted_files TEXT[] DEFAULT '{}',
  architecture_decisions TEXT[] DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]',
  validation_method TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, executing, completed, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Long-term memory / knowledge base (for future RAG)
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL, -- 'fact', 'preference', 'code_pattern', 'decision'
  content TEXT NOT NULL,
  embedding VECTOR(1536), -- For semantic search (requires pgvector extension)
  importance FLOAT DEFAULT 0.5, -- 0-1 score for memory consolidation
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_session ON agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON agent_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_plans_session ON agent_plans(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON agent_memory(type);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON agent_sessions(updated_at DESC);

-- Enable Row Level Security (optional, enable if needed)
-- ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_plans ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_agent_sessions_updated_at ON agent_sessions;
CREATE TRIGGER update_agent_sessions_updated_at
  BEFORE UPDATE ON agent_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_plans_updated_at ON agent_plans;
CREATE TRIGGER update_agent_plans_updated_at
  BEFORE UPDATE ON agent_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
