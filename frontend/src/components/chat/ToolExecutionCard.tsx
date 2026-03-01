import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle2, 
  ChevronDown, 
  ChevronRight, 
  Loader2, 
  Wrench,
  FileEdit,
  FilePlus,
  FileMinus,
  XCircle
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ToolExecuteStatus = 'executing' | 'success' | 'failed' | 'rejected' | 'reverted';

export interface FileChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  additions?: number;
  deletions?: number;
}

export interface ToolExecutionProps {
  toolName: string;
  args?: Record<string, any>;
  status: ToolExecuteStatus;
  result?: any;
  error?: string;
  changes?: FileChange[];
  onKeep?: () => void;
  onUndo?: () => void;
  className?: string;
}

export function ToolExecutionCard({
  toolName,
  args,
  status,
  result,
  error,
  changes,
  onKeep,
  onUndo,
  className
}: ToolExecutionProps) {
  const [isOpen, setIsOpen] = useState(status === 'executing' || status === 'failed');

  const isExecuting = status === 'executing';
  const isSuccess = status === 'success' || status === 'rejected' || status === 'reverted'; // terminal states that we consider successful tool executions, rejected means user rolled back
  const isFailed = status === 'failed';

  const formatToolName = (name: string) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const hasChanges = changes && changes.length > 0;
  
  // Calculate total stats
  const addedLines = changes?.reduce((acc, c) => acc + (c.additions || 0), 0) || 0;
  const deletedLines = changes?.reduce((acc, c) => acc + (c.deletions || 0), 0) || 0;

  return (
    <div className={cn("group flex flex-col w-full my-4 bg-surface-3/50 backdrop-blur-sm border border-border-subtle rounded-xl overflow-hidden shadow-sm", className)}>
      {/* Header */}
      <div 
        className={cn(
          "flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-surface-4 transition-colors",
          isOpen ? "border-b border-border-subtle/50" : ""
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className={cn(
            "flex items-center justify-center w-7 h-7 rounded-lg shrink-0 border",
            isExecuting ? "bg-accent/10 text-accent border-accent/20" :
            isFailed ? "bg-red-500/10 text-red-500 border-red-500/20" :
            "bg-green-500/10 text-green-500 border-green-500/20"
          )}>
            {isExecuting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isFailed ? (
              <XCircle size={14} />
            ) : (
              <Wrench size={14} />
            )}
          </div>
          
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-white truncate flex items-center gap-2">
              {formatToolName(toolName)}
              {!isExecuting && hasChanges && (
                <div className="flex text-[10px] items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-surface-1 border border-border-subtle shrink-0">
                   <span className="text-zinc-300">{changes.length} files</span>
                   <div className="flex items-center gap-1 font-mono">
                     {addedLines > 0 && <span className="text-green-500">+{addedLines}</span>}
                     {deletedLines > 0 && <span className="text-red-500">-{deletedLines}</span>}
                   </div>
                </div>
              )}
            </span>
            <span className={cn(
              "text-xs truncate",
              isFailed ? "text-red-400" : "text-zinc-400"
            )}>
              {isExecuting ? 'Evaluating...' : 
               isFailed ? error || 'Execution failed' : 
               status === 'reverted' ? 'Changes undid' :
               status === 'rejected' ? 'Changes rejected' :
               'Analysis complete'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isExecuting && isSuccess && onKeep && onUndo && status === 'success' && (
             <div className="flex items-center mr-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
               <button 
                  onClick={onKeep}
                  className="px-3 py-1 text-xs font-medium text-white bg-accent hover:bg-opacity-80 rounded-l-md border border-accent transition-colors"
                >
                  Keep
               </button>
               <button 
                  onClick={onUndo}
                  className="px-3 py-1 text-xs font-medium text-zinc-300 bg-surface-2 hover:bg-surface-4 rounded-r-md border border-l-0 border-border-subtle transition-colors"
                >
                  Undo
               </button>
             </div>
          )}
          
          <button className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-surface-4">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {/* Body */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-3 bg-surface-1/50 border-t border-border-subtle/50">
              {/* Arguments */}
              {args && Object.keys(args).length > 0 && (
                 <div className="space-y-1.5">
                   <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Arguments</span>
                   <pre className="text-xs font-mono text-zinc-300 bg-surface-0 p-2 rounded-md border border-border-subtle overflow-x-auto whitespace-pre-wrap">
                     {JSON.stringify(args, null, 2)}
                   </pre>
                 </div>
              )}

              {/* Changes */}
              {hasChanges && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Changes</span>
                  <div className="space-y-1 bg-surface-0 rounded-md border border-border-subtle overflow-hidden">
                    {changes.map((change, idx) => (
                      <div key={idx} className={cn("flex items-center justify-between text-xs p-2", idx !== 0 && "border-t border-border-subtle")}>
                        <div className="flex items-center gap-2 truncate text-zinc-300">
                          {change.type === 'create' ? <FilePlus size={12} className="text-green-500 shrink-0" /> :
                           change.type === 'delete' ? <FileMinus size={12} className="text-red-500 shrink-0" /> :
                           <FileEdit size={12} className="text-blue-500 shrink-0" />}
                          <span className="truncate font-mono">{change.path}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0 ml-2">
                           {change.additions && change.additions > 0 ? <span className="text-green-500 py-0.5 px-1 bg-green-500/10 rounded">+{change.additions}</span> : null}
                           {change.deletions && change.deletions > 0 ? <span className="text-red-500 py-0.5 px-1 bg-red-500/10 rounded">-{change.deletions}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Result Preview (optional, if no changes and small result) */}
              {!hasChanges && result && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Result</span>
                  <div className="text-xs font-mono text-zinc-300 bg-surface-0 p-2 rounded-md border border-border-subtle overflow-x-auto max-h-[150px]">
                    {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                  </div>
                </div>
              )}

              {/* Error */}
              {isFailed && error && (
                <div className="space-y-1.5 mt-2">
                  <span className="text-xs font-medium text-red-500 uppercase tracking-wider">Error Output</span>
                  <div className="text-xs text-red-400 bg-red-500/10 p-2 rounded-md border border-red-500/20 whitespace-pre-wrap font-mono">
                    {error}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
