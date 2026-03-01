import React, { useState } from 'react';
import { RefreshCw, ExternalLink, Monitor, X } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';

export function PreviewPanel() {
  const { previewUrl, setPreviewUrl } = useAgentStore();
  const [customUrl, setCustomUrl] = useState('http://localhost:3000');
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const displayUrl = previewUrl || activeUrl;

  const handleLoad = (url: string) => {
    setActiveUrl(url);
  };

  const handleRefresh = () => {
    setKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col h-full bg-surface-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface-1 flex-shrink-0">
        <Monitor size={12} className="text-zinc-500" />
        <input
          type="text"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLoad(customUrl)}
          className="flex-1 bg-surface-0 border border-border-subtle rounded px-2 py-0.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-accent/50"
          placeholder="http://localhost:3000"
        />
        <button onClick={handleRefresh} className="btn-ghost p-1" title="Refresh">
          <RefreshCw size={12} />
        </button>
        {displayUrl && (
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost p-1"
            title="Open in new tab"
          >
            <ExternalLink size={12} />
          </a>
        )}
        {previewUrl && (
          <button onClick={() => setPreviewUrl(null)} className="btn-ghost p-1" title="Close preview">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Preview */}
      <div className="flex-1 relative">
        {displayUrl ? (
          <iframe
            key={key}
            src={displayUrl}
            className="w-full h-full border-none bg-white"
            title="Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <div className="text-5xl opacity-20">🖥️</div>
            <div>
              <p className="text-zinc-500 text-sm font-medium">No Preview Active</p>
              <p className="text-zinc-600 text-xs mt-1">
                Enter a URL above or deploy a preview from the chat
              </p>
            </div>
            <div className="flex gap-2">
              {['http://localhost:3000', 'http://localhost:5173'].map((url) => (
                <button
                  key={url}
                  onClick={() => {
                    setCustomUrl(url);
                    handleLoad(url);
                  }}
                  className="px-2 py-1 text-xs rounded border border-border-subtle text-zinc-400 hover:text-white hover:border-accent/50 transition-colors font-mono"
                >
                  {url.replace('http://', '')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
