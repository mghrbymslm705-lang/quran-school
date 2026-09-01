import { useEffect, useMemo, useState } from 'react'
import { Layout } from '../../components/Layout'
import { IconTrash, IconX } from '../../components/icons'
import {
  getAudit,
  deleteAuditRecord,
  previewAuditDelete,
  deleteAuditBulk,
  refreshAll,
  getStudents,
  getTeachers,
  getCircles,
  getErrorMessage,
  type AuditRow,
  type AuditList
} from '../../data/store'
import { formatAuditChange, auditEntityName, type AuditCtx } from '../../utils/auditFormat'

const ENTITY_OPTIONS = [
  { v: '', l: 'الكل' },
  { v: 'student', l: 'الطالب' },
  { v: 'teacher', l: 'المعلم' },
  { v: 'group', l: 'الحلقة' },
  { v: 'daily_records', l: 'السجل اليومي' },
  { v: 'student_group', l: 'إسناد الطالب للحلقة' },
  { v: 'audit_log', l: 'سجل التغييرات' },
  { v: 'school_settings', l: 'إعدادات المؤسسة' }
]
const ACTION_OPTIONS = [
  { v: '', l: 'الكل' },
  { v: 'create', l: 'إنشاء' },
  { v: 'update', l: 'تعديل' },
  { v: 'archive', l: 'أرشفة' },
  { v: 'reactivate', l: 'إعادة تفعيل' },
  { v: 'transfer', l: 'نقل' },
  { v: 'delete', l: 'حذف' },
  { v: 'bulk_delete', l: 'تنظيف' },
  { v: 'reset_password', l: 'تغيير كلمة المرور' }
]
const CLEANUP_MODES = [
  { v: '30d', l: '30 يومًا' },
  { v: '90d', l: '90 يومًا' },
  { v: '6m', l: '6 أشهر' },
  { v: '1y', l: 'سنة' },
  { v: 'custom', l: 'فترة مخصصة' }
]

