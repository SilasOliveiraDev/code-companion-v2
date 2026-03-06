import { Loader2, Search, Brain, Cog, CheckCircle2, Shield, Wrench } from 'lucide-react';
import type { StreamEventProgress } from '../../types';

const stageConfig: Record<string, { icon: typeof Loader2; color: string; label: string }> = {
  analyzing: { icon: Search, color: 'text-blue-400', label: 'Analyzing' },
  context: { icon: Brain, color: 'text-purple-400', label: 'Loading context' },
  thinking: { icon: Brain, color: 'text-accent-light', label: 'Thinking' },
  executing: { icon: Cog, color: 'text-yellow-400', label: 'Executing' },
  validating: { icon: Shield, color: 'text-cyan-400', label: 'Validating' },
  healing: { icon: Wrench, color: 'text-orange-400', label: 'Repairing' },
  complete: { icon: CheckCircle2, color: 'text-green-400', label: 'Complete' },
};

interface ProgressIndicatorProps {
  events: StreamEventProgress[];
}

export function ProgressIndicator({ events }: ProgressIndicatorProps) {
  if (!events || events.length === 0) return null;

  const latest = events[events.length - 1];
  const isComplete = latest.stage === 'complete';
  const config = stageConfig[latest.stage] || stageConfig.executing;
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2/60 border border-border-subtle/50 mb-2">
      {isComplete ? (
        <Icon size={14} className={config.color} />
      ) : (
        <Loader2 size={14} className={`${config.color} animate-spin`} />
      )}

      <span className={`text-xs font-medium ${isComplete ? 'text-green-400' : 'text-zinc-300'}`}>
        {latest.message}
      </span>

      {latest.stepCurrent != null && latest.stepTotal != null && latest.stepTotal > 1 && (
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-0.5">
            {Array.from({ length: Math.min(latest.stepTotal, 12) }, (_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i < (latest.stepCurrent ?? 0) ? 'bg-accent' :
                  i === (latest.stepCurrent ?? 0) ? 'bg-accent-light animate-pulse' :
                  'bg-surface-4'
                }`}
              />
            ))}
          </div>
          <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
            {latest.stepCurrent}/{latest.stepTotal}
          </span>
        </div>
      )}
    </div>
  );
}
