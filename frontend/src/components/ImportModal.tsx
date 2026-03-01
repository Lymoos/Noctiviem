import { useState, useRef, DragEvent, ChangeEvent } from 'react'
import { X, Upload, FileArchive, AlertCircle, Film, Music, AlignJustify, File, CheckSquare, Square } from 'lucide-react'
import { useStore, getToken } from '../store'
import { translations } from '../i18n'

interface TorrentFilePreview {
  index: number
  name: string
  size: number
  isVideo: boolean
  isAudio: boolean
  isSub: boolean
}

interface ImportModalProps {
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function ImportModal({ onClose }: ImportModalProps) {
  const { toggleDownloads, lang } = useStore()
  const t = translations[lang]
  const [dragging, setDragging] = useState(false)
  const [step, setStep] = useState<'upload' | 'select' | 'starting'>('upload')
  const [error, setError] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState('')
  const [files, setFiles] = useState<TorrentFilePreview[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [totalSize, setTotalSize] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getFileType = (f: TorrentFilePreview) => {
    if (f.isVideo) return { label: t.typeVideo, color: 'text-purple-400', icon: <Film size={12} /> }
    if (f.isAudio) return { label: t.typeAudio, color: 'text-blue-400',   icon: <Music size={12} /> }
    if (f.isSub)   return { label: t.typeSub,   color: 'text-green-400',  icon: <AlignJustify size={12} /> }
    return             { label: t.typeOther, color: 'text-slate-400',   icon: <File size={12} /> }
  }

  const uploadAndParse = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.torrent')) {
      setError('Only .torrent files are accepted')
      return
    }
    setError(null)
    setStep('upload') // show spinner in upload zone

    const form = new FormData()
    form.append('torrent', file)

    try {
      const r = await fetch('/api/downloads/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      })
      const data = await r.json()
      if (data.error) { setError(data.error); return }

      const fileList: TorrentFilePreview[] = data.files ?? []
      // Default selection: video + audio + subtitle files
      const defaultSelected = new Set<number>(
        fileList
          .filter(f => f.isVideo || f.isAudio || f.isSub)
          .map(f => f.index)
      )
      // If nothing matched, select all
      if (defaultSelected.size === 0) fileList.forEach(f => defaultSelected.add(f.index))

      setPreviewId(data.previewId)
      setFiles(fileList)
      setSelected(defaultSelected)
      setTotalSize(fileList.reduce((s, f) => s + f.size, 0))
      setStep('select')
    } catch {
      setError('Upload failed. Please try again.')
    }
  }

  const startDownload = async () => {
    if (selected.size === 0) { setError(t.noFilesSelected); return }
    setError(null)
    setStep('starting')
    try {
      const r = await fetch('/api/downloads/confirm', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ previewId, selectedIndices: Array.from(selected) }),
      })
      const data = await r.json()
      if (data.error) { setError(data.error); setStep('select'); return }
      onClose()
      toggleDownloads()
    } catch {
      setError('Failed to start download.')
      setStep('select')
    }
  }

  const toggleFile = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(files.map(f => f.index)))
  const deselectAll = () => setSelected(new Set())

  const selectedSize = files
    .filter(f => selected.has(f.index))
    .reduce((s, f) => s + f.size, 0)

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadAndParse(file)
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadAndParse(file)
    e.target.value = ''
  }

  // ── Step: File selection ─────────────────────────────────────────────────
  if (step === 'select' || step === 'starting') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-content max-w-lg animate-fade-in" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-bold text-cinema-text">{t.selectFilesTitle}</h2>
              <p className="text-xs text-cinema-muted mt-0.5">{t.selectFilesDesc}</p>
            </div>
            <button onClick={onClose} className="btn-ghost p-2 -mr-2">
              <X size={16} />
            </button>
          </div>

          {/* Stats bar */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-500">
              {files.length} {lang === 'ru' ? 'файлов' : 'files'} · {formatSize(totalSize)}
            </span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
                {t.selectAll}
              </button>
              <span className="text-slate-700">·</span>
              <button onClick={deselectAll} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                {t.deselectAll}
              </button>
            </div>
          </div>

          {/* File list */}
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 mb-4">
            {files.map(f => {
              const fType = getFileType(f)
              const isChecked = selected.has(f.index)
              return (
                <div
                  key={f.index}
                  onClick={() => toggleFile(f.index)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all select-none ${
                    isChecked
                      ? 'bg-purple-600/10 border border-purple-500/20'
                      : 'bg-white/3 border border-white/5 opacity-50 hover:opacity-70'
                  }`}
                >
                  {/* Checkbox */}
                  <div className="flex-shrink-0 text-purple-400">
                    {isChecked
                      ? <CheckSquare size={15} />
                      : <Square size={15} className="text-slate-600" />
                    }
                  </div>

                  {/* Type icon */}
                  <div className={`flex-shrink-0 ${fType.color}`}>
                    {fType.icon}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-cinema-text truncate" title={f.name}>{f.name}</p>
                    <p className={`text-[10px] ${fType.color} mt-0.5`}>{fType.label}</p>
                  </div>

                  {/* Size */}
                  <span className="text-xs text-slate-500 flex-shrink-0 ml-2">{formatSize(f.size)}</span>
                </div>
              )
            })}
          </div>

          {/* Selected size info */}
          <div className="mb-4 px-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              {lang === 'ru'
                ? `Выбрано: ${selected.size} из ${files.length} файлов`
                : `Selected: ${selected.size} of ${files.length} files`}
            </span>
            <span className="text-purple-400 font-medium">{formatSize(selectedSize)}</span>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2.5">
              <AlertCircle size={14} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary px-5">
              {t.cancel}
            </button>
            <button
              onClick={startDownload}
              disabled={selected.size === 0 || step === 'starting'}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {step === 'starting' ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {lang === 'ru' ? 'Запуск...' : 'Starting...'}
                </>
              ) : (
                <>
                  <Upload size={14} />
                  {t.startDownload}
                  {selected.size > 0 && ` (${selected.size})`}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Step: Upload ─────────────────────────────────────────────────────────
  const isParsing = step === 'upload' && previewId === '' && files.length === 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content max-w-md animate-fade-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-cinema-text">{t.importMedia}</h2>
          <button onClick={onClose} className="btn-ghost p-2 -mr-2">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-cinema-muted mb-6">{t.importDesc}</p>

        {/* Drop zone */}
        <div
          className={`relative rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-10 flex flex-col items-center justify-center gap-4 text-center
            ${dragging
              ? 'border-purple-500/60 bg-purple-600/10'
              : 'border-white/10 bg-cinema-card/40 hover:border-purple-500/30 hover:bg-purple-600/5'
            }`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".torrent,application/x-bittorrent"
            className="hidden"
            onChange={onFileChange}
          />

          {isParsing && previewId === '' && files.length === 0 && error === null ? (
            // This shows during upload+parsing
            <>
              <div className="w-12 h-12 rounded-2xl accent-gradient flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
              <div>
                <p className="text-sm font-medium text-cinema-text">{t.parsingFiles}</p>
                <p className="text-xs text-cinema-muted mt-1">{t.serverReceiving}</p>
              </div>
            </>
          ) : (
            <>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                dragging ? 'accent-gradient' : 'bg-purple-600/15'
              }`}>
                <Upload size={22} className={dragging ? 'text-white' : 'text-purple-400'} />
              </div>
              <div>
                <p className="text-sm font-medium text-cinema-text">
                  {dragging ? t.dropIt : t.dragDropTorrent}
                </p>
                <p className="text-xs text-cinema-muted mt-1">{t.orClickToBrowse}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <FileArchive size={11} />
                <span>{t.torrentFilesOnly}</span>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={14} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            <Upload size={14} />
            {t.browseFile}
          </button>
          <button onClick={onClose} className="btn-secondary px-5">
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
