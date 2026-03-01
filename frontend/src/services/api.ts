import { AgentMode, FileNode, GitStatus, GitCommit, LLMModel, OpenRouterStatus } from '../types';

const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface StreamChunk {
  type: 'chunk' | 'done' | 'error';
  content?: string | import('../types').StreamEventTool;
  message?: { id: string; role: string; content: string; timestamp: string };
  plan?: import('../types').ExecutionPlan;
  error?: string;
}

export const api = {
  // Agent sessions
  createSession: (rootPath: string, mode: AgentMode) =>
    request<{ sessionId: string; mode: AgentMode; createdAt: string }>('/agent/sessions', {
      method: 'POST',
      body: JSON.stringify({ rootPath, mode }),
    }),

  getSession: (sessionId: string) =>
    request<{
      id: string;
      mode: AgentMode;
      messages: import('../types').ChatMessage[];
    }>(`/agent/sessions/${sessionId}`),

  streamMessage: async (
    sessionId: string,
    message: string,
    images: string[] | undefined,
    attachments: import('../types').ChatAttachment[] | undefined,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}/agent/sessions/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, images, attachments }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body?.getReader();
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
          try {
            const chunk = JSON.parse(line.slice(6)) as StreamChunk;
            onChunk(chunk);
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }
  },

  setMode: (sessionId: string, mode: AgentMode) =>
    request<{ success: boolean; mode: AgentMode }>(`/agent/sessions/${sessionId}/mode`, {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),

  approvePlan: (sessionId: string) =>
    request<{ success: boolean; message: string; errors?: string[] }>(
      `/agent/sessions/${sessionId}/plan/approve`,
      { method: 'POST' }
    ),

  rejectPlan: (sessionId: string) =>
    request<{ success: boolean }>(`/agent/sessions/${sessionId}/plan/reject`, {
      method: 'POST',
    }),

  // Workspace
  listFiles: (root: string) =>
    request<{ files: FileNode[]; rootPath: string }>(`/workspace/files?root=${encodeURIComponent(root)}`),

  readFile: (path: string, root: string) =>
    request<{ path: string; content: string; extension: string }>(
      `/workspace/file?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}`
    ),

  writeFile: (path: string, content: string, root: string) =>
    request<{ success: boolean; path: string }>('/workspace/file', {
      method: 'PUT',
      body: JSON.stringify({ path, content, root }),
    }),

  deleteFile: (path: string, root: string) =>
    request<{ success: boolean }>(
      `/workspace/file?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}`,
      { method: 'DELETE' }
    ),

  searchFiles: (query: string, root: string, extensions?: string[]) =>
    request<{ results: string[]; query: string }>('/workspace/search', {
      method: 'POST',
      body: JSON.stringify({ query, root, extensions }),
    }),

  createDirectory: (path: string, root: string) =>
    request<{ success: boolean; path: string }>('/workspace/directory', {
      method: 'POST',
      body: JSON.stringify({ path, root }),
    }),

  // Git
  gitStatus: (repo: string) =>
    request<GitStatus>(`/git/status?repo=${encodeURIComponent(repo)}`),

  gitLog: (repo: string, limit = 20) =>
    request<{ commits: GitCommit[] }>(`/git/log?repo=${encodeURIComponent(repo)}&limit=${limit}`),

  gitBranches: (repo: string) =>
    request<{ current: string; all: string[] }>(`/git/branches?repo=${encodeURIComponent(repo)}`),

  gitCreateBranch: (repo: string, name: string, checkout = true) =>
    request<{ success: boolean; branch: string }>('/git/branch', {
      method: 'POST',
      body: JSON.stringify({ repo, name, checkout }),
    }),

  gitCheckout: (repo: string, branch: string) =>
    request<{ success: boolean; branch: string }>('/git/checkout', {
      method: 'POST',
      body: JSON.stringify({ repo, branch }),
    }),

  gitStage: (repo: string, files?: string[], all?: boolean) =>
    request<{ success: boolean }>('/git/stage', {
      method: 'POST',
      body: JSON.stringify({ repo, files, all }),
    }),

  gitCommit: (repo: string, message: string) =>
    request<{ success: boolean; hash: string }>('/git/commit', {
      method: 'POST',
      body: JSON.stringify({ repo, message }),
    }),

  gitPush: (repo: string, remote?: string, branch?: string) =>
    request<{ success: boolean }>('/git/push', {
      method: 'POST',
      body: JSON.stringify({ repo, remote, branch }),
    }),

  gitGetConfig: (repo: string) =>
    request<{ name: string; email: string }>(`/git/config?repo=${encodeURIComponent(repo)}`),

  gitSetConfig: (repo: string, name: string, email: string) =>
    request<{ success: boolean }>('/git/config', {
      method: 'POST',
      body: JSON.stringify({ repo, name, email }),
    }),

  gitDiff: (repo: string, file?: string, staged?: boolean) =>
    request<{ diff: string }>(
      `/git/diff?repo=${encodeURIComponent(repo)}${file ? `&file=${encodeURIComponent(file)}` : ''}${staged ? '&staged=true' : ''}`
    ),

  // OpenRouter / LLM
  getOpenRouterStatus: () =>
    request<OpenRouterStatus>('/openrouter/status'),

  getModels: () =>
    request<{ models: LLMModel[]; total: number; defaultModel: string }>('/openrouter/models'),

  setModel: (sessionId: string, model: string) =>
    request<{ success: boolean; model: string }>(`/agent/sessions/${sessionId}/model`, {
      method: 'PATCH',
      body: JSON.stringify({ model }),
    }),

  // Generic methods
  get: <T = unknown>(path: string) => request<T>(path),

  // Workspace/Repos
  getRepos: () =>
    request<{ repos: { id: string; name: string; path: string; lastAccessedAt: string }[]; total: number }>('/workspace/repos'),

  getRepoContext: (repoId: string) =>
    request<{ context: string; workspaceId: string; workspacePath: string }>(`/workspace/repos/${repoId}/context`),

  createRepo: (name: string, template?: 'empty' | 'react' | 'node' | 'nextjs', initGit = true) =>
    request<{ success: boolean; repo: { id: string; name: string; path: string; template: string } }>('/workspace/repos', {
      method: 'POST',
      body: JSON.stringify({ name, template, initGit }),
    }),

  cloneRepo: (url: string, name?: string) =>
    request<{ success: boolean; repo: { id: string; name: string; path: string; url: string } }>('/workspace/repos/clone', {
      method: 'POST',
      body: JSON.stringify({ url, name }),
    }),

  scanRepos: () =>
    request<{ repos: { id: string; name: string; path: string; lastAccessedAt: string }[]; total: number }>('/workspace/repos/scan', {
      method: 'POST',
    }),
};
