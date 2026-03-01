import { useEffect } from 'react'
import { X, Download, CheckCircle, AlertCircle, Clock, Loader, Trash2, Film } from 'lucide-react'
import { useStore, apiDelete } from '../store'
import { socket } from '../socket'
import { DownloadItem } from '../types'

function formatBytes(b: number): string {
  if (b === 0) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(2)} GB`
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps} B/s`
  if (bps < 1048576) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1048576).toFixed(1)} MB/s`
}

function formatEta(seconds: number): string {
  if (!seconds || seconds === Infinity || seconds > 86400) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function StatusIcon({ status }: { status: DownloadItem['status'] }) {
  if (status === 'completed') return <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
  if (status === 'error') return <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
  if (status === 'queued') return <Clock size={14} className="text-slate-400 flex-shrink-0" />
  return <Loader size={14} className="text-purple-400 flex-shrink-0 animate-spin" />
}

function StatusLabel({ status }: { status: DownloadItem['status'] }) {
  const map: Record<DownloadItem['status'], string> = {
    queued: 'Queued',
    metadata: 'Fetching info…',
    downloading: 'Downloading',
    completed: 'Complete',
    error: 'Error',
    paused: 'Paused',
  }
  return <span>{map[status]}</span>
}

function DownloadRow({ item, onRemove }: { item: DownloadItem; onRemove: (id: string) => void }) {
  const isActive = item.status === 'downloading' || item.status === 'metadata'

  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-purple-600/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Film size={15} className="text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-cinema-text truncate" title={item.name}>{item.name}</p>
          <div className="flex items-center gap-2 text-xs text-cinema-muted mt-0.5">
            <StatusIcon status={item.status} />
            <StatusLabel status={item.status} />
            {item.status === 'error' && item.error && (
              <span className="text-red-400 truncate">— {item.error}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => onRemove(item.id)}
          className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors p-1"
          title="Remove"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Progress bar */}
      {(isActive || item.status === 'completed') && (
        <div>
          <div className="h-1.5 rounded-full bg-cinema-card overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                item.status === 'completed' ? 'bg-green-500' : 'accent-gradient'
              }`}
              style={{ width: `${Math.round(item.progress * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs text-slate-500">
            <span>{Math.round(item.progress * 100)}%</span>
            {item.total > 0 && (
              <span>{formatBytes(item.downloaded)} / {formatBytes(item.total)}</span>
            )}
          </div>
        </div>
      )}

      {/* Speed / peers / ETA */}
      {isActive && (
        <div className="flex items-center gap-4 text-xs text-slate-500">
          {item.downloadSpeed > 0 && (
            <span className="text-green-400">↓ {formatSpeed(item.downloadSpeed)}</span>
          )}
          {item.uploadSpeed > 0 && (
            <span>↑ {formatSpeed(item.uploadSpeed)}</span>
          )}
          {item.numPeers > 0 && (
            <span>{item.numPeers} peers</span>
          )}
          {item.eta > 0 && (
            <span>ETA {formatEta(item.eta)}</span>
          )}
        </div>
      )}

      {/* File list (completed) */}
      {item.status === 'completed' && item.files.length > 0 && (
        <div className="space-y-1">
          {item.files.map(f => (
            <div key={f.name} className="flex items-center gap-2 text-xs text-slate-500">
              <Film size={10} className={f.isVideo ? 'text-purple-400' : 'text-slate-600'} />
              <span className="truncate">{f.name}</span>
              <span className="flex-shrink-0 ml-auto">{formatBytes(f.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DownloadsPanel() {
  const { downloads, setDownloads, toggleDownloads } = useStore()

  useEffect(() => {
    socket.on('downloads:update', (items: DownloadItem[]) => {
      setDownloads(items)
    })
    return () => { socket.off('downloads:update') }
  }, [setDownloads])

  const handleRemove = async (id: string) => {
    await apiDelete(`/api/downloads/${id}`)
    setDownloads(downloads.filter(d => d.id !== id))
  }

  const active = downloads.filter(d => d.status === 'downloading' || d.status === 'metadata' || d.status === 'queued')
  const completed = downloads.filter(d => d.status === 'completed')
  const failed = downloads.filter(d => d.status === 'error')

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={toggleDownloads}>
      <div
        className="w-full max-w-sm h-full glass-strong flex flex-col animate-slide-in-right shadow-2xl"
        style={{ borderLeft: '1px solid rgba(255,255,255,0.07)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 flex-shrink-0">
          <Download size={16} className="text-purple-400" />
          <h2 className="font-semibold text-cinema-text flex-1">Downloads</h2>
          {active.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-purple-600/30 text-purple-300">
              {active.length} active
            </span>
          )}
          <button onClick={toggleDownloads} className="btn-ghost p-1.5">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {downloads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-cinema-card flex items-center justify-center mb-3 opacity-30">
                <Download size={22} className="text-slate-500" />
              </div>
              <p className="text-cinema-muted text-sm">No downloads yet</p>
              <p className="text-xs text-slate-600 mt-1">Use the Import button to add a torrent</p>
            </div>
          )}

          {active.length > 0 && (
            <section>
              <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-3">Active</h3>
              <div className="space-y-3">
                {active.map(item => (
                  <DownloadRow key={item.id} item={item} onRemove={handleRemove} />
                ))}
              </div>
            </section>
          )}

          {failed.length > 0 && (
            <section>
              <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-3">Failed</h3>
              <div className="space-y-3">
                {failed.map(item => (
                  <DownloadRow key={item.id} item={item} onRemove={handleRemove} />
                ))}
              </div>
            </section>
          )}

          {completed.length > 0 && (
            <section>
              <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-3">Completed</h3>
              <div className="space-y-3">
                {completed.map(item => (
                  <DownloadRow key={item.id} item={item} onRemove={handleRemove} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
