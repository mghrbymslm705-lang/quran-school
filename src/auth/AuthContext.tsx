import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role, User } from '../types'
import { loginRequest, fetchMe, setToken } from '../data/store'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string; user?: User }>
  logout: () => void
  updateUser: (data: Partial<User>) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function toUser(raw: any): User {
  return {
    id: raw.id,
    username: raw.username,
    email: raw.email,
    password: '',
    name: raw.full_name ?? raw.name,
    role: raw.role as Role,
    active: raw.status !== 'inactive',
    teacherId: raw.teacherId ?? null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMe()
      .then((raw) => setUser(raw ? toUser(raw) : null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    try {
      const res = await loginRequest(username, password)
      const u = toUser(res.user)
      setUser(u)
      return { ok: true, user: u }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'تعذر تسجيل الدخول' }
    }
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  const updateUser = (data: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...data } : prev))
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function defaultPathForRole(role: Role): string {
  return role === 'supervisor' ? '/supervisor/dashboard' : '/teacher/dashboard'
}