function ConfirmModal({
  title,
  message,
  details,
  backup,
  busy,
  error,
  onBackupChange,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  details?: { label: string; value: string }[]
  backup: boolean
  busy: boolean
  error: string | null
  onBackupChange: (v: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚠️ {title}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="إغلاق">
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <p className="warn-text">{message}</p>
          {details && details.length > 0 && (
            <div className="confirm-detail">
              {details.map((d, i) => (
                <div key={i}>
                  <span>{d.label}: </span>
                  <strong>{d.value}</strong>
                </div>
              ))}
            </div>
          )}
          <label className="backup-check">
            <input type="checkbox" checked={backup} onChange={(e) => onBackupChange(e.target.checked)} /> ☑️ إنشاء نسخة احتياطية قبل الحذف
            (مُفعّلة افتراضيًا)
          </label>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'جارٍ التنفيذ…' : '🗑️ حذف'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function AuditPage() {
  const [list, setList] = useState<AuditList>({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ q: '', entity_type: '', action: '', user: '', from: '', to: '', sort: 'desc' as 'asc' | 'desc' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [single, setSingle] = useState<AuditRow | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [cleanup, setCleanup] = useState({ mode: '90d', customFrom: '', customTo: '', preview: null as null | { count: number; oldest: string | null; newest: string | null }, backup: true })
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const students = getStudents()
  const teachers = getTeachers()
  const circles = getCircles()
  const ctx: AuditCtx = useMemo(() => {
    const sm: Record<string, string> = {}
    students.forEach((s) => (sm[s.id] = s.name))
    const tm: Record<string, string> = {}
    teachers.forEach((t) => (tm[t.id] = t.name))
    const gm: Record<string, string> = {}
    circles.forEach((g) => (gm[g.id] = g.name))
    return { studentName: (id) => sm[id], teacherName: (id) => tm[id], groupName: (id) => gm[id] }
  }, [students, teachers, circles])

  const userOptions = useMemo(() => {
    const m = new Map<string, string>()
    list.rows.forEach((r) => r.user_id && m.set(r.user_id, r.user_name || r.username || r.user_id))
    return Array.from(m.entries())
  }, [list.rows])

  const load = (f = filters) => {
    setLoading(true)
    getAudit(f)
      .then((r) => setList(r))
      .catch(() => setList({ rows: [], total: 0 }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refreshAll().catch(() => {})
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }
  const setF = (patch: Partial<typeof filters>) => {
    const nf = { ...filters, ...patch }
    setFilters(nf)
    load(nf)
  }

  const toggle = (id: string) => {
    const n = new Set(selected)
    n.has(id) ? n.delete(id) : n.add(id)
    setSelected(n)
  }
  const toggleAll = () => {
    if (selected.size === list.rows.length && list.rows.length) setSelected(new Set())
    else setSelected(new Set(list.rows.map((r) => r.id)))
  }

  const onSingleConfirm = async () => {
    if (!single) return
    setBusy(true)
    setModalError(null)
    try {
      await deleteAuditRecord(single.id, cleanup.backup)
      setSingle(null)
      flash('تم حذف السجل')
      load()
    } catch (e) {
      setModalError(getErrorMessage(e, 'تعذّر حذف السجل'))
    } finally {
      setBusy(false)
    }
  }

  const onBulkConfirm = async () => {
    setBusy(true)
    setModalError(null)
    try {
      const r = await deleteAuditBulk({ ids: Array.from(selected), confirmText: 'حذف', backup: cleanup.backup })
      setBulkOpen(false)
      setSelected(new Set())
      flash(`تم حذف ${r.deleted} سجلًا`)
      load()
    } catch (e) {
      setModalError(getErrorMessage(e, 'تعذّر حذف السجلات'))
    } finally {
      setBusy(false)
    }
  }

  const cleanupFilter = (): { ids?: string[]; from?: string; to?: string; olderThan?: string; customDate?: string } => {
    if (cleanup.mode === 'custom') return { from: cleanup.customFrom, to: cleanup.customTo }
    return { olderThan: cleanup.mode }
  }
  const onPreview = async () => {
    setModalError(null)
    try {
      const p = await previewAuditDelete(cleanupFilter())
      setCleanup((c) => ({ ...c, preview: p }))
    } catch (e) {
      setModalError(getErrorMessage(e, 'تعذّر معاينة السجلات'))
      setCleanup((c) => ({ ...c, preview: null }))
    }
  }
  const onCleanupDelete = async () => {
    setBusy(true)
    setModalError(null)
    try {
      const r = await deleteAuditBulk({ ...cleanupFilter(), confirmText: 'حذف', backup: cleanup.backup })
      setCleanup((c) => ({ ...c, preview: null }))
      flash(`تم حذف ${r.deleted} سجلًا قديمًا`)
      load()
    } catch (e) {
      setModalError(getErrorMessage(e, 'تعذّر حذف السجلات'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title="سجل التغييرات" subtitle="العمليات الإدارية المهمة (المشرف فقط)">
      {toast && <div className="banner banner-ok">{toast}</div>}
      {modalError && <div className="form-error">{modalError}</div>}

      {/* أدوات التنظيف */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">🗑️ تنظيف سجل التغييرات</div>
        </div>
        <div className="dm-form">
          {CLEANUP_MODES.map((m) => (
            <label key={m.v} className="radio-line">
              <input
                type="radio"
                name="cleanup"
                checked={cleanup.mode === m.v}
                onChange={() => setCleanup((c) => ({ ...c, mode: m.v, preview: null }))}
              />
              {m.l}
            </label>
          ))}
        </div>
        {cleanup.mode === 'custom' && (
          <div className="dm-form">
            <div className="field">
              <label>من تاريخ:</label>
              <input className="input" type="date" value={cleanup.customFrom} onChange={(e) => setCleanup((c) => ({ ...c, customFrom: e.target.value, preview: null }))} />
            </div>
            <div className="field">
              <label>إلى تاريخ:</label>
              <input className="input" type="date" value={cleanup.customTo} onChange={(e) => setCleanup((c) => ({ ...c, customTo: e.target.value, preview: null }))} />
            </div>
          </div>
        )}
        <div className="dm-actions">
          <button className="btn btn-ghost" onClick={onPreview}>
            معاينة عدد السجلات
          </button>
        </div>
        {cleanup.preview && (
          <div className="preview-box">
            <div className="card-sub">
              عدد السجلات التي سيتم حذفها: <strong>{cleanup.preview.count}</strong>
            </div>
            <ul className="preview-list">
              <li>أقدم سجل: {cleanup.preview.oldest || '—'}</li>
              <li>أحدث سجل ضمن الحذف: {cleanup.preview.newest || '—'}</li>
            </ul>
            <button className="btn btn-danger" onClick={onCleanupDelete} disabled={cleanup.preview.count === 0}>
              🔴 حذف هذه السجلات
            </button>
          </div>
        )}
      </div>

      {/* الجدول مع التصفية والحذف المتعدد */}
      <div className="card">
        <div className="toolbar audit-toolbar">
          <input
            className="input"
            placeholder="بحث (اسم/مستخدم/كيان/عملية)…"
            value={filters.q}
            onChange={(e) => setF({ q: e.target.value })}
          />
          <select className="select" value={filters.entity_type} onChange={(e) => setF({ entity_type: e.target.value })}>
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </select>
          <select className="select" value={filters.action} onChange={(e) => setF({ action: e.target.value })}>
            {ACTION_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </select>
          <select className="select" value={filters.user} onChange={(e) => setF({ user: e.target.value })}>
            <option value="">كل المستخدمين</option>
            {userOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <input className="input" type="date" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
          <input className="input" type="date" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
          <button className="btn btn-ghost btn-sm" onClick={() => setF({ sort: filters.sort === 'desc' ? 'asc' : 'desc' })}>
            {filters.sort === 'desc' ? 'الأحدث أولًا' : 'الأقدم أولًا'}
          </button>
        </div>

        <div className="audit-summary">
          إجمالي السجلات: <strong>{list.total}</strong>
          {selected.size > 0 && (
            <span className="selected-bar">
              تم تحديد: {selected.size} سجلًا
              <button className="btn btn-danger btn-sm" onClick={() => { setBulkOpen(true); setModalError(null) }}>
                🗑️ حذف السجلات المحددة
              </button>
            </span>
          )}
        </div>

        {loading && <div className="muted">جارٍ التحميل…</div>}
        {!loading && list.rows.length === 0 && <div className="empty">لا توجد سجلات مطابقة.</div>}

        <div className="timeline">
          {list.rows.map((r) => {
            const view = formatAuditChange(r, ctx)
            const isSel = selected.has(r.id)
            return (
              <div key={r.id} className={'timeline-row' + (isSel ? ' selected' : '')}>
                <div className="timeline-select">
                  <input type="checkbox" checked={isSel} onChange={() => toggle(r.id)} aria-label="تحديد" />
                </div>
                <div className="timeline-date">{r.created_at}</div>
                <div className="timeline-body">
                  <div className="audit-row-head">
                    <div>
                      <strong>{view.title}</strong>
                      <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>
                        {auditEntityName(r, ctx)} — بواسطة <strong>{r.user_name || r.username || '—'}</strong>
                      </div>
                    </div>
                    <button className="icon-btn danger" onClick={() => { setSingle(r); setModalError(null); setBusy(false) }} aria-label="حذف السجل">
                      <IconTrash size={16} />
                    </button>
                  </div>
                  {view.lines.length > 0 && (
                    <div className="audit-changes">
                      {view.lines.map((l, i) => (
                        <div key={i} className="audit-change">
                          <span className="ch-label">{l.label}:</span>{' '}
                          {l.from != null && <span className="chip chip-ghost">{l.from}</span>}
                          {l.from != null && <span className="chip-arrow"> ← </span>}
                          <span className="chip chip-success">{l.to}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {list.rows.length > 0 && (
          <div className="select-all-row">
            <label>
              <input type="checkbox" checked={selected.size === list.rows.length && list.rows.length > 0} onChange={toggleAll} /> تحديد الكل المعروض
            </label>
          </div>
        )}
      </div>

      {single && (
        <ConfirmModal
          title="حذف سجل تغيير"
          message="هل تريد حذف هذا السجل من سجل التغييرات؟ لا يؤثر ذلك على بيانات الطلاب أو المعلمين أو الحلقات."
          details={[
            { label: 'نوع العملية', value: view_action(single.action) },
            { label: 'العنصر', value: auditEntityName(single, ctx) },
            { label: 'التاريخ والوقت', value: String(single.created_at) },
            { label: 'المستخدم', value: single.user_name || single.username || '—' }
          ]}
          backup={cleanup.backup}
          busy={busy}
          error={modalError}
          onBackupChange={(v) => setCleanup((c) => ({ ...c, backup: v }))}
          onConfirm={onSingleConfirm}
          onCancel={() => setSingle(null)}
        />
      )}

      {bulkOpen && (
        <ConfirmModal
          title="حذف سجلات محددة"
          message={`أنت على وشك حذف ${selected.size} سجلًا من سجل التغييرات. هذه العملية لا تؤثر على بيانات الطلاب أو المعلمين أو الحلقات، وإنما تحذف سجلات التتبع فقط.`}
          backup={cleanup.backup}
          busy={busy}
          error={modalError}
          onBackupChange={(v) => setCleanup((c) => ({ ...c, backup: v }))}
          onConfirm={onBulkConfirm}
          onCancel={() => setBulkOpen(false)}
        />
      )}
    </Layout>
  )
}

function view_action(a: string): string {
  const m: Record<string, string> = {
    create: 'إنشاء', update: 'تعديل', edit: 'تعديل', delete: 'حذف', bulk_delete: 'تنظيف',
    archive: 'أرشفة', reactivate: 'إعادة تفعيل', deactivate: 'تعطيل', transfer: 'نقل',
    reset_password: 'تغيير كلمة المرور', login: 'تسجيل دخول'
  }
  return m[a] || a
}
