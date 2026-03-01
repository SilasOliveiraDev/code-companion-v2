import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
  accessToken?: string;
}

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    supabaseClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseClient;
}

export async function testSupabaseConnection(): Promise<{
  connected: boolean;
  projectRef?: string;
  error?: string;
}> {
  try {
    const client = getSupabaseClient();
    
    // Try to query system tables to verify connection
    const { data, error } = await client
      .from('_prisma_migrations')
      .select('id')
      .limit(1);

    // Even if table doesn't exist, if we get a proper error response, we're connected
    if (error && !error.message.includes('does not exist')) {
      // Check if it's an auth error vs connection error
      if (error.message.includes('Invalid API key') || error.message.includes('JWT')) {
        return { connected: false, error: error.message };
      }
    }

    // Extract project ref from URL
    const url = process.env.SUPABASE_URL || '';
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    const projectRef = match ? match[1] : undefined;

    return { connected: true, projectRef };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Management API functions using Access Token
export async function callManagementAPI(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: Record<string, unknown>
): Promise<unknown> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN not set');
  }

  const response = await fetch(`https://api.supabase.com${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase Management API error: ${error}`);
  }

  return response.json();
}

// Get project details
export async function getProjectInfo(): Promise<unknown> {
  const url = process.env.SUPABASE_URL || '';
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  const projectRef = match ? match[1] : null;

  if (!projectRef) {
    throw new Error('Could not extract project ref from SUPABASE_URL');
  }

  return callManagementAPI(`/v1/projects/${projectRef}`);
}

// List all tables in the database
export async function listTables(): Promise<string[]> {
  const client = getSupabaseClient();
  
  const { data, error } = await client.rpc('get_tables');
  
  if (error) {
    // Fallback: query information_schema  
    const { data: tables, error: fallbackError } = await client
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public');
    
    if (fallbackError) {
      throw new Error(`Failed to list tables: ${fallbackError.message}`);
    }
    
    return (tables || []).map((t: { table_name: string }) => t.table_name);
  }
  
  return data || [];
}

// Execute raw SQL (admin only)
export async function executeSQL(sql: string): Promise<unknown> {
  const client = getSupabaseClient();
  
  const { data, error } = await client.rpc('exec_sql', { query: sql });
  
  if (error) {
    throw new Error(`SQL execution failed: ${error.message}`);
  }
  
  return data;
}
