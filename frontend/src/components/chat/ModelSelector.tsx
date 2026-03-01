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

export function ModelSelector() {
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

  // Group models by category
  const groupedModels = filteredModels.reduce((acc, model) => {
    const category = getModelCategory(model.id);
    if (!acc[category]) acc[category] = [];
    acc[category].push(model);
    return acc;
  }, {} as Record<string, LLMModel[]>);

  const selectedModelObj = availableModels.find((m) => m.id === selectedModel);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoadingModels}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-2 hover:bg-surface-3 
                   border border-border-subtle text-xs text-zinc-300 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
      >
        {isLoadingModels ? (
          <span className="text-zinc-500">Loading...</span>
        ) : (
          <>
            {getModelIcon(selectedModel)}
            <span className="truncate max-w-[100px]">
              {selectedModelObj ? formatModelName(selectedModelObj) : selectedModel.split('/').pop()}
            </span>
            <ChevronDown size={12} className="text-zinc-500 ml-auto flex-shrink-0" />
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-surface-2 border border-border-subtle 
                        rounded-lg shadow-xl z-50 overflow-hidden">
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
          <div className="max-h-80 overflow-y-auto">
            {Object.entries(groupedModels).length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-500">
                No models found
              </div>
            ) : (
              Object.entries(groupedModels).map(([category, models]) => (
                <div key={category}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider bg-surface-1">
                    {category}
                  </div>
                  {models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setSelectedModel(model.id);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs 
                                  hover:bg-surface-3 transition-colors
                                  ${model.id === selectedModel ? 'bg-accent/10 text-accent-light' : 'text-zinc-300'}`}
                    >
                      {getModelIcon(model.id)}
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">
                          {formatModelName(model)}
                        </div>
                        {model.context_length && (
                          <div className="text-[10px] text-zinc-500">
                            {(model.context_length / 1000).toFixed(0)}K context
                          </div>
                        )}
                      </div>
                      {model.id === selectedModel && (
                        <Check size={14} className="text-accent flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
