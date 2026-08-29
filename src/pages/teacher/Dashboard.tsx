import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Layout } from '../../components/Layout'
import { useSchoolData } from '../../data/useSchoolData'
import { getTeacher, getCircles, getTodayStats } from '../../data/store'
import { IconCalendar, IconStudents, IconCircles, IconCheck, IconUser } from '../../components/icons'

export function TeacherDashboard() {
  const { user } = useAuth()

  const data = useSchoolData((d) => {
    const teacher = getTeacher(user?.teacherId)
    const circles = getCircles({ teacherId: teacher?.id })
    const circleIds = circles.map((c) => c.id)
    return {
      teacher,
      circles,
      stats: getTodayStats({ circleIds }),
      totalStudents: circles.reduce((acc, c) => acc + c.studentIds.length, 0)
    }
  })

  const cards = useMemo(
    () => [
      { label: 'حلقاتي', value: data.circles.length, icon: <IconCircles /> },
      { label: 'طلابي', value: data.totalStudents, icon: <IconUser /> },
      { label: 'الحاضرون اليوم', value: data.stats.presentToday, icon: <IconCheck />, tone: 'success' as const },
      { label: 'سمعوا اللوح اليوم', value: data.stats.heardLuhToday, icon: <IconCheck />, tone: 'success' as const }
    ],
    [data]
  )

  return (
    <Layout title="لوحة تحكم المعلم" subtitle={`أهلاً، ${user?.name ?? ''}`}>
      <div className="page-head">
        <h2>نظرة عامة</h2>
        <p>ملخّص حلقاتك وطلابك لليوم.</p>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="row gap-3" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{user?.name}</div>
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              الحلقات المسندة: {data.circles.map((c) => c.name).join('، ') || 'لا توجد حلقات'}
            </div>
          </div>
          <div className="row gap-2 wrap">
            <Link to="/teacher/daily" className="btn btn-primary">
              <IconCalendar size={18} />
              التسجيل اليومي
            </Link>
            <Link to="/teacher/students" className="btn btn-soft">
              <IconStudents size={18} />
              الطلاب
            </Link>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        {cards.map((c) => (
          <div key={c.label} className={'stat-card' + (c.tone ? ' is-' + c.tone : '')}>
            <div className="stat-icon">{c.icon}</div>
            <div className="stat-body">
              <div className="stat-value">{c.value}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  )
}
