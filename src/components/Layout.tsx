import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useDeviceMode } from '../hooks/useDeviceMode'
import { getSchoolSettings } from '../data/store'
import type { Role } from '../types'
import {
  IconDashboard,
  IconStudents,
  IconCircles,
  IconTeachers,
  IconLogout,
  IconMenu,
  IconCalendar,
  IconReports,
  IconSettings,
  IconData,
  IconClose,
  IconInfo
} from './icons'
import { UpdateBanner } from './UpdateBanner'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

interface NavGroup {
  section: string
  items: NavItem[]
}

const NAV: Record<Role, NavGroup[]> = {
  supervisor: [
    {
      section: 'الرئيسية',
      items: [{ to: '/supervisor/dashboard', label: 'لوحة التحكم', icon: <IconDashboard /> }]
    },
    {
      section: 'الإدارة',
      items: [
        { to: '/supervisor/students', label: 'الطلاب', icon: <IconStudents /> },
        { to: '/supervisor/circles', label: 'الحلقات', icon: <IconCircles /> },
        { to: '/supervisor/teachers', label: 'المعلمون', icon: <IconTeachers /> },
        { to: '/supervisor/audit', label: 'سجل التغييرات', icon: <IconCalendar /> }
      ]
    },
    {
      section: 'إدارة البيانات',
      items: [{ to: '/supervisor/data-management', label: '🗃️ إدارة البيانات', icon: <IconData /> }]
    },
    {
      section: 'التقارير',
      items: [{ to: '/supervisor/reports', label: 'مركز التقارير', icon: <IconReports /> }]
    },
    {
      section: 'إدارة البيانات',
      items: [{ to: '/supervisor/data-management', label: 'إدارة البيانات', icon: <IconData /> }]
    },
    {
      section: 'المساعدة والتطبيق',
      items: [{ to: '/about', label: 'حول التطبيق', icon: <IconInfo /> }]
    }
  ],
  teacher: [
    {
      section: 'الرئيسية',
      items: [{ to: '/teacher/dashboard', label: 'لوحة التحكم', icon: <IconDashboard /> }]
    },
    {
      section: 'عملي',
      items: [
        { to: '/teacher/students', label: 'طلابي', icon: <IconStudents /> },
        { to: '/teacher/circles', label: 'حلقاتي', icon: <IconCircles /> },
        { to: '/teacher/daily', label: 'التسجيل اليومي', icon: <IconCalendar /> }
      ]
    },
    {
      section: 'المساعدة والتطبيق',
      items: [{ to: '/about', label: 'حول التطبيق', icon: <IconInfo /> }]
    }
  ]
}

function initials(name: string): string {
  const parts = name.replace(/^أ\.?\s*/, '').trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

export function Layout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [schoolName, setSchoolName] = useState('المدرسة القرآنية')
  useDeviceMode()

  useEffect(() => {
    getSchoolSettings().then(s => setSchoolName(s.name || 'المدرسة القرآنية')).catch(() => {})
  }, [])

  if (!user) return null

  const groups = NAV[user.role]

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const renderNav = (groups: NavGroup[]) =>
    groups.map((g) => (
      <div key={g.section}>
        <div className="nav-section">{g.section}</div>
        {g.items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            onClick={() => setDrawer(false)}
          >
            {it.icon}
            <span>{it.label}</span>
          </NavLink>
        ))}
      </div>
    ))

  return (
    <div className="app-shell">
      <aside className={'sidebar' + (drawer ? ' open' : '')}>
        <div className="sidebar-brand">
          <div className="logo">
            <img src="/logo.svg" alt="شعار المدرسة" width={28} height={28} />
          </div>
          <div>
            <div className="brand-name">{schoolName}</div>
            <div className="brand-sub">نظام الإدارة</div>
          </div>
        </div>
        <nav className="nav">{renderNav(groups)}</nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="avatar">{initials(user.name)}</div>
            <div>
              <div className="name">{user.name}</div>
              <div className="role">{user.role === 'supervisor' ? 'مشرف' : 'معلم'}</div>
            </div>
          </div>
          <button className="btn-logout" onClick={handleLogout}>
            <IconLogout size={18} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
        <button
          className="icon-btn"
          style={{ position: 'absolute', insetInlineEnd: 10, top: 14, display: drawer ? 'grid' : 'none' }}
          onClick={() => setDrawer(false)}
          aria-label="إغلاق"
        >
          <IconClose />
        </button>
      </aside>

      <div className={'backdrop' + (drawer ? ' show' : '')} onClick={() => setDrawer(false)} />

      <div className="main">
        <header className="topbar">
          <div className="row gap-2">
            <button className="menu-btn" onClick={() => setDrawer(true)} aria-label="القائمة">
              <IconMenu />
            </button>
            <div>
              <h1>{title}</h1>
              {subtitle && <div className="sub">{subtitle}</div>}
            </div>
          </div>
        </header>
        <UpdateBanner />
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
