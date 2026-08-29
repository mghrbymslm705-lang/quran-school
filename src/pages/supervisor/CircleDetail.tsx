import { useMemo, useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { useSchoolData } from '../../data/useSchoolData'
import { getStudents, getCircle, getTeacher, refreshAll, getGroupTeacherHistory } from '../../data/store'
import { AttendanceChip, MemorizationChip, RevisionChip } from '../../components/StatusChips'
import { DailyEditModal } from '../../components/DailyEditModal'
import { initials } from '../../components/ui'
import { IconCalendar } from '../../components/icons'
import type { Student } from '../../types'
import type { DailyHistoryRow, AssignmentHistoryRow } from '../../data/store'

const FILTERS = [
  { v: 'all', label: 'جميع الطلاب' },
  { v: 'not_recorded', label: 'لم يسجّل' },
  { v: 'on_time', label: 'حضر في الوقت' },
  { v: 'not_on_time', label: 'لم يحضر في الوقت' },
  { v: 'heard', label: 'سمع اللوح' },
  { v: 'not_heard', label: 'لم يسمع اللوح' },
  { v: 'reviewed', label: 'راجع الورد' },
  { v: 'not_reviewed', label: 'لم يراجع' }
] as const

type FilterV = (typeof FILTERS)[number]['v']

// السجل "مكتمل" فقط إذا سُجّلت المحاور الثلاثة كلها (وليست "غير مسجّل").
// تسجيل الحضور فقط مع ترك اللوح/الورد يبقى "غير مكتمل".
function isComplete(rec?: DailyHistoryRow): boolean {
  if (!rec) return false
  const a = rec.attendance_status
  const m = rec.memorization_status
  const r = rec.revision_status
  return !!a && a !== 'not_recorded' && !!m && m !== 'not_recorded' && !!r && r !== 'not_recorded'
}

function matchesFilter(f: FilterV, rec?: DailyHistoryRow): boolean {
  if (f === 'all') return true
  if (f === 'not_recorded') return !rec
  if (!rec) return false
  switch (f) {
    case 'on_time':
      return rec.attendance_status === 'on_time'
    case 'not_on_time':
      return rec.attendance_status === 'late' || rec.attendance_status === 'excused_absent'
    case 'heard':
      return rec.memorization_status === 'heard'
    case 'not_heard':
      return rec.memorization_status === 'not_heard'
    case 'reviewed':
      return rec.revision_status === 'reviewed'
    case 'not_reviewed':
      return rec.revision_status === 'not_reviewed'
  }
  return true
}

export function CircleDetail() {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const date = params.get('date') || new Date().toISOString().slice(0, 10)
  const [filter, setFilter] = useState<FilterV>('all')
  const [query, setQuery] = useState('')
  const [editStudent, setEditStudent] = useState<Student | null>(null)
  const [editRec, setEditRec] = useState<DailyHistoryRow | undefined>()

  const data = useSchoolData((d) => ({
    students: getStudents(id ? { circleIds: [id] } : undefined),
    circles: d.circles,
    daily: d.daily
  }))
  const circle = data.circles.find((c) => c.id === id)
  const teacherName = circle ? getTeacher(circle.teacherId)?.name : '—'
  const [teacherHistory, setTeacherHistory] = useState<AssignmentHistoryRow[]>([])
  useEffect(() => {
    if (!id) return
    getGroupTeacherHistory(id).then(setTeacherHistory).catch(() => setTeacherHistory([]))
  }, [id])

  useEffect(() => {
    setParams((p) => {
      p.set('date', date)
      return p
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const recMap = useMemo(() => {
    const m = new Map<string, DailyHistoryRow>()
    for (const r of data.daily as DailyHistoryRow[]) {
      if (r.group_id === id && r.record_date === date) m.set(r.student_id, r)
    }
    return m
  }, [data.daily, id, date])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.students
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .filter((s) => matchesFilter(filter, recMap.get(s.id)))
      .map((s) => ({ student: s, rec: recMap.get(s.id) }))
  }, [data.students, query, filter, recMap])

  const openEdit = (student: Student, rec?: DailyHistoryRow) => {
    setEditStudent(student)
    setEditRec(rec)
  }

  return (
    <Layout title={circle?.name || 'تفاصيل الحلقة'} subtitle="متابعة تفصيلية للحلقة">
      <div className="page-head">
        <div>
          <h2>{circle?.name || '—'}</h2>
          <p>
            المعلم: {teacherName} · {data.students.length} طالب · التاريخ: {date}
          </p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label>التاريخ</label>
            <input className="input" type="date" dir="ltr" value={date} onChange={(e) => setParams((p) => { p.set('date', e.target.value); return p })} />
          </div>
          <button className="btn btn-soft" onClick={() => refreshAll()}>
            تحديث
          </button>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>
            رجوع
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row gap-2 wrap">
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <input className="input" placeholder="بحث سريع باسم الطالب…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="row gap-2 wrap" style={{ marginTop: '0.6rem' }}>
          {FILTERS.map((f) => (
            <button key={f.v} className={'chip-filter' + (filter === f.v ? ' is-on' : '')} onClick={() => setFilter(f.v)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>الطالب</th>
              <th>الحضور</th>
              <th>اللوح</th>
              <th>الورد</th>
              <th>الملاحظة</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, rec }) => {
              const note = [rec?.attendance_note, rec?.memorization_note, rec?.revision_note].find((n) => n && n.trim())
              return (
                <tr key={student.id}>
                  <td>
                    <button className="link-btn" onClick={() => navigate('/supervisor/student/' + student.id + '?date=' + date)}>
                      <span className="avatar avatar-sm">{initials(student.name)}</span>
                      <span>{student.name}</span>
                    </button>
                  </td>
                  <td><AttendanceChip status={rec?.attendance_status || 'not_recorded'} /></td>
                  <td><MemorizationChip status={rec?.memorization_status || 'not_recorded'} /></td>
                  <td><RevisionChip status={rec?.revision_status || 'not_recorded'} /></td>
                   <td className="muted" style={{ fontSize: '0.82rem' }}>{note || '—'}</td>
                   <td>
                     {isComplete(rec) ? (
                       <span className="chip chip-success">مكتمل</span>
                     ) : rec ? (
                       <span className="chip chip-warning">غير مكتمل</span>
                     ) : (
                       <span className="chip chip-ghost">لم يُسجَّل</span>
                     )}
                   </td>
                  <td>
                    <button className="btn btn-soft btn-sm" onClick={() => openEdit(student, rec)}>
                      تعديل التسجيل
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  لا يوجد طلاب مطابقون.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>سجل إسناد المعلمين</h3>
        {teacherHistory.length === 0 ? (
          <div className="empty">لا يوجد سجل إسناد.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>المعلم</th><th>من</th><th>إلى</th><th>السبب</th></tr>
              </thead>
              <tbody>
                {teacherHistory.map((h) => (
                  <tr key={h.id}>
                    <td>{h.teacher_name || '—'}</td>
                    <td>{h.start_date ? h.start_date.slice(0, 10) : '—'}</td>
                    <td>{h.end_date ? h.end_date.slice(0, 10) : 'الآن'}</td>
                    <td className="muted">{h.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editStudent && (
        <DailyEditModal
          student={editStudent}
          date={date}
          existing={editRec}
          onClose={() => setEditStudent(null)}
          onSaved={() => refreshAll()}
        />
      )}
    </Layout>
  )
}
