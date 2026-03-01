import React, { useState } from 'react';
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  Circle,
  RefreshCw,
  Check,
} from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

export function GitPanel() {
  const { gitStatus, gitLog, gitBranches, refreshGitStatus, stageAll, commitChanges } =
    useAgentStore();
  const [commitMsg, setCommitMsg] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  const handleCommit = async () => {
    if (!commitMsg.trim() || isCommitting) return;
    setIsCommitting(true);
    try {
      await commitChanges(commitMsg.trim());
      setCommitMsg('');
    } finally {
      setIsCommitting(false);
    }
  };

  const totalChanges =
    (gitStatus?.staged.length || 0) +
    (gitStatus?.unstaged.length || 0) +
    (gitStatus?.untracked.length || 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="panel-header justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span>Source Control</span>
          {totalChanges > 0 && (
            <span className="badge badge-purple">{totalChanges}</span>
          )}
        </div>
        <button onClick={refreshGitStatus} className="btn-ghost p-0.5" title="Refresh">
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Branch info */}
        {gitBranches && (
          <div className="px-3 py-2 border-b border-border-subtle">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <GitBranch size={12} className="text-accent-light" />
              <span className="font-medium text-white">{gitBranches.current}</span>
              {gitStatus && gitStatus.ahead > 0 && (
                <span className="text-success ml-auto">↑ {gitStatus.ahead}</span>
              )}
              {gitStatus && gitStatus.behind > 0 && (
                <span className="text-warning ml-auto">↓ {gitStatus.behind}</span>
              )}
            </div>
          </div>
        )}

        {/* Commit form */}
        {gitStatus && totalChanges > 0 && (
          <div className="p-3 border-b border-border-subtle space-y-2">
            <textarea
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message..."
              rows={2}
              className="input text-xs resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={stageAll}
                className="btn-ghost text-xs flex-1 justify-center"
              >
                <Plus size={11} />
                Stage All
              </button>
              <button
                onClick={handleCommit}
                disabled={!commitMsg.trim() || isCommitting}
                className="btn-primary text-xs flex-1 justify-center"
              >
                <Check size={11} />
                Commit
              </button>
            </div>
          </div>
        )}

        {/* Changes */}
        {gitStatus && (
          <div>
            {/* Staged */}
            {gitStatus.staged.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Staged ({gitStatus.staged.length})
                </div>
                {gitStatus.staged.map((file) => (
                  <div key={file} className="flex items-center gap-2 px-3 py-1 hover:bg-surface-2">
                    <Plus size={10} className="text-success flex-shrink-0" />
                    <span className="text-xs text-zinc-300 truncate font-mono">{file}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Unstaged */}
            {gitStatus.unstaged.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Modified ({gitStatus.unstaged.length})
                </div>
                {gitStatus.unstaged.map((file) => (
                  <div key={file} className="flex items-center gap-2 px-3 py-1 hover:bg-surface-2">
                    <Minus size={10} className="text-warning flex-shrink-0" />
                    <span className="text-xs text-zinc-300 truncate font-mono">{file}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Untracked */}
            {gitStatus.untracked.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Untracked ({gitStatus.untracked.length})
                </div>
                {gitStatus.untracked.map((file) => (
                  <div key={file} className="flex items-center gap-2 px-3 py-1 hover:bg-surface-2">
                    <Circle size={8} className="text-info flex-shrink-0" />
                    <span className="text-xs text-zinc-300 truncate font-mono">{file}</span>
                  </div>
                ))}
              </div>
            )}

            {totalChanges === 0 && (
              <div className="px-3 py-6 text-center text-xs text-zinc-600">
                No changes to commit
              </div>
            )}
          </div>
        )}

        {/* Commit log */}
        {gitLog && gitLog.length > 0 && (
          <div className="border-t border-border-subtle">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              Recent Commits
            </div>
            <div className="space-y-0">
              {gitLog.slice(0, 10).map((commit) => (
                <div key={commit.hash} className="px-3 py-2 hover:bg-surface-2 group">
                  <div className="flex items-start gap-2">
                    <GitCommit size={10} className="text-zinc-600 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-zinc-300 truncate">{commit.message}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-[10px] text-accent-light">{commit.hash}</code>
                        <span className="text-[10px] text-zinc-600 truncate">{commit.author}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
