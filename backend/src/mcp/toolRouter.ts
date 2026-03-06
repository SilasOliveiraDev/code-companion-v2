import { MCPTool, MCPToolCall, MCPToolResult } from '../types';
import { createRepo, CreateRepoParams } from './tools/createRepo';
import { writeFiles, WriteFilesParams } from './tools/writeFiles';
import { deployPreview, DeployPreviewParams } from './tools/deployPreview';
import { runMigrations, RunMigrationsParams } from './tools/runMigrations';
import { connectSupabase, ConnectSupabaseParams } from './tools/connectSupabase';
import { runCommand, RunCommandParams } from './tools/runCommand';
import { editFile, EditFileParams } from './tools/editFile';
import {
  readFile, ReadFileParams,
  listDirectory, ListDirectoryParams,
  deleteFileOrDir, DeleteParams,
  moveFile, MoveParams,
  copyFile, CopyParams,
  searchFiles, SearchFilesParams,
  createDirectory, CreateDirectoryParams,
  getFileInfo, FileInfoParams,
} from './tools/filesystem';

export const MCP_TOOLS: MCPTool[] = [
  // Filesystem Tools
  {
    name: 'read_file',
    description: 'Read the contents of a file. Can read specific line ranges.',
    parameters: {
      filePath: { type: 'string', description: 'Path to the file to read', required: true },
      basePath: { type: 'string', description: 'Base path for relative file paths' },
      encoding: { type: 'string', description: 'File encoding (default: utf8)' },
      startLine: { type: 'number', description: 'Start reading from this line (1-indexed)' },
      endLine: { type: 'number', description: 'Stop reading at this line (inclusive)' },
    },
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory with optional filtering and recursion',
    parameters: {
      dirPath: { type: 'string', description: 'Path to the directory to list', required: true },
      basePath: { type: 'string', description: 'Base path for relative paths' },
      recursive: { type: 'boolean', description: 'Recursively list subdirectories' },
      maxDepth: { type: 'number', description: 'Maximum depth for recursive listing (default: 3)' },
      includeHidden: { type: 'boolean', description: 'Include hidden files (starting with .)' },
      pattern: { type: 'string', description: 'Regex pattern to filter file names' },
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory',
    parameters: {
      targetPath: { type: 'string', description: 'Path to delete', required: true },
      basePath: { type: 'string', description: 'Base path for relative paths' },
      recursive: { type: 'boolean', description: 'Recursively delete directory contents' },
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or directory',
    parameters: {
      sourcePath: { type: 'string', description: 'Source path', required: true },
      destPath: { type: 'string', description: 'Destination path', required: true },
      basePath: { type: 'string', description: 'Base path for relative paths' },
      overwrite: { type: 'boolean', description: 'Overwrite destination if exists' },
    },
  },
  {
    name: 'copy_file',
    description: 'Copy a file or directory',
    parameters: {
      sourcePath: { type: 'string', description: 'Source path', required: true },
      destPath: { type: 'string', description: 'Destination path', required: true },
      basePath: { type: 'string', description: 'Base path for relative paths' },
      recursive: { type: 'boolean', description: 'Recursively copy directories' },
      overwrite: { type: 'boolean', description: 'Overwrite destination if exists' },
    },
  },
  {
    name: 'search_files',
    description: 'Search for text content in files within a directory',
    parameters: {
      query: { type: 'string', description: 'Text to search for', required: true },
      basePath: { type: 'string', description: 'Directory to search in', required: true },
      extensions: { type: 'array', description: 'File extensions to include (e.g., ["ts", "js"])' },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 50)' },
      caseSensitive: { type: 'boolean', description: 'Case-sensitive search' },
    },
  },
  {
    name: 'create_directory',
    description: 'Create a new directory (including parent directories if needed)',
    parameters: {
      dirPath: { type: 'string', description: 'Path of directory to create', required: true },
      basePath: { type: 'string', description: 'Base path for relative paths' },
    },
  },
  {
    name: 'get_file_info',
    description: 'Get detailed information about a file or directory',
    parameters: {
      filePath: { type: 'string', description: 'Path to the file or directory', required: true },
      basePath: { type: 'string', description: 'Base path for relative paths' },
    },
  },
  {
    name: 'edit_file',
    description: 'Edit an existing file surgically using an exact string anchor (replace/insert_after/delete). Fails if the target is missing or ambiguous.',
    parameters: {
      filePath: { type: 'string', description: 'Path to the existing file to edit', required: true },
      basePath: { type: 'string', description: 'Base path for relative file paths', required: true },
      operation: { type: 'string', description: 'One of: replace | insert_after | delete', required: true },
      target: { type: 'string', description: 'Exact string to match (must occur exactly once)', required: true },
      replacement: { type: 'string', description: 'Replacement content for replace operation' },
      content: { type: 'string', description: 'Content to insert for insert_after operation' },
      encoding: { type: 'string', description: 'File encoding (default: utf8)' },
    },
  },
  // Project Tools
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
    description: 'Create new files in the workspace. Refuses to overwrite existing files (use edit_file to modify).',
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
  {
    name: 'run_command',
    description: 'Run a shell command in a given working directory and return stdout/stderr',
    parameters: {
      command: { type: 'string', description: 'Command to execute', required: true },
      cwd: { type: 'string', description: 'Working directory (absolute path preferred)', required: true },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 600000)' },
      env: { type: 'object', description: 'Optional environment variables to merge into process.env' },
    },
  },
];

export class ToolRouter {
  async execute(call: MCPToolCall): Promise<MCPToolResult> {
    switch (call.toolName) {
      // Filesystem tools
      case 'read_file':
        return readFile(call.parameters as unknown as ReadFileParams);
      case 'list_directory':
        return listDirectory(call.parameters as unknown as ListDirectoryParams);
      case 'delete_file':
        return deleteFileOrDir(call.parameters as unknown as DeleteParams);
      case 'move_file':
        return moveFile(call.parameters as unknown as MoveParams);
      case 'copy_file':
        return copyFile(call.parameters as unknown as CopyParams);
      case 'search_files':
        return searchFiles(call.parameters as unknown as SearchFilesParams);
      case 'create_directory':
        return createDirectory(call.parameters as unknown as CreateDirectoryParams);
      case 'get_file_info':
        return getFileInfo(call.parameters as unknown as FileInfoParams);
      case 'edit_file':
        return editFile(call.parameters as unknown as EditFileParams);
      // Project tools
      case 'create_repo':
        return createRepo(call.parameters as unknown as CreateRepoParams);
      case 'write_files':
        return writeFiles(call.parameters as unknown as WriteFilesParams);
      case 'deploy_preview':
        return deployPreview(call.parameters as unknown as DeployPreviewParams);
      case 'run_migrations':
        return runMigrations(call.parameters as unknown as RunMigrationsParams);
      case 'connect_supabase':
        return connectSupabase(call.parameters as unknown as ConnectSupabaseParams);
      case 'run_command':
        return runCommand(call.parameters as unknown as RunCommandParams);
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
