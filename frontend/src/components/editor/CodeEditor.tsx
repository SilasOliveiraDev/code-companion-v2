import React, { useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { X, Save, Circle } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  py: 'python',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  dockerfile: 'dockerfile',
  xml: 'xml',
  env: 'plaintext',
};

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (filename.toLowerCase() === 'dockerfile') return 'dockerfile';
  return LANGUAGE_MAP[ext] || 'plaintext';
}

export function CodeEditor() {
  const { activeFile, openFiles, fileContents, closeFile, openFile, saveFile } = useAgentStore();
  const dirtyFiles = useRef(new Set<string>());
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  const handleChange = useCallback(
    (path: string, value: string | undefined) => {
      if (value === undefined) return;
      dirtyFiles.current.add(path);
      forceUpdate();
      // Update in store without saving to disk yet
      useAgentStore.setState((state) => {
        const newMap = new Map(state.fileContents);
        newMap.set(path, value);
        return { fileContents: newMap };
      });
    },
    []
  );

  const handleSave = useCallback(
    async (path: string) => {
      const content = fileContents.get(path);
      if (content !== undefined) {
        await saveFile(path, content);
        dirtyFiles.current.delete(path);
        forceUpdate();
      }
    },
    [fileContents, saveFile]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && activeFile) {
        e.preventDefault();
        handleSave(activeFile);
      }
    },
    [activeFile, handleSave]
  );

  React.useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (openFiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface-1 text-center px-8">
        <div className="text-5xl mb-4 opacity-20">📄</div>
        <p className="text-zinc-500 text-sm">Open a file from the explorer</p>
        <p className="text-zinc-600 text-xs mt-1">or ask the AI to create one</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-1">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border-subtle bg-surface-0 overflow-x-auto flex-shrink-0">
        {openFiles.map((filePath) => {
          const name = filePath.split('/').pop() || filePath;
          const isActive = filePath === activeFile;
          const isDirty = dirtyFiles.current.has(filePath);

          return (
            <button
              key={filePath}
              onClick={() => openFile(filePath)}
              className={`
                flex items-center gap-2 px-3 py-2 text-xs border-r border-border-subtle flex-shrink-0
                transition-colors group min-w-0
                ${isActive
                  ? 'bg-surface-1 text-white border-t-2 border-t-accent -mt-px'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-surface-2'
                }
              `}
            >
              {isDirty ? (
                <Circle size={6} className="fill-warning text-warning flex-shrink-0" />
              ) : null}
              <span className="truncate max-w-[120px]">{name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dirtyFiles.current.delete(filePath);
                  closeFile(filePath);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-white transition-opacity ml-0.5 flex-shrink-0"
              >
                <X size={10} />
              </button>
            </button>
          );
        })}
      </div>

      {/* Editor */}
      {activeFile && (
        <div className="flex-1 relative">
          <Editor
            path={activeFile}
            value={fileContents.get(activeFile) || ''}
            language={getLanguage(activeFile)}
            theme="vs-dark"
            onChange={(val) => handleChange(activeFile, val)}
            options={{
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Fira Code, monospace',
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
              insertSpaces: true,
              renderLineHighlight: 'line',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              contextmenu: false,
              formatOnPaste: true,
              formatOnType: true,
              suggestOnTriggerCharacters: true,
              acceptSuggestionOnEnter: 'on',
              padding: { top: 8, bottom: 8 },
            }}
          />

          {/* Save indicator */}
          {dirtyFiles.current.has(activeFile) && (
            <div className="absolute top-2 right-4 z-10">
              <button
                onClick={() => handleSave(activeFile)}
                className="btn-ghost text-[10px] gap-1 bg-surface-2 border border-border"
                title="Ctrl+S to save"
              >
                <Save size={10} />
                Unsaved
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
