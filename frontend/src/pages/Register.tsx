import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Film, Eye, EyeOff } from 'lucide-react'
import { useStore, apiPost } from '../store'
import { Account } from '../types'

export default function Register() {
  const navigate = useNavigate()
  const { setAccount } = useStore()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const r = await apiPost<{ user: Account; token: string }>('/api/auth/register', { username, email, password })
    setLoading(false)
    if (r.error) { setError(r.error); return }
    setAccount(r.user, r.token)
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-cinema-bg flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 right-1/3 w-96 h-96 rounded-full bg-purple-600/5 blur-3xl" />
        <div className="absolute bottom-1/3 left-1/4 w-64 h-64 rounded-full bg-blue-600/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl accent-gradient flex items-center justify-center">
            <Film size={20} className="text-white" />
          </div>
          <span className="text-2xl font-bold accent-gradient-text tracking-tight">Noctiviem</span>
        </div>

        <div className="glass-strong rounded-2xl p-8" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          <h1 className="text-xl font-bold text-cinema-text mb-1">Create account</h1>
          <p className="text-sm text-cinema-muted mb-6">Join the private cinema</p>

          {error && (
            <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2.5">
              <span>⚠</span><span>{error}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className="input-field" placeholder="yourname" required minLength={2} maxLength={32} autoFocus />
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input-field" placeholder="you@example.com" required />
            </div>

            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="input-field pr-10" placeholder="Min 6 characters" required minLength={6} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating account…
                </span>
              ) : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-cinema-muted mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
