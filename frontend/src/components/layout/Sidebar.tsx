import React from 'react';
import { Files, GitBranch, Search, Settings } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { FileExplorer } from '../explorer/FileExplorer';
import { GitPanel } from '../git/GitPanel';
import { ActivePanel } from '../../types';

interface NavItem {
  id: ActivePanel;
  icon: React.ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'explorer', icon: <Files size={18} />, label: 'Explorer' },
  { id: 'git', icon: <GitBranch size={18} />, label: 'Source Control' },
  { id: 'search', icon: <Search size={18} />, label: 'Search' },
];

export function Sidebar() {
  const { activePanel, setActivePanel, gitStatus } = useAgentStore();

  const gitChanges =
    (gitStatus?.staged.length || 0) +
    (gitStatus?.unstaged.length || 0) +
    (gitStatus?.untracked.length || 0);

  return (
    <div className="flex h-full border-r border-border-subtle">
      {/* Icon rail */}
      <div className="w-12 flex flex-col items-center py-2 gap-1 bg-surface-0 border-r border-border-subtle flex-shrink-0">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePanel(item.id)}
            title={item.label}
            className={`
              relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors
              ${activePanel === item.id
                ? 'text-white bg-surface-3'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-surface-2'
              }
            `}
          >
            {item.icon}
            {item.id === 'git' && gitChanges > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent rounded-full text-[9px] flex items-center justify-center text-white font-bold">
                {gitChanges > 9 ? '9+' : gitChanges}
              </span>
            )}
          </button>
        ))}

        <div className="flex-1" />

        <button
          title="Settings"
          className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Panel content */}
      <div className="w-56 flex-shrink-0 bg-surface-1 overflow-hidden">
        {activePanel === 'explorer' && <FileExplorer />}
        {activePanel === 'git' && <GitPanel />}
        {activePanel === 'search' && <SearchPanel />}
      </div>
    </div>
  );
}

function SearchPanel() {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<string[]>([]);
  const { rootPath, openFile } = useAgentStore();
  const { api } = React.useMemo(() => ({ api: null as null }), []); // placeholder

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      const res = await fetch(
        `/api/workspace/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, root: rootPath }),
        }
      );
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">Search</div>
      <div className="p-2 border-b border-border-subtle">
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search files..."
            className="input text-xs flex-1"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {results.map((r) => (
          <button
            key={r}
            onClick={() => openFile(r)}
            className="w-full text-left px-3 py-1 text-xs text-zinc-300 hover:bg-surface-2 truncate font-mono"
          >
            {r}
          </button>
        ))}
        {results.length === 0 && query && (
          <div className="px-3 py-4 text-xs text-zinc-600 text-center">No results</div>
        )}
      </div>
    </div>
  );
}
