import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, User, Sliders, Download, Trash2, LogOut, Save, Eye, EyeOff, Film } from 'lucide-react'
import { useStore, apiPatch, apiDelete } from '../store'

type Tab = 'profile' | 'playback' | 'downloads' | 'account'

export default function Settings() {
  const navigate = useNavigate()
  const { account, updateAccount, logout } = useStore()
  const [tab, setTab] = useState<Tab>('profile')
  const [saving, setSaving] = useState(false)
  const [saveError, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Profile fields
  const [nickname, setNickname] = useState(account?.settings.nickname ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)

  // Playback fields
  const [defaultQuality, setDefaultQuality] = useState(account?.settings.defaultQuality ?? 'Auto')
  const [defaultAudioLang, setDefaultAudioLang] = useState(account?.settings.defaultAudioLang ?? 'und')
  const [defaultSubsLang, setDefaultSubsLang] = useState(account?.settings.defaultSubsLang ?? 'off')
  const [autoSync, setAutoSync] = useState(account?.settings.autoSyncOnJoin ?? true)

  // Downloads fields
  const [maxDl, setMaxDl] = useState(account?.settings.maxConcurrentDownloads ?? 3)

  // Danger zone
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const body: Record<string, unknown> = { nickname, email }
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

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',   label: 'Profile',   icon: <User size={14} /> },
    { id: 'playback',  label: 'Playback',  icon: <Sliders size={14} /> },
    { id: 'downloads', label: 'Downloads', icon: <Download size={14} /> },
    { id: 'account',   label: 'Account',   icon: <Trash2 size={14} /> },
  ]

  return (
    <div className="min-h-screen bg-cinema-bg">
      {/* Header */}
      <header className="glass-strong sticky top-0 z-30 px-6 py-3 flex items-center gap-4">
        <button onClick={() => navigate('/')} className="btn-ghost p-2">
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg accent-gradient flex items-center justify-center">
            <Film size={13} className="text-white" />
          </div>
          <span className="font-bold accent-gradient-text tracking-tight">Noctiviem</span>
        </div>
        <div className="flex-1" />
        <span className="text-sm text-cinema-muted">Settings</span>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-cinema-text mb-8">Settings</h1>

        {/* Tab list */}
        <div className="flex gap-1 mb-8 glass rounded-xl p-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(null); setSaved(false) }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm transition-all ${
                tab === t.id
                  ? 'bg-purple-600/30 text-purple-300 font-medium'
                  : 'text-cinema-muted hover:text-cinema-text'
              }`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Feedback */}
        {saved && (
          <div className="mb-4 flex items-center gap-2 text-sm text-green-400 bg-green-900/15 border border-green-500/20 rounded-lg px-3 py-2.5">
            <span>✓</span><span>Changes saved</span>
          </div>
        )}
        {saveError && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2.5">
            <span>⚠</span><span>{saveError}</span>
          </div>
        )}

        {/* ── PROFILE TAB ──────────────────────────────────────────────────────── */}
        {tab === 'profile' && (
          <form onSubmit={saveProfile} className="glass-strong rounded-2xl p-6 space-y-5" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Display name</label>
              <input
                type="text" value={nickname} onChange={e => setNickname(e.target.value)}
                className="input-field" placeholder="Your nickname" minLength={2} maxLength={32} required
              />
              <p className="text-xs text-slate-600 mt-1">Shown in rooms and chat</p>
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Username</label>
              <input
                type="text" value={account?.username ?? ''} disabled
                className="input-field opacity-50 cursor-not-allowed"
              />
              <p className="text-xs text-slate-600 mt-1">Cannot be changed</p>
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input-field" required
              />
            </div>

            <hr className="border-white/5" />

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Change password</label>
              <div className="space-y-2">
                <input
                  type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                  className="input-field" placeholder="Current password"
                />
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                    className="input-field pr-10" placeholder="New password (min 6 chars)" minLength={newPw ? 6 : undefined}
                  />
                  <button type="button" onClick={() => setShowNewPw(!showNewPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                    {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-1">Leave blank to keep current password</p>
            </div>

            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</>
              ) : (
                <><Save size={14} />Save profile</>
              )}
            </button>
          </form>
        )}

        {/* ── PLAYBACK TAB ─────────────────────────────────────────────────────── */}
        {tab === 'playback' && (
          <form onSubmit={savePlayback} className="glass-strong rounded-2xl p-6 space-y-5" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Default quality</label>
              <select value={defaultQuality} onChange={e => setDefaultQuality(e.target.value)} className="input-field">
                {['Auto', '1080p', '720p', '480p', '360p'].map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Default audio language</label>
              <select value={defaultAudioLang} onChange={e => setDefaultAudioLang(e.target.value)} className="input-field">
                <option value="und">Unknown / Any</option>
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="ru">Russian</option>
                <option value="ja">Japanese</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Default subtitles</label>
              <select value={defaultSubsLang} onChange={e => setDefaultSubsLang(e.target.value)} className="input-field">
                <option value="off">Off</option>
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="ru">Russian</option>
                <option value="ja">Japanese</option>
              </select>
            </div>

            <div className="flex items-center justify-between p-3 glass rounded-lg">
              <div>
                <div className="text-sm text-cinema-text">Auto-sync on join</div>
                <div className="text-xs text-cinema-muted mt-0.5">Snap to leader's position when entering a room</div>
              </div>
              <button
                type="button"
                onClick={() => setAutoSync(!autoSync)}
                className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${autoSync ? 'bg-purple-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${autoSync ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</>
              ) : (
                <><Save size={14} />Save playback settings</>
              )}
            </button>
          </form>
        )}

        {/* ── DOWNLOADS TAB ────────────────────────────────────────────────────── */}
        {tab === 'downloads' && (
          <form onSubmit={saveDownloads} className="glass-strong rounded-2xl p-6 space-y-5" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">
                Max concurrent downloads: <span className="text-purple-400 normal-case">{maxDl}</span>
              </label>
              <input
                type="range" min={1} max={5} step={1} value={maxDl} onChange={e => setMaxDl(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
              <div className="flex justify-between text-xs text-slate-600 mt-1">
                <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
              </div>
              <p className="text-xs text-slate-600 mt-2">More concurrent downloads use more bandwidth and CPU</p>
            </div>

            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</>
              ) : (
                <><Save size={14} />Save download settings</>
              )}
            </button>
          </form>
        )}

        {/* ── ACCOUNT TAB ──────────────────────────────────────────────────────── */}
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
                    Member since {account ? new Date(account.createdAt).toLocaleDateString() : '—'}
                  </div>
                </div>
              </div>
              <button onClick={handleLogout} className="btn-secondary w-full flex items-center justify-center gap-2">
                <LogOut size={14} />
                Sign out
              </button>
            </div>

            <div className="glass-strong rounded-2xl p-6 border border-red-500/20">
              <h3 className="text-sm font-semibold text-red-400 mb-1">Danger zone</h3>
              <p className="text-xs text-cinema-muted mb-4">
                Permanently delete your account and all associated data. This cannot be undone.
              </p>
              <div className="space-y-2">
                <input
                  type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                  className="input-field text-sm" placeholder="Type DELETE to confirm"
                />
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirm !== 'DELETE' || deletingAccount}
                  className="w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all
                    bg-red-900/20 border border-red-500/30 text-red-400
                    hover:bg-red-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {deletingAccount ? 'Deleting…' : 'Delete account permanently'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
