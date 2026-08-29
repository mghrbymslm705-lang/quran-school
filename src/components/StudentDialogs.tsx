import { useState } from 'react'
import type { Circle, Student } from '../types'
import { addStudent, updateStudent, getErrorMessage, handleNotFoundError } from '../data/store'
import { useAuth } from '../auth/AuthContext'
import { Modal } from './ui'
import { IconBook } from './icons'

const today = () => new Date().toISOString().slice(0, 10)

export function AddStudentDialog({
  circles,
  student,
  onClose,
  onSaved
}: {
  circles: Circle[]
  student?: Student
  onClose: () => void
  onSaved?: (s: Student) => void
}) {
  const { user } = useAuth()
  const isSupervisor = user?.role === 'supervisor'
  const [form, setForm] = useState({
    name: student?.name ?? '',
    student_code: student?.student_code ?? '',
    circleId: student?.circleId ?? circles[0]?.id ?? '',
    nickname: student?.nickname ?? '',
    birthDate: student?.birthDate ?? '',
    enrollmentDate: student?.enrollmentDate ?? today(),
    status: student?.status ?? 'active',
    note: student?.note ?? '',
    phone: student?.phone ?? '',
    address: student?.address ?? '',
    familyContact: student?.familyContact ?? '',
    healthStatus: student?.healthStatus ?? '',
    healthVisibleToTeacher: student?.healthVisibleToTeacher ?? false,
    behavior: student?.behavior ?? '',
    currentMemorization: student?.currentMemorization ?? '',
    currentMemorizationStatus: student?.currentMemorizationStatus ?? ''
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (saving) return
    if (!form.name.trim()) {
      setError('الرجاء إدخال اسم الطالب')
      return
    }
    if (!form.circleId) {
      setError('الرجاء اختيار الحلقة')
      return
    }
    const payload: Omit<Student, 'id'> = {
      name: form.name.trim(),
      student_code: form.student_code.trim() || undefined,
      circleId: form.circleId,
      nickname: form.nickname.trim() || undefined,
      birthDate: form.birthDate || undefined,
      enrollmentDate: form.enrollmentDate || today(),
      status: form.status,
      note: form.note.trim() || undefined
    }
    if (isSupervisor) {
      payload.phone = form.phone.trim() || undefined
      payload.address = form.address.trim() || undefined
      payload.familyContact = form.familyContact.trim() || undefined
      payload.healthStatus = form.healthStatus.trim() || undefined
      payload.healthVisibleToTeacher = !!form.healthVisibleToTeacher
      payload.behavior = form.behavior.trim() || undefined
      payload.currentMemorization = form.currentMemorization.trim() || undefined
      payload.currentMemorizationStatus = form.currentMemorizationStatus.trim() || undefined
    }
    setSaving(true)
    try {
      if (student) {
        await updateStudent(student.id, payload)
      } else {
        await addStudent(payload)
      }
      onClose()
      onSaved?.(student ?? ({} as Student))
    } catch (e: any) {
      setError(getErrorMessage(e))
      await handleNotFoundError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={student ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'جارٍ الحفظ…' : student ? 'حفظ التعديلات' : 'حفظ الطالب'}
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
          <label>اسم الطالب</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="الاسم الكامل" />
        </div>
        <div className="field">
          <label>رقم الطالب</label>
          <input className="input" value={form.student_code} onChange={(e) => set('student_code', e.target.value)} placeholder="S000" dir="ltr" />
        </div>
      </div>
      <div className="field">
        <label>الحلقة</label>
        <select className="select" value={form.circleId} onChange={(e) => set('circleId', e.target.value)}>
          {circles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>اللقب</label>
          <input className="input" value={form.nickname} onChange={(e) => set('nickname', e.target.value)} />
        </div>
        <div className="field">
          <label>تاريخ التسجيل</label>
          <input className="input" type="date" value={form.enrollmentDate} onChange={(e) => set('enrollmentDate', e.target.value)} dir="ltr" />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>تاريخ الميلاد</label>
          <input className="input" type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} dir="ltr" />
        </div>
        <div className="field">
          <label>الحالة</label>
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">نشط</option>
            <option value="suspended">موقوف</option>
            <option value="transferred">منقول</option>
            <option value="withdrawn">منسحب</option>
            <option value="archived">مؤرشف</option>
          </select>
        </div>
      </div>

      {isSupervisor && (
        <>
          <div className="divider" />
          <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            حقول خاصة (مشرف فقط) — لا تظهر للمعلم
          </div>
          <div className="grid-2">
            <div className="field">
              <label>هاتف ولي الأمر</label>
              <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" />
            </div>
            <div className="field">
              <label>جهة الاتصال بالأسرة</label>
              <input className="input" value={form.familyContact} onChange={(e) => set('familyContact', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>العنوان</label>
            <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>الحالة الصحية</label>
              <input className="input" value={form.healthStatus} onChange={(e) => set('healthStatus', e.target.value)} />
            </div>
            <div className="field row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              <label className="switch" style={{ margin: 0 }}>
                <input type="checkbox" checked={!!form.healthVisibleToTeacher} onChange={(e) => set('healthVisibleToTeacher', e.target.checked)} />
                عرض الحالة الصحية للمعلم
              </label>
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>السلوك</label>
              <input className="input" value={form.behavior} onChange={(e) => set('behavior', e.target.value)} />
            </div>
            <div className="field">
              <label>المتسمع الحالي</label>
              <input className="input" value={form.currentMemorization} onChange={(e) => set('currentMemorization', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>حالة المتسمع الحالي</label>
            <select className="select" value={form.currentMemorizationStatus} onChange={(e) => set('currentMemorizationStatus', e.target.value)}>
              <option value="">—</option>
              <option value="mastered">متقن</option>
              <option value="needs_review">يحتاج مراجعة</option>
              <option value="not_evaluated">غير مقيّم</option>
            </select>
          </div>
        </>
      )}

      <div className="divider" />
      <div className="field">
        <label>ملاحظات الإدارة</label>
        <textarea className="input" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
      </div>
    </Modal>
  )
}

export function StudentFileDialog({
  student,
  circleName,
  role,
  onClose
}: {
  student: Student
  circleName?: string
  role?: string
  onClose: () => void
}) {
  const isSupervisor = role === 'supervisor'
  const rows: [string, string | undefined][] = [
    ['الحلقة', circleName],
    ['اللقب', student.nickname],
    ['المتسمع الحالي', student.currentMemorization],
    ['السلوك', student.behavior],
    ['الحالة الصحية', student.healthStatus],
    ['تاريخ الميلاد', student.birthDate],
    ['تاريخ التسجيل', student.enrollmentDate],
    ['ملاحظات', student.note]
  ]
  const privateRows: [string, string | undefined][] = [
    ['هاتف ولي الأمر', student.phone],
    ['جهة الاتصال بالأسرة', student.familyContact],
    ['العنوان', student.address]
  ]
  return (
    <Modal title="ملف الطالب" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>إغلاق</button>}>
      <div className="row gap-3" style={{ marginBottom: '1rem' }}>
        <div className="avatar" style={{ width: 56, height: 56, fontSize: '1.2rem' }}>
          {student.name.replace(/^أ\.?\s*/, '').trim()[0]}
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{student.name}</div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            رقم الطالب: {student.student_code || student.id}
          </div>
        </div>
      </div>
      <div className="divider" />
      {rows.map(([label, value]) => (
        <div key={label} className="row" style={{ justifyContent: 'space-between', padding: '0.4rem 0' }}>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {label}
          </span>
          <span style={{ fontWeight: 600, textAlign: 'end' }}>{value || '—'}</span>
        </div>
      ))}
      {isSupervisor && (
        <>
          <div className="divider" />
          <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>
            <IconBook size={13} /> بيانات خاصة (مشرف فقط)
          </div>
          {privateRows.map(([label, value]) => (
            <div key={label} className="row" style={{ justifyContent: 'space-between', padding: '0.4rem 0' }}>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {label}
              </span>
              <span style={{ fontWeight: 600, textAlign: 'end' }}>{value || '—'}</span>
            </div>
          ))}
        </>
      )}
    </Modal>
  )
}
