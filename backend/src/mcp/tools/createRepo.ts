import { MCPToolResult } from '../../types';
import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

export interface CreateRepoParams {
  name: string;
  description?: string;
  template?: string;
  targetPath: string;
}

export async function createRepo(params: CreateRepoParams): Promise<MCPToolResult> {
  try {
    const { name, description, targetPath } = params;
    const repoPath = path.join(targetPath, name);

    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }

    const git = simpleGit(repoPath);
    await git.init();

    // Create basic project structure
    const readmeContent = `# ${name}\n\n${description || 'A new project created by AI Software Engineer Agent.'}\n`;
    fs.writeFileSync(path.join(repoPath, 'README.md'), readmeContent);

    const gitignoreContent = `node_modules/\ndist/\n.env\n.DS_Store\n*.log\n`;
    fs.writeFileSync(path.join(repoPath, '.gitignore'), gitignoreContent);

    await git.add('.');
    await git.commit('Initial commit: Project scaffold by AI Engineer Agent');

    return {
      success: true,
      data: {
        path: repoPath,
        name,
        message: `Repository "${name}" created successfully at ${repoPath}`,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create repository',
    };
  }
}
