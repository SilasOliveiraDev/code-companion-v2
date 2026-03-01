import { useState, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  RefreshCw,
} from 'lucide-react';
import { FileNode } from '../../types';
import { useAgentStore } from '../../store/agentStore';
import { RepoSelector } from '../workspace/RepoSelector';

const EXTENSION_COLORS: Record<string, string> = {
  ts: 'text-blue-400',
  tsx: 'text-cyan-400',
  js: 'text-yellow-400',
  jsx: 'text-yellow-300',
  json: 'text-yellow-500',
  css: 'text-pink-400',
  scss: 'text-pink-500',
  html: 'text-orange-400',
  md: 'text-zinc-300',
  py: 'text-green-400',
  go: 'text-cyan-300',
  rs: 'text-orange-500',
  sql: 'text-purple-400',
  env: 'text-red-400',
  yml: 'text-yellow-300',
  yaml: 'text-yellow-300',
  sh: 'text-green-300',
  dockerfile: 'text-blue-300',
  svg: 'text-pink-300',
  png: 'text-purple-300',
  jpg: 'text-purple-300',
};

interface FileNodeProps {
  node: FileNode;
  depth: number;
  onOpen: (path: string) => void;
  activeFile: string | null;
}

function FileNodeItem({ node, depth, onOpen, activeFile }: FileNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const handleClick = () => {
    if (node.type === 'directory') {
      setExpanded((e) => !e);
    } else {
      onOpen(node.path);
    }
  };

  const isActive = activeFile === node.path;
  const colorClass = node.extension ? (EXTENSION_COLORS[node.extension] || 'text-zinc-400') : 'text-zinc-400';

  return (
    <div>
      <button
        onClick={handleClick}
        className={`
          w-full flex items-center gap-1 py-0.5 px-2 rounded-sm text-xs transition-colors cursor-pointer
          hover:bg-surface-3 text-left group
          ${isActive ? 'bg-accent/20 text-accent-light' : ''}
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.type === 'directory' ? (
          <>
            <span className="text-zinc-500 w-3 flex-shrink-0">
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </span>
            {expanded ? (
              <FolderOpen size={12} className="text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder size={12} className="text-yellow-600 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 flex-shrink-0" />
            <File size={12} className={`flex-shrink-0 ${colorClass}`} />
          </>
        )}
        <span className={`truncate ${isActive ? 'text-accent-light' : 'text-zinc-300'}`}>
          {node.name}
        </span>
      </button>

      {node.type === 'directory' && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpen={onOpen}
              activeFile={activeFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileExplorer() {
  const { 
    files, 
    activeFile, 
    openFile, 
    refreshFiles, 
    rootPath, 
    currentRepoId, 
    currentRepoName,
    loadRepositories,
    selectRepository 
  } = useAgentStore();

  useEffect(() => {
    loadRepositories();
  }, [loadRepositories]);

  return (
    <div className="flex flex-col h-full">
      {/* Repository Selector */}
      <RepoSelector 
        currentRepoId={currentRepoId || undefined}
        onRepoSelect={selectRepository}
      />

      <div className="panel-header justify-between">
        <span className="truncate">{currentRepoName || 'Explorer'}</span>
        <button
          onClick={refreshFiles}
          className="btn-ghost p-0.5"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {files.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-zinc-600 text-xs">No files found</div>
            <div className="text-zinc-700 text-[10px] mt-1">{rootPath}</div>
          </div>
        ) : (
          files.map((node) => (
            <FileNodeItem
              key={node.path}
              node={node}
              depth={0}
              onOpen={openFile}
              activeFile={activeFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
