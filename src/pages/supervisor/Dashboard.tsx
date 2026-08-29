import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Layout } from '../../components/Layout'
import { getDailySummary, type DailySummary, type CircleSummary } from '../../data/store'
import { LoadingState, ErrorState, EmptyState } from '../../components/States'
import { IconStudents, IconCheck, IconX, IconBook, IconUser, IconCalendar, IconCircles, IconTeachers } from '../../components/icons'

const today = () => new Date().toISOString().slice(0, 10)

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className={'stat-card' + (tone ? ' is-' + tone : '')}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

export function SupervisorDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [date, setDate] = useState(today())
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getDailySummary({ date })
      .then((s) => {
        if (!active) return
        setSummary(s)
      })
      .catch(() => {
        if (!active) return
        setError('تعذر تحميل الملخّص. تأكد من اتصال الخادم.')
        setSummary(null)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [date])

  const s = summary
  const total = s?.total_students ?? 0
  const registered = s?.registered ?? 0
  const completion = total > 0 ? Math.round((registered / total) * 100) : 0
  const notOnTime = (s?.late ?? 0) + (s?.excused ?? 0)

  // الحلقات المكتملة = كل طلابها لديهم سجل في هذا التاريخ
  const circles = s?.circles ?? []
  const completedCircles = circles.filter((c) => c.total_students > 0 && c.registered >= c.total_students).length
  const incompleteCircles = circles.filter((c) => c.registered < c.total_students).length
  const incompleteNames = circles.filter((c) => c.registered < c.total_students).map((c) => c.name)

  const cards = useMemo(
    (): { label: string; value: number; icon: React.ReactNode; tone?: 'success' | 'warning' | 'danger' }[] => [
      { label: 'إجمالي الطلاب', value: total, icon: <IconStudents /> },
      { label: 'سجّلوا اليوم', value: registered, icon: <IconCheck />, tone: 'success' },
      { label: 'لم يسجّلوا', value: s?.not_registered ?? 0, icon: <IconUser />, tone: 'danger' },
      { label: 'حضروا في الوقت', value: s?.on_time ?? 0, icon: <IconCheck />, tone: 'success' },
      { label: 'لم يحضروا في الوقت', value: notOnTime, icon: <IconX />, tone: 'warning' },
      { label: 'سمعوا اللوح', value: s?.heard ?? 0, icon: <IconBook />, tone: 'success' },
      { label: 'لم يسمعوا اللوح', value: s?.not_heard ?? 0, icon: <IconBook />, tone: 'warning' },
      { label: 'راجعوا الورد', value: s?.reviewed ?? 0, icon: <IconCheck />, tone: 'success' },
      { label: 'لم يراجعوا', value: s?.not_reviewed ?? 0, icon: <IconX />, tone: 'warning' }
    ],
    [s, total, registered, notOnTime]
  )

  return (
    <Layout title="لوحة متابعة المدرسة" subtitle={`أهلاً، ${user?.name ?? ''}`}>
      <div className="page-head">
        <h2>لوحة متابعة المدرسة</h2>
        <p>حالة المدرسة ليوم محدد — البيانات حقيقية ومتّصلة بقاعدة البيانات.</p>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field" style={{ minWidth: 200 }}>
            <label>التاريخ المحدد</label>
            <input className="input" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button className="btn btn-soft" onClick={() => setDate(today())}>
            اليوم
          </button>
        </div>
      </div>

      {loading && <LoadingState label="جارٍ تحميل ملخّص اليوم…" />}
      {error && <ErrorState>{error}</ErrorState>}

      {!loading && !error && (
       <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
          <span className="chip chip-success">اكتمل تسجيل {completedCircles} من {circles.length} حلقة</span>
          {incompleteCircles > 0 && (
            <span className="chip chip-warning">غير مكتملة: {incompleteNames.join('، ')}</span>
          )}
        </div>
      </div>

      <div className="stat-grid">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} />
        ))}
      </div>

      <div className="card" style={{ marginTop: '1.25rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <strong>نسبة اكتمال التسجيل اليومي</strong>
          <span>
            {registered} من {total} — <strong>{completion}%</strong>
          </span>
        </div>
        <div className="progress">
          <div className="progress-bar" style={{ width: completion + '%' }} />
        </div>
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
          الحساب: عدد الطلاب الذين لديهم سجل يومي ÷ إجمالي الطلاب النشطين × 100. «لم يسجّل» يختلف عن «غائب/لم يسمع/لم يراجع».
        </div>
      </div>

      <div className="page-head" style={{ marginTop: '1.5rem' }}>
        <h3>متابعة الحلقات</h3>
        <p>الحلقات النشطة. اضغط الحلقة لعرض طلابها وتفاصيلها.</p>
      </div>

      <div className="grid-circles">
        {(s?.circles ?? []).map((c: CircleSummary) => {
          const comp = c.total_students > 0 ? Math.round((c.registered / c.total_students) * 100) : 0
          const notOn = c.late + c.excused
          return (
            <div key={c.id} className="circle-card" onClick={() => navigate('/supervisor/circle/' + c.id + '?date=' + date)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="item-title">{c.name}</div>
                <span className="badge badge-muted">
                  <IconTeachers size={14} /> {c.teacher_name || '—'}
                </span>
              </div>
              <div className="muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0 0.6rem' }}>
                {c.total_students} طالب · سجّل {c.registered} · لم يسجّل {c.not_registered}
              </div>
              <div className="mini-stats">
                <span className="chip chip-success">في الوقت {c.on_time}</span>
                <span className="chip chip-warning">متأخر/بعيد/عذر {notOn}</span>
                <span className="chip chip-success">سمع {c.heard}</span>
                <span className="chip chip-warning">لم يسمع {c.not_heard}</span>
                <span className="chip chip-success">راجع {c.reviewed}</span>
                <span className="chip chip-warning">لم يراجع {c.not_reviewed}</span>
              </div>
              <div className="progress" style={{ marginTop: '0.6rem' }}>
                <div className="progress-bar" style={{ width: comp + '%' }} />
              </div>
            </div>
          )
        })}
        {(s?.circles ?? []).length === 0 && <div className="empty">لا توجد حلقات نشطة.</div>}
      </div>
       </>
      )}
    </Layout>
  )
}
