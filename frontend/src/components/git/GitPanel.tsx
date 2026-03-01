import React, { useState } from 'react';
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  Circle,
  RefreshCw,
  Check,
  Upload,
  Settings,
} from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

export function GitPanel() {
  const { 
    gitStatus, 
    gitLog, 
    gitBranches, 
    refreshGitStatus, 
    stageAll, 
    commitChanges,
    pushChanges,
    getGitConfig,
    setGitConfig
  } = useAgentStore();
  
  const [commitMsg, setCommitMsg] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  
  const [configName, setConfigName] = useState('');
  const [configEmail, setConfigEmail] = useState('');
  
  React.useEffect(() => {
    if (showConfig) {
      getGitConfig().then(cfg => {
        if (cfg) {
          setConfigName(cfg.name || '');
          setConfigEmail(cfg.email || '');
        }
      });
    }
  }, [showConfig, getGitConfig]);

  const handleCommit = async () => {
    if (!commitMsg.trim() || isCommitting) return;
    setIsCommitting(true);
    try {
      // Auto-stage all if nothing is staged but there are changes
      if (gitStatus && gitStatus.staged.length === 0 && (gitStatus.unstaged.length > 0 || gitStatus.untracked.length > 0)) {
        await stageAll();
      }
      await commitChanges(commitMsg.trim());
      setCommitMsg('');
    } catch (error) {
      console.error("Failed to commit:", error);
      alert("Failed to commit: You might need to configure your Git User/Email first via the gear icon.");
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePush = async () => {
    if (isPushing) return;
    setIsPushing(true);
    try {
      await pushChanges();
    } finally {
      setIsPushing(false);
    }
  };

  const handleSaveConfig = async () => {
    await setGitConfig(configName, configEmail);
    setShowConfig(false);
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
        <div className="flex items-center gap-1">
          <button onClick={() => setShowConfig(!showConfig)} className="btn-ghost p-0.5" title="Git Setup">
            <Settings size={11} className={showConfig ? "text-accent-light" : ""} />
          </button>
          <button onClick={refreshGitStatus} className="btn-ghost p-0.5" title="Refresh">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showConfig && (
          <div className="p-3 border-b border-border-subtle bg-surface-1">
            <h3 className="text-xs font-medium text-white mb-2">Git Configuration</h3>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">Name</label>
                <input 
                  type="text" 
                  value={configName} 
                  onChange={e => setConfigName(e.target.value)} 
                  className="input text-xs w-full py-1 h-7" 
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 mb-1 block">Email</label>
                <input 
                  type="email" 
                  value={configEmail} 
                  onChange={e => setConfigEmail(e.target.value)} 
                  className="input text-xs w-full py-1 h-7"
                  placeholder="e.g. john@example.com"
                />
              </div>
              <button 
                onClick={handleSaveConfig}
                className="btn-primary w-full text-xs justify-center mt-2 h-7"
              >
                Save
              </button>
            </div>
          </div>
        )}

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
        
        {/* Push action */}
        {gitStatus && gitStatus.ahead > 0 && (
          <div className="p-3 border-b border-border-subtle">
            <button
              onClick={handlePush}
              disabled={isCommitting}
              className="btn-primary w-full text-xs justify-center"
            >
              <Upload size={11} className="mr-1" />
              Push {gitStatus.ahead} commit{gitStatus.ahead > 1 ? 's' : ''}
            </button>
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
