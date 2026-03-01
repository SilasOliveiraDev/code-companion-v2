import React, { useEffect } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { Terminal, Monitor, ChevronDown, ChevronUp } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { Sidebar } from './Sidebar';
import { CodeEditor } from '../editor/CodeEditor';
import { ChatPanel } from '../chat/ChatPanel';
import { PreviewPanel } from '../preview/PreviewPanel';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { BottomPanel } from '../../types';

function ResizeHandle({ direction = 'horizontal' }: { direction?: 'horizontal' | 'vertical' }) {
  return (
    <PanelResizeHandle
      className={`
        ${direction === 'horizontal' ? 'w-px hover:w-0.5' : 'h-px hover:h-0.5'}
        bg-border-subtle hover:bg-accent/50 transition-all duration-150 flex-shrink-0
      `}
    />
  );
}

export function Workspace() {
  const { initSession, bottomPanel, setBottomPanel, showPreview } = useAgentStore();

  useEffect(() => {
    initSession(import.meta.env.VITE_WORKSPACE_ROOT || '/tmp/workspace');
  }, [initSession]);

  const toggleBottomPanel = (panel: BottomPanel) => {
    setBottomPanel(bottomPanel === panel ? 'none' : panel);
  };

  return (
    <div className="flex flex-col h-screen bg-surface-0 overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-0 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center">
            <span className="text-white text-xs font-bold">AI</span>
          </div>
          <span className="text-sm font-semibold text-white">Code Companion</span>
          <span className="text-zinc-600 text-xs">AI Software Engineer</span>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3">
          <StatusIndicator />
        </div>

        {/* Bottom panel toggles */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleBottomPanel('terminal')}
            className={`btn-ghost text-xs gap-1 ${bottomPanel === 'terminal' ? 'text-white bg-surface-3' : ''}`}
          >
            <Terminal size={12} />
            Terminal
            {bottomPanel === 'terminal' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          </button>
          <button
            onClick={() => toggleBottomPanel('preview')}
            className={`btn-ghost text-xs gap-1 ${bottomPanel === 'preview' ? 'text-white bg-surface-3' : ''}`}
          >
            <Monitor size={12} />
            Preview
            {bottomPanel === 'preview' ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          </button>
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" className="h-full">
          {/* Sidebar */}
          <Panel defaultSize={16} minSize={12} maxSize={30}>
            <Sidebar />
          </Panel>

          <ResizeHandle />

          {/* Main content area */}
          <Panel defaultSize={55} minSize={30}>
            <PanelGroup direction="vertical" className="h-full">
              {/* Editor */}
              <Panel defaultSize={bottomPanel !== 'none' ? 65 : 100} minSize={30}>
                <CodeEditor />
              </Panel>

              {/* Bottom panel */}
              {bottomPanel !== 'none' && (
                <>
                  <ResizeHandle direction="vertical" />
                  <Panel defaultSize={35} minSize={15} maxSize={60}>
                    {bottomPanel === 'terminal' && <TerminalPanel />}
                    {bottomPanel === 'preview' && <PreviewPanel />}
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          <ResizeHandle />

          {/* Chat + optional preview side panel */}
          <Panel defaultSize={showPreview ? 29 : 29} minSize={22} maxSize={45}>
            {showPreview ? (
              <PanelGroup direction="vertical" className="h-full">
                <Panel defaultSize={50} minSize={30}>
                  <ChatPanel />
                </Panel>
                <ResizeHandle direction="vertical" />
                <Panel defaultSize={50} minSize={20}>
                  <PreviewPanel />
                </Panel>
              </PanelGroup>
            ) : (
              <ChatPanel />
            )}
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function StatusIndicator() {
  const { sessionId, isStreaming, mode } = useAgentStore();

  const modeColors: Record<string, string> = {
    ASK: 'bg-info',
    PLAN: 'bg-warning',
    AGENT: 'bg-success',
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <div
          className={`w-1.5 h-1.5 rounded-full ${modeColors[mode] || 'bg-zinc-500'} ${
            isStreaming ? 'animate-pulse' : ''
          }`}
        />
        <span className="text-xs text-zinc-500">
          {isStreaming ? 'Thinking...' : sessionId ? 'Ready' : 'Connecting...'}
        </span>
      </div>
    </div>
  );
}
