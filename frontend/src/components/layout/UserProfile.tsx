import { useState } from 'react';
import { User, Settings, LogOut, ChevronDown } from 'lucide-react';

interface UserProfileProps {
  userName?: string;
  userEmail?: string;
}

export function UserProfile({ userName = 'Demo User', userEmail = 'demo@demo.com' }: UserProfileProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Get first letter of the name for avatar
  const avatarLetter = userName.charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center">
          <span className="text-white text-sm font-semibold">{avatarLetter}</span>
        </div>
        
        {/* User info */}
        <div className="flex flex-col items-start min-w-0">
          <span className="text-sm font-medium text-white truncate">{userName}</span>
          <span className="text-xs text-zinc-400 truncate">{userEmail}</span>
        </div>
        
        <ChevronDown 
          size={14} 
          className={`text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Menu */}
          <div className="absolute right-0 top-full mt-1 w-48 bg-surface-2 border border-border-subtle rounded-lg shadow-lg z-20">
            <div className="p-3 border-b border-border-subtle">
              <div className="text-sm font-medium text-white">{userName}</div>
              <div className="text-xs text-zinc-400">{userEmail}</div>
            </div>
            
            <div className="py-1">
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-surface-3 hover:text-white transition-colors">
                <User size={14} />
                Edit Profile
              </button>
              
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-surface-3 hover:text-white transition-colors">
                <Settings size={14} />
                Settings
              </button>
              
              <hr className="my-1 border-border-subtle" />
              
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors">
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}