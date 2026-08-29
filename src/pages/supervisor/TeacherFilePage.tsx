import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Modal, initials } from '../../components/ui'
import { IconArrowLeft, IconEdit, IconCircles, IconCalendar, IconCheck } from '../../components/icons'
import {
  getTeacherFile,
  getTeacherStats,
  getTeacherAudit,
  getTeacherGroupHistory,
  updateTeacher,
  deactivateTeacher,
  reactivateTeacher,
  resetTeacherPassword,
  getCircles,
  getErrorMessage,
  handleNotFoundError
} from '../../data/store'
import type { TeacherFile, TeacherStats, AuditRow, AssignmentHistoryRow } from '../../data/store'

function fmtDate(d?: string | null) {
  return d ? d.slice(0, 10) : '—'
}

function EditTeacherDialog({ id, current, onClose }: { id: string; current: TeacherFile; onClose: () => void }) {
  const circles = getCircles()
  const [form, setForm] = useState({
    name: current.full_name,
    phone: current.phone || '',
    email: current.email || '',
    adminNotes: current.admin_notes || '',
    active: current.status === 'active',
    circleIds: current.groups.map((g) => g.id)
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof form, v: string | boolean | string[]) => setForm((f) => ({ ...f, [k]: v }))
  const toggle = (cid: string) =>
    setForm((f) => ({ ...f, circleIds: f.circleIds.includes(cid) ? f.circleIds.filter((x) => x !== cid) : [...f.circleIds, cid] }))

  const save = async () => {
    if (saving) return
    if (!form.name.trim()) {
      setError('الرجاء إدخال الاسم')
      return
    }
    setSaving(true)
    try {
      await updateTeacher(id, {
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        adminNotes: form.adminNotes || undefined,
        active: form.active,
        circleIds: form.circleIds
      })
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
      title="تعديل بيانات المعلم"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error && <div className="auth-error">{error}</div>}
      <div className="grid-2">
        <div className="field"><label>الاسم الكامل</label><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>البريد الإلكتروني</label><input className="input" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>الهاتف</label><input className="input" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div className="field"><label>ملاحظات إدارية</label><input className="input" value={form.adminNotes} onChange={(e) => set('adminNotes', e.target.value)} /></div>
      </div>
      <div className="field">
        <label className="switch">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
          الحساب مفعل
        </label>
      </div>
      <div className="field">
        <label>الحلقات المسندة</label>
        <div className="list" style={{ maxHeight: 180, overflowY: 'auto' }}>
          {circles.map((c) => (
            <label key={c.id} className="switch" style={{ justifyContent: 'flex-start' }}>
              <input type="checkbox" checked={form.circleIds.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function ResetPasswordDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving || done) return
    setSaving(true)
    try {
      await resetTeacherPassword(id, pw, confirm)
      setDone(true)
      setTimeout(onClose, 700)
    } catch (e: any) {
      setError(getErrorMessage(e))
      await handleNotFoundError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="إعادة تعيين كلمة المرور"
      onClose={onClose}
      footer={
        done ? (
          <button className="btn btn-primary" onClick={onClose}><IconCheck size={16} /> تم</button>
        ) : (
          <>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
            <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          </>
        )
      }
    >
      {error && <div className="auth-error">{error}</div>}
      <p className="muted">لا يمكنك رؤية كلمة المرور الحالية. أدخل كلمة مرور جديدة وقم بتأكيدها.</p>
      <div className="grid-2">
        <div className="field"><label>كلمة المرور الجديدة</label><input className="input" type="text" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="field"><label>تأكيد كلمة المرور</label><input className="input" type="text" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
      </div>
    </Modal>
  )
}

export function TeacherFilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [file, setFile] = useState<TeacherFile | null>(null)
  const [stats, setStats] = useState<TeacherStats | null>(null)
  const [range, setRange] = useState<'today' | '7' | '30'>('today')
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [history, setHistory] = useState<AssignmentHistoryRow[]>([])
  const [showEdit, setShowEdit] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [confirmDeact, setConfirmDeact] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [f, s, a, h] = await Promise.all([
        getTeacherFile(id),
        getTeacherStats(id, range),
        getTeacherAudit(id),
        getTeacherGroupHistory(id)
      ])
      setFile(f)
      setStats(s)
      setAudit(a)
      setHistory(h)
    } catch (e: any) {
      setError(getErrorMessage(e))
      await handleNotFoundError(e)
    }
  }, [id, range])

  useEffect(() => { load() }, [load])

  const active = file?.status === 'active'

  const onDeactivate = async () => {
    if (!id) return
    await deactivateTeacher(id)
    setConfirmDeact(false)
    load()
  }
  const onReactivate = async () => {
    if (!id) return
    await reactivateTeacher(id)
    load()
  }

  return (
    <Layout title={file?.full_name || 'ملف المعلم'} subtitle="بيانات المعلم وإحصائياته وسجل نشاطه">
      <div className="page-head">
        <div>
          <h2>
            {file?.full_name}
            {file && (
              <span className={'badge ' + (active ? 'badge-success' : 'badge-danger')} style={{ marginInlineStart: 8 }}>
                {active ? 'نشط' : 'معطّل'}
              </span>
            )}
          </h2>
          <p className="muted" dir="ltr">{file?.username}</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn btn-soft" onClick={() => setShowEdit(true)}><IconEdit size={16} /> تعديل</button>
          {active ? (
            <button className="btn btn-danger-soft" onClick={() => setConfirmDeact(true)}>تعطيل الحساب</button>
          ) : (
            <button className="btn btn-success-soft" onClick={onReactivate}>إعادة تفعيل</button>
          )}
          <button className="btn btn-soft" onClick={() => setShowReset(true)}>إعادة تعيين كلمة المرور</button>
          <button className="btn btn-ghost" onClick={() => navigate('/supervisor/teachers')}><IconArrowLeft size={16} /> رجوع</button>
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>البيانات الأساسية</h3>
          <div className="kv">
            <div><span>الاسم</span><b>{file?.full_name}</b></div>
            <div><span>اسم المستخدم</span><b dir="ltr">{file?.username}</b></div>
            <div><span>البريد</span><b dir="ltr">{file?.email || '—'}</b></div>
            <div><span>الهاتف</span><b dir="ltr">{file?.phone || '—'}</b></div>
            <div><span>تاريخ الإنشاء</span><b>{fmtDate(file?.created_at)}</b></div>
            <div><span>الحالة</span><b>{active ? 'نشط' : 'معطّل'}</b></div>
            {file?.admin_notes && <div className="span-2"><span>ملاحظات إدارية</span><b>{file.admin_notes}</b></div>}
          </div>

          <h3 style={{ marginTop: '1rem' }}>الحلقات المسندة</h3>
          {file && file.groups.length === 0 ? (
            <div className="empty">لا حلقات مسندة.</div>
          ) : (
            <div className="list">
              {file?.groups.map((g) => (
                <div className="list-row" key={g.id} onClick={() => navigate('/supervisor/circle/' + g.id)} style={{ cursor: 'pointer' }}>
                  <IconCircles size={18} />
                  <div className="grow">
                    <div className="item-title">{g.name}</div>
                    <div className="item-sub">{g.student_count} طالب حالي</div>
                  </div>
                  <span className="badge badge-muted">فتح</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="row gap-2 wrap" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>إحصائيات التسجيل</h3>
            <div className="row gap-2 wrap">
              <button className={'chip-filter' + (range === 'today' ? ' is-on' : '')} onClick={() => setRange('today')}>اليوم</button>
              <button className={'chip-filter' + (range === '7' ? ' is-on' : '')} onClick={() => setRange('7')}>7 أيام</button>
              <button className={'chip-filter' + (range === '30' ? ' is-on' : '')} onClick={() => setRange('30')}>30 يومًا</button>
            </div>
          </div>
          {stats && (
            <div className="stats-grid">
              <div className="stat"><div className="stat-n">{stats.total_students}</div><div className="stat-l">إجمالي الطلاب الحاليين</div></div>
              <div className="stat"><div className="stat-n">{stats.registered}</div><div className="stat-l">تم تسجيلهم</div></div>
              <div className="stat"><div className="stat-n">{stats.not_registered}</div><div className="stat-l">لم يُسجَّلوا</div></div>
              <div className="stat"><div className="stat-n">{stats.completion_pct}%</div><div className="stat-l">نسبة الإكمال</div></div>
              <div className="stat"><div className="stat-n">{stats.group_count}</div><div className="stat-l">الحلقات</div></div>
              <div className="stat"><div className="stat-n" style={{ fontSize: '0.9rem' }}>{fmtDate(stats.last_daily_at)}</div><div className="stat-l">آخر تسجيل</div></div>
            </div>
          )}
          {file && file.recent_activity.length > 0 && (
            <>
              <h3 style={{ marginTop: '1rem' }}>آخر النشاط</h3>
              <div className="list">
                {file.recent_activity.map((a, i) => (
                  <div className="list-row" key={i}>
                    <IconCalendar size={18} />
                    <div className="grow">
                      <div className="item-title">{a.group_name}</div>
                      <div className="item-sub">{a.records} تسجيل</div>
                    </div>
                    <span className="muted">{fmtDate(a.record_date)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>سجل إسناد الحلقات</h3>
        {history.length === 0 ? (
          <div className="empty">لا يوجد سجل إسناد.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>الحلقة</th><th>من</th><th>إلى</th><th>السبب</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.group_name || '—'}</td>
                    <td>{fmtDate(h.start_date)}</td>
                    <td>{h.end_date ? fmtDate(h.end_date) : 'الآن'}</td>
                    <td className="muted">{h.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>سجل النشاط الإداري</h3>
        {audit.length === 0 ? (
          <div className="empty">لا توجد عمليات مسجّلة.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>العملية</th><th>الكيان</th><th>التاريخ</th></tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{a.action}</td>
                    <td className="muted">{a.entity_type}</td>
                    <td className="muted">{fmtDate(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEdit && file && <EditTeacherDialog id={id!} current={file} onClose={() => { setShowEdit(false); load() }} />}
      {showReset && id && <ResetPasswordDialog id={id} onClose={() => setShowReset(false)} />}
      {confirmDeact && (
        <Modal
          title="تأكيد تعطيل الحساب"
          onClose={() => setConfirmDeact(false)}
          footer={
            <>
              <button className="btn btn-danger" onClick={onDeactivate}>نعم، تعطيل</button>
              <button className="btn btn-ghost" onClick={() => setConfirmDeact(false)}>إلغاء</button>
            </>
          }
        >
          <p>سيتم منع المعلم من تسجيل الدخول، مع الاحتفاظ بجميع بياناته وتسجيلاته السابقة. يمكنك إعادة تفعيله لاحقًا.</p>
        </Modal>
      )}
    </Layout>
  )
}
