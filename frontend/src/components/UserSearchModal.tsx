import { useState, useCallback } from 'react'
import { X, Search, UserPlus, UserMinus, Loader } from 'lucide-react'
import { useStore, apiFetch, apiPost, apiDelete } from '../store'
import { translations } from '../i18n'
import Avatar from './Avatar'

interface SearchUser {
  id: string
  username: string
  nickname: string
  avatarSeed: string
  avatarStyle: string
}

interface UserSearchModalProps {
  onClose: () => void
}

export default function UserSearchModal({ onClose }: UserSearchModalProps) {
  const { lang, account } = useStore()
  const t = translations[lang]
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchUser[]>([])
  const [loading, setLoading] = useState(false)
  const [friendStates, setFriendStates] = useState<Record<string, 'adding' | 'removing' | null>>({})
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const r = await apiFetch<{ users: SearchUser[] }>(`/api/users/search?q=${encodeURIComponent(q)}`)
      if (r.users) setResults(r.users.filter(u => u.id !== account?.id))
    } catch {}
    setLoading(false)
  }, [account?.id])

  const handleQueryChange = (v: string) => {
    setQuery(v)
    search(v)
  }

  const handleAddFriend = async (userId: string) => {
    setFriendStates(s => ({ ...s, [userId]: 'adding' }))
    await apiPost(`/api/users/${userId}/friend`, {})
    setAddedIds(s => new Set([...s, userId]))
    setFriendStates(s => ({ ...s, [userId]: null }))
  }

  const handleRemoveFriend = async (userId: string) => {
    setFriendStates(s => ({ ...s, [userId]: 'removing' }))
    await apiDelete(`/api/users/${userId}/friend`)
    setAddedIds(s => { const n = new Set(s); n.delete(userId); return n })
    setFriendStates(s => ({ ...s, [userId]: null }))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-cinema-text">{t.findFriends}</h2>
          <button onClick={onClose} className="btn-ghost p-2">
            <X size={18} />
          </button>
        </div>

        {/* Search input */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            className="input-field w-full text-sm"
            placeholder={t.searchUsers}
            autoFocus
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>

        {/* Results */}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-6">
              <Loader size={20} className="text-purple-400 animate-spin" />
            </div>
          )}
          {!loading && query.length < 2 && (
            <p className="text-xs text-cinema-muted text-center py-4">{t.searchMin2}</p>
          )}
          {!loading && query.length >= 2 && results.length === 0 && (
            <p className="text-xs text-cinema-muted text-center py-4">{t.noUsersFound}</p>
          )}
          {results.map(user => {
            const style = user.avatarStyle || 'thumbs'
            const isFriend = addedIds.has(user.id)
            const busy = !!friendStates[user.id]
            return (
              <div
                key={user.id}
                className="flex items-center gap-3 p-3 glass rounded-lg border border-white/5"
              >
                <Avatar
                  seed={user.avatarSeed || user.id}
                  name={user.nickname}
                  src={`https://api.dicebear.com/7.x/${style}/svg?seed=${user.avatarSeed || user.id}&backgroundColor=7c3aed,3b82f6`}
                  size={36}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-cinema-text truncate">{user.nickname}</div>
                  <div className="text-xs text-cinema-muted">@{user.username}</div>
                </div>
                {isFriend ? (
                  <button
                    onClick={() => handleRemoveFriend(user.id)}
                    disabled={busy}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-cinema-muted hover:text-red-400 hover:border-red-500/30 transition-all disabled:opacity-50"
                  >
                    {busy ? <Loader size={11} className="animate-spin" /> : <UserMinus size={11} />}
                    {t.removeFriend}
                  </button>
                ) : (
                  <button
                    onClick={() => handleAddFriend(user.id)}
                    disabled={busy}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-all disabled:opacity-50"
                  >
                    {busy ? <Loader size={11} className="animate-spin" /> : <UserPlus size={11} />}
                    {t.addFriend}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
