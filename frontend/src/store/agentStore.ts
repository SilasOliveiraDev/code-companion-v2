import { create } from 'zustand';
import {
  AgentMode,
  ChatMessage,
  ExecutionPlan,
  FileNode,
  GitStatus,
  GitCommit,
  ActivePanel,
  BottomPanel,
  LLMModel,
  ChatAttachment,
} from '../types';
import { api } from '../services/api';

interface Repository {
  id: string;
  name: string;
  path: string;
  lastAccessedAt: string;
}

interface AgentState {
  // Session
  sessionId: string | null;
  mode: AgentMode;

  // Model
  selectedModel: string;
  availableModels: LLMModel[];
  isLoadingModels: boolean;

  // Chat
  messages: ChatMessage[];
  isStreaming: boolean;
  streamBuffer: string;
  currentPlan: ExecutionPlan | null;

  // Workspace
  currentRepoId: string | null;
  currentRepoName: string | null;
  repositories: Repository[];
  rootPath: string;
  files: FileNode[];
  activeFile: string | null;
  openFiles: string[];
  fileContents: Map<string, string>;

  // Git
  gitStatus: GitStatus | null;
  gitLog: GitCommit[];
  gitBranches: { current: string; all: string[] } | null;

  // Layout
  activePanel: ActivePanel;
  bottomPanel: BottomPanel;
  showPreview: boolean;
  previewUrl: string | null;

