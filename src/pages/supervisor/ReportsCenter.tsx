import { useEffect, useRef, useState } from 'react'
import { Layout } from '../../components/Layout'
import { LoadingState, EmptyState, ErrorState } from '../../components/States'
import { ReportTable, type Column } from '../../components/ReportTable'
import {
  getReportsDaily,
  getReportStudent,
  getReportCircle,
  getCircles,
  getTeachers,
  getStudents,
  getSchoolSettings,
  getErrorMessage,
  refreshAll
} from '../../data/store'
import type {
  ReportRow,
  ReportSummary,
  StudentReport,
  CircleReportRow,
  AttendanceState,
  MemorizationState,
  RevisionState,
  MasteryState
} from '../../types'
import { downloadCSV } from '../../utils/export'

const ATT_LABELS: Record<string, string> = {
  on_time: 'حاضر في الوقت',
  late: 'متأخر',
  excused_absent: 'غياب بعذر',
  not_recorded: 'لم يُسجّل'
}
const MEM_LABELS: Record<string, string> = {
  heard: 'سمع',
  not_heard: 'لم يسمع',
  not_recorded: 'لم يُسجّل'
}
const REV_LABELS: Record<string, string> = {
  reviewed: 'راجع',
  not_reviewed: 'لم يراجع',
  not_recorded: 'لم يُسجّل'
}
const MASTERY_LABELS: Record<string, string> = {
  mastered: 'متقن',
  needs_review: 'يحتاج مراجعة',
  not_evaluated: 'غير مقيّم'
}

