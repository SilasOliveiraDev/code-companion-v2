import React from 'react';
import { MessageSquare, Lightbulb, Zap } from 'lucide-react';
import { AgentMode } from '../../types';

interface ModeSelectorProps {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

const MODES: {
  value: AgentMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    value: 'ASK',
    label: 'Ask',
    description: 'Answer questions only',
    icon: <MessageSquare size={14} />,
    color: 'text-info',
  },
  {
    value: 'PLAN',
    label: 'Plan',
    description: 'Propose plan, await approval',
    icon: <Lightbulb size={14} />,
    color: 'text-warning',
  },
  {
    value: 'AGENT',
    label: 'Agent',
    description: 'Execute autonomously',
    icon: <Zap size={14} />,
    color: 'text-success',
  },
];

export function ModeSelector({ mode, onChange, disabled }: ModeSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-surface-0 rounded-lg border border-border-subtle">
      {MODES.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          disabled={disabled}
          title={m.description}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all
            disabled:opacity-50 disabled:cursor-not-allowed
            ${mode === m.value
              ? `bg-surface-3 ${m.color}`
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-surface-2'
            }
          `}
        >
          {m.icon}
          {m.label}
        </button>
      ))}
    </div>
  );
}
