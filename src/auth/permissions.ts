import type { Role } from '../types'

// تعريف الصلاحيات: كل مسار يسمح بأدوار محددة.
// المشرف (supervisor) يصل إلى كل الصفحات.
// المعلم (teacher) يقتصر على صفحاته فقط.

export interface RoutePermission {
  path: string
  allowedRoles: Role[]
  label: string
}

export const ROUTE_PERMISSIONS: RoutePermission[] = [
  { path: '/supervisor/dashboard', allowedRoles: ['supervisor'], label: 'لوحة المشرف' },
  { path: '/supervisor/students', allowedRoles: ['supervisor'], label: 'إدارة الطلاب' },
  { path: '/supervisor/circles', allowedRoles: ['supervisor'], label: 'إدارة الحلقات' },
  { path: '/supervisor/teachers', allowedRoles: ['supervisor'], label: 'إدارة المعلمين' },
  { path: '/supervisor/reports', allowedRoles: ['supervisor'], label: 'مركز التقارير' },
  { path: '/supervisor/settings', allowedRoles: ['supervisor'], label: 'الإعدادات' },
  { path: '/teacher/dashboard', allowedRoles: ['teacher', 'supervisor'], label: 'لوحة المعلم' },
  { path: '/teacher/students', allowedRoles: ['teacher', 'supervisor'], label: 'طلابي' },
  { path: '/teacher/circles', allowedRoles: ['teacher', 'supervisor'], label: 'حلقاتي' },
  { path: '/teacher/daily', allowedRoles: ['teacher', 'supervisor'], label: 'التسجيل اليومي' }
]

export function canAccess(role: Role, pathname: string): boolean {
  const match = ROUTE_PERMISSIONS.find((r) => pathname.startsWith(r.path))
  if (!match) return true
  return match.allowedRoles.includes(role)
}
