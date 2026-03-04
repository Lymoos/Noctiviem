import { useState, useRef, useEffect, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Sliders, Download, Trash2, LogOut, Save, Eye, EyeOff, Film, ChevronDown, RefreshCw } from 'lucide-react'
import { useStore, apiPatch, apiDelete } from '../store'
import { translations } from '../i18n'
import { randomUUID } from '../utils'

type Tab = 'profile' | 'playback' | 'downloads' | 'account'

interface SelectOption { value: string; label: string }

function CustomSelect({ value, options, onChange }: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field flex items-center justify-between cursor-pointer text-left"
        style={{ paddingLeft: '14px' }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={14} className={`text-slate-500 transition-transform flex-shrink-0 ml-2 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 right-0 z-50 mt-1 py-1 rounded-lg"
          style={{
            background: 'rgba(17, 21, 28, 0.98)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.1)',
            backdropFilter: 'blur(16px)',
          }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                opt.value === value
                  ? 'text-purple-300 bg-purple-600/10'
                  : 'text-cinema-muted hover:text-cinema-text hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { account, updateAccount, logout, lang } = useStore()
  const t = translations[lang]
  const [tab, setTab] = useState<Tab>('profile')
  const [saving, setSaving] = useState(false)
  const [saveError, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [nickname, setNickname] = useState(account?.settings.nickname ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [isPrivate, setIsPrivate] = useState(account?.settings.isPrivate ?? false)
  const [avatarStyle, setAvatarStyle] = useState(account?.settings.avatarStyle ?? 'thumbs')
  const [avatarSeed, setAvatarSeed] = useState(account?.settings.avatarSeed ?? '')
  const [seatColor, setSeatColor] = useState(account?.settings.seatColor ?? 'default')

  const [defaultQuality, setDefaultQuality] = useState(account?.settings.defaultQuality ?? 'Auto')
  const [defaultAudioLang, setDefaultAudioLang] = useState(account?.settings.defaultAudioLang ?? 'und')
  const [defaultSubsLang, setDefaultSubsLang] = useState(account?.settings.defaultSubsLang ?? 'off')
  const [autoSync, setAutoSync] = useState(account?.settings.autoSyncOnJoin ?? true)

  const [maxDl, setMaxDl] = useState(account?.settings.maxConcurrentDownloads ?? 3)

  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const body: Record<string, unknown> = { nickname, email, isPrivate, avatarStyle, avatarSeed, seatColor }
    if (newPw) { body.currentPassword = currentPw; body.newPassword = newPw }
    const r = await apiPatch<{ user: typeof account }>('/api/auth/settings', body)
    setSaving(false)
    if (r.error) { setError(r.error); return }
    if (r.user) updateAccount(r.user)
    setCurrentPw(''); setNewPw('')
    flash()
  }

  const savePlayback = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const r = await apiPatch<{ user: typeof account }>('/api/auth/settings', {
      defaultQuality, defaultAudioLang, defaultSubsLang, autoSyncOnJoin: autoSync,
    })
    setSaving(false)
    if (r.error) { setError(r.error); return }
    if (r.user) updateAccount(r.user)
    flash()
  }

  const saveDownloads = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const r = await apiPatch<{ user: typeof account }>('/api/auth/settings', { maxConcurrentDownloads: maxDl })
    setSaving(false)
    if (r.error) { setError(r.error); return }
    if (r.user) updateAccount(r.user)
    flash()
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return
    setDeletingAccount(true)
    await apiDelete('/api/auth/account')
    logout()
    navigate('/login', { replace: true })
  }

  const qualityOptions: SelectOption[] = [
    { value: 'Auto', label: t.auto },
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: '480p', label: '480p' },
    { value: '360p', label: '360p' },
  ]

  const audioOptions: SelectOption[] = [
    { value: 'und', label: t.unknownAny },
    { value: 'en', label: t.english },
    { value: 'fr', label: t.french },
    { value: 'es', label: t.spanish },
    { value: 'de', label: t.german },
    { value: 'ru', label: t.russian },
    { value: 'ja', label: t.japanese },
  ]

  const subsOptions: SelectOption[] = [
    { value: 'off', label: t.off },
    { value: 'en', label: t.english },
    { value: 'fr', label: t.french },
    { value: 'es', label: t.spanish },
    { value: 'de', label: t.german },
    { value: 'ru', label: t.russian },
    { value: 'ja', label: t.japanese },
  ]

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',   label: t.profile,   icon: <User size={14} /> },
    { id: 'playback',  label: t.playback,  icon: <Sliders size={14} /> },
    { id: 'downloads', label: t.downloads, icon: <Download size={14} /> },
    { id: 'account',   label: t.account,   icon: <Trash2 size={14} /> },
  ]

  return (
    <div className="min-h-screen bg-cinema-bg">
      {/* Header */}
      <header className="glass-strong sticky top-0 z-30 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-lg accent-gradient flex items-center justify-center">
            <Film size={13} className="text-white" />
          </div>
          <span className="font-bold accent-gradient-text tracking-tight">Noctiviem</span>
        </Link>
        <div className="flex-1" />
        <span className="text-sm text-cinema-muted">{t.settingsTitle}</span>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-cinema-text mb-8">{t.settingsTitle}</h1>

        <div className="flex gap-1 mb-8 glass rounded-xl p-1">
          {TABS.map(tab_ => (
            <button
              key={tab_.id}
              onClick={() => { setTab(tab_.id); setError(null); setSaved(false) }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm transition-all ${
                tab === tab_.id
                  ? 'bg-purple-600/30 text-purple-300 font-medium'
                  : 'text-cinema-muted hover:text-cinema-text'
              }`}
            >
              {tab_.icon}
              <span className="hidden sm:inline">{tab_.label}</span>
            </button>
          ))}
        </div>

        {saved && (
          <div className="mb-4 flex items-center gap-2 text-sm text-green-400 bg-green-900/15 border border-green-500/20 rounded-lg px-3 py-2.5">
            <span>✓</span><span>{t.changesSaved}</span>
          </div>
        )}
        {saveError && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2.5">
            <span>⚠</span><span>{saveError}</span>
          </div>
        )}

        {/* ── PROFILE TAB ── */}
        {tab === 'profile' && (
          <form onSubmit={saveProfile} className="glass-strong rounded-2xl p-6 space-y-5" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">{t.displayName}</label>
              <input
                type="text" value={nickname} onChange={e => setNickname(e.target.value)}
                className="input-field" placeholder={t.yourNickname} minLength={2} maxLength={32} required
                style={{ paddingLeft: '14px' }}
              />
              <p className="text-xs text-slate-600 mt-1">{t.shownInRooms}</p>
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">{t.username}</label>
              <input
                type="text" value={account?.username ?? ''} disabled
                className="input-field opacity-50 cursor-not-allowed"
                style={{ paddingLeft: '14px' }}
              />
              <p className="text-xs text-slate-600 mt-1">{t.cannotBeChanged}</p>
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">{t.email}</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input-field" required
                style={{ paddingLeft: '14px' }}
              />
            </div>

            <hr className="border-white/5" />

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">{t.changePassword}</label>
              <div className="space-y-2">
                <input
                  type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                  className="input-field" placeholder={t.currentPassword}
                  style={{ paddingLeft: '14px' }}
                />
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                    className="input-field pr-10" placeholder={t.newPassword} minLength={newPw ? 6 : undefined}
                    style={{ paddingLeft: '14px' }}
                  />
                  <button type="button" onClick={() => setShowNewPw(!showNewPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                    {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-1">{t.leaveBlank}</p>
            </div>

            <hr className="border-white/5" />

            <div className="flex items-center justify-between p-3 glass rounded-lg">
              <div>
                <div className="text-sm text-cinema-text">Private account</div>
                <div className="text-xs text-cinema-muted mt-0.5">Hide your watch history and friends from other users</div>
              </div>
              <button
                type="button"
                onClick={() => setIsPrivate(!isPrivate)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${isPrivate ? 'bg-purple-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isPrivate ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <hr className="border-white/5" />

            {/* Avatar style picker */}
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">{t.avatarStyle}</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {(['thumbs','avataaars','pixel-art','adventurer','big-smile','fun-emoji','croodles','shapes'] as const).map(style => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => setAvatarStyle(style)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${
                      avatarStyle === style
                        ? 'border-purple-500/60 bg-purple-600/15'
                        : 'border-white/5 bg-white/3 hover:bg-white/6'
                    }`}
                  >
                    <img
                      src={`https://api.dicebear.com/7.x/${style}/svg?seed=${avatarSeed || account?.id || 'preview'}`}
                      alt={style}
                      className="w-10 h-10 rounded-full"
                      onError={e => { (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/thumbs/svg?seed=preview` }}
                    />
                    <span className="text-[10px] text-cinema-muted capitalize">{style.replace('-', ' ')}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAvatarSeed(randomUUID())}
                className="btn-ghost text-xs flex items-center gap-1.5 py-1"
              >
                <RefreshCw size={11} />
                {t.regenerateAvatar}
              </button>
            </div>

            <hr className="border-white/5" />

            {/* Seat color picker */}
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">{t.seatColor}</label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { value: 'default', label: 'Фиолет.', color: '#7c3aed' },
                  { value: 'crimson', label: 'Алый', color: '#dc2626' },
                  { value: 'ocean',   label: 'Океан', color: '#2563eb' },
                  { value: 'emerald', label: 'Изумруд', color: '#059669' },
                  { value: 'gold',    label: 'Золото', color: '#d97706' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSeatColor(opt.value)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
                      seatColor === opt.value
                        ? 'border-white/30 bg-white/10 text-cinema-text'
                        : 'border-white/5 bg-white/3 text-cinema-muted hover:bg-white/6'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: opt.color }} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{t.saving}</>
              ) : (
                <><Save size={14} />{t.saveProfile}</>
              )}
            </button>
          </form>
        )}

        {/* ── PLAYBACK TAB ── */}
        {tab === 'playback' && (
          <form onSubmit={savePlayback} className="glass-strong rounded-2xl p-6 space-y-5" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">{t.defaultQuality}</label>
              <CustomSelect value={defaultQuality} options={qualityOptions} onChange={setDefaultQuality} />
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">{t.defaultAudioLang}</label>
              <CustomSelect value={defaultAudioLang} options={audioOptions} onChange={setDefaultAudioLang} />
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">{t.defaultSubtitles}</label>
              <CustomSelect value={defaultSubsLang} options={subsOptions} onChange={setDefaultSubsLang} />
            </div>

            <div className="flex items-center justify-between p-3 glass rounded-lg">
              <div>
                <div className="text-sm text-cinema-text">{t.autoSync}</div>
                <div className="text-xs text-cinema-muted mt-0.5">{t.autoSyncDesc}</div>
              </div>
              <button
                type="button"
                onClick={() => setAutoSync(!autoSync)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${autoSync ? 'bg-purple-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${autoSync ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{t.saving}</>
              ) : (
                <><Save size={14} />{t.savePlayback}</>
              )}
            </button>
          </form>
        )}

        {/* ── DOWNLOADS TAB ── */}
        {tab === 'downloads' && (
          <form onSubmit={saveDownloads} className="glass-strong rounded-2xl p-6 space-y-5" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">
                {t.maxConcurrentDownloads}: <span className="text-purple-400 normal-case">{maxDl}</span>
              </label>
              <input
                type="range" min={1} max={5} step={1} value={maxDl} onChange={e => setMaxDl(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
              <div className="flex justify-between text-xs text-slate-600 mt-1">
                <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
              </div>
              <p className="text-xs text-slate-600 mt-2">{t.maxConcurrentDesc}</p>
            </div>

            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{t.saving}</>
              ) : (
                <><Save size={14} />{t.saveDownloads}</>
              )}
            </button>
          </form>
        )}

        {/* ── ACCOUNT TAB ── */}
        {tab === 'account' && (
          <div className="space-y-4">
            <div className="glass-strong rounded-2xl p-6" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full accent-gradient flex items-center justify-center text-white font-bold">
                  {(account?.settings.nickname ?? 'U').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-cinema-text">{account?.settings.nickname}</div>
                  <div className="text-xs text-cinema-muted">{account?.email}</div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {t.memberSince} {account ? new Date(account.createdAt).toLocaleDateString() : '—'}
                  </div>
                </div>
              </div>
              <button onClick={handleLogout} className="btn-secondary w-full flex items-center justify-center gap-2">
                <LogOut size={14} />
                {t.signOut}
              </button>
            </div>

            <div className="glass-strong rounded-2xl p-6 border border-red-500/20">
              <h3 className="text-sm font-semibold text-red-400 mb-1">{t.dangerZone}</h3>
              <p className="text-xs text-cinema-muted mb-4">{t.deleteAccountDesc}</p>
              <div className="space-y-2">
                <input
                  type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                  className="input-field text-sm" placeholder={t.typeDeleteConfirm}
                  style={{ paddingLeft: '14px' }}
                />
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirm !== 'DELETE' || deletingAccount}
                  className="w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all
                    bg-red-900/20 border border-red-500/30 text-red-400
                    hover:bg-red-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {deletingAccount ? t.deleting : t.deleteAccountPermanently}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
