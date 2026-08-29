import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { IconX } from '../../components/icons'
import {
  getDataManagementSummary,
  createDataBackup,
  deleteStudentPermanent,
  deleteTeacherPermanent,
  archiveGroup,
  deleteGroupPermanent,
  refreshAll,
  getStudents,
  getTeachers,
  getCircles,
  getErrorMessage
} from '../../data/store'
import type { Student, Teacher, Circle } from '../../types'

type Summary = {
  students: { active: number; archived: number; total: number }
  teachers: { active: number; inactive: number; total: number }
  groups: { active: number; inactive: number; total: number }
  dailyRecords: number
  auditLogs: number
}

type ModalState = {
  kind: 'student' | 'teacher' | 'group' | 'groupArchive'
  id?: string
  name?: string
  title: string
  warning: string
  requireTyped: boolean
} | null

function ConfirmModal({
  modal,
  backup,
  busy,
  error,
  onBackupChange,
  onConfirm,
  onCancel
}: {
  modal: NonNullable<ModalState>
  backup: boolean
  busy: boolean
  error: string | null
  onBackupChange: (v: boolean) => void
  onConfirm: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  useEffect(() => {
    setText('')
  }, [modal])
  const ok = modal.requireTyped
    ? text.trim() === 'حذف' || (modal.name != null && text.trim() === modal.name.trim())
    : true
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚠️ {modal.title}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="إغلاق">
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          <p className="warn-text">{modal.warning}</p>
          {modal.name && (
            <div className="confirm-detail">
              <span>{modal.kind === 'group' || modal.kind === 'groupArchive' ? 'الحلقة' : 'الاسم'}:</span>{' '}
              <strong>{modal.name}</strong>
            </div>
          )}
          {modal.requireTyped && (
            <div className="field">
              <label>
                اكتب «حذف»
                {modal.name ? ` أو «${modal.name}»` : ''} للتأكيد:
              </label>
              <input
                className="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                placeholder="حذف"
              />
            </div>
          )}
          <label className="backup-check">
            <input type="checkbox" checked={backup} onChange={(e) => onBackupChange(e.target.checked)} /> 💾 إنشاء
            نسخة احتياطية أوّلًا
          </label>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button className="btn btn-danger" onClick={() => onConfirm(text)} disabled={!ok || busy}>
            {busy ? 'جارٍ التنفيذ…' : '🗑️ حذف نهائي'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DataManagement() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [backup, setBackup] = useState<{ status: 'idle' | 'ok' | 'err'; msg?: string; file?: string; at?: string }>({
    status: 'idle'
  })
  const [backupBusy, setBackupBusy] = useState(false)

  const [toast, setToast] = useState<string | null>(null)

  // نافذة التأكيد
  const [modal, setModal] = useState<ModalState>(null)
  const [modalBackup, setModalBackup] = useState(false)
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const students = getStudents()
  const teachers = getTeachers()
  const circles = getCircles()

  const loadSummary = async () => {
    try {
      const s = await getDataManagementSummary()
      setSummary(s)
      setLoadErr(null)
    } catch (e) {
      setLoadErr(getErrorMessage(e, 'تعذّر تحميل ملخّص إدارة البيانات'))
    }
  }

  useEffect(() => {
    refreshAll().catch(() => {})
    loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const onBackupClick = async () => {
    setBackupBusy(true)
    setBackup({ status: 'idle' })
    try {
      const r = await createDataBackup()
      setBackup({ status: 'ok', file: r.file, at: r.createdAt })
      flash('تم إنشاء النسخة الاحتياطية بنجاح')
    } catch (e) {
      setBackup({ status: 'err', msg: getErrorMessage(e, 'تعذّر إنشاء النسخة الاحتياطية') })
    } finally {
      setBackupBusy(false)
    }
  }

  const openModal = (m: NonNullable<ModalState>) => {
    setModal(m)
    setModalError(null)
    setModalBackup(false)
  }

  const onConfirm = async (text: string) => {
    if (!modal) return
    setModalBusy(true)
    setModalError(null)
    try {
      if (modal.kind === 'student') await deleteStudentPermanent(modal.id!, text, modalBackup)
      else if (modal.kind === 'teacher') await deleteTeacherPermanent(modal.id!, text, modalBackup)
      else if (modal.kind === 'group') await deleteGroupPermanent(modal.id!, text, modalBackup)
      else if (modal.kind === 'groupArchive') await archiveGroup(modal.id!)
      setModal(null)
      setModalBackup(false)
      await loadSummary()
      flash('تمت العملية بنجاح وسُجّلت في سجل التدقيق')
    } catch (e) {
      setModalError(getErrorMessage(e, 'تعذّر تنفيذ العملية'))
    } finally {
      setModalBusy(false)
    }
  }

  const studentOptions = useMemo(() => students, [students])
  const teacherOptions = useMemo(() => teachers, [teachers])
  const circleOptions = useMemo(() => circles, [circles])

  return (
    <Layout title="إدارة البيانات" subtitle="حذف آمن وتنظيف قاعدة البيانات — للمشرف فقط">
      {toast && <div className="banner banner-ok">{toast}</div>}
      {loadErr && <div className="form-error">{loadErr}</div>}

      {/* النسخ الاحتياطي قبل الحذف */}
      <div className="card dm-backup">
        <div className="card-head">
          <div>
            <div className="card-title">💾 النسخ الاحتياطي قبل الحذف</div>
            <div className="card-sub">أنشئ نسخة من قاعدة البيانات قبل أي حذف جماعي أو نهائي.</div>
          </div>
          <button className="btn btn-soft" onClick={onBackupClick} disabled={backupBusy}>
            {backupBusy ? 'جارٍ…' : '💾 إنشاء نسخة احتياطية الآن'}
          </button>
        </div>
        {backup.status === 'ok' && (
          <div className="banner banner-ok">
            تم إنشاء النسخة الاحتياطية بنجاح
            <div className="backup-meta">
              التاريخ: {new Date(backup.at || '').toLocaleString('ar')}
              <br />
              الملف: <code>{backup.file}</code>
            </div>
          </div>
        )}
        {backup.status === 'err' && <div className="form-error">{backup.msg}</div>}
      </div>

      {/* الطلاب */}
      <div className="dm-grid">
        <div className="card">
          <div className="card-head">
            <div className="card-title">👨‍🎓 الطلاب</div>
          </div>
          <div className="stats-grid">
            <div className="stat">
              <div className="stat-value">{summary?.students.active ?? '—'}</div>
              <div className="stat-label">النشطون</div>
            </div>
            <div className="stat">
              <div className="stat-value">{summary?.students.archived ?? '—'}</div>
              <div className="stat-label">المؤرشفون</div>
            </div>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/supervisor/students">
            إدارة الطلاب
          </Link>
          <div className="danger-zone">
            <div className="dz-title">⚠️ منطقة الحذف النهائي</div>
            <div className="field">
              <label>اختر طالبًا لحذفه نهائيًا:</label>
              <select
                className="select"
                defaultValue=""
                onChange={(e) => {
                  const s = studentOptions.find((x: Student) => x.id === e.target.value)
                  if (s)
                    openModal({
                      kind: 'student',
                      id: s.id,
                      name: s.name,
                      title: 'حذف نهائي لطالب',
                      warning:
                        'سيتم حذف الطالب وجميع البيانات المرتبطة به (السجل اليومي، الحفظ، المراجعة، الملاحظات، تاريخ النقل) نهائيًا، ولا يمكن التراجع عن العملية.',
                      requireTyped: true
                    })
                }}
              >
                <option value="" disabled>
                  — اختر طالبًا —
                </option>
                {studentOptions.map((s: Student) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.student_code})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* المعلمون */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">👨‍🏫 المعلمون</div>
          </div>
          <div className="stats-grid">
            <div className="stat">
              <div className="stat-value">{summary?.teachers.active ?? '—'}</div>
              <div className="stat-label">النشطون</div>
            </div>
            <div className="stat">
              <div className="stat-value">{summary?.teachers.inactive ?? '—'}</div>
              <div className="stat-label">المعطّلون</div>
            </div>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/supervisor/teachers">
            إدارة المعلمين
          </Link>
          <div className="danger-zone">
            <div className="dz-title">⚠️ منطقة الحذف النهائي</div>
            <div className="field">
              <label>اختر معلمًا لحذفه نهائيًا:</label>
              <select
                className="select"
                defaultValue=""
                onChange={(e) => {
                  const t = teacherOptions.find((x: Teacher) => x.id === e.target.value)
                  if (t)
                    openModal({
                      kind: 'teacher',
                      id: t.id,
                      name: t.name,
                      title: 'حذف نهائي لمعلم',
                      warning:
                        'سيتم حذف حساب المعلم وبياناته نهائيًا. لا يمكن الحذف إن كان المعلم مرتبطًا بحلقة نشطة حاليًا (افصل الإسناد أولًا). ولا يمكن التراجع.',
                      requireTyped: true
                    })
                }}
              >
                <option value="" disabled>
                  — اختر معلمًا —
                </option>
                {teacherOptions.map((t: Teacher) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.active ? 'نشط' : 'معطّل'})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* الحلقات */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">⭕ الحلقات</div>
          </div>
          <div className="stats-grid">
            <div className="stat">
              <div className="stat-value">{summary?.groups.active ?? '—'}</div>
              <div className="stat-label">النشطة</div>
            </div>
            <div className="stat">
              <div className="stat-value">{summary?.groups.inactive ?? '—'}</div>
              <div className="stat-label">المعطّلة</div>
            </div>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/supervisor/circles">
            إدارة الحلقات
          </Link>
          <div className="danger-zone">
            <div className="dz-title">⚠️ منطقة الحذف النهائي</div>
            <div className="field">
              <label>اختر حلقة لحذفها نهائيًا:</label>
              <select
                className="select"
                defaultValue=""
                onChange={(e) => {
                  const g = circleOptions.find((x: Circle) => x.id === e.target.value)
                  if (g) {
                    openModal({
                      kind: 'group',
                      id: g.id,
                      name: g.name,
                      title: 'حذف نهائي للحلقة',
                      warning:
                        'سيتم حذف الحلقة نهائيًا. لا يمكن الحذف إن كانت تضم طلابًا نشطين (انقل الطلاب أو أرشفهم أولًا). تبقى السجلات اليومية التاريخية محفوظة.',
                      requireTyped: true
                    })
                  }
                }}
              >
                <option value="" disabled>
                  — اختر حلقة —
                </option>
                {circleOptions.map((g: Circle) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.status === 'active' ? 'نشطة' : 'معطّلة'})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>أرشفة حلقة (إخفاؤها مع الإبقاء على بياناتها):</label>
              <select
                className="select"
                defaultValue=""
                onChange={(e) => {
                  const g = circleOptions.find((x: Circle) => x.id === e.target.value)
                  if (g) {
                    openModal({
                      kind: 'groupArchive',
                      id: g.id,
                      name: g.name,
                      title: 'أرشفة الحلقة',
                      warning: 'سيتم إخفاء الحلقة من القوائم العادية مع الإبقاء على جميع بياناتها. يمكن استرجاعها لاحقًا.',
                      requireTyped: false
                    })
                  }
                }}
              >
                <option value="" disabled>
                  — اختر حلقة —
                </option>
                {circleOptions.map((g: Circle) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* سجل التدقيق */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">📜 سجل التدقيق</div>
          <div className="card-sub">سجلّ جميع العمليات الإدارية المهمة، مع أدوات البحث والحذف الآمن.</div>
        </div>
        <div className="dm-actions">
          <Link className="btn btn-soft" to="/supervisor/audit">
            🔎 فتح سجل التدقيق وأدوات التنظيف
          </Link>
        </div>
      </div>

      {modal && (
        <ConfirmModal
          modal={modal}
          backup={modalBackup}
          busy={modalBusy}
          error={modalError}
          onBackupChange={setModalBackup}
          onConfirm={onConfirm}
          onCancel={() => setModal(null)}
        />
      )}
    </Layout>
  )
}
