import { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface Repository {
  id: string;
  name: string;
  path: string;
  lastAccessedAt: string;
}

interface RepoSelectorProps {
  onRepoSelect?: (repoId: string, repoPath: string) => void;
  currentRepoId?: string;
}

type ModalMode = 'none' | 'create' | 'clone';
type Template = 'empty' | 'react' | 'node' | 'nextjs';

export function RepoSelector({ onRepoSelect, currentRepoId }: RepoSelectorProps) {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>(currentRepoId || '');
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>('none');
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoTemplate, setNewRepoTemplate] = useState<Template>('empty');
  const [cloneUrl, setCloneUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    loadRepos();
  }, []);

  useEffect(() => {
    if (!currentRepoId) return;
    setSelectedRepoId(currentRepoId);
  }, [currentRepoId]);

  const loadRepos = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.getRepos();
      setRepos(response.repos);

      // Safe auto-select: restore last selection, or auto-select only if there's exactly 1 repo.
      if (!selectedRepoId && response.repos.length > 0) {
        const storedRepoId = localStorage.getItem('ccv2.selectedRepoId');
        const stored = storedRepoId ? response.repos.find((r: Repository) => r.id === storedRepoId) : null;

        if (stored) {
          setSelectedRepoId(stored.id);
          onRepoSelect?.(stored.id, stored.path);
        } else if (response.repos.length === 1) {
          setSelectedRepoId(response.repos[0].id);
          onRepoSelect?.(response.repos[0].id, response.repos[0].path);
        }
      }
    } catch (err) {
      console.error('Error loading repos:', err);
      setError('Failed to load repositories');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepoId(repo.id);
    setIsExpanded(false);
    try {
      localStorage.setItem('ccv2.selectedRepoId', repo.id);
    } catch {
      // ignore
    }
    onRepoSelect?.(repo.id, repo.path);
  };

  const openCreateModal = () => {
    setModalMode('create');
    setNewRepoName('');
    setNewRepoTemplate('empty');
    setModalError(null);
    setIsExpanded(false);
  };

  const openCloneModal = () => {
    setModalMode('clone');
    setCloneUrl('');
    setNewRepoName('');
    setModalError(null);
    setIsExpanded(false);
  };

  const closeModal = () => {
    setModalMode('none');
    setModalError(null);
  };

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) {
      setModalError('Repository name is required');
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(newRepoName)) {
      setModalError('Name can only contain letters, numbers, hyphens, and underscores');
      return;
    }

    try {
      setIsSubmitting(true);
      setModalError(null);
      const response = await api.createRepo(newRepoName, newRepoTemplate, true);
      
      // Add to repos list and select it
      const newRepo: Repository = {
        id: response.repo.id,
        name: response.repo.name,
        path: response.repo.path,
        lastAccessedAt: new Date().toISOString(),
      };
      setRepos(prev => [newRepo, ...prev]);
      handleRepoSelect(newRepo);
      closeModal();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to create repository');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloneRepo = async () => {
    if (!cloneUrl.trim()) {
      setModalError('Repository URL is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setModalError(null);
      const response = await api.cloneRepo(cloneUrl, newRepoName || undefined);
      
      // Add to repos list and select it
      const newRepo: Repository = {
        id: response.repo.id,
        name: response.repo.name,
        path: response.repo.path,
        lastAccessedAt: new Date().toISOString(),
      };
      setRepos(prev => [newRepo, ...prev]);
      handleRepoSelect(newRepo);
      closeModal();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to clone repository');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedRepo = repos.find(r => r.id === selectedRepoId);

  if (isLoading) {
    return (
      <div className="px-3 py-2 text-xs text-gray-400">
        Loading repositories...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2">
        <span className="text-xs text-red-400">{error}</span>
        <button 
          onClick={loadRepos}
          className="ml-2 text-xs text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="relative border-b border-gray-700">
        {/* Selected Repo Display */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <svg 
              className="w-4 h-4 text-gray-400 flex-shrink-0" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" 
              />
            </svg>
            <span className="text-sm font-medium text-white truncate">
              {selectedRepo?.name || 'Select Repository'}
            </span>
          </div>
          <svg 
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M19 9l-7 7-7-7" 
            />
          </svg>
        </button>

        {/* Dropdown */}
        {isExpanded && (
          <div className="absolute z-50 top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded-b shadow-lg max-h-80 overflow-y-auto">
            {/* Action buttons */}
            <div className="flex gap-1 p-2 border-b border-gray-700">
              <button
                onClick={openCreateModal}
                className="flex-1 px-2 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium text-white flex items-center justify-center gap-1 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New
              </button>
              <button
                onClick={openCloneModal}
                className="flex-1 px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium text-white flex items-center justify-center gap-1 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Clone
              </button>
            </div>

            {/* Repos list */}
            {repos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => handleRepoSelect(repo)}
                className={`w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-700 transition-colors text-left ${
                  repo.id === selectedRepoId ? 'bg-gray-700' : ''
                }`}
              >
                <svg 
                  className="w-4 h-4 text-gray-400 flex-shrink-0" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" 
                  />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{repo.name}</div>
                  <div className="text-xs text-gray-500 truncate">{repo.path}</div>
                </div>
                {repo.id === selectedRepoId && (
                  <svg 
                    className="w-4 h-4 text-green-400 flex-shrink-0" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M5 13l4 4L19 7" 
                    />
                  </svg>
                )}
              </button>
            ))}
            
            {/* Refresh button */}
            <button
              onClick={() => { loadRepos(); }}
              className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-700 transition-colors text-gray-400 border-t border-gray-700"
            >
              <svg 
                className="w-4 h-4" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
                />
              </svg>
              <span className="text-sm">Refresh repositories</span>
            </button>
          </div>
        )}
      </div>

      {/* Modal Overlay */}
      {modalMode !== 'none' && (
        <div 
          className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div 
            className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-700"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white">
                {modalMode === 'create' ? 'Create New Repository' : 'Clone Repository'}
              </h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              {modalError && (
                <div className="p-3 bg-red-500/10 border border-red-500/50 rounded text-red-400 text-sm">
                  {modalError}
                </div>
              )}

              {modalMode === 'create' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Repository Name
                    </label>
                    <input
                      type="text"
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="my-new-project"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                      autoFocus
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Only letters, numbers, hyphens, and underscores allowed
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Template
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'empty', label: 'Empty', desc: 'Just README' },
                        { id: 'react', label: 'React', desc: 'Vite + React' },
                        { id: 'node', label: 'Node.js', desc: 'Basic Node' },
                        { id: 'nextjs', label: 'Next.js', desc: 'Next.js 14' },
                      ].map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setNewRepoTemplate(t.id as Template)}
                          className={`p-3 rounded border text-left transition-colors ${
                            newRepoTemplate === t.id
                              ? 'border-purple-500 bg-purple-500/10'
                              : 'border-gray-600 hover:border-gray-500'
                          }`}
                        >
                          <div className="text-sm font-medium text-white">{t.label}</div>
                          <div className="text-xs text-gray-500">{t.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Repository URL
                    </label>
                    <input
                      type="text"
                      value={cloneUrl}
                      onChange={(e) => setCloneUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Custom Name (optional)
                    </label>
                    <input
                      type="text"
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="Leave empty to use repo name"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={modalMode === 'create' ? handleCreateRepo : handleCloneRepo}
                disabled={isSubmitting}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 rounded text-sm font-medium text-white transition-colors flex items-center gap-2"
              >
                {isSubmitting && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {modalMode === 'create' ? 'Create Repository' : 'Clone Repository'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
