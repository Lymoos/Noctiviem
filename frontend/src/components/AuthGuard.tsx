import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useStore, apiFetch } from '../store'
import { Account } from '../types'

export default function AuthGuard() {
  const { isAuthenticated, account, setAccount, logout } = useStore()
  const [checking, setChecking] = useState(!account && isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated || account) { setChecking(false); return }
    apiFetch<{ user: Account }>('/api/auth/me')
      .then(r => {
        if (r.error || !r.user) { logout(); }
        else { setAccount(r.user, localStorage.getItem('noctiviem_token')!) }
        setChecking(false)
      })
      .catch(() => { logout(); setChecking(false) })
  }, [isAuthenticated, account, setAccount, logout])

  if (checking) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