  // Actions
  initSession: (rootPath?: string) => Promise<void>;
  sendMessage: (message: string, images?: string[], attachments?: ChatAttachment[]) => Promise<void>;
  setMode: (mode: AgentMode) => Promise<void>;
  setSelectedModel: (model: string) => void;
  loadModels: () => Promise<void>;
  approvePlan: () => Promise<void>;
  rejectPlan: () => void;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  saveFile: (path: string, content: string) => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  stageAll: () => Promise<void>;
  commitChanges: (message: string) => Promise<void>;    pushChanges: () => Promise<void>;
    getGitConfig: () => Promise<{name: string, email: string} | null>;
    setGitConfig: (name: string, email: string) => Promise<void>;  setActivePanel: (panel: ActivePanel) => void;
  setBottomPanel: (panel: BottomPanel) => void;
  setPreviewUrl: (url: string | null) => void;
  loadRepositories: () => Promise<void>;
  selectRepository: (repoId: string, repoPath: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  // Initial state
  sessionId: null,
  mode: 'PLAN',
  selectedModel: 'anthropic/claude-sonnet-4',
  availableModels: [],
  isLoadingModels: false,
  messages: [],
  isStreaming: false,
  streamBuffer: '',
  currentPlan: null,
  currentRepoId: null,
  currentRepoName: null,
  repositories: [],
  rootPath: '',
  files: [],
  activeFile: null,
  openFiles: [],
  fileContents: new Map(),
  gitStatus: null,
  gitLog: [],
  gitBranches: null,
  activePanel: 'explorer',
  bottomPanel: 'none',
  showPreview: false,
  previewUrl: null,

  initSession: async (rootPath = '/tmp/workspace') => {
    try {
      const data = await api.createSession(rootPath, 'PLAN');
      set({ sessionId: data.sessionId, mode: data.mode, rootPath });

      // Load initial workspace state
      await get().refreshFiles();
      await get().refreshGitStatus();
      await get().loadModels();
    } catch (error) {
      console.error('Failed to init session:', error);
    }
  },

  loadModels: async () => {
    set({ isLoadingModels: true });
    try {
      const data = await api.getModels();
      set({ 
        availableModels: data.models,
        selectedModel: data.defaultModel || 'anthropic/claude-sonnet-4',
        isLoadingModels: false,
      });
    } catch (error) {
      console.error('Failed to load models:', error);
      set({ isLoadingModels: false });
    }
  },

  setSelectedModel: (model: string) => {
    set({ selectedModel: model });
    // Persist to session if needed
    const { sessionId } = get();
    if (sessionId) {
      api.setModel(sessionId, model).catch(console.error);
    }
  },

  sendMessage: async (message: string, images?: string[], attachments?: ChatAttachment[]) => {
    const { sessionId } = get();
    if (!sessionId || get().isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      images,
      timestamp: new Date().toISOString(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
      streamBuffer: '',
    }));

    try {
      await api.streamMessage(sessionId, message, images, attachments, (chunk) => {
        if (chunk.type === 'chunk' && chunk.content) {
          set((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.id === assistantMsg.id) {
               if (typeof chunk.content === 'string') {
                  last.content += chunk.content;
               } else if (chunk.content && typeof chunk.content === 'object' && chunk.content.type === 'tool') {
                  if (!last.metadata) last.metadata = {};
                  if (!last.metadata.toolCalls) last.metadata.toolCalls = [];
                  
                  const tools = last.metadata.toolCalls as any[];
                  const existingIdx = tools.findIndex(t => t.toolCallId === (chunk.content as any).toolCallId && t.toolName === (chunk.content as any).toolName);
                  
                  if (existingIdx >= 0) {
                     tools[existingIdx] = { ...tools[existingIdx], ...chunk.content };
                  } else {
                     tools.push(chunk.content);
                  }
               }
            }
            return { messages: msgs };
          });
        } else if (chunk.type === 'done') {
          set((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.id === assistantMsg.id) {
              last.content = chunk.message?.content || last.content;
            }
            return {
              messages: msgs,
              isStreaming: false,
              currentPlan: chunk.plan || state.currentPlan,
            };
          });
        } else if (chunk.type === 'error') {
          set((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.id === assistantMsg.id) {
              last.content = `Error: ${chunk.error}`;
            }
            return { messages: msgs, isStreaming: false };
          });
        }
      });
    } catch (error) {
      set((state) => {
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.id === assistantMsg.id) {
          last.content = `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
        return { messages: msgs, isStreaming: false };
      });
    }
  },

  setMode: async (mode: AgentMode) => {
    const { sessionId } = get();
    if (!sessionId) return;
    await api.setMode(sessionId, mode);
    set({ mode });
  },

  approvePlan: async () => {
    const { sessionId, currentPlan } = get();
    if (!sessionId || !currentPlan) return;

    set((state) => ({
      currentPlan: state.currentPlan
        ? { ...state.currentPlan, status: 'executing' }
        : null,
    }));

    try {
      const result = await api.approvePlan(sessionId);
      const resultMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.message,
        timestamp: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, resultMsg],
        currentPlan: state.currentPlan
          ? { ...state.currentPlan, status: result.success ? 'completed' : 'failed' }
          : null,
      }));

      await get().refreshFiles();
      await get().refreshGitStatus();
    } catch (error) {
      set((state) => ({
        currentPlan: state.currentPlan
          ? { ...state.currentPlan, status: 'failed' }
          : null,
      }));
      console.error('Plan approval failed:', error);
    }
  },

  rejectPlan: () => {
    const { sessionId } = get();
    if (sessionId) {
      api.rejectPlan(sessionId).catch(console.error);
    }
    set({ currentPlan: null });
  },

  openFile: async (path: string) => {
    const { fileContents, rootPath } = get();

    set((state) => ({
      activeFile: path,
      openFiles: state.openFiles.includes(path)
        ? state.openFiles
        : [...state.openFiles, path],
    }));

    if (!fileContents.has(path)) {
      try {
        const data = await api.readFile(path, rootPath);
        set((state) => {
          const newMap = new Map(state.fileContents);
          newMap.set(path, data.content);
          return { fileContents: newMap };
        });
      } catch (error) {
        console.error('Failed to read file:', error);
      }
    }
  },

  closeFile: (path: string) => {
    set((state) => {
      const newOpen = state.openFiles.filter((f) => f !== path);
      const newMap = new Map(state.fileContents);
      newMap.delete(path);
      return {
        openFiles: newOpen,
        activeFile: state.activeFile === path ? newOpen[newOpen.length - 1] || null : state.activeFile,
        fileContents: newMap,
      };
    });
  },

  saveFile: async (path: string, content: string) => {
    const { rootPath } = get();
    await api.writeFile(path, content, rootPath);
    set((state) => {
      const newMap = new Map(state.fileContents);
      newMap.set(path, content);
      return { fileContents: newMap };
    });
  },

  refreshFiles: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    try {
      const data = await api.listFiles(rootPath);
      set({ files: data.files });
    } catch (error) {
      console.error('Failed to refresh files:', error);
    }
  },

  refreshGitStatus: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    try {
      const [status, log, branches] = await Promise.all([
        api.gitStatus(rootPath),
        api.gitLog(rootPath),
        api.gitBranches(rootPath),
      ]);
      set({ gitStatus: status, gitLog: log.commits, gitBranches: branches });
    } catch {
      // Git may not be initialized
    }
  },

  stageAll: async () => {
    const { rootPath } = get();
    await api.gitStage(rootPath, undefined, true);
    await get().refreshGitStatus();
  },

  commitChanges: async (message: string) => {
    const { rootPath } = get();
    await api.gitCommit(rootPath, message);
    await get().refreshGitStatus();
  },

  pushChanges: async () => {
    const { rootPath } = get();
    await api.gitPush(rootPath);
    await get().refreshGitStatus();
  },

  getGitConfig: async () => {
    try {
      const { rootPath } = get();
      const config = await api.gitGetConfig(rootPath);
      return config;
    } catch (error) {
      console.error('Failed to get git config:', error);
      return null;
    }
  },

  setGitConfig: async (name: string, email: string) => {
    try {
      const { rootPath } = get();
      await api.gitSetConfig(rootPath, name, email);
    } catch (error) {
      console.error('Failed to set git config:', error);
    }
  },

  setActivePanel: (panel: ActivePanel) => set({ activePanel: panel }),
  setBottomPanel: (panel: BottomPanel) => set({ bottomPanel: panel }),
  setPreviewUrl: (url: string | null) => set({ previewUrl: url, showPreview: url !== null }),

  loadRepositories: async () => {
    try {
      const response = await api.getRepos();
      set({ repositories: response.repos });
    } catch (error) {
      console.error('Failed to load repositories:', error);
    }
  },

  selectRepository: async (repoId: string, repoPath: string) => {
    const { repositories } = get();
    const repo = repositories.find(r => r.id === repoId);

    try {
      localStorage.setItem('ccv2.selectedRepoId', repoId);
    } catch {
      // ignore (e.g. privacy mode)
    }

    set({
      currentRepoId: repoId,
      currentRepoName: repo?.name || repoPath.split(/[\\/]/).pop() || '',
      rootPath: repoPath,
      files: [],
      activeFile: null,
      openFiles: [],
      fileContents: new Map(),
      gitStatus: null,
      gitLog: [],
      gitBranches: null,
    });

    await get().initSession(repoPath);
  },
}));
