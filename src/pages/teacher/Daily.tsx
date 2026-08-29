import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { Layout } from '../../components/Layout'
import { useSchoolData } from '../../data/useSchoolData'
import { getTeacher, getCircles, getDailyRecord, saveDailyBulk, getDailySummary, type DailySummary } from '../../data/store'
import type { AttendanceState, MemorizationState, RevisionState, MasteryState, DailyEntry, Student } from '../../types'
import { initials } from '../../components/ui'
import { IconCheck, IconBook, IconSearch, IconCalendar, IconUser } from '../../components/icons'

const ATT_OPTIONS: { v: AttendanceState; label: string; cls: string }[] = [
  { v: 'on_time', label: 'في الوقت', cls: 'badge-success' },
  { v: 'late', label: 'متأخر', cls: 'badge-warning' },
  { v: 'excused_absent', label: 'بعذر', cls: 'badge-muted' }
]
const MEM_OPTIONS: { v: MemorizationState; label: string; cls: string }[] = [
  { v: 'heard', label: 'سمع', cls: 'badge-success' },
  { v: 'not_heard', label: 'لم يسمع', cls: 'badge-warning' }
]
const REV_OPTIONS: { v: RevisionState; label: string; cls: string }[] = [
  { v: 'reviewed', label: 'راجع', cls: 'badge-success' },
  { v: 'not_reviewed', label: 'لم يراجع', cls: 'badge-warning' }
]
const MASTERY_OPTIONS: { v: MasteryState; label: string }[] = [
  { v: 'not_evaluated', label: 'غير مقيّم' },
  { v: 'mastered', label: 'متقن' },
  { v: 'needs_review', label: 'يحتاج مراجعة' }
]

const todayLocal = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function defaultEntry(id: string): DailyEntry {
  return {
    studentId: id,
    attendance: 'not_recorded',
    attendanceNote: '',
    memorization: 'not_recorded',
    memorizationAmount: '',
    memorizationMastery: 'not_evaluated',
    memorizationNote: '',
    revision: 'not_recorded',
    revisionNote: '',
    note: ''
  }
}

function isRecorded(e?: DailyEntry): boolean {
  if (!e) return false
  return (
    e.attendance !== 'not_recorded' ||
    e.memorization !== 'not_recorded' ||
    e.revision !== 'not_recorded' ||
    !!(e.note && e.note.trim())
  )
}

function glyph(value: string): { sym: string; cls: string } {
  if (value === 'on_time' || value === 'heard' || value === 'reviewed') return { sym: '✓', cls: 'ok' }
  if (value === 'late' || value === 'excused_absent' || value === 'not_heard' || value === 'not_reviewed')
    return { sym: '×', cls: 'no' }
  return { sym: '—', cls: 'na' }
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { v: T; label: string; cls: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={'seg-btn' + (value === o.v ? ' is-on ' + o.cls : '')}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
      <button
        type="button"
        className={'seg-btn' + (value === 'not_recorded' ? ' is-on badge-muted' : '')}
        onClick={() => onChange('not_recorded' as T)}
        title="غير مسجّل"
      >
        ×
      </button>
    </div>
  )
}

const FILTERS = [
  { v: 'all', label: 'الكل' },
  { v: 'unrecorded', label: 'غير المسجل' },
  { v: 'on_time', label: 'حضر في الوقت' },
  { v: 'late', label: 'لم يحضر في الوقت' },
  { v: 'heard', label: 'سمع اللوح' },
  { v: 'not_heard', label: 'لم يسمع' },
  { v: 'reviewed', label: 'راجع الورد' },
  { v: 'not_reviewed', label: 'لم يراجع' }
] as const

type FilterV = (typeof FILTERS)[number]['v']

