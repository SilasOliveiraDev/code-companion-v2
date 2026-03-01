import React from 'react';
import {
  CheckCircle,
  XCircle,
  FileCode,
  Cpu,
  ListChecks,
  Target,
  ShieldCheck,
  Clock,
  Loader2,
} from 'lucide-react';
import { ExecutionPlan } from '../../types';

interface PlanCardProps {
  plan: ExecutionPlan;
  onApprove: () => void;
  onReject: () => void;
}

const ACTION_COLORS: Record<string, string> = {
  create: 'text-success bg-success/10',
  modify: 'text-info bg-info/10',
  delete: 'text-error bg-error/10',
  run: 'text-warning bg-warning/10',
  install: 'text-accent-light bg-accent/10',
  migrate: 'text-purple-400 bg-purple-400/10',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock size={14} className="text-zinc-500" />,
  in_progress: <Loader2 size={14} className="text-info animate-spin" />,
  completed: <CheckCircle size={14} className="text-success" />,
  failed: <XCircle size={14} className="text-error" />,
};

export function PlanCard({ plan, onApprove, onReject }: PlanCardProps) {
  const isExecuting = plan.status === 'executing';
  const isCompleted = plan.status === 'completed' || plan.status === 'failed';
  const canAct = plan.status === 'pending';

  return (
    <div className="rounded-xl border border-border bg-surface-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="text-accent-light" />
          <span className="text-sm font-semibold text-white">Execution Plan</span>
        </div>
        <span
          className={`badge text-xs ${
            plan.status === 'pending'
              ? 'badge-yellow'
              : plan.status === 'executing'
                ? 'badge-blue'
                : plan.status === 'completed'
                  ? 'badge-green'
                  : 'badge-red'
          }`}
        >
          {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Goal */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Target size={13} className="text-accent-light" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Goal</span>
          </div>
          <p className="text-sm text-zinc-200">{plan.goal}</p>
        </div>

        {/* Architecture decisions */}
        {plan.architectureDecisions.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Cpu size={13} className="text-accent-light" />
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Architecture
              </span>
            </div>
            <ul className="space-y-1">
              {plan.architectureDecisions.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-accent-light flex-shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Impacted files */}
        {plan.impactedFiles.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileCode size={13} className="text-accent-light" />
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Impacted Files
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {plan.impactedFiles.map((f, i) => (
                <code
                  key={i}
                  className="px-2 py-0.5 rounded bg-surface-0 text-xs text-zinc-300 font-mono border border-border-subtle"
                >
                  {f}
                </code>
              ))}
            </div>
          </div>
        )}

        {/* Steps */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ListChecks size={13} className="text-accent-light" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Steps ({plan.steps.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {plan.steps.map((step) => (
              <div
                key={step.id}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg bg-surface-0 border border-border-subtle
                  ${step.status === 'completed' ? 'step-completed' : ''}
                `}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {STATUS_ICONS[step.status]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{step.order}.</span>
                    <span
                      className={`badge text-xs px-1.5 py-0.5 rounded ${ACTION_COLORS[step.action] || 'text-zinc-400 bg-zinc-400/10'}`}
                    >
                      {step.action}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-200 mt-0.5">{step.description}</p>
                  {step.files.length > 0 && (
                    <p className="text-xs text-zinc-500 mt-0.5 font-mono truncate">
                      {step.files.join(', ')}
                    </p>
                  )}
                  {step.error && (
                    <p className="text-xs text-error mt-0.5">{step.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Validation */}
        <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-surface-0 border border-border-subtle">
          <ShieldCheck size={13} className="text-success mt-0.5 flex-shrink-0" />
          <div>
            <span className="text-xs font-medium text-zinc-400 block mb-0.5">Validation</span>
            <p className="text-xs text-zinc-300">{plan.validationMethod}</p>
          </div>
        </div>

        {/* Actions */}
        {canAct && (
          <div className="flex gap-2 pt-1">
            <button onClick={onApprove} className="btn-success flex-1 justify-center">
              <CheckCircle size={14} />
              Approve & Execute
            </button>
            <button onClick={onReject} className="btn-danger flex-1 justify-center">
              <XCircle size={14} />
              Reject
            </button>
          </div>
        )}

        {isExecuting && (
          <div className="flex items-center gap-2 text-sm text-info">
            <Loader2 size={14} className="animate-spin" />
            Executing plan...
          </div>
        )}
      </div>
    </div>
  );
}
