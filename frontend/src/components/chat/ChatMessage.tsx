import React from 'react';
import { Bot, User } from 'lucide-react';
import { ChatMessage as ChatMessageType, ExecutionPlan, StreamEventProgress, StreamEventCheckpoint } from '../../types';
import { PlanCard } from './PlanCard';
import { ToolExecutionCard, FileChange } from './ToolExecutionCard';
import { ProgressIndicator } from './ProgressIndicator';
import { CheckpointCard } from './CheckpointCard';

interface ChatMessageProps {
  message: ChatMessageType;
  plan?: ExecutionPlan | null;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
}

function formatContent(content: string): React.ReactNode {
  // Simple markdown-like formatting
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        inCodeBlock = false;
        elements.push(
          <div key={i} className="my-2 rounded-lg overflow-hidden border border-border-subtle">
            {codeLang && (
              <div className="px-3 py-1 bg-surface-4 text-xs text-zinc-400 font-mono border-b border-border-subtle">
                {codeLang}
              </div>
            )}
            <pre className="px-3 py-2 bg-surface-0 overflow-x-auto text-xs font-mono text-zinc-200 code-scroll">
              <code>{codeLines.join('\n')}</code>
            </pre>
          </div>
        );
        codeLines = [];
        codeLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-sm font-semibold text-white mt-2 mb-1">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(
        <p key={i} className="text-sm font-semibold text-white">
          {line.slice(2, -2)}
        </p>
      );
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(
        <li key={i} className="text-sm text-zinc-200 ml-3 list-disc">
          {formatInline(line.slice(2))}
        </li>
      );
    } else if (line.match(/^\d+\. /)) {
      elements.push(
        <li key={i} className="text-sm text-zinc-200 ml-3 list-decimal">
          {formatInline(line.replace(/^\d+\. /, ''))}
        </li>
      );
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} className="border-border-subtle my-2" />);
    } else if (line.trim() === '') {
      elements.push(<br key={i} />);
    } else {
      elements.push(
        <p key={i} className="text-sm text-zinc-200">
          {formatInline(line)}
        </p>
      );
    }
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function formatInline(text: string): React.ReactNode {
  // Handle inline code
  const parts = text.split(/(`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1 py-0.5 rounded bg-surface-0 text-xs font-mono text-accent-light border border-border-subtle">
          {part.slice(1, -1)}
        </code>
      );
    }
    // Handle bold
    const boldParts = part.split(/(\*\*[^*]+\*\*)/);
    return boldParts.map((bp, j) => {
      if (bp.startsWith('**') && bp.endsWith('**')) {
        return <strong key={`${i}-${j}`} className="font-semibold text-white">{bp.slice(2, -2)}</strong>;
      }
      return <React.Fragment key={`${i}-${j}`}>{bp}</React.Fragment>;
    });
  });
}

export function ChatMessageComponent({
  message,
  plan,
  onApprovePlan,
  onRejectPlan,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isProgress = message.metadata?.type === 'progress';

  if (isProgress) {
    return (
      <div className="flex gap-2 px-4 py-1 message-animate">
        <div className="w-5 h-5 flex-shrink-0" />
        <div className="text-xs text-zinc-500 font-mono">{message.content}</div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 px-4 py-3 message-animate ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isUser ? 'bg-accent/20 text-accent-light' : 'bg-surface-3 text-zinc-400'
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {isUser ? (
          <div className="bg-accent/20 border border-accent/30 rounded-xl rounded-tr-sm px-3 py-2 max-w-lg">
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {message.images.map((img, i) => (
                  <img key={i} src={img} alt="Pasted" className="max-w-[200px] max-h-[200px] rounded-md border border-border/50 object-contain bg-surface-2" />
                ))}
              </div>
            )}
            <p className="text-sm text-white">{message.content}</p>
          </div>
        ) : (
          <div className="w-full space-y-3">
            {Array.isArray(message.metadata?.progressEvents) && (message.metadata!.progressEvents as StreamEventProgress[]).length > 0 && (
              <ProgressIndicator events={message.metadata!.progressEvents as StreamEventProgress[]} />
            )}

            {message.metadata?.toolCalls && message.metadata.toolCalls.length > 0 && (
              <div className="space-y-2 mb-3">
                 {message.metadata.toolCalls.map((toolCall: any, idx: number) => {
                    let changes: FileChange[] | undefined = undefined;

                    if (toolCall.toolName === 'write_files' || toolCall.toolName === 'create_files' || toolCall.toolName === 'modify_files') {
                       if (toolCall.args?.files) {
                           changes = toolCall.args.files.map((file: any) => ({
                              path: file.path,
                              type: 'modify',
                           }));
                       }
                    }

                    return (
                      <ToolExecutionCard
                         key={idx}
                         toolName={toolCall.toolName}
                         args={toolCall.args}
                         status={
                             toolCall.state === 'start' ? 'executing' :
                             toolCall.state === 'success' ? 'success' : 'failed'
                         }
                         result={toolCall.result}
                         error={toolCall.error}
                         changes={changes}
                         className="max-w-xl"
                      />
                    );
                 })}
              </div>
            )}

            {message.content && (
              <div className="leading-relaxed">{formatContent(message.content.replace(/\[(?:Executing|Reading):[^\]]+\]/g, '').replace(/\[[^\]]+: (?:Success|Failed - [^\]]+)\]/g, '').trim())}</div>
            )}

            {plan && plan.status !== 'rejected' && onApprovePlan && onRejectPlan && (
              <PlanCard
                plan={plan}
                onApprove={onApprovePlan}
                onReject={onRejectPlan}
              />
            )}

            {message.metadata?.checkpoint && (
              <CheckpointCard checkpoint={message.metadata.checkpoint as StreamEventCheckpoint} />
            )}
          </div>
        )}

        <span className="text-[10px] text-zinc-600 mt-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
