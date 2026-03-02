import { useEffect, useState } from 'react'
import { X, Download, CheckCircle, AlertCircle, Clock, Loader, Trash2, Film, GripVertical } from 'lucide-react'
import { useStore, apiDelete, apiPatch } from '../store'
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
  if (!seconds || seconds <= 0 || seconds > 86400) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function StatusIcon({ status }: { status: DownloadItem['status'] }) {
  if (status === 'completed') return <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
  if (status === 'error')     return <AlertCircle  size={14} className="text-red-400 flex-shrink-0" />
  if (status === 'queued')    return <Clock        size={14} className="text-slate-400 flex-shrink-0" />
  return <Loader size={14} className="text-purple-400 flex-shrink-0 animate-spin" />
}

function StatusLabel({ status }: { status: DownloadItem['status'] }) {
  const map: Record<DownloadItem['status'], string> = {
    queued: 'В очереди', metadata: 'Загрузка…', downloading: 'Загрузка',
    completed: 'Завершено', error: 'Ошибка', paused: 'Пауза',
  }
  return <span>{map[status]}</span>
}

interface DownloadRowProps {
  item: DownloadItem
  position?: number          // queue position badge (1-based, for queued items)
  draggable?: boolean
  isDragOver?: boolean
  onRemove: (id: string) => void
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}

function DownloadRow({
  item, position, draggable: isDraggable, isDragOver,
  onRemove, onDragStart, onDragOver, onDrop, onDragEnd,
}: DownloadRowProps) {
  const isActive = item.status === 'downloading' || item.status === 'metadata'

  return (
    <div
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`glass rounded-xl p-4 space-y-3 transition-all ${
        isDragOver ? 'ring-2 ring-purple-400 scale-[1.01]' : ''
      } ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        {isDraggable && (
          <div className="flex-shrink-0 text-slate-600 hover:text-slate-400 transition-colors mt-1 cursor-grab">
            <GripVertical size={14} />
          </div>
        )}

        {/* Film icon + position badge */}
        <div className="relative w-9 h-9 rounded-lg bg-purple-600/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Film size={15} className="text-purple-400" />
          {position !== undefined && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-purple-600 text-white text-[9px] font-bold flex items-center justify-center">
              {position}
            </span>
          )}
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
          title="Удалить"
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
        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
          {item.downloadSpeed > 0 && (
            <span className="text-green-400">↓ {formatSpeed(item.downloadSpeed)}</span>
          )}
          {item.uploadSpeed > 0 && (
            <span>↑ {formatSpeed(item.uploadSpeed)}</span>
          )}
          {item.numPeers > 0 && <span>{item.numPeers} peers</span>}
          {item.eta > 0  && <span>ETA {formatEta(item.eta)}</span>}
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

  const [draggedId,  setDraggedId]  = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  useEffect(() => {
    socket.on('downloads:update', (items: DownloadItem[]) => setDownloads(items))
    return () => { socket.off('downloads:update') }
  }, [setDownloads])

  const handleRemove = async (id: string) => {
    await apiDelete(`/api/downloads/${id}`)
    setDownloads(downloads.filter(d => d.id !== id))
  }

  // ── Drag-and-drop handlers ────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== draggedId) setDragOverId(id)
  }

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return }

    // Build new order: remove draggedId then insert before targetId
    const allActiveIds = active.map(i => i.id)
    const fromIdx = allActiveIds.indexOf(draggedId)
    const toIdx   = allActiveIds.indexOf(targetId)
    if (fromIdx === -1 || toIdx === -1) { setDraggedId(null); setDragOverId(null); return }

    const newOrder = [...allActiveIds]
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, draggedId)

    setDraggedId(null)
    setDragOverId(null)

    // Optimistic update + persist to server
    await apiPatch('/api/downloads/reorder', { ids: newOrder })
  }

  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null) }

  // ── Sections ──────────────────────────────────────────────────────────────
  const active    = downloads.filter(d => d.status === 'downloading' || d.status === 'metadata' || d.status === 'queued')
  const completed = downloads.filter(d => d.status === 'completed')
  const failed    = downloads.filter(d => d.status === 'error')

  // Position badge counter for queued items (1-based slot in queue)
  let queueCounter = 1

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
          <h2 className="font-semibold text-cinema-text flex-1">Загрузки</h2>
          {active.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-purple-600/30 text-purple-300">
              {active.length} активных
            </span>
          )}
          <button onClick={toggleDownloads} className="btn-ghost p-1.5"><X size={14} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {downloads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-cinema-card flex items-center justify-center mb-3 opacity-30">
                <Download size={22} className="text-slate-500" />
              </div>
              <p className="text-cinema-muted text-sm">Нет загрузок</p>
              <p className="text-xs text-slate-600 mt-1">Используйте кнопку Импорт чтобы добавить торрент</p>
            </div>
          )}

          {active.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-slate-500 uppercase tracking-wide">Активные</h3>
                {active.some(d => d.status === 'queued') && (
                  <span className="text-xs text-slate-600">Перетащите для смены очерёдности</span>
                )}
              </div>
              <div className="space-y-3">
                {active.map(item => {
                  const pos = item.status === 'queued' ? queueCounter++ : undefined
                  return (
                    <DownloadRow
                      key={item.id}
                      item={item}
                      position={pos}
                      draggable
                      isDragOver={dragOverId === item.id}
                      onRemove={handleRemove}
                      onDragStart={e => handleDragStart(e, item.id)}
                      onDragOver={e => handleDragOver(e, item.id)}
                      onDrop={e => handleDrop(e, item.id)}
                      onDragEnd={handleDragEnd}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {failed.length > 0 && (
            <section>
              <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-3">Ошибки</h3>
              <div className="space-y-3">
                {failed.map(item => (
                  <DownloadRow key={item.id} item={item} onRemove={handleRemove} />
                ))}
              </div>
            </section>
          )}

          {completed.length > 0 && (
            <section>
              <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-3">Завершено</h3>
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
