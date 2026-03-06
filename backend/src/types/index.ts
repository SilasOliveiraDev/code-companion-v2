export type AgentMode = 'ASK' | 'PLAN' | 'AGENT';

export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  images?: string[];
  timestamp: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
}

export interface WorkspaceState {
  rootPath: string;
  files: FileNode[];
  activeFile?: string;
  openFiles: string[];
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

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, MCPToolParameter>;
}

export interface MCPToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

export interface MCPToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
  sessionId: string;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentSession {
  id: string;
  mode: AgentMode;
  selectedModel: string;
  messages: ChatMessage[];
  currentPlan?: ExecutionPlan;
  workspace: WorkspaceState;
  projectIntelligence?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentRequest {
  sessionId: string;
  message: string;
  mode: AgentMode;
}

export interface AgentResponse {
  sessionId: string;
  message: ChatMessage;
  plan?: ExecutionPlan;
  toolCalls?: MCPToolCall[];
}

export interface DeploymentInfo {
  url: string;
  status: 'building' | 'ready' | 'error';
  updatedAt: Date;
}

export type StreamChunkToolState = 'start' | 'success' | 'failed';

export interface StreamEventTool {
  type: 'tool';
  toolName: string;
  state: StreamChunkToolState;
  args?: Record<string, unknown>;
  result?: any;
  error?: string;
  toolCallId?: string;
}

export type StreamProgressStage =
  | 'analyzing'
  | 'context'
  | 'thinking'
  | 'executing'
  | 'validating'
  | 'healing'
  | 'complete';

export interface StreamEventProgress {
  type: 'progress';
  stage: StreamProgressStage;
  message: string;
  stepCurrent?: number;
  stepTotal?: number;
}

export interface StreamEventCheckpoint {
  type: 'checkpoint';
  message: string;
  completedTools: string[];
  summary: string;
  iterationsUsed: number;
  canContinue: boolean;
}

export type StreamEvent = string | StreamEventTool | StreamEventProgress | StreamEventCheckpoint;

export interface SupabaseConfig {
  projectUrl: string;
  anonKey: string;
  serviceRoleKey?: string;
}
