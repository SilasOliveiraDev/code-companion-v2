import { MCPTool, MCPToolCall, MCPToolResult } from '../types';
import { createRepo, CreateRepoParams } from './tools/createRepo';
import { writeFiles, WriteFilesParams } from './tools/writeFiles';
import { deployPreview, DeployPreviewParams } from './tools/deployPreview';
import { runMigrations, RunMigrationsParams } from './tools/runMigrations';
import { connectSupabase, ConnectSupabaseParams } from './tools/connectSupabase';

export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'create_repo',
    description: 'Create a new git repository with initial scaffold',
    parameters: {
      name: { type: 'string', description: 'Repository name', required: true },
      description: { type: 'string', description: 'Repository description' },
      template: { type: 'string', description: 'Template to use (react, nextjs, express, etc.)' },
      targetPath: { type: 'string', description: 'Parent directory path', required: true },
    },
  },
  {
    name: 'write_files',
    description: 'Write or update multiple files in the workspace',
    parameters: {
      files: { type: 'array', description: 'Array of {path, content} objects', required: true },
      basePath: { type: 'string', description: 'Base path for relative file paths', required: true },
    },
  },
  {
    name: 'deploy_preview',
    description: 'Deploy project to a preview environment and return the URL',
    parameters: {
      projectPath: { type: 'string', description: 'Path to project root', required: true },
      buildCommand: { type: 'string', description: 'Build command to run' },
      outputDir: { type: 'string', description: 'Build output directory' },
      envVars: { type: 'object', description: 'Environment variables for build' },
    },
  },
  {
    name: 'run_migrations',
    description: 'Run SQL migrations against a Supabase project',
    parameters: {
      projectId: { type: 'string', description: 'Supabase project ID', required: true },
      migrations: { type: 'array', description: 'Array of {name, sql, order} migration objects', required: true },
      supabaseUrl: { type: 'string', description: 'Supabase project URL' },
      serviceRoleKey: { type: 'string', description: 'Service role key for admin access' },
    },
  },
  {
    name: 'connect_supabase',
    description: 'Connect to a Supabase project and configure authentication and realtime',
    parameters: {
      projectUrl: { type: 'string', description: 'Supabase project URL', required: true },
      anonKey: { type: 'string', description: 'Supabase anon key', required: true },
      serviceRoleKey: { type: 'string', description: 'Service role key (optional)' },
      enableRealtime: { type: 'boolean', description: 'Enable realtime subscriptions' },
      enableAuth: { type: 'boolean', description: 'Enable authentication' },
    },
  },
];

export class ToolRouter {
  async execute(call: MCPToolCall): Promise<MCPToolResult> {
    switch (call.toolName) {
      case 'create_repo':
        return createRepo(call.parameters as CreateRepoParams);
      case 'write_files':
        return writeFiles(call.parameters as WriteFilesParams);
      case 'deploy_preview':
        return deployPreview(call.parameters as DeployPreviewParams);
      case 'run_migrations':
        return runMigrations(call.parameters as RunMigrationsParams);
      case 'connect_supabase':
        return connectSupabase(call.parameters as ConnectSupabaseParams);
      default:
        return {
          success: false,
          error: `Unknown tool: ${call.toolName}`,
        };
    }
  }

  getAvailableTools(): MCPTool[] {
    return MCP_TOOLS;
  }

  getToolDefinitionsForClaude(): Array<{
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  }> {
    return MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            { type: param.type, description: param.description },
          ])
        ),
        required: Object.entries(tool.parameters)
          .filter(([, param]) => param.required)
          .map(([key]) => key),
      },
    }));
  }
}
