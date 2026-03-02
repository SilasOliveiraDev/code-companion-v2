import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Sparkles, Zap, Brain } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { LLMModel } from '../../types';

const MODEL_ICONS: Record<string, React.ReactNode> = {
  'claude': <Brain size={14} className="text-purple-400" />,
  'gpt': <Sparkles size={14} className="text-green-400" />,
  'gemini': <Zap size={14} className="text-blue-400" />,
  'llama': <Sparkles size={14} className="text-orange-400" />,
  'mistral': <Sparkles size={14} className="text-cyan-400" />,
  'deepseek': <Brain size={14} className="text-emerald-400" />,
};

function getModelIcon(modelId: string): React.ReactNode {
  for (const [key, icon] of Object.entries(MODEL_ICONS)) {
    if (modelId.toLowerCase().includes(key)) return icon;
  }
  return <Sparkles size={14} className="text-zinc-400" />;
}

function formatModelName(model: LLMModel): string {
  // Extract friendly name from model id
  const name = model.name || model.id;
  return name
    .replace(/^(anthropic|openai|google|meta|mistralai|deepseek)\//, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getModelCategory(modelId: string): string {
  if (modelId.includes('claude')) return 'Anthropic';
  if (modelId.includes('gpt')) return 'OpenAI';
  if (modelId.includes('gemini')) return 'Google';
  if (modelId.includes('llama')) return 'Meta';
  if (modelId.includes('mistral')) return 'Mistral';
  if (modelId.includes('deepseek')) return 'DeepSeek';
  return 'Other';
}

function formatContextLabel(model: LLMModel): string {
  if (!model.context_length) return '';
  const k = Math.round(model.context_length / 1000);
  return `${k}K`;
}

interface ModelSelectorProps {
  compact?: boolean;
  dropUp?: boolean;
}

export function ModelSelector({ compact, dropUp }: ModelSelectorProps) {
  const { selectedModel, availableModels, setSelectedModel, isLoadingModels } = useAgentStore();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const filteredModels = availableModels.filter((model) => {
    const searchLower = search.toLowerCase();
    return (
      model.id.toLowerCase().includes(searchLower) ||
      (model.name && model.name.toLowerCase().includes(searchLower))
    );
  });

  const sortedModels = [...filteredModels].sort((a, b) => {
    const aCat = getModelCategory(a.id);
    const bCat = getModelCategory(b.id);
    if (aCat !== bCat) return aCat.localeCompare(bCat);
    return (a.name || a.id).localeCompare(b.name || b.id);
  });

  const selectedModelObj = availableModels.find((m) => m.id === selectedModel);
  const selectedLabel = selectedModelObj ? formatModelName(selectedModelObj) : (selectedModel.split('/').pop() || selectedModel);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoadingModels}
        title={selectedLabel}
        aria-label={`Model: ${selectedLabel}`}
        className={
          compact
            ? 'flex items-center justify-center w-9 h-8 rounded-md bg-surface-2 hover:bg-surface-3 border border-border-subtle text-xs text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            : 'flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border-subtle text-xs text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]'
        }
      >
        {isLoadingModels ? (
          <span className="text-zinc-500">{compact ? '…' : 'Loading...'}</span>
        ) : (
          <>
            {getModelIcon(selectedModel)}
            {!compact && (
              <>
                <span className="truncate max-w-[100px]">
                  {selectedLabel}
                </span>
                <ChevronDown size={12} className="text-zinc-500 ml-auto flex-shrink-0" />
              </>
            )}
          </>
        )}
      </button>

      {isOpen && (
        <div
          className={
            (dropUp
              ? 'absolute right-0 bottom-full mb-1'
              : 'absolute right-0 top-full mt-1') +
            ' w-72 bg-surface-2 border border-border-subtle rounded-md shadow-xl z-50 overflow-hidden'
          }
        >
          {/* Search */}
          <div className="p-2 border-b border-border-subtle">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full px-2 py-1.5 bg-surface-1 border border-border-subtle rounded 
                         text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Models list */}
          <div className="max-h-80 overflow-y-auto divide-y divide-border-subtle">
            {sortedModels.length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-500">No models found</div>
            ) : (
              sortedModels.map((model) => {
                const isSelected = model.id === selectedModel;
                const rightLabel = formatContextLabel(model);
                return (
                  <button
                    key={model.id}
                    onClick={() => {
                      setSelectedModel(model.id);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={
                      'w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs ' +
                      'hover:bg-surface-3 transition-colors ' +
                      (isSelected ? 'bg-surface-3 text-white' : 'text-zinc-300')
                    }
                    title={model.id}
                    aria-label={`Select model ${formatModelName(model)}`}
                  >
                    <span className="w-4 flex items-center justify-center flex-shrink-0">
                      {isSelected ? <Check size={14} className="text-accent" /> : null}
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {formatModelName(model)}
                    </span>
                    <span className="text-[11px] text-zinc-500 tabular-nums flex-shrink-0">
                      {rightLabel}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
