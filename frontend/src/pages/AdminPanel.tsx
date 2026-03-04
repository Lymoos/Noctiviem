import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Trash2, HardDrive, AlertTriangle, RefreshCw, Film, ArrowLeft, CheckCircle, Users, Star } from 'lucide-react'
import { useStore, apiFetch } from '../store'

interface FileEntry {
  path: string
  name: string
  size: number
  isKnown: boolean
  mediaId?: string
  mediaTitle?: string
}

interface UserEntry {
  id: string
  username: string
  nickname: string
  specialRole: string | null
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(1)} MB`
  return `${(b / 1_073_741_824).toFixed(2)} GB`
}

export default function AdminPanel() {
  const navigate = useNavigate()
  const { account } = useStore()
  const [tab, setTab] = useState<'files' | 'users'>('files')

  // Files state
  const [files, setFiles] = useState<FileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(true)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [filesError, setFilesError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'orphaned' | 'known'>('all')

  // Users state
  const [users, setUsers] = useState<UserEntry[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [togglingRole, setTogglingRole] = useState<Set<string>>(new Set())

  // Redirect non-admins
  useEffect(() => {
    if (account && !account.isAdmin) navigate('/', { replace: true })
  }, [account, navigate])

  // Load files
  const loadFiles = useCallback(async () => {
    setFilesLoading(true)
    setFilesError(null)
    try {
      const r = await apiFetch<{ files: FileEntry[] }>('/api/admin/files')
      if (r.error) { setFilesError(r.error); return }
      setFiles(r.files ?? [])
    } catch (e: any) {
      setFilesError(e.message ?? 'Failed to load files')
    } finally {
      setFilesLoading(false)
    }
  }, [])

  // Load users
  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const r = await apiFetch<{ users: UserEntry[] }>('/api/admin/users')
      if (!r.error) setUsers(r.users ?? [])
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])
  useEffect(() => { if (tab === 'users') loadUsers() }, [tab, loadUsers])

  const handleDelete = async (filePath: string) => {
    if (!confirm(`Delete "${filePath}"?\n\nThis is permanent and cannot be undone.`)) return
    setDeleting(prev => new Set([...prev, filePath]))
    try {
      const r = await apiFetch('/api/admin/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      })
      if ((r as any).error) alert((r as any).error)
      else setFiles(prev => prev.filter(f => f.path !== filePath))
    } catch (e: any) {
      alert(e.message ?? 'Delete failed')
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(filePath); return next })
    }
  }

  const handleToggleRole = async (userId: string, currentRole: string | null) => {
    const newRole = currentRole === 'miloe-solnyshko' ? null : 'miloe-solnyshko'
    setTogglingRole(prev => new Set([...prev, userId]))
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (!(r as any).error) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, specialRole: newRole } : u))
      }
    } finally {
      setTogglingRole(prev => { const next = new Set(prev); next.delete(userId); return next })
    }
  }

  const visible = files.filter(f => {
    if (filter === 'orphaned') return !f.isKnown
    if (filter === 'known') return f.isKnown
    return true
  })

  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const orphanedSize = files.filter(f => !f.isKnown).reduce((s, f) => s + f.size, 0)
  const orphanedCount = files.filter(f => !f.isKnown).length

  if (account && !account.isAdmin) return null

  return (
    <div className="min-h-screen bg-cinema-bg">
      {/* Header */}
      <div className="glass-strong sticky top-0 z-50 px-4 sm:px-6 py-4 flex items-center gap-3 sm:gap-4 border-b border-white/5">
        <button onClick={() => navigate('/')} className="btn-ghost p-2 flex items-center gap-2 text-sm flex-shrink-0">
          <ArrowLeft size={14} />
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-red-400" />
          </div>
          <div>
            <h1 className="font-bold text-cinema-text leading-none">Admin Panel</h1>
            <p className="text-xs text-slate-500 hidden sm:block">System manager</p>
          </div>
        </div>
        <div className="flex-1" />
        {/* Tabs */}
        <div className="flex gap-1">
          <button
            onClick={() => setTab('files')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              tab === 'files' ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30' : 'btn-ghost'
            }`}
          >
            <Film size={13} />
            <span className="hidden sm:inline">Files</span>
          </button>
          <button
            onClick={() => setTab('users')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              tab === 'users' ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30' : 'btn-ghost'
            }`}
          >
            <Users size={13} />
            <span className="hidden sm:inline">Users</span>
          </button>
        </div>
        <button
          onClick={tab === 'files' ? loadFiles : loadUsers}
          disabled={tab === 'files' ? filesLoading : usersLoading}
          className="btn-ghost p-2 flex-shrink-0"
          title="Refresh"
        >
          <RefreshCw size={14} className={(tab === 'files' ? filesLoading : usersLoading) ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto space-y-6">

        {/* ── FILES TAB ── */}
        {tab === 'files' && (
          <>
            {!filesLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="glass rounded-xl p-4">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <HardDrive size={12} className="text-purple-400" />
                    Total on disk
                  </div>
                  <div className="text-lg font-bold text-cinema-text">{formatBytes(totalSize)}</div>
                  <div className="text-xs text-slate-600">{files.length} files</div>
                </div>
                <div className="glass rounded-xl p-4 border border-green-500/10">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <CheckCircle size={12} className="text-green-400" />
                    In media library
                  </div>
                  <div className="text-lg font-bold text-green-400">
                    {formatBytes(files.filter(f => f.isKnown).reduce((s, f) => s + f.size, 0))}
                  </div>
                  <div className="text-xs text-slate-600">{files.filter(f => f.isKnown).length} files</div>
                </div>
                <div className="glass rounded-xl p-4 border border-red-500/10">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                    <AlertTriangle size={12} className="text-red-400" />
                    Orphaned
                  </div>
                  <div className="text-lg font-bold text-red-400">{formatBytes(orphanedSize)}</div>
                  <div className="text-xs text-slate-600">{orphanedCount} files</div>
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {(['all', 'orphaned', 'known'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    filter === f ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30' : 'btn-ghost'
                  }`}
                >
                  {f === 'all' ? `All (${files.length})` : f === 'orphaned' ? `Orphaned (${orphanedCount})` : `In library (${files.filter(f2 => f2.isKnown).length})`}
                </button>
              ))}
            </div>

            {filesError && (
              <div className="glass rounded-xl px-4 py-3 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
                <AlertTriangle size={14} />{filesError}
              </div>
            )}

            {filesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-cinema-card animate-pulse" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div className="text-center py-16 text-cinema-muted">
                <Film size={32} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">No files found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map(file => {
                  const isDel = deleting.has(file.path)
                  return (
                    <div
                      key={file.path}
                      className={`glass rounded-xl px-4 py-3 flex items-center gap-3 ${!file.isKnown ? 'border border-red-500/10' : ''}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${file.isKnown ? 'bg-green-600/15' : 'bg-red-600/15'}`}>
                        <Film size={14} className={file.isKnown ? 'text-green-400' : 'text-red-400'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-cinema-text truncate" title={file.path}>{file.name}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
                          <span>{formatBytes(file.size)}</span>
                          {file.isKnown ? (
                            <span className="text-green-400 flex items-center gap-1"><CheckCircle size={10} />{file.mediaTitle ?? 'In library'}</span>
                          ) : (
                            <span className="text-red-400 flex items-center gap-1"><AlertTriangle size={10} />Not in library</span>
                          )}
                          <span className="text-slate-600 truncate hidden sm:inline">{file.path}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(file.path)}
                        disabled={isDel}
                        className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors p-1.5 disabled:opacity-50"
                        title="Delete permanently"
                      >
                        {isDel ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <>
            {/* Role legend */}
            <div className="glass rounded-xl p-4 flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">🌸</span>
              <div>
                <p className="text-sm font-semibold text-cinema-text">Милое солнышко</p>
                <p className="text-xs text-slate-500 mt-1">
                  Присваивает особую роль пользователю. В кинозале над аватаркой появляются
                  красивые цветочки и искорки — нежная метка для особого человека ✨
                </p>
              </div>
            </div>

            {usersLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-xl bg-cinema-card animate-pulse" />
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-16 text-cinema-muted">
                <Users size={32} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">No registered users</p>
              </div>
            ) : (
              <div className="space-y-2">
                {users.map(user => {
                  const hasSunRole = user.specialRole === 'miloe-solnyshko'
                  const isToggling = togglingRole.has(user.id)
                  return (
                    <div
                      key={user.id}
                      className={`glass rounded-xl px-4 py-3 flex items-center gap-3 transition-colors ${
                        hasSunRole ? 'border border-rose-500/20' : ''
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                        hasSunRole ? 'bg-rose-500/20 text-rose-300' : 'bg-purple-600/20 text-purple-300'
                      }`}>
                        {user.nickname.slice(0, 2).toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-cinema-text">{user.nickname}</p>
                          {hasSunRole && (
                            <span className="text-xs flex items-center gap-1 text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-full px-2 py-0.5">
                              🌸 Милое солнышко
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">@{user.username}</p>
                      </div>

                      <button
                        onClick={() => handleToggleRole(user.id, user.specialRole)}
                        disabled={isToggling}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 ${
                          hasSunRole
                            ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/20'
                            : 'btn-ghost text-slate-400 hover:text-rose-300'
                        }`}
                        title={hasSunRole ? 'Remove role' : 'Assign Милое солнышко'}
                      >
                        {isToggling ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : (
                          <Star size={12} className={hasSunRole ? 'fill-rose-400' : ''} />
                        )}
                        <span className="hidden sm:inline">{hasSunRole ? 'Remove' : 'Assign'}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
