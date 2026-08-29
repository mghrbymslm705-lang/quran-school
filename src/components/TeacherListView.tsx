import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSchoolData } from '../data/useSchoolData'
import { addTeacher, getCircles, getErrorMessage } from '../data/store'
import { Modal, initials } from './ui'
import { IconPlus, IconCircles, IconUser, IconSearch } from './icons'

function AddTeacherDialog({ onClose }: { onClose: () => void }) {
  const circles = useSchoolData((d) => d.circles)
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    phone: '',
    email: '',
    adminNotes: '',
    active: true,
    circleIds: [] as string[]
  })
  const [error, setError] = useState('')

  const set = (k: keyof typeof form, v: string | boolean | string[]) => setForm((f) => ({ ...f, [k]: v }))
  const toggleCircle = (id: string) =>
    setForm((f) => ({
      ...f,
      circleIds: f.circleIds.includes(id) ? f.circleIds.filter((x) => x !== id) : [...f.circleIds, id]
    }))

  const save = async () => {
    if (!form.name.trim() || !form.username.trim() || !form.password) {
      setError('الرجاء إدخال الاسم واسم المستخدم وكلمة المرور')
      return
    }
    try {
      await addTeacher({
        name: form.name,
        username: form.username,
        password: form.password,
        phone: form.phone || undefined,
        email: form.email || undefined,
        adminNotes: form.adminNotes || undefined,
        active: form.active,
        circleIds: form.circleIds
      })
      onClose()
    } catch (e: any) {
      setError(getErrorMessage(e))
    }
  }

  return (
    <Modal
      title="إضافة معلم"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save}>
            حفظ المعلم
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      {error && <div className="auth-error">{error}</div>}
      <div className="grid-2">
        <div className="field">
          <label>الاسم الكامل</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label>اسم المستخدم</label>
          <input className="input" dir="ltr" value={form.username} onChange={(e) => set('username', e.target.value)} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>كلمة المرور الأولية</label>
          <input className="input" type="text" dir="ltr" value={form.password} onChange={(e) => set('password', e.target.value)} />
        </div>
        <div className="field">
          <label>البريد الإلكتروني</label>
          <input className="input" dir="ltr" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>الهاتف</label>
          <input className="input" dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="field">
          <label>ملاحظات إدارية</label>
          <input className="input" value={form.adminNotes} onChange={(e) => set('adminNotes', e.target.value)} />
        </div>
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
              <input type="checkbox" checked={form.circleIds.includes(c.id)} onChange={() => toggleCircle(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}

export function TeacherListView() {
  const [showAdd, setShowAdd] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const data = useSchoolData((d) => ({ teachers: d.teachers, circles: d.circles }))
  const navigate = useNavigate()

  const circleNames = (ids: string[]) =>
    data.circles.filter((c) => ids.includes(c.id)).map((c) => c.name)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.teachers.filter((t) => {
      if (filter === 'active' && !t.active) return false
      if (filter === 'inactive' && t.active) return false
      if (!needle) return true
      return (
        t.name.toLowerCase().includes(needle) ||
        (t.username || '').toLowerCase().includes(needle)
      )
    })
  }, [data.teachers, q, filter])

  return (
    <>
      <div className="toolbar">
        <div className="search-box" style={{ minWidth: 220 }}>
          <IconSearch size={16} />
          <input
            className="input"
            placeholder="بحث بالاسم أو اسم المستخدم…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="row gap-2 wrap">
          <button className={'chip-filter' + (filter === 'all' ? ' is-on' : '')} onClick={() => setFilter('all')}>
            جميع المعلمين
          </button>
          <button className={'chip-filter' + (filter === 'active' ? ' is-on' : '')} onClick={() => setFilter('active')}>
            النشطون
          </button>
          <button className={'chip-filter' + (filter === 'inactive' ? ' is-on' : '')} onClick={() => setFilter('inactive')}>
            المعطلون
          </button>
        </div>
        <div className="grow" />
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <IconPlus size={18} />
          إضافة معلم
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">لا يوجد معلمون مطابقون.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>المعلم</th>
                <th>اسم المستخدم</th>
                <th>الحالة</th>
                <th>الحلقات</th>
                <th>الطلاب الحاليون</th>
                <th>آخر تسجيل</th>
                <th>تاريخ الإنشاء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => navigate('/supervisor/teacher/' + t.id)}>
                  <td>
                    <div className="item-title">
                      <span className="avatar avatar-sm">{initials(t.name)}</span>
                      <span>{t.name}</span>
                    </div>
                  </td>
                  <td dir="ltr" className="muted">{t.username || '—'}</td>
                  <td>
                    <span className={'badge ' + (t.active ? 'badge-success' : 'badge-danger')}>
                      {t.active ? 'نشط' : 'معطّل'}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-muted">
                      <IconCircles size={14} /> {circleNames(t.circleIds).length}
                    </span>
                  </td>
                  <td>{typeof t.studentCount === 'number' ? t.studentCount : '—'}</td>
                  <td className="muted">{t.lastDailyAt || '—'}</td>
                  <td className="muted">{t.createdAt ? t.createdAt.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddTeacherDialog onClose={() => setShowAdd(false)} />}
    </>
  )
}
