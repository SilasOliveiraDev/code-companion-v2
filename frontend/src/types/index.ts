export type AgentMode = 'ASK' | 'PLAN' | 'AGENT';

export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface PlanStep {
  id: string;
  order: number;
  description: string;
  files: string[];
  action: 'create' | 'modify' | 'delete' | 'run' | 'install' | 'migrate';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  impactedFiles: string[];
  architectureDecisions: string[];
  steps: PlanStep[];
  validationMethod: string;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
}

export interface GitStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export type ActivePanel = 'explorer' | 'git' | 'search';

export type BottomPanel = 'terminal' | 'preview' | 'none';

export interface WorkspaceLayout {
  sidebarWidth: number;
  chatWidth: number;
  bottomPanelHeight: number;
  bottomPanel: BottomPanel;
  activePanel: ActivePanel;
  showPreview: boolean;
}
