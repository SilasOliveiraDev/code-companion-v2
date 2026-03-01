import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, Square, RotateCcw, ChevronDown, Image as ImageIcon, X } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { ChatMessageComponent } from './ChatMessage';
import { ModeSelector } from './ModeSelector';
import { ModelSelector } from './ModelSelector';

export function ChatPanel() {
  const {
    messages,
    isStreaming,
    currentPlan,
    mode,
    sendMessage,
    setMode,
    approvePlan,
    rejectPlan,
  } = useAgentStore();

  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isStreaming || messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, isStreaming, scrollToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollButton(!atBottom);
  };

  const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) {
            try {
              const base64 = await toBase64(file);
              setImages(prev => [...prev, base64]);
            } catch (error) {
              console.error('Failed to parse image', error);
            }
          }
        }
      }
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0) || isStreaming) return;
    setInput('');
    const currentImages = [...images];
    setImages([]);
    inputRef.current?.focus();
    await sendMessage(trimmed, currentImages.length > 0 ? currentImages : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const lastAssistantPlanMessageIndex = [...messages]
    .reverse()
    .findIndex(
      (m) => m.role === 'assistant' && m.metadata?.planId === currentPlan?.id
    );

  const hasPlanMessage = lastAssistantPlanMessageIndex !== -1;

  return (
    <div className="flex flex-col h-full bg-surface-1">
      {/* Header */}
      <div className="panel-header justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span>AI Engineer</span>
          {isStreaming && (
            <div className="dot-pulse flex items-center gap-0.5">
              <span className="w-1 h-1 rounded-full bg-accent-light inline-block" />
              <span className="w-1 h-1 rounded-full bg-accent-light inline-block" />
              <span className="w-1 h-1 rounded-full bg-accent-light inline-block" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector />
          <ModeSelector mode={mode} onChange={setMode} disabled={isStreaming} />
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-2"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center">
              <span className="text-2xl">🤖</span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white mb-1">
                AI Software Engineer
              </h3>
              <p className="text-sm text-zinc-400 max-w-xs">
                Describe a feature, ask a question, or request a change. I'll analyze
                your codebase and help you build it.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
              {[
                'Add user authentication with Supabase',
                'Create a REST API endpoint for products',
                'Explain the current project architecture',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="text-left px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle hover:border-accent/50 hover:bg-surface-3 text-xs text-zinc-300 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isPlanMessage =
            msg.role === 'assistant' &&
            currentPlan &&
            msg.metadata?.planId === currentPlan.id &&
            hasPlanMessage &&
            idx === messages.length - 1 - (messages.length - 1 - messages.findIndex((m) => m.id === msg.id));

          return (
            <ChatMessageComponent
              key={msg.id}
              message={msg}
              plan={
                msg.role === 'assistant' && msg.metadata?.planId === currentPlan?.id
                  ? currentPlan
                  : undefined
              }
              onApprovePlan={approvePlan}
              onRejectPlan={rejectPlan}
            />
          );
        })}

        {/* Streaming indicator */}
        {isStreaming &&
          messages.length > 0 &&
          messages[messages.length - 1]?.content === '' && (
            <div className="flex gap-3 px-4 py-3">
              <div className="w-7 h-7 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0">
                <span className="text-sm">🤖</span>
              </div>
              <div className="dot-pulse flex items-center gap-1 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
              </div>
            </div>
          )}

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 right-4 w-8 h-8 rounded-full bg-surface-3 border border-border flex items-center justify-center hover:bg-surface-4 transition-colors shadow-lg"
        >
          <ChevronDown size={14} className="text-zinc-400" />
        </button>
      )}

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-border-subtle p-3">
        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img} alt="Pasted" className="h-16 w-auto rounded-md border border-border object-contain bg-surface-2" />
                <button
                  onClick={() => handleRemoveImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-surface-3 border border-border rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-4"
                >
                  <X size={10} className="text-zinc-300" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end bg-surface-2 rounded-xl border border-border focus-within:border-accent/50 transition-colors p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              mode === 'ASK'
                ? 'Ask a question about your codebase...'
                : mode === 'PLAN'
                  ? 'Describe what you want to build...'
                  : 'Give the agent a task to execute...'
            }
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 resize-none focus:outline-none leading-relaxed min-h-[24px] max-h-[160px]"
          />
          <div className="flex items-center gap-1 flex-shrink-0 pb-0.5">
            {isStreaming ? (
              <button className="btn-ghost p-1.5" title="Stop generation">
                <Square size={14} className="text-error" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && images.length === 0}
                className="btn-primary py-1.5 px-2.5 disabled:opacity-30"
                title="Send (Enter)"
              >
                <Send size={13} />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-zinc-600">
            Shift+Enter for new line · Enter to send
          </span>
          <button className="btn-ghost py-0.5 px-1.5 text-[10px] gap-1">
            <RotateCcw size={10} />
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
