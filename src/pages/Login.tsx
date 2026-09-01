import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth, defaultPathForRole } from '../auth/AuthContext'
import { IconLogout } from '../components/icons'

export function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (user) {
    return <Navigate to={defaultPathForRole(user.role)} replace />
  }

  const from = (location.state as { from?: string })?.from

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await login(username, password)
    setLoading(false)
    if (res.ok && res.user) {
      navigate(from ?? defaultPathForRole(res.user.role), { replace: true })
    } else {
      setError(res.error ?? 'تعذر تسجيل الدخول')
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.svg" alt="شعار المدرسة" width={44} height={44} />
        </div>
        <div className="auth-title">نظام إدارة المدرسة القرآنية</div>
        <div className="auth-sub">سجّل الدخول للوصول إلى لوحة العمل الخاصة بك</div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="username">اسم المستخدم أو البريد الإلكتروني</label>
            <input
              id="username"
              className="input"
              type="text"
              autoComplete="username"
              placeholder="مثال: admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="field" style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="password">كلمة المرور</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={loading}>
            <IconLogout size={18} style={{ marginLeft: 6 }} />
            {loading ? 'جارٍ الدخول…' : 'تسجيل الدخول'}
          </button>
        </form>

        <div className="auth-footer">
          <a href="/about">تواصل معنا</a>
        </div>
      </div>
    </div>
  )
}
