import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Plus, Download, Upload, Settings, LogOut, Film } from 'lucide-react'
import { useStore } from '../store'
import ImportModal from './ImportModal'
import DownloadsPanel from './DownloadsPanel'

interface NavbarProps {
  onCreateRoom?: () => void
  searchQuery?: string
  onSearchChange?: (q: string) => void
}

export default function Navbar({ onCreateRoom, searchQuery = '', onSearchChange }: NavbarProps) {
  const navigate = useNavigate()
  const { account, nickname, logout, downloads, downloadsOpen, toggleDownloads } = useStore()
  const [profileOpen, setProfileOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const activeDownloads = downloads.filter(
    d => d.status === 'downloading' || d.status === 'metadata' || d.status === 'queued'
  ).length

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <nav className="glass-strong sticky top-0 z-50 px-6 py-3 flex items-center gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg accent-gradient flex items-center justify-center">
            <Film size={16} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight accent-gradient-text">Noctiviem</span>
        </Link>

        {/* Search */}
        <div className="flex-1 max-w-sm relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search library…"
            value={searchQuery}
            onChange={e => onSearchChange?.(e.target.value)}
            className="input-field pl-9 py-2 text-sm w-full"
          />
        </div>

        <div className="flex-1" />

        {/* Import */}
        <button
          onClick={() => setImportOpen(true)}
          className="btn-ghost text-sm flex items-center gap-2"
          title="Import torrent"
        >
          <Upload size={14} />
          <span className="hidden sm:inline">Import</span>
        </button>

        {/* Downloads */}
        <button
          onClick={toggleDownloads}
          className={`btn-ghost relative flex items-center gap-2 text-sm ${downloadsOpen ? 'text-purple-400' : ''}`}
          title="Downloads"
        >
          <Download size={14} />
          <span className="hidden sm:inline">Downloads</span>
          {activeDownloads > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-600 text-white text-[10px] flex items-center justify-center font-bold">
              {activeDownloads}
            </span>
          )}
        </button>

        {/* Create hall */}
        <button
          onClick={onCreateRoom}
          className="btn-primary flex items-center gap-2 py-2 px-4 text-sm"
        >
          <Plus size={14} />
          <span>Create Hall</span>
        </button>

        {/* Profile menu */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-8 h-8 rounded-full accent-gradient flex items-center justify-center text-white text-xs font-bold hover:opacity-80 transition-opacity"
          >
            {nickname.slice(0, 2).toUpperCase()}
          </button>

          {profileOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
              <div className="menu-dropdown absolute right-0 top-12 w-52 z-50 animate-fade-in">
                <div className="px-3 py-2 border-b border-white/5 mb-1">
                  <div className="text-sm font-medium text-cinema-text truncate">{nickname}</div>
                  {account && (
                    <div className="text-xs text-cinema-muted truncate">{account.email}</div>
                  )}
                </div>
                <Link
                  to="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-cinema-muted hover:text-cinema-text hover:bg-white/5 rounded-lg transition-colors"
                >
                  <Settings size={13} />
                  Settings
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-cinema-muted hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-colors"
                >
                  <LogOut size={13} />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </nav>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {downloadsOpen && <DownloadsPanel />}
    </>
  )
}
