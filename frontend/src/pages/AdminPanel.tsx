import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Trash2, HardDrive, AlertTriangle, RefreshCw, Film, ArrowLeft, CheckCircle } from 'lucide-react'
import { useStore, apiFetch, apiDelete } from '../store'

interface FileEntry {
  path: string
  name: string
  size: number
  isKnown: boolean
  mediaId?: string
  mediaTitle?: string
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
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'orphaned' | 'known'>('all')

  // Redirect non-admins
  useEffect(() => {
    if (account && !account.isAdmin) navigate('/', { replace: true })
  }, [account, navigate])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch<{ files: FileEntry[] }>('/api/admin/files')
      if (r.error) { setError(r.error); return }
      setFiles(r.files ?? [])
    } catch (e: any) {
      setError(e.message ?? 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (filePath: string) => {
    if (!confirm(`Delete "${filePath}"?\n\nThis is permanent and cannot be undone.`)) return
    setDeleting(prev => new Set([...prev, filePath]))
    try {
      const r = await apiFetch('/api/admin/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      })
      if ((r as any).error) {
        alert((r as any).error)
      } else {
        setFiles(prev => prev.filter(f => f.path !== filePath))
      }
    } catch (e: any) {
      alert(e.message ?? 'Delete failed')
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(filePath); return next })
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
      <div className="glass-strong sticky top-0 z-50 px-6 py-4 flex items-center gap-4 border-b border-white/5">
        <button
          onClick={() => navigate('/')}
          className="btn-ghost p-2 flex items-center gap-2 text-sm"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 flex items-center justify-center">
            <Shield size={16} className="text-red-400" />
          </div>
          <div>
            <h1 className="font-bold text-cinema-text leading-none">Admin Panel</h1>
            <p className="text-xs text-slate-500">File system manager</p>
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={load}
          disabled={loading}
          className="btn-ghost p-2"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-6 py-8 max-w-4xl mx-auto space-y-6">
        {/* Stats row */}
        {!loading && (
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
                Orphaned (not in library)
              </div>
              <div className="text-lg font-bold text-red-400">{formatBytes(orphanedSize)}</div>
              <div className="text-xs text-slate-600">{orphanedCount} files</div>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2">
          {(['all', 'orphaned', 'known'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === f
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30'
                  : 'btn-ghost'
              }`}
            >
              {f === 'all' ? `All (${files.length})` : f === 'orphaned' ? `Orphaned (${orphanedCount})` : `In library (${files.filter(f2 => f2.isKnown).length})`}
            </button>
          ))}
        </div>

        {error && (
          <div className="glass rounded-xl px-4 py-3 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* File list */}
        {loading ? (
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
                  className={`glass rounded-xl px-4 py-3 flex items-center gap-3 ${
                    !file.isKnown ? 'border border-red-500/10' : ''
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    file.isKnown ? 'bg-green-600/15' : 'bg-red-600/15'
                  }`}>
                    <Film size={14} className={file.isKnown ? 'text-green-400' : 'text-red-400'} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-cinema-text truncate" title={file.path}>
                      {file.name}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      <span>{formatBytes(file.size)}</span>
                      {file.isKnown ? (
                        <span className="text-green-400 flex items-center gap-1">
                          <CheckCircle size={10} />
                          {file.mediaTitle ?? 'In library'}
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center gap-1">
                          <AlertTriangle size={10} />
                          Not in library
                        </span>
                      )}
                      <span className="text-slate-600 truncate">{file.path}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(file.path)}
                    disabled={isDel}
                    className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors p-1.5 disabled:opacity-50"
                    title="Delete file permanently"
                  >
                    {isDel ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
