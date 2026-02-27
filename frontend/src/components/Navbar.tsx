import { useState } from 'react'
import { Search, Plus, Plug, User, Film } from 'lucide-react'
import { useStore } from '../store'
import { setLocalNickname } from '../socket'

interface NavbarProps {
  onCreateRoom?: () => void
  onConnectSource?: () => void
  searchQuery?: string
  onSearchChange?: (q: string) => void
}

export default function Navbar({ onCreateRoom, onConnectSource, searchQuery = '', onSearchChange }: NavbarProps) {
  const { nickname, setNickname } = useStore()
  const [profileOpen, setProfileOpen] = useState(false)
  const [editNickname, setEditNickname] = useState(nickname)

  const saveNickname = () => {
    const trimmed = editNickname.trim()
    if (trimmed) {
      setNickname(trimmed)
      setLocalNickname(trimmed)
    }
    setProfileOpen(false)
  }

  return (
    <nav className="glass-strong sticky top-0 z-50 px-6 py-3 flex items-center gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg accent-gradient flex items-center justify-center">
          <Film size={16} className="text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight accent-gradient-text">Noctiviem</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-sm relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search library…"
          value={searchQuery}
          onChange={e => onSearchChange?.(e.target.value)}
          className="input-field pl-9 py-2 text-sm w-full"
        />
      </div>

      <div className="flex-1" />

      {/* Actions */}
      <button
        onClick={onConnectSource}
        className="btn-ghost text-sm flex items-center gap-2"
      >
        <Plug size={14} />
        <span className="hidden sm:inline">Connect Source</span>
      </button>

      <button
        onClick={onCreateRoom}
        className="btn-primary flex items-center gap-2 py-2 px-4 text-sm"
      >
        <Plus size={14} />
        <span>Create Hall</span>
      </button>

      {/* Profile */}
      <div className="relative">
        <button
          onClick={() => setProfileOpen(!profileOpen)}
          className="w-8 h-8 rounded-full accent-gradient flex items-center justify-center text-white text-xs font-bold hover:opacity-80 transition-opacity"
        >
          {nickname.slice(0, 2).toUpperCase()}
        </button>

        {profileOpen && (
          <div className="menu-dropdown absolute right-0 top-12 w-64 p-4 animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full accent-gradient flex items-center justify-center text-white text-sm font-bold">
                {nickname.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-medium text-cinema-text">{nickname}</div>
                <div className="text-xs text-cinema-muted">Your display name</div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-500 uppercase tracking-wide">Nickname</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editNickname}
                  onChange={e => setEditNickname(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveNickname()}
                  className="input-field text-sm flex-1 py-2"
                  maxLength={24}
                />
                <button onClick={saveNickname} className="btn-primary text-sm py-2 px-3">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {profileOpen && (
        <div className="fixed inset-0 z-[-1]" onClick={() => setProfileOpen(false)} />
      )}
    </nav>
  )
}