function matchesFilter(f: FilterV, e?: DailyEntry): boolean {
  if (f === 'all') return true
  if (f === 'unrecorded') return !isRecorded(e)
  if (!e) return false
  if (f === 'on_time') return e.attendance === 'on_time'
  if (f === 'late') return e.attendance === 'late' || e.attendance === 'excused_absent'
  if (f === 'heard') return e.memorization === 'heard'
  if (f === 'not_heard') return e.memorization === 'not_heard'
  if (f === 'reviewed') return e.revision === 'reviewed'
  if (f === 'not_reviewed') return e.revision === 'not_reviewed'
  return true
}

export function TeacherDaily() {
  const { user } = useAuth()
  const teacher = getTeacher(user?.teacherId)
  const circles = getCircles({ teacherId: teacher?.id })
  const allStudents = useSchoolData((d) => d.students)

  const [circleId, setCircleId] = useState(circles[0]?.id ?? '')
  const [date, setDate] = useState(todayLocal())
  const [entries, setEntries] = useState<Record<string, DailyEntry>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterV>('all')
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // الطلاب النشطون في الحلقة (بلا مؤرشفين)، مرتّبون بثبات حسب الاسم
  const baseStudents = useMemo(() => {
    return allStudents
      .filter((s) => s.circleId === circleId && s.status !== 'archived')
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }, [allStudents, circleId])

  // تحميل التسجيلات من الخادم عند تغيير الحلقة/التاريخ
  useEffect(() => {
    if (!circleId || !date || dirtyRef.current) return
    const rec = getDailyRecord(circleId, date)
    const map: Record<string, DailyEntry> = {}
    if (rec) rec.entries.forEach((e) => (map[e.studentId] = { ...e }))
    baseStudents.forEach((s) => {
      if (!map[s.id]) map[s.id] = defaultEntry(s.id)
    })
    setEntries(map)
    setSavedAt(null)
    setError(null)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, date])

  // جلب الملخّص من الخادم
  useEffect(() => {
    if (!circleId || !date) return
    let active = true
    getDailySummary({ group_id: circleId, date })
      .then((s) => active && setSummary(s))
      .catch(() => active && setSummary(null))
    return () => {
      active = false
    }
  }, [circleId, date])

  // منع مغادرة الصفحة مع تغييرات غير محفوظة
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  if (circles.length === 0) {
    return (
      <Layout title="التسجيل اليومي" subtitle="تسجيل الحضور والتسميع والمراجعة">
        <div className="empty">لا توجد حلقات مسندة إليك لإجراء التسجيل اليومي.</div>
      </Layout>
    )
  }

  const set = (id: string, patch: Partial<DailyEntry>) => {
    setEntries((prev) => ({ ...prev, [id]: { ...(prev[id] || defaultEntry(id)), ...patch } }))
    setDirty(true)
    setSavedAt(null)
  }

  const confirmLeave = (): boolean => {
    if (!dirtyRef.current) return true
    return window.confirm('لديك تغييرات غير محفوظة. هل تريد المتابعة دون حفظ؟')
  }

  const changeCircle = (id: string) => {
    if (id === circleId) return
    if (!confirmLeave()) {
      setCircleId(circleId)
      return
    }
    setSelected(new Set())
    setCircleId(id)
  }
  const changeDate = (d: string) => {
    if (d === date) return
    if (!confirmLeave()) return
    setSelected(new Set())
    setDate(d)
  }

  // أدوات جماعية سريعة (لا تحفظ تلقائيًا)
  const applyToAllVisible = (patch: Partial<DailyEntry>) => {
    setEntries((prev) => {
      const next = { ...prev }
      visibleStudents.forEach((s) => {
        next[s.id] = { ...(next[s.id] || defaultEntry(s.id)), ...patch }
      })
      return next
    })
    setDirty(true)
    setSavedAt(null)
  }
  const applyToSelected = (patch: Partial<DailyEntry>) => {
    if (selected.size === 0) return
    setEntries((prev) => {
      const next = { ...prev }
      selected.forEach((id) => {
        next[id] = { ...(next[id] || defaultEntry(id)), ...patch }
      })
      return next
    })
    setDirty(true)
    setSavedAt(null)
  }
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return baseStudents.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) && !(s.nickname || '').toLowerCase().includes(q)) return false
      if (!matchesFilter(filter, entries[s.id])) return false
      return true
    })
  }, [baseStudents, search, filter, entries])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const toSave = baseStudents
        .map((s) => entries[s.id])
        .filter((e): e is DailyEntry => !!e && isRecorded(e))
      await saveDailyBulk(date, toSave)
      // إعادة التحميل من الخادم للتأكد من التطابق
      const rec = getDailyRecord(circleId, date)
      const map: Record<string, DailyEntry> = {}
      if (rec) rec.entries.forEach((e) => (map[e.studentId] = { ...e }))
      baseStudents.forEach((s) => {
        if (!map[s.id]) map[s.id] = defaultEntry(s.id)
      })
      setEntries(map)
      setSelected(new Set())
      setDirty(false)
      const t = new Date()
      setSavedAt(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`)
      getDailySummary({ group_id: circleId, date }).then(setSummary).catch(() => {})
    } catch {
      setError('تعذر حفظ التسجيلات، حاول مرة أخرى.')
    } finally {
      setSaving(false)
    }
  }

  const total = summary?.total_students ?? baseStudents.length
  const registered = summary?.registered ?? 0
  const completion = total > 0 ? Math.round((registered / total) * 100) : 0

  return (
    <Layout title="التسجيل اليومي" subtitle="تسجيل الحضور والتسميع والمراجعة لحلقاتك">
      <div className="page-head">
        <h2>التسجيل اليومي</h2>
        <p>
          التاريخ: <strong>{date}</strong> · المعلم: <strong>{teacher?.name || '—'}</strong>
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="toolbar wrap" style={{ marginBottom: 0 }}>
          <div className="field" style={{ minWidth: 220 }}>
            <label>الحلقة</label>
            <select className="select" value={circleId} onChange={(e) => changeCircle(e.target.value)}>
              {circles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 180 }}>
            <label>التاريخ</label>
            <div className="search-box">
              <IconCalendar size={16} />
              <input className="input" type="date" value={date} onChange={(e) => changeDate(e.target.value)} />
            </div>
          </div>
          <div className="grow" />
          {savedAt && !error && <span className="badge badge-success">تم حفظ التسجيلات بنجاح — {savedAt}</span>}
          {error && <span className="badge badge-danger-soft">{error}</span>}
        </div>
      </div>

      {/* ملخّص */}
      <div className="card stats-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat">
          <div className="stat-n">{total}</div>
          <div className="stat-l">إجمالي الطلاب</div>
        </div>
        <div className="stat">
          <div className="stat-n">{registered}</div>
          <div className="stat-l">تم التسجيل</div>
        </div>
        <div className="stat">
          <div className="stat-n">{total - registered}</div>
          <div className="stat-l">لم يُسجَّل</div>
        </div>
        <div className="stat">
          <div className="stat-n">{completion}%</div>
          <div className="stat-l">نسبة الإنجاز</div>
        </div>
      </div>

      {/* أدوات سريعة جماعية */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="bulk-tools">
          <span className="muted">تحديد الكل:</span>
          <button className="btn btn-soft" onClick={() => applyToAllVisible({ attendance: 'on_time' })}>
            حضر في الوقت
          </button>
          <button className="btn btn-soft" onClick={() => applyToAllVisible({ memorization: 'heard' })}>
            سمع اللوح
          </button>
          <button className="btn btn-soft" onClick={() => applyToAllVisible({ revision: 'reviewed' })}>
            راجع الورد
          </button>
          <span className="divider" />
          <span className="muted">على المحدد ({selected.size}):</span>
          <button className="btn btn-soft" disabled={selected.size === 0} onClick={() => applyToSelected({ attendance: 'on_time' })}>
            حضر
          </button>
          <button className="btn btn-soft" disabled={selected.size === 0} onClick={() => applyToSelected({ memorization: 'heard' })}>
            سمع
          </button>
          <button className="btn btn-soft" disabled={selected.size === 0} onClick={() => applyToSelected({ revision: 'reviewed' })}>
            راجع
          </button>
        </div>
      </div>

      {/* بحث + فلتر */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="toolbar wrap" style={{ marginBottom: 0 }}>
          <div className="search-box" style={{ minWidth: 220 }}>
            <IconSearch size={16} />
            <input
              className="input"
              placeholder="ابحث باسم الطالب..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="chip-row">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                className={'chip-filter' + (filter === f.v ? ' is-on' : '')}
                onClick={() => setFilter(f.v)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* قائمة الطلاب */}
      <div className="list">
        {visibleStudents.map((s: Student) => {
          const e = entries[s.id] || defaultEntry(s.id)
          const g = glyph(e.attendance)
          const gm = glyph(e.memorization)
          const gr = glyph(e.revision)
          return (
            <div className="daily-student" key={s.id}>
              <input
                type="checkbox"
                className="student-check"
                checked={selected.has(s.id)}
                onChange={() => toggleSelect(s.id)}
                aria-label="تحديد الطالب"
              />
              <div className="avatar">{initials(s.name)}</div>
              <div className="grow student-id">
                <div className="item-title">{s.name}</div>
                <div className="item-sub">
                  {s.nickname ? s.nickname + ' · ' : ''}
                  {s.currentMemorization ? 'المحفوظ: ' + s.currentMemorization : ''}
                  {s.healthVisibleToTeacher && s.healthStatus ? ' · صحة: ' + s.healthStatus : ''}
                  {s.behavior ? ' · سلوك: ' + s.behavior : ''}
                </div>
              </div>

              <div className="axis">
                <div className="axis-label">
                  الحضور <span className={'glyph ' + g.cls}>{g.sym}</span>
                </div>
                <Segmented value={e.attendance} options={ATT_OPTIONS} onChange={(v) => set(s.id, { attendance: v })} />
              </div>

              <div className="axis">
                <div className="axis-label">
                  اللوح <span className={'glyph ' + gm.cls}>{gm.sym}</span>
                </div>
                <Segmented value={e.memorization} options={MEM_OPTIONS} onChange={(v) => set(s.id, { memorization: v })} />
                <div className="axis-extra">
                  <input
                    className="input input-xs"
                    placeholder="الكمية"
                    value={e.memorizationAmount || ''}
                    onChange={(ev) => set(s.id, { memorizationAmount: ev.target.value })}
                  />
                  <select
                    className="select select-xs"
                    value={e.memorizationMastery || 'not_evaluated'}
                    onChange={(ev) => set(s.id, { memorizationMastery: ev.target.value as MasteryState })}
                  >
                    {MASTERY_OPTIONS.map((m) => (
                      <option key={m.v} value={m.v}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="axis">
                <div className="axis-label">
                  الورد <span className={'glyph ' + gr.cls}>{gr.sym}</span>
                </div>
                <Segmented value={e.revision} options={REV_OPTIONS} onChange={(v) => set(s.id, { revision: v })} />
              </div>

              <div className="axis note-axis">
                <div className="axis-label">ملاحظة</div>
                <input
                  className="input input-xs"
                  placeholder="ملاحظة الطالب لهذا اليوم"
                  value={e.note || ''}
                  onChange={(ev) => set(s.id, { note: ev.target.value })}
                />
              </div>
            </div>
          )
        })}
        {visibleStudents.length === 0 && <div className="empty">لا يوجد طلاب مطابقون في هذه الحلقة.</div>}
      </div>

      {/* شريط الحفظ */}
      <div className="save-bar">
        <div className="row gap-2 wrap">
          {dirty && <span className="badge badge-warning">تغييرات غير محفوظة</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ التسجيلات'}
          </button>
        </div>
      </div>
    </Layout>
  )
}
