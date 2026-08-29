import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth, defaultPathForRole } from './AuthContext'
import type { Role } from '../types'

// حماية المسارات: تمنع الوصول لمن ليس لديه الصلاحية المناسب.
export function ProtectedRoute({
  allow,
  children
}: {
  allow: Role[]
  children: ReactNode
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="centered-screen">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!allow.includes(user.role)) {
    // منع المعلم من الوصول لصفحات المشرف (وإعادته للوحة الخاصة به)
    return <Navigate to={defaultPathForRole(user.role)} replace />
  }

  return <>{children}</>
}
