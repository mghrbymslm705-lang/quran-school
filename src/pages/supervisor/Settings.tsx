import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { Layout } from '../../components/Layout'
import { useDeviceMode } from '../../hooks/useDeviceMode'
import { updateMe, changeMyPassword, getSchoolSettings, updateSchoolSettings, getErrorMessage, handleNotFoundError } from '../../data/store'
import type { SchoolSettings } from '../../data/store'

const THEME_KEY = 'school_theme'

function applyTheme(value: string) {
  const html = document.documentElement
  if (value === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    html.dataset.theme = prefersDark ? 'dark' : 'light'
  } else {
    html.dataset.theme = value
  }
}

export function Settings() {
  const { user, updateUser } = useAuth()
  const { mode, set: setDeviceMode } = useDeviceMode()
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'light')

  // --- بيانات الحساب ---
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)

  // --- كلمة المرور ---
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [pwSaving, setPwSaving] = useState(false)

  // --- معلومات المؤسسة ---
  const [school, setSchool] = useState<SchoolSettings>({ name: '', description: '', address: '', phone: '', email: '' })
  const [schoolEdit, setSchoolEdit] = useState(false)
  const [schoolDraft, setSchoolDraft] = useState<SchoolSettings>({ name: '', description: '', address: '', phone: '', email: '' })
  const [schoolMsg, setSchoolMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [schoolSaving, setSchoolSaving] = useState(false)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(THEME_KEY, theme)
    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => { document.documentElement.dataset.theme = e.matches ? 'dark' : 'light' }
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
  }, [theme])

  useEffect(() => {
    getSchoolSettings().then(setSchool).catch(() => {})
  }, [])

  // --- بيانات الحساب ---
  function startEdit() {
    setFullName(user?.name || '')
    setUsername(user?.username || '')
    setEmail(user?.email || '')
    setProfileMsg(null)
    setEditing(true)
  }

  async function saveProfile() {
    setProfileMsg(null)
    setProfileSaving(true)
    try {
      const res = await updateMe({ full_name: fullName, username, email: email || undefined })
      updateUser({ name: res.user.full_name, username: res.user.username, email: res.user.email })
      setProfileMsg({ type: 'ok', text: 'تم تحديث البيانات بنجاح' })
      setEditing(false)
    } catch (e: any) {
      setProfileMsg({ type: 'err', text: getErrorMessage(e) })
      await handleNotFoundError(e)
    } finally {
      setProfileSaving(false)
    }
  }

  async function savePassword() {
    setPwMsg(null)
    setPwSaving(true)
    try {
      await changeMyPassword({ current_password: currentPw, new_password: newPw, confirm_password: confirmPw })
      setPwMsg({ type: 'ok', text: 'تم تغيير كلمة المرور بنجاح' })
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch (e: any) {
      setPwMsg({ type: 'err', text: getErrorMessage(e) })
      await handleNotFoundError(e)
    } finally {
      setPwSaving(false)
    }
  }

  // --- معلومات المؤسسة ---
  function startSchoolEdit() {
    setSchoolDraft({ ...school })
    setSchoolMsg(null)
    setSchoolEdit(true)
  }

  async function saveSchool() {
    setSchoolMsg(null)
    setSchoolSaving(true)
    try {
      const res = await updateSchoolSettings(schoolDraft)
      setSchool(res)
      setSchoolMsg({ type: 'ok', text: 'تم حفظ معلومات المؤسسة بنجاح' })
      setSchoolEdit(false)
    } catch (e: any) {
      setSchoolMsg({ type: 'err', text: getErrorMessage(e) })
      await handleNotFoundError(e)
    } finally {
      setSchoolSaving(false)
    }
  }

  return (
    <Layout title="الإعدادات" subtitle="تحكّم في مظهر المنصة وبياناتك وإعدادات المؤسسة">
      <div className="settings-grid">
        {/* المظهر */}
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">المظهر</div>
              <div className="card-sub">الوضع الليلي والنهاري</div>
            </div>
          </div>
          <div className="field">
            <label>نمط العرض</label>
            <select className="input select" value={theme} onChange={e => setTheme(e.target.value)}>
              <option value="light">نهاري</option>
              <option value="dark">ليلي</option>
              <option value="system">حسب إعدادات الجهاز</option>
            </select>
          </div>
        </section>

        {/* نوع الجهاز */}
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">نوع الجهاز وطريقة العرض</div>
              <div className="card-sub">تحسين تخطيط الواجهة حسب طريقة الاستخدام</div>
            </div>
          </div>
          <div className="settings-device-options">
            <button className={'seg-btn' + (mode === 'auto' ? ' is-on' : '')} onClick={() => setDeviceMode('auto')}>
              <span className="seg-icon">📱</span><span>تلقائي حسب الشاشة</span>
            </button>
            <button className={'seg-btn' + (mode === 'mobile' ? ' is-on' : '')} onClick={() => setDeviceMode('mobile')}>
              <span className="seg-icon">📱</span><span>وضع الهاتف</span>
            </button>
            <button className={'seg-btn' + (mode === 'desktop' ? ' is-on' : '')} onClick={() => setDeviceMode('desktop')}>
              <span className="seg-icon">🖥️</span><span>وضع الحاسوب</span>
            </button>
          </div>
        </section>

        {/* بيانات الحساب */}
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">بيانات الحساب</div>
              <div className="card-sub">عرض وتعديل معلومات حسابك</div>
            </div>
          </div>
          {!editing ? (
            <div className="profile-display">
              <div className="profile-field"><span className="profile-label">الاسم الكامل</span><span>{user?.name || '—'}</span></div>
              <div className="profile-field"><span className="profile-label">اسم المستخدم</span><span>{user?.username || '—'}</span></div>
              <div className="profile-field"><span className="profile-label">البريد الإلكتروني</span><span>{user?.email || '—'}</span></div>
              <div className="profile-field"><span className="profile-label">الدور</span><span>مشرف</span></div>
              <button className="btn" onClick={startEdit}>تعديل البيانات</button>
            </div>
          ) : (
            <div className="profile-form">
              <div className="field"><label>الاسم الكامل</label><input className="input" value={fullName} onChange={e => setFullName(e.target.value)} /></div>
              <div className="field"><label>اسم المستخدم</label><input className="input" value={username} onChange={e => setUsername(e.target.value)} /></div>
              <div className="field"><label>البريد الإلكتروني</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div className="field"><label>الدور</label><input className="input" value="مشرف" disabled /></div>
              {profileMsg && <div className={'msg-' + profileMsg.type}>{profileMsg.text}</div>}
              <div className="row gap-2">
                <button className="btn" onClick={saveProfile} disabled={profileSaving}>{profileSaving ? 'جاري الحفظ...' : 'حفظ'}</button>
                <button className="btn btn-ghost" onClick={() => setEditing(false)}>إلغاء</button>
              </div>
            </div>
          )}
        </section>

        {/* تغيير كلمة المرور */}
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">تغيير كلمة المرور</div>
            </div>
          </div>
          <div className="profile-form">
            <div className="field"><label>كلمة المرور الحالية</label><input className="input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} /></div>
            <div className="field"><label>كلمة المرور الجديدة</label><input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} /></div>
            <div className="field"><label>تأكيد كلمة المرور</label><input className="input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} /></div>
            {pwMsg && <div className={'msg-' + pwMsg.type}>{pwMsg.text}</div>}
            <button className="btn" onClick={savePassword} disabled={pwSaving}>{pwSaving ? 'جاري...' : 'تغيير كلمة المرور'}</button>
          </div>
        </section>

        {/* معلومات المؤسسة */}
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">معلومات المؤسسة</div>
              <div className="card-sub">بيانات المؤسسة التي تظهر في التقارير</div>
            </div>
          </div>
          {!schoolEdit ? (
            <div className="profile-display">
              <div className="profile-field"><span className="profile-label">اسم المؤسسة</span><span>{school.name || '—'}</span></div>
              <div className="profile-field"><span className="profile-label">الوصف</span><span>{school.description || '—'}</span></div>
              <div className="profile-field"><span className="profile-label">العنوان</span><span>{school.address || '—'}</span></div>
              <div className="profile-field"><span className="profile-label">الهاتف</span><span>{school.phone || '—'}</span></div>
              <div className="profile-field"><span className="profile-label">البريد الإلكتروني</span><span>{school.email || '—'}</span></div>
              <button className="btn" onClick={startSchoolEdit}>تعديل معلومات المؤسسة</button>
            </div>
          ) : (
            <div className="profile-form">
              <div className="field"><label>اسم المؤسسة *</label><input className="input" value={schoolDraft.name} onChange={e => setSchoolDraft({ ...schoolDraft, name: e.target.value })} /></div>
              <div className="field"><label>الوصف المختصر</label><input className="input" value={schoolDraft.description} onChange={e => setSchoolDraft({ ...schoolDraft, description: e.target.value })} /></div>
              <div className="field"><label>العنوان</label><input className="input" value={schoolDraft.address} onChange={e => setSchoolDraft({ ...schoolDraft, address: e.target.value })} /></div>
              <div className="field"><label>رقم الهاتف</label><input className="input" value={schoolDraft.phone} onChange={e => setSchoolDraft({ ...schoolDraft, phone: e.target.value })} /></div>
              <div className="field"><label>البريد الإلكتروني</label><input className="input" type="email" value={schoolDraft.email} onChange={e => setSchoolDraft({ ...schoolDraft, email: e.target.value })} /></div>
              {schoolMsg && <div className={'msg-' + schoolMsg.type}>{schoolMsg.text}</div>}
              <div className="row gap-2">
                <button className="btn" onClick={saveSchool} disabled={schoolSaving}>{schoolSaving ? 'جاري الحفظ...' : 'حفظ'}</button>
                <button className="btn btn-ghost" onClick={() => setSchoolEdit(false)}>إلغاء</button>
              </div>
            </div>
          )}
        </section>

      </div>
    </Layout>
  )
}
