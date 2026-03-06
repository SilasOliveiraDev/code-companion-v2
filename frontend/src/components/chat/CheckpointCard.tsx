import React from 'react';
import { StreamEventCheckpoint } from '../../types';
import { useAgentStore } from '../../store/agentStore';

interface CheckpointCardProps {
  checkpoint: StreamEventCheckpoint;
}

export const CheckpointCard: React.FC<CheckpointCardProps> = ({ checkpoint }) => {
  const sendMessage = useAgentStore((s) => s.sendMessage);

  return (
    <div className="border border-yellow-500/30 bg-yellow-500/10 rounded-lg p-4 my-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400 text-lg">⏸</span>
        <span className="text-yellow-300 font-medium">Checkpoint</span>
      </div>
      <p className="text-sm text-gray-300 mb-2">{checkpoint.message}</p>
      {checkpoint.completedTools.length > 0 && (
        <div className="text-xs text-gray-400 mb-2">
          Tools used: {checkpoint.completedTools.join(', ')}
        </div>
      )}
      <div className="text-xs text-gray-500 mb-3">
        Iterations: {checkpoint.iterationsUsed}
      </div>
      {checkpoint.canContinue && (
        <button
          onClick={() => sendMessage('Continue the task from where you stopped.')}
          className="btn-primary text-sm"
        >
          ▶ Continue from where it stopped
        </button>
      )}
    </div>
  );
};
