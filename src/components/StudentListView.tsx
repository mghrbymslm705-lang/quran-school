import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSchoolData } from '../data/useSchoolData'
import { useAuth } from '../auth/AuthContext'
import {
  getStudents,
  getCircles,
  getTeacher,
  transferStudent,
  archiveStudent,
  reactivateStudent
} from '../data/store'
import { AddStudentDialog, StudentFileDialog } from './StudentDialogs'
import { Modal, initials, EmptyState } from './ui'
import { IconSearch, IconPlus, IconUser } from './icons'

export function TransferDialog({ student, circles, onClose }: { student: any; circles: any[]; onClose: () => void }) {
  const currentCircle = circles.find((c) => c.id === student.circleId)
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const targetCircle = circles.find((c) => c.id === target)
  const confirm = async () => {
    if (!target) {
      setError('الرجاء اختيار الحلقة الوجهة')
      return
    }
    await transferStudent(student.id, target)
    onClose()
  }
  return (
    <Modal
      title="نقل الطالب إلى حلقة أخرى"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={confirm}>
            تأكيد النقل
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      {error && <div className="auth-error">{error}</div>}
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        هل أنت متأكد من نقل الطالب <strong>{student.name}</strong> من حلقة{' '}
        <strong>{currentCircle?.name || '—'}</strong> إلى حلقة{' '}
        <strong>{targetCircle?.name || '—'}</strong>؟
      </p>
      <div className="field">
        <label>الحلقة الوجهة</label>
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">اختر الحلقة…</option>
          {circles
            .filter((c) => c.id !== student.circleId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
        يبقى السجل اليومي السابق وتاريخ انتساب الحلقة القديمة كما هو.
      </div>
    </Modal>
  )
}

export function ArchiveDialog({ student, onClose }: { student: any; onClose: () => void }) {
  const confirm = async () => {
    await archiveStudent(student.id)
    onClose()
  }
  return (
    <Modal
      title="أرشفة الطالب"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger" onClick={confirm}>
            تأكيد الأرشفة
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <p className="muted">
        هل أنت متأكد من أرشفة الطالب <strong>{student.name}</strong>؟ لن يُحذف الطالب ولا سجله، بل
        يُخفى من القوائم التشغيلية ويبقى سجله التاريخي متاحًا للمشرف.
      </p>
    </Modal>
  )
}

export function ReactivateDialog({ student, circles, onClose }: { student: any; circles: any[]; onClose: () => void }) {
  const [target, setTarget] = useState(student.circleId || circles[0]?.id || '')
  const confirm = async () => {
    await reactivateStudent(student.id, target || undefined)
    onClose()
  }
  return (
    <Modal
      title="إعادة تفعيل الطالب"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={confirm}>
            تأكيد التفعيل
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        إعادة تفعيل الطالب <strong>{student.name}</strong> مع الحفاظ على كامل تاريخه السابق.
      </p>
      <div className="field">
        <label>الحلقة (اختياري)</label>
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {circles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  )
}

export function StudentListView({
  circleIds,
  canAdd
}: {
  circleIds?: string[]
  canAdd: boolean
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isSupervisor = user?.role === 'supervisor'
  const openFile = (s: any) => {
    if (isSupervisor) navigate('/supervisor/student/' + s.id)
    else setOpenId(s.id)
  }
  const [query, setQuery] = useState('')
  const [circleFilter, setCircleFilter] = useState('')
  const [teacherFilter, setTeacherFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active')
  const [showAdd, setShowAdd] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [transferId, setTransferId] = useState<string | null>(null)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [reactivateId, setReactivateId] = useState<string | null>(null)

  const data = useSchoolData((d) => ({
    students: getStudents(circleIds ? { circleIds } : undefined),
    circles: getCircles(),
    teachers: d.teachers
  }))

  const circleName = (id: string) => data.circles.find((c) => c.id === id)?.name ?? '—'
  const teacherName = (id: string) => getTeacher(id)?.name ?? '—'
  const circleTeacherId = (id: string) => data.circles.find((c) => c.id === id)?.teacherId ?? ''

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.students.filter((s) => {
      if (q && !(s.name.toLowerCase().includes(q) || (s.student_code || '').toLowerCase().includes(q))) return false
      if (circleFilter && s.circleId !== circleFilter) return false
      if (teacherFilter && circleTeacherId(s.circleId) !== teacherFilter) return false
      if (statusFilter === 'active' && s.status === 'archived') return false
      if (statusFilter === 'archived' && s.status !== 'archived') return false
      return true
    })
  }, [data.students, query, circleFilter, teacherFilter, statusFilter])

  const byId = (id: string | null) => (id ? data.students.find((s) => s.id === id) : undefined)
  const openStudent = byId(openId)
  const transferStudentRow = byId(transferId)
  const archiveStudentRow = byId(archiveId)
  const reactivateStudentRow = byId(reactivateId)

  return (
    <>
      <div className="toolbar wrap">
        <div className="search-box">
          <IconSearch size={18} />
          <input
            className="input"
            placeholder="ابحث بالاسم أو رقم الطالب…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="select select-sm" value={circleFilter} onChange={(e) => setCircleFilter(e.target.value)}>
          <option value="">كل الحلقات</option>
          {data.circles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="select select-sm" value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)}>
          <option value="">كل المعلمين</option>
          {data.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="select select-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
        >
          <option value="active">نشط</option>
          <option value="archived">مؤرشف</option>
          <option value="all">الكل</option>
        </select>
        {canAdd && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <IconPlus size={18} />
            إضافة طالب
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState text="لا يوجد طلاب مطابقون" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>رقم الطالب</th>
                <th>الاسم</th>
                <th>الكنية</th>
                <th>الحلقة</th>
                <th>المعلم</th>
                <th>الحالة</th>
                <th>المحفوظ الحالي</th>
                <th>السلوك</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td dir="ltr">{s.student_code || '—'}</td>
                  <td>
                    <button className="link-btn" onClick={() => openFile(s)}>
                      {s.name}
                    </button>
                  </td>
                  <td>{s.nickname || '—'}</td>
                  <td>{circleName(s.circleId)}</td>
                  <td>{teacherName(circleTeacherId(s.circleId))}</td>
                  <td>
                    <span className={`badge ${s.status === 'archived' ? 'badge-muted' : 'badge-success'}`}>
                      {s.status === 'archived' ? 'مؤرشف' : 'نشط'}
                    </span>
                  </td>
                  <td>{s.currentMemorization || '—'}</td>
                  <td>{s.behavior || '—'}</td>
                  <td className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                    {isSupervisor && s.status !== 'archived' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setTransferId(s.id)}>
                        نقل
                      </button>
                    )}
                    {isSupervisor && s.status !== 'archived' && (
                      <button className="btn btn-soft btn-sm" onClick={() => setEditId(s.id)}>
                        تعديل
                      </button>
                    )}
                    {isSupervisor && s.status === 'archived' && (
                      <button className="btn btn-soft btn-sm" onClick={() => setReactivateId(s.id)}>
                        تفعيل
                      </button>
                    )}
                    {isSupervisor && s.status !== 'archived' && (
                      <button className="btn btn-danger btn-sm" onClick={() => setArchiveId(s.id)}>
                        أرشفة
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && canAdd && (
        <AddStudentDialog
          circles={circleIds ? data.circles.filter((c) => circleIds.includes(c.id)) : data.circles}
          onClose={() => setShowAdd(false)}
        />
      )}

      {openStudent && (
        <StudentFileDialog
          student={openStudent}
          circleName={circleName(openStudent.circleId)}
          role={user?.role}
          onClose={() => setOpenId(null)}
        />
      )}

      {editId && (
        <AddStudentDialog
          circles={circleIds ? data.circles.filter((c) => circleIds.includes(c.id)) : data.circles}
          student={byId(editId)}
          onClose={() => setEditId(null)}
        />
      )}

      {transferStudentRow && (
        <TransferDialog student={transferStudentRow} circles={data.circles} onClose={() => setTransferId(null)} />
      )}
      {archiveStudentRow && <ArchiveDialog student={archiveStudentRow} onClose={() => setArchiveId(null)} />}
      {reactivateStudentRow && (
        <ReactivateDialog
          student={reactivateStudentRow}
          circles={data.circles}
          onClose={() => setReactivateId(null)}
        />
      )}
    </>
  )
}
