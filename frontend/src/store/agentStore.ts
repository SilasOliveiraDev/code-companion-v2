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
} from '../types';
import { api } from '../services/api';

interface AgentState {
  // Session
  sessionId: string | null;
  mode: AgentMode;

  // Chat
  messages: ChatMessage[];
  isStreaming: boolean;
  streamBuffer: string;
  currentPlan: ExecutionPlan | null;

  // Workspace
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
  sendMessage: (message: string) => Promise<void>;
  setMode: (mode: AgentMode) => Promise<void>;
  approvePlan: () => Promise<void>;
  rejectPlan: () => void;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  saveFile: (path: string, content: string) => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  stageAll: () => Promise<void>;
  commitChanges: (message: string) => Promise<void>;
  setActivePanel: (panel: ActivePanel) => void;
  setBottomPanel: (panel: BottomPanel) => void;
  setPreviewUrl: (url: string | null) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  // Initial state
  sessionId: null,
  mode: 'PLAN',
  messages: [],
  isStreaming: false,
  streamBuffer: '',
  currentPlan: null,
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
    } catch (error) {
      console.error('Failed to init session:', error);
    }
  },

  sendMessage: async (message: string) => {
    const { sessionId } = get();
    if (!sessionId || get().isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
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
      await api.streamMessage(sessionId, message, (chunk) => {
        if (chunk.type === 'chunk') {
          set((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.id === assistantMsg.id) {
              last.content += chunk.content;
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

  setActivePanel: (panel: ActivePanel) => set({ activePanel: panel }),
  setBottomPanel: (panel: BottomPanel) => set({ bottomPanel: panel }),
  setPreviewUrl: (url: string | null) => set({ previewUrl: url, showPreview: url !== null }),
}));
