import { useEffect, useState } from 'react'
import { useSchoolData } from '../data/useSchoolData'
import { useAuth } from '../auth/AuthContext'
import { getCircles, getTeacher, getDailySummary, addCircle, updateCircle, getErrorMessage, handleNotFoundError, type DailySummary } from '../data/store'
import { Modal, initials } from './ui'
import { IconCircles, IconTeachers, IconUser, IconPlus, IconEdit } from './icons'

const REASON_OPTIONS = [
  { value: 'reassign', label: 'إعادة توزيع الحلقات' },
  { value: 'transfer', label: 'انتقال المحفظ إلى حلقة أخرى' },
  { value: 'substitute', label: 'تعويض محفظ' },
  { value: 'organizational', label: 'تغيير تنظيمي' },
  { value: 'other', label: 'سبب آخر' }
]

function CircleFormDialog({
  circle,
  onClose
}: {
  circle?: { id: string; name: string; teacherId: string; code?: string; status?: string; notes?: string }
  onClose: () => void
}) {
  const teachers = useSchoolData((d) => d.teachers)
  const [form, setForm] = useState({
    name: circle?.name ?? '',
    code: circle?.code ?? '',
    teacherId: circle?.teacherId ?? teachers[0]?.id ?? '',
    status: circle?.status ?? 'active',
    notes: circle?.notes ?? ''
  })
  const [assignReason, setAssignReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const teacherChanged = circle && form.teacherId !== (circle.teacherId || '')
  const showReasonField = teacherChanged && assignReason === 'other'

  function getReasonText(): string | undefined {
    if (!teacherChanged) return undefined
    if (assignReason === 'other') return customReason.trim() || undefined
    const found = REASON_OPTIONS.find(r => r.value === assignReason)
    return found ? found.label : undefined
  }

  const save = async () => {
    if (saving) return
    if (!form.name.trim()) {
      setError('الرجاء إدخال اسم الحلقة')
      return
    }
    setSaving(true)
    try {
      if (circle) {
        await updateCircle(circle.id, {
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          teacherId: form.teacherId || undefined,
          status: form.status,
          notes: form.notes.trim() || undefined,
          assignReason: getReasonText()
        })
      } else {
        await addCircle({
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          teacherId: form.teacherId || undefined,
          status: form.status,
          notes: form.notes.trim() || undefined,
          assignReason: getReasonText()
        })
      }
      onClose()
    } catch (e: any) {
      setError(getErrorMessage(e))
      await handleNotFoundError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={circle ? 'تعديل الحلقة' : 'إضافة حلقة جديدة'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'جارٍ الحفظ…' : circle ? 'حفظ التعديلات' : 'حفظ الحلقة'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      {error && <div className="auth-error">{error}</div>}
      <div className="field">
        <label>اسم الحلقة (يحدّده المشرف يدويًا)</label>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: حلقة الرواد" />
      </div>
      <div className="grid-2">
        <div className="field">
          <label>رمز الحلقة (اختياري)</label>
          <input className="input" dir="ltr" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="G1" />
        </div>
        <div className="field">
          <label>الحالة</label>
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">نشطة</option>
            <option value="inactive">غير نشطة</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>المعلم المسؤول</label>
        <select className="select" value={form.teacherId} onChange={(e) => set('teacherId', e.target.value)}>
          <option value="">بدون معلم</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {circle && teacherChanged && (
        <div className="field">
          <label>سبب تغيير المحفظ</label>
          <select className="select" value={assignReason} onChange={(e) => setAssignReason(e.target.value)}>
            <option value="">اختر السبب...</option>
            {REASON_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {assignReason === 'other' && (
            <input
              className="input"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="اكتب السبب هنا..."
              style={{ marginTop: '0.5rem' }}
            />
          )}
        </div>
      )}
      <div className="field">
        <label>ملاحظات</label>
        <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Modal>
  )
}

function CircleDialog({ circle, onClose }: { circle: { id: string; name: string; studentIds: string[]; code?: string; notes?: string }; onClose: () => void }) {
  const data = useSchoolData((d) => ({
    students: d.students.filter((s) => circle.studentIds.includes(s.id))
  }))
  const [summary, setSummary] = useState<DailySummary | null>(null)
  useEffect(() => {
    let active = true
    getDailySummary({ group_id: circle.id })
      .then((s) => active && setSummary(s))
      .catch(() => active && setSummary(null))
    return () => {
      active = false
    }
  }, [circle.id])
  return (
    <Modal
      title={circle.name}
      onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>إغلاق</button>}
    >
      <div className="muted" style={{ marginBottom: '0.5rem' }}>
        {circle.code ? `الرمز: ${circle.code} — ` : ''}عدد الطلاب: {data.students.length}
      </div>
      {summary && (
        <div className="row gap-2 wrap" style={{ marginBottom: '0.75rem' }}>
          <span className="badge badge-success">في الوقت: {summary.on_time}</span>
          <span className="badge badge-warning">متأخر: {summary.late}</span>
          <span className="badge badge-soft">سمع: {summary.heard}</span>
          <span className="badge badge-soft">راجع: {summary.reviewed}</span>
          <span className="badge badge-muted">غير مسجّل: {summary.not_recorded_att}</span>
        </div>
      )}
      {data.students.length === 0 ? (
        <Empty />
      ) : (
        <div className="list">
          {data.students.map((s) => (
            <div className="list-row" key={s.id}>
              <div className="avatar">{initials(s.name)}</div>
              <div>
                <div className="item-title">{s.name}</div>
                <div className="item-sub">{s.nickname ?? ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function Empty() {
  return <div className="empty">لا يوجد طلاب في هذه الحلقة</div>
}

export function CircleListView({ teacherId }: { teacherId?: string }) {
  const { user } = useAuth()
  const isSupervisor = user?.role === 'supervisor'
  const [openId, setOpenId] = useState<string | null>(null)
  const [formId, setFormId] = useState<string | null>(null)
  const [stopId, setStopId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const data = useSchoolData((d) => ({
    circles: getCircles(teacherId ? { teacherId } : undefined),
    students: d.students
  }))

  const teacherName = (id: string) => getTeacher(id)?.name ?? '—'
  const circleById = (id: string) => data.circles.find((c) => c.id === id)

  const formCircle = formId ? circleById(formId) : undefined
  const stopCircle = stopId ? circleById(stopId) : undefined

  const confirmStop = async () => {
    if (stopCircle) await updateCircle(stopCircle.id, { status: 'inactive' })
    setStopId(null)
  }

  return (
    <>
      {isSupervisor && (
        <div className="toolbar" style={{ marginBottom: '1rem' }}>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <IconPlus size={18} />
            إضافة حلقة
          </button>
        </div>
      )}

      {data.circles.length === 0 ? (
        <Empty />
      ) : (
        <div className="list">
          {data.circles.map((c) => (
            <div className="list-row" key={c.id}>
              <div className="avatar" style={{ background: 'var(--primary-soft)', color: 'var(--primary-dark)' }}>
                <IconCircles />
              </div>
              <div className="grow">
                <div className="item-title">{c.name}</div>
                <div className="item-sub">
                  <span className="badge badge-muted" style={{ marginInlineEnd: 6 }}>
                    <IconTeachers size={14} /> {teacherName(c.teacherId)}
                  </span>
                  <span className="badge badge-soft">
                    <IconUser size={14} /> {c.studentIds.length} طالب
                  </span>
                </div>
              </div>
              {isSupervisor && (
                <button className="btn btn-ghost btn-sm" onClick={() => setFormId(c.id)} title="تعديل">
                  <IconEdit size={16} />
                </button>
              )}
              {isSupervisor && c.status !== 'inactive' && (
                <button className="btn btn-danger btn-sm" onClick={() => setStopId(c.id)} title="إيقاف الحلقة">
                  إيقاف
                </button>
              )}
              <button className="btn btn-soft btn-sm" onClick={() => setOpenId(c.id)}>
                فتح الحلقة
              </button>
            </div>
          ))}
        </div>
      )}

      {openId && circleById(openId) && <CircleDialog circle={circleById(openId)!} onClose={() => setOpenId(null)} />}
      {showAdd && <CircleFormDialog onClose={() => setShowAdd(false)} />}
      {formId && <CircleFormDialog circle={formCircle} onClose={() => setFormId(null)} />}
      {stopCircle && (
        <Modal
          title="إيقاف الحلقة"
          onClose={() => setStopId(null)}
          footer={
            <>
              <button className="btn btn-danger" onClick={confirmStop}>
                تأكيد الإيقاف
              </button>
              <button className="btn btn-ghost" onClick={() => setStopId(null)}>
                إلغاء
              </button>
            </>
          }
        >
          <p className="muted">
            هل أنت متأكد من إيقاف الحلقة <strong>{stopCircle.name}</strong>؟ لا تُحذف الحلقة ولا
            طلابها ولا سجلاتها، لكنها لن تظهر في القوائم التشغيلية الحالية.
          </p>
        </Modal>
      )}
    </>
  )
}
