import React, { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, X, Plus } from 'lucide-react';

interface TerminalSession {
  id: string;
  name: string;
  lines: string[];
}

// Lightweight pseudo-terminal for demo (real impl would use xterm.js + backend WebSocket PTY)
export function TerminalPanel() {
  const [sessions, setSessions] = useState<TerminalSession[]>([
    { id: '1', name: 'Terminal', lines: ['$ '] },
  ]);
  const [activeId, setActiveId] = useState('1');
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions]);

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeSession) return;

    const cmd = input.trim();
    setInput('');

    // Simulate command execution (in production this goes to a backend PTY)
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeId) return s;
        const output = simulateCommand(cmd);
        return {
          ...s,
          lines: [...s.lines.slice(0, -1), `$ ${cmd}`, ...output, '$ '],
        };
      })
    );
  };

  const addSession = () => {
    const id = Date.now().toString();
    setSessions((prev) => [
      ...prev,
      { id, name: `Terminal ${prev.length + 1}`, lines: ['$ '] },
    ]);
    setActiveId(id);
  };

  const closeSession = (id: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (activeId === id && remaining.length > 0) {
        setActiveId(remaining[remaining.length - 1].id);
      }
      return remaining;
    });
  };

  return (
    <div className="flex flex-col h-full bg-surface-0 font-mono">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border-subtle bg-surface-1 flex-shrink-0">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-border-subtle transition-colors group ${
              s.id === activeId ? 'bg-surface-0 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            onClick={() => setActiveId(s.id)}
          >
            <TerminalIcon size={11} />
            <span>{s.name}</span>
            {sessions.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeSession(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-error transition-opacity"
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addSession}
          className="px-2 py-1.5 text-zinc-600 hover:text-zinc-400 transition-colors"
          title="New terminal"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Terminal output */}
      <div
        className="flex-1 overflow-y-auto p-3 text-xs text-green-300 leading-5 cursor-text code-scroll"
        onClick={() => inputRef.current?.focus()}
      >
        {activeSession?.lines.map((line, i) => {
          const isLast = i === (activeSession.lines.length - 1);
          if (isLast) {
            return (
              <div key={i} className="flex items-center">
                <span className="text-green-400">{'$ '}</span>
                <form onSubmit={handleCommand} className="flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="bg-transparent text-green-300 outline-none w-full caret-green-400"
                    autoFocus
                    spellCheck={false}
                  />
                </form>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`whitespace-pre-wrap ${
                line.startsWith('error:') || line.startsWith('Error:')
                  ? 'text-error'
                  : line.startsWith('$')
                    ? 'text-green-400'
                    : 'text-zinc-300'
              }`}
            >
              {line}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function simulateCommand(cmd: string): string[] {
  const parts = cmd.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  switch (command) {
    case 'ls':
      return ['src/  node_modules/  package.json  tsconfig.json  README.md'];
    case 'pwd':
      return ['/workspace/project'];
    case 'node':
      if (args[0] === '--version') return ['v20.11.0'];
      return [`${cmd}: command executed`];
    case 'npm':
      if (args[0] === 'install') return ['added 0 packages in 0.1s'];
      if (args[0] === 'run') return [`> ${args[1] || 'script'}\n\nStarted...`];
      return [`npm ${args.join(' ')} executed`];
    case 'git':
      if (args[0] === 'status') return ['On branch main\nnothing to commit, working tree clean'];
      if (args[0] === 'log') return ['commit abc1234\nAuthor: AI Agent\nDate: now\n\nInitial commit'];
      return [`git ${args.join(' ')}: executed`];
    case 'echo':
      return [args.join(' ')];
    case 'clear':
      return [];
    case 'help':
      return [
        'Available commands: ls, pwd, node, npm, git, echo, clear',
        'Connect a real terminal via WebSocket for full shell access.',
      ];
    default:
      return [`${command}: command not found (demo terminal)\nType 'help' for available commands`];
  }
}