function Badge({ kind, value }: { kind: 'att' | 'mem' | 'rev' | 'mastery'; value: string }) {
  const labels = kind === 'att' ? ATT_LABELS : kind === 'mem' ? MEM_LABELS : kind === 'rev' ? REV_LABELS : MASTERY_LABELS
  return <span className={`badge ${kind}-${value}`}>{labels[value] || value}</span>
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function SummaryCard({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={'summary-card' + (tone ? ' tone-' + tone : '')}>
      <div className="summary-value">{value}</div>
      <div className="summary-label">{label}</div>
    </div>
  )
}

function exportDailyCSV(data: { date: string; rows: ReportRow[] }) {
  const headers = [
    'الرقم',
    'اسم الطالب',
    'الكنية',
    'الحلقة',
    'المحفظ',
    'الحضور',
    'اللوح',
    'كمية المحفوظ',
    'الإتقان',
    'الورد',
    'الملاحظة'
  ]
  const rows = data.rows.map((r) => [
    r.student_code,
    r.full_name,
    r.nickname,
    r.group_name,
    r.teacher_name,
    ATT_LABELS[r.attendance],
    MEM_LABELS[r.memorization],
    r.memorization_amount,
    MASTERY_LABELS[r.mastery],
    REV_LABELS[r.revision],
    r.note
  ])
  downloadCSV(`التقرير_اليومي_${data.date}.csv`, headers, rows)
}

function exportCircleCSV(data: { students: CircleReportRow[]; from: string; to: string }) {
  const headers = [
    'الرقم',
    'اسم الطالب',
    'الكنية',
    'أيام التسجيل',
    'حضور',
    'تأخر',
    'سماع اللوح',
    'عدم السماع',
    'مراجعة',
    'عدم المراجعة',
    'نسبة الالتزام',
    'ملاحظات'
  ]
  const rows = data.students.map((r) => [
    r.student_code,
    r.full_name,
    r.nickname,
    r.days_count,
    r.on_time,
    r.late,
    r.heard,
    r.not_heard,
    r.reviewed,
    r.not_reviewed,
    r.commitment_rate + '%',
    r.important_notes.length ? `${r.important_notes.length} ملاحظة` : '—'
  ])
  downloadCSV(`تقرير_الحلقة_${data.from}_${data.to}.csv`, headers, rows)
}

function exportStudentCSV(d: StudentReport) {
  const headers = ['البند', 'القيمة']
  const rows: (string | number)[][] = [
    ['الطالب', d.full_name],
    ['الرقم', d.student_code],
    ['الحلقة', d.group_name],
    ['المحفظ', d.teacher_name],
    ['الفترة من', d.from],
    ['الفترة إلى', d.to],
    ['أيام مطلوب التسجيل فيها', d.required_days],
    ['أيام التسجيل', d.recorded_days],
    ['أيام غير مسجّلة', d.unrecorded_days],
    ['حضور في الوقت', d.on_time],
    ['تأخر', d.late],
    ['غياب بعذر', d.excused_absent],
    ['سماع اللوح', d.heard],
    ['عدم سماع اللوح', d.not_heard],
    ['مراجعة الورد', d.reviewed],
    ['عدم مراجعة', d.not_reviewed],
    ['إجمالي كمية المحفوظ', d.memorization_amount_sum]
  ]
  for (const n of d.daily_notes) rows.push([`ملاحظة ${n.date}`, n.note])
  downloadCSV(`تقرير_الطالب_${d.student_code}.csv`, headers, rows)
}

export function ReportsCenter() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'daily' | 'student' | 'circle'>('daily')

  const [circles] = useState(() => getCircles())
  const [teachers] = useState(() => getTeachers())
  const [students] = useState(() => getStudents())
  const [printMeta, setPrintMeta] = useState<any>(null)
  const [schoolName, setSchoolName] = useState('المدرسة القرآنية')

  useEffect(() => {
    getSchoolSettings().then(s => setSchoolName(s.name || 'المدرسة القرآنية')).catch(() => {})
    refreshAll()
  }, [])

  function triggerPrint(mode: 'report' | 'table') {
    const el = rootRef.current
    if (!el) return
    const cleanup = () => {
      el.classList.remove('printing', 'print-table', 'print-report')
      window.removeEventListener('afterprint', cleanup)
    }
    el.classList.add('printing', mode === 'table' ? 'print-table' : 'print-report')
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  const teacherOptions = teachers.map((t: any) => ({ value: t.id, label: t.full_name || t.name || '' }))
  const groupOptions = circles.map((g: any) => ({ value: g.id, label: g.name || '' }))
  const studentOptions = students.map((s: any) => ({ value: s.id, label: `${s.name} (${s.student_code || ''})` }))

  return (
    <Layout title="مركز التقارير" subtitle="تقارير مركزية مشتقّة من سجلات المتابعة اليومية">
      <div className="reports-root" ref={rootRef}>
        {/* رأس الطباعة (مخفي على الشاشة) */}
        <div className="print-only print-header" id="print-header">
          <div className="ph-school">{schoolName}</div>
          <div className="ph-title">{printMeta?.title || 'مركز التقارير'}</div>
          <div className="ph-meta">
            {printMeta?.date && <span>التاريخ / الفترة: {printMeta.date}</span>}
            {printMeta?.circle && <span>الحلقة: {printMeta.circle}</span>}
            {printMeta?.teacher && <span>المحفظ: {printMeta.teacher}</span>}
          </div>
        </div>
        <div className="print-only print-footer" id="print-footer">
          {printMeta?.summary && (
            <div className="pf-totals">
              <span>إجمالي الطلاب: {printMeta.summary.total_students}</span>
              <span>المسجلون: {printMeta.summary.registered}</span>
              <span>غير المسجلين: {printMeta.summary.not_registered}</span>
              <span>
                نسبة التسجيل:{' '}
                {printMeta.summary.total_students
                  ? Math.round((printMeta.summary.registered / printMeta.summary.total_students) * 100)
                  : 0}
                %
              </span>
            </div>
          )}
          <div className="pf-page">صفحة <span className="page-number" /> من <span className="total-pages" /></div>
        </div>

        <div className="tabs no-print">
          <button className={'tab' + (tab === 'daily' ? ' active' : '')} onClick={() => setTab('daily')}>
            التقرير اليومي
          </button>
          <button className={'tab' + (tab === 'student' ? ' active' : '')} onClick={() => setTab('student')}>
            تقرير الطالب الدوري
          </button>
          <button className={'tab' + (tab === 'circle' ? ' active' : '')} onClick={() => setTab('circle')}>
            تقرير الحلقة
          </button>
        </div>

        <div className="print-actions no-print">
          <button className="btn" onClick={() => triggerPrint('report')}>
            طباعة التقرير
          </button>
          <button className="btn btn-ghost" onClick={() => triggerPrint('table')}>
            طباعة الجدول
          </button>
        </div>

        {tab === 'daily' && (
          <DailyReport
            circles={groupOptions}
            teachers={teacherOptions}
            onPrintMeta={(m) => setPrintMeta(m)}
          />
        )}
        {tab === 'student' && (
          <StudentReportView students={studentOptions} onPrintMeta={(m) => setPrintMeta(m)} />
        )}
        {tab === 'circle' && (
          <CircleReportView circles={groupOptions} onPrintMeta={(m) => setPrintMeta(m)} />
        )}
      </div>
    </Layout>
  )
}

// =================== التقرير اليومي ===================
function DailyReport({
  circles,
  teachers,
  onPrintMeta
}: {
  circles: { value: string; label: string }[]
  teachers: { value: string; label: string }[]
  onPrintMeta: (m: any) => void
}) {
  const [date, setDate] = useState(todayStr())
  const [groupId, setGroupId] = useState('all')
  const [teacherId, setTeacherId] = useState('all')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')

  const [data, setData] = useState<{ date: string; summary: ReportSummary; rows: ReportRow[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getReportsDaily({ date, group_id: groupId, teacher_id: teacherId, status, q })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date, groupId, teacherId, status, q])

  useEffect(() => {
    onPrintMeta({
      title: 'التقرير اليومي لمتابعة الطلاب',
      date: date,
      circle: groupId === 'all' ? 'كل الحلقات' : circles.find((c) => c.value === groupId)?.label || '',
      teacher: teacherId === 'all' ? 'كل المحفظين' : teachers.find((t) => t.value === teacherId)?.label || '',
      summary: data?.summary
    })
  }, [data, date, groupId, teacherId, circles, teachers, onPrintMeta])

  const columns: Column<ReportRow>[] = [
    { key: 'student_code', label: 'الرقم', width: '90px', sortValue: (r) => r.student_code },
    { key: 'full_name', label: 'اسم الطالب', sortValue: (r) => r.full_name },
    { key: 'nickname', label: 'الكنية', sortValue: (r) => r.nickname },
    {
      key: 'group_name',
      label: 'الحلقة',
      filter: circles,
      sortValue: (r) => r.group_name
    },
    {
      key: 'teacher_name',
      label: 'المحفظ',
      filter: teachers,
      sortValue: (r) => r.teacher_name
    },
    {
      key: 'attendance',
      label: 'الحضور',
      filter: [
        { value: 'on_time', label: ATT_LABELS.on_time },
        { value: 'late', label: ATT_LABELS.late },
        { value: 'excused_absent', label: ATT_LABELS.excused_absent },
        { value: 'not_recorded', label: ATT_LABELS.not_recorded }
      ],
      render: (r) => <Badge kind="att" value={r.attendance} />
    },
    {
      key: 'memorization',
      label: 'اللوح',
      filter: [
        { value: 'heard', label: MEM_LABELS.heard },
        { value: 'not_heard', label: MEM_LABELS.not_heard },
        { value: 'not_recorded', label: MEM_LABELS.not_recorded }
      ],
      render: (r) => <Badge kind="mem" value={r.memorization} />
    },
    { key: 'memorization_amount', label: 'كمية المحفوظ', sortValue: (r) => r.memorization_amount },
    {
      key: 'mastery',
      label: 'الإتقان',
      filter: [
        { value: 'mastered', label: MASTERY_LABELS.mastered },
        { value: 'needs_review', label: MASTERY_LABELS.needs_review },
        { value: 'not_evaluated', label: MASTERY_LABELS.not_evaluated }
      ],
      render: (r) => <Badge kind="mastery" value={r.mastery} />
    },
    {
      key: 'revision',
      label: 'الورد',
      filter: [
        { value: 'reviewed', label: REV_LABELS.reviewed },
        { value: 'not_reviewed', label: REV_LABELS.not_reviewed },
        { value: 'not_recorded', label: REV_LABELS.not_recorded }
      ],
      render: (r) => <Badge kind="rev" value={r.revision} />
    },
    { key: 'note', label: 'الملاحظة', sortValue: (r) => r.note }
  ]

  const s = data?.summary

  return (
    <div className="report-section">
      <div className="filters-bar no-print">
        <label>
          التاريخ
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          الحلقة
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="all">كل الحلقات</option>
            {circles.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          المحفظ
          <select className="input" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="all">كل المحفظين</option>
            {teachers.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          حالة التسجيل
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">الكل</option>
            <option value="recorded">مسجّل</option>
            <option value="not_recorded">غير مسجّل</option>
          </select>
        </label>
        <label>
          بحث بالاسم أو الرقم
          <input
            className="input"
            type="search"
            value={q}
            placeholder="اكتب الاسم أو الرقم..."
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {loading && <LoadingState label="جارٍ تحميل التقرير اليومي…" />}
      {error && <ErrorState>{error}</ErrorState>}
      {!loading && !error && s && (
        <div className="export-bar no-print">
          <button className="btn btn-ghost" onClick={() => exportDailyCSV(data!)}>
            تصدير Excel
          </button>
        </div>
      )}
      {!loading && !error && s && (
        <>
          <div className="summary-cards report-summary">
            <SummaryCard label="إجمالي الطلاب" value={s.total_students} tone="total" />
            <SummaryCard label="المسجلون" value={s.registered} tone="ok" />
            <SummaryCard label="غير المسجلين" value={s.not_registered} tone="warn" />
            <SummaryCard label="حضر في الوقت" value={s.on_time} tone="ok" />
            <SummaryCard label="متأخر" value={s.late} tone="warn" />
            <SummaryCard label="سمع اللوح" value={s.heard} tone="ok" />
            <SummaryCard label="لم يسمع" value={s.not_heard} tone="warn" />
            <SummaryCard label="راجع الورد" value={s.reviewed} tone="ok" />
            <SummaryCard label="لم يراجع" value={s.not_reviewed} tone="warn" />
          </div>
          <ReportTable<ReportRow>
            columns={columns}
            rows={data!.rows}
            rowKey={(r) => r.student_id}
            rowSearchText={(r) =>
              [r.full_name, r.student_code, r.nickname, r.group_name, r.teacher_name, r.note].join(' ')
            }
            searchPlaceholder="بحث سريع في الجدول..."
          />
        </>
      )}
      {!loading && !error && !s && <EmptyState>لا توجد بيانات لعرضها</EmptyState>}
    </div>
  )
}

// =================== تقرير الطالب الدوري ===================
function StudentReportView({
  students,
  onPrintMeta
}: {
  students: { value: string; label: string }[]
  onPrintMeta: (m: any) => void
}) {
  const [studentId, setStudentId] = useState('all')
  const [range, setRange] = useState('30')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [data, setData] = useState<StudentReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (studentId === 'all') return
    if (range === 'custom') {
      if (!from) {
        setError('يرجى اختيار تاريخ البداية.')
        setLoading(false)
        return
      }
      if (!to) {
        setError('يرجى اختيار تاريخ النهاية.')
        setLoading(false)
        return
      }
      if (from > to) {
        setError('تاريخ البداية يجب أن يكون قبل تاريخ النهاية.')
        setLoading(false)
        return
      }
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getReportStudent(studentId, range, from || undefined, to || undefined)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(getErrorMessage(e, 'تعذر تحميل حصيلة الطالب')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [studentId, range, from, to])

  useEffect(() => {
    if (!data) return
    onPrintMeta({
      title: `التقرير الدوري للطالب: ${data.full_name}`,
      date: `${data.from} ← ${data.to}`,
      circle: data.group_name,
      teacher: data.teacher_name,
      summary: null
    })
  }, [data, onPrintMeta])

  const rangeLabel =
    range === '7' ? 'آخر 7 أيام' : range === '30' ? 'آخر 30 يومًا' : range === 'all' ? 'كل الفترة' : 'فترة مخصصة'

  return (
    <div className="report-section">
      <div className="filters-bar no-print">
        <label>
          الطالب
          <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="all">اختر طالبًا...</option>
            {students.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          الفترة
          <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="7">آخر 7 أيام</option>
            <option value="30">آخر 30 يومًا</option>
            <option value="all">كل الفترة</option>
            <option value="custom">مخصصة</option>
          </select>
        </label>
        {range === 'custom' && (
          <>
            <label>
              من
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              إلى
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {studentId === 'all' && <EmptyState>اختر طالبًا لعرض تقريره الدوري</EmptyState>}
      {loading && <LoadingState label="جارٍ تحميل التقرير…" />}
      {error && <ErrorState>{error}</ErrorState>}

      {data && !loading && (
        <>
          <div className="export-bar no-print">
            <button className="btn btn-ghost" onClick={() => exportStudentCSV(data)}>
              تصدير Excel
            </button>
          </div>
          <div className="period-meta report-summary">
            <span>الفترة: {rangeLabel}</span>
            <span>من: {data.from}</span>
            <span>إلى: {data.to}</span>
            <span>الحلقة: {data.group_name || '—'}</span>
            <span>المحفظ: {data.teacher_name || '—'}</span>
          </div>
          <div className="summary-cards">
            <SummaryCard label="أيام مطلوب التسجيل فيها" value={data.required_days} tone="total" />
            <SummaryCard label="أيام التسجيل" value={data.recorded_days} tone="ok" />
            <SummaryCard label="أيام غير مسجّلة" value={data.unrecorded_days} tone="warn" />
            <SummaryCard label="حضور في الوقت" value={data.on_time} tone="ok" />
            <SummaryCard label="تأخر" value={data.late} tone="warn" />
            <SummaryCard label="غياب بعذر" value={data.excused_absent} />
            <SummaryCard label="سماع اللوح" value={data.heard} tone="ok" />
            <SummaryCard label="عدم سماع اللوح" value={data.not_heard} tone="warn" />
            <SummaryCard label="مراجعة الورد" value={data.reviewed} tone="ok" />
            <SummaryCard label="عدم مراجعة" value={data.not_reviewed} tone="warn" />
            {data.memorization_amount_records > 0 && (
              <SummaryCard label="إجمالي كمية المحفوظ" value={data.memorization_amount_sum} />
            )}
          </div>
          <div className="mastery-row">
            <span>الإتقان — متقن: {data.mastery.mastered}</span>
            <span>يحتاج مراجعة: {data.mastery.needs_review}</span>
            <span>غير مقيّم: {data.mastery.not_evaluated}</span>
          </div>
          <h3 className="notes-title">الملاحظات اليومية</h3>
          {data.daily_notes.length === 0 ? (
            <EmptyState>لا توجد ملاحظات مسجّلة في الفترة</EmptyState>
          ) : (
            <ul className="notes-list">
              {data.daily_notes.map((n, i) => (
                <li key={i}>
                  <span className="note-date">{n.date}</span>
                  <span>{n.note}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

// =================== تقرير الحلقة ===================
function CircleReportView({
  circles,
  onPrintMeta
}: {
  circles: { value: string; label: string }[]
  onPrintMeta: (m: any) => void
}) {
  const [groupId, setGroupId] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [data, setData] = useState<{ group_id: string; from: string; to: string; students: CircleReportRow[] } | null>(
    null
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (groupId === 'all') return
    let cancelled = false
    setLoading(true)
    setError(null)
    getReportCircle(groupId, from || undefined, to || undefined)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(getErrorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [groupId, from, to])

  useEffect(() => {
    if (!data) return
    onPrintMeta({
      title: `تقرير الحلقة: ${circles.find((c) => c.value === data.group_id)?.label || ''}`,
      date: `${data.from} ← ${data.to}`,
      circle: circles.find((c) => c.value === data.group_id)?.label || '',
      teacher: '',
      summary: null
    })
  }, [data, circles, onPrintMeta])

  const columns: Column<CircleReportRow>[] = [
    { key: 'student_code', label: 'الرقم', width: '90px', sortValue: (r) => r.student_code },
    { key: 'full_name', label: 'اسم الطالب', sortValue: (r) => r.full_name },
    { key: 'nickname', label: 'الكنية', sortValue: (r) => r.nickname },
    { key: 'days_count', label: 'أيام التسجيل', align: 'center', sortValue: (r) => r.days_count },
    { key: 'on_time', label: 'حضور', align: 'center', sortValue: (r) => r.on_time },
    { key: 'late', label: 'تأخر', align: 'center', sortValue: (r) => r.late },
    { key: 'heard', label: 'سماع اللوح', align: 'center', sortValue: (r) => r.heard },
    { key: 'not_heard', label: 'عدم السماع', align: 'center', sortValue: (r) => r.not_heard },
    { key: 'reviewed', label: 'مراجعة', align: 'center', sortValue: (r) => r.reviewed },
    { key: 'not_reviewed', label: 'عدم المراجعة', align: 'center', sortValue: (r) => r.not_reviewed },
    {
      key: 'commitment_rate',
      label: 'نسبة الالتزام',
      align: 'center',
      sortValue: (r) => r.commitment_rate,
      render: (r) => <span className={'commitment ' + (r.commitment_rate >= 75 ? 'high' : r.commitment_rate >= 50 ? 'mid' : 'low')}>{r.commitment_rate}%</span>
    },
    {
      key: 'notes',
      label: 'ملاحظات مهمة',
      sortValue: (r) => r.important_notes.length,
      render: (r) => (r.important_notes.length ? <span className="note-count">{r.important_notes.length} ملاحظة</span> : '—')
    }
  ]

  return (
    <div className="report-section">
      <div className="filters-bar no-print">
        <label>
          الحلقة
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="all">اختر حلقة...</option>
            {circles.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          من
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          إلى
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {groupId === 'all' && <EmptyState>اختر حلقة لعرض تقرير أدائها</EmptyState>}
      {loading && <LoadingState label="جارٍ تحميل التقرير…" />}
      {error && <ErrorState>{error}</ErrorState>}

      {data && !loading && (
        <>
          <div className="export-bar no-print">
            <button className="btn btn-ghost" onClick={() => exportCircleCSV(data)}>
              تصدير Excel
            </button>
          </div>
          <div className="period-meta report-summary">
            <span>الفترة: من {data.from} إلى {data.to}</span>
            <span>عدد الطلاب: {data.students.length}</span>
          </div>
          <ReportTable<CircleReportRow>
            columns={columns}
            rows={data.students}
            rowKey={(r) => r.student_id}
            rowSearchText={(r) => [r.full_name, r.student_code, r.nickname].join(' ')}
            searchPlaceholder="بحث في طلاب الحلقة..."
          />
        </>
      )}
    </div>
  )
}
