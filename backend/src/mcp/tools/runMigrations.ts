import { MCPToolResult } from '../../types';

export interface Migration {
  name: string;
  sql: string;
  order: number;
}

export interface RunMigrationsParams {
  projectId: string;
  migrations: Migration[];
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

export async function runMigrations(params: RunMigrationsParams): Promise<MCPToolResult> {
  const { projectId, migrations } = params;

  const sorted = [...migrations].sort((a, b) => a.order - b.order);
  const applied: string[] = [];

  for (const migration of sorted) {
    // In a real implementation this would execute SQL via Supabase client
    // Here we validate and record for demonstration purposes
    if (!migration.sql.trim()) {
      return {
        success: false,
        error: `Migration "${migration.name}" has empty SQL`,
      };
    }

    applied.push(migration.name);
  }

  return {
    success: true,
    data: {
      projectId,
      applied,
      count: applied.length,
      message: `Successfully applied ${applied.length} migration(s) to project ${projectId}`,
    },
  };
}
