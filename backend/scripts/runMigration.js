// Script to run migrations on Supabase
const sql = `
-- Sessions table
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode VARCHAR(20) NOT NULL DEFAULT 'PLAN',
  selected_model VARCHAR(100) DEFAULT 'anthropic/claude-sonnet-4',
  workspace_path TEXT,
  summary TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
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
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Long-term memory table
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  importance FLOAT DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_session ON agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON agent_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_plans_session ON agent_plans(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON agent_memory(type);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON agent_sessions(updated_at DESC);
`;

async function runMigration() {
  const token = process.env.SUPABASE_ACCESS_TOKEN || 'sbp_7898d024fbcd53a6f0c206a5c04e8ca6040acaed';
  const projectRef = 'nniakhkhbbfqpofrlbbn';

  // Split SQL into individual statements
  const statements = sql.split(';').filter(s => s.trim()).map(s => s.trim() + ';');

  console.log(`Running ${statements.length} migration statements...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`\n[${i + 1}/${statements.length}] Executing...`);
    
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: stmt }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.log(`  Error: ${error}`);
      } else {
        const result = await response.json();
        console.log(`  OK`);
      }
    } catch (error) {
      console.log(`  Failed: ${error.message}`);
    }
  }

  console.log('\nMigration complete!');
}

runMigration();
