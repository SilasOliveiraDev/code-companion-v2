import { Router, Request, Response } from 'express';
import { 
  testSupabaseConnection, 
  getSupabaseClient,
  getProjectInfo,
} from '../integrations/supabase';

const router = Router();

// GET /api/supabase/status - Check connection status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await testSupabaseConnection();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      connected: false,
      error: error instanceof Error ? error.message : 'Connection test failed',
    });
  }
});

// GET /api/supabase/project - Get project info
router.get('/project', async (_req: Request, res: Response) => {
  try {
    const info = await getProjectInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get project info',
    });
  }
});

// GET /api/supabase/tables - List all tables
router.get('/tables', async (_req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    
    // Query public schema tables
    const { data, error } = await client
      .rpc('exec_sql', { 
        query: `
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
          ORDER BY table_name
        ` 
      });

    if (error) {
      // Fallback approach - try direct query
      const { data: tables } = await client
        .from('pg_tables')
        .select('tablename')
        .eq('schemaname', 'public');
      
      res.json({ tables: tables?.map((t: { tablename: string }) => t.tablename) || [] });
      return;
    }

    res.json({ tables: data });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to list tables',
    });
  }
});

// POST /api/supabase/query - Execute a query
router.post('/query', async (req: Request, res: Response) => {
  try {
    const { table, select = '*', filters } = req.body;
    
    if (!table) {
      res.status(400).json({ error: 'Table name is required' });
      return;
    }

    const client = getSupabaseClient();
    let query = client.from(table).select(select);

    // Apply filters if provided
    if (filters && typeof filters === 'object') {
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.json({ data });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Query failed',
    });
  }
});

// POST /api/supabase/insert - Insert data
router.post('/insert', async (req: Request, res: Response) => {
  try {
    const { table, data: insertData } = req.body;
    
    if (!table || !insertData) {
      res.status(400).json({ error: 'Table and data are required' });
      return;
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from(table)
      .insert(insertData)
      .select();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.json({ data });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Insert failed',
    });
  }
});

export default router;
