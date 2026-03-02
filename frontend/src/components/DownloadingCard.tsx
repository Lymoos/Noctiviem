import { Film } from 'lucide-react'
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
  if (!seconds || seconds <= 0 || seconds > 86400) return ''
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

/** Deterministic hue from torrent name for coloring the placeholder poster */
function nameToHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return h % 360
}

interface Props {
  item: DownloadItem
}

export default function DownloadingCard({ item }: Props) {
  const pct = Math.round(item.progress * 100)
  const hue = nameToHue(item.name)
  const hue2 = (hue + 50) % 360
  const hue3 = (hue + 110) % 360

  // Shared poster background — derived from torrent name
  const bg = `radial-gradient(ellipse at 50% 30%, hsl(${hue},60%,20%) 0%, hsl(${hue2},45%,10%) 55%, hsl(${hue3},30%,5%) 100%)`

  const statusLabel =
    item.status === 'queued'   ? 'В очереди' :
    item.status === 'metadata' ? 'Загрузка…' :
    `${pct}%`

  // Film-strip side-bars (for decoration)
  const strips = Array.from({ length: 9 })

  return (
    <div className="media-card">
      {/* ── Poster area ── */}
      <div className="relative aspect-[2/3] bg-cinema-card overflow-hidden rounded-xl">

        {/* BASE LAYER — full grayscale/dark version */}
        <div
          className="absolute inset-0"
          style={{ background: bg, filter: 'grayscale(1) brightness(0.38) contrast(1.1)' }}
        >
          {/* film strips */}
          <div className="absolute top-0 left-0 bottom-0 w-4 flex flex-col justify-around py-2 gap-1">
            {strips.map((_, i) => (
              <div key={i} className="flex-1 bg-black/50 mx-0.5 rounded-sm max-h-3" />
            ))}
          </div>
          <div className="absolute top-0 right-0 bottom-0 w-4 flex flex-col justify-around py-2 gap-1">
            {strips.map((_, i) => (
              <div key={i} className="flex-1 bg-black/50 mx-0.5 rounded-sm max-h-3" />
            ))}
          </div>
        </div>

        {/* COLOR LAYER — clipped to reveal from left as % grows */}
        <div
          className="absolute inset-0"
          style={{
            background: bg,
            clipPath: `inset(0 ${100 - pct}% 0 0)`,
            transition: 'clip-path 0.9s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div className="absolute top-0 left-0 bottom-0 w-4 flex flex-col justify-around py-2 gap-1">
            {strips.map((_, i) => (
              <div key={i} className="flex-1 bg-black/50 mx-0.5 rounded-sm max-h-3" />
            ))}
          </div>
          <div className="absolute top-0 right-0 bottom-0 w-4 flex flex-col justify-around py-2 gap-1">
            {strips.map((_, i) => (
              <div key={i} className="flex-1 bg-black/50 mx-0.5 rounded-sm max-h-3" />
            ))}
          </div>
        </div>

        {/* Vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/30 pointer-events-none" />

        {/* Center info */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none px-3">
          <Film size={26} className="text-white/20 mb-1" />
          {item.status === 'downloading' && pct > 0 && (
            <span className="text-2xl font-bold text-white/85 tabular-nums leading-none">
              {pct}%
            </span>
          )}
          {item.status === 'downloading' && item.downloadSpeed > 0 && (
            <span className="text-xs text-white/50">↓ {formatSpeed(item.downloadSpeed)}</span>
          )}
          {item.status === 'queued' && (
            <span className="text-xs text-white/40">В очереди</span>
          )}
          {item.status === 'metadata' && (
            <span className="text-xs text-white/40 animate-pulse">Загрузка…</span>
          )}
        </div>

        {/* Progress bar at very bottom */}
        {item.status === 'downloading' && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, hsl(${hue},80%,55%), hsl(${hue2},70%,60%))`,
              }}
            />
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-2 left-2">
          <span className="badge-processing">{statusLabel}</span>
        </div>

        {/* ETA */}
        {item.eta > 0 && item.status === 'downloading' && (
          <div className="absolute bottom-3 right-2 text-xs text-white/45 bg-black/50 rounded px-1.5 py-0.5 leading-none">
            {formatEta(item.eta)}
          </div>
        )}
      </div>

      {/* ── Info row ── */}
      <div className="mt-3 px-1">
        <h3
          className="text-sm font-semibold text-cinema-text truncate"
          title={item.name}
        >
          {item.name}
        </h3>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-cinema-muted">
            {item.status === 'queued'   ? 'В очереди' :
             item.status === 'metadata' ? 'Загрузка метаданных…' :
             'Загрузка'}
          </span>
          {item.total > 0 && (
            <span className="text-xs text-slate-600 truncate">
              {formatBytes(item.downloaded)} / {formatBytes(item.total)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
