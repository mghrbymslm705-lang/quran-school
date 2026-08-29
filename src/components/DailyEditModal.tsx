import { useState } from 'react'
import type { Student, DailyEntry, AttendanceState, MemorizationState, RevisionState } from '../types'
import type { DailyHistoryRow } from '../data/store'
import { patchDaily, postDaily } from '../data/store'
import { Modal } from './ui'

const ATT: { v: AttendanceState; label: string }[] = [
  { v: 'on_time', label: 'حضر في الوقت' },
  { v: 'late', label: 'لم يحضر في الوقت' },
  { v: 'excused_absent', label: 'غياب بعذر' }
]
const MEM: { v: MemorizationState; label: string }[] = [
  { v: 'heard', label: 'سمع اللوح' },
  { v: 'not_heard', label: 'لم يسمع اللوح' }
]
const REV: { v: RevisionState; label: string }[] = [
  { v: 'reviewed', label: 'راجع الورد' },
  { v: 'not_reviewed', label: 'لم يراجع' }
]

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} type="button" className={'seg-btn' + (value === o.v ? ' is-on' : '')} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
      <button type="button" className={'seg-btn' + (value === 'not_recorded' ? ' is-on' : '')} onClick={() => onChange('not_recorded' as T)} title="غير مسجّل">
        ×
      </button>
    </div>
  )
}

export function DailyEditModal({
  student,
  date,
  existing,
  onClose,
  onSaved
}: {
  student: Student
  date: string
  existing?: DailyHistoryRow
  onClose: () => void
  onSaved?: () => void
}) {
  const [attendance, setAttendance] = useState<AttendanceState>((existing?.attendance_status as AttendanceState) || 'not_recorded')
  const [memorization, setMemorization] = useState<MemorizationState>((existing?.memorization_status as MemorizationState) || 'not_recorded')
  const [revision, setRevision] = useState<RevisionState>((existing?.revision_status as RevisionState) || 'not_recorded')
  const [attNote, setAttNote] = useState(existing?.attendance_note || '')
  const [memNote, setMemNote] = useState(existing?.memorization_note || '')
  const [revNote, setRevNote] = useState(existing?.revision_note || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const entry: DailyEntry = {
      studentId: student.id,
      attendance,
      attendanceNote: attNote,
      memorization,
      memorizationNote: memNote,
      memorizationAmount: existing?.memorization_amount || '',
      revision,
      revisionNote: revNote
    }
    try {
      if (existing?.id) await patchDaily(existing.id, entry)
      else await postDaily(student.id, date, entry)
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`تعديل تسجيل ${student.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'جارٍ الحفظ…' : 'حفظ التعديل'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      <div className="muted" style={{ marginBottom: '0.75rem' }}>التاريخ: {date}</div>

      <div className="field">
        <label>الحضور</label>
        <Segmented value={attendance} options={ATT} onChange={setAttendance} />
        <input className="input input-xs" placeholder="ملاحظة الحضور" value={attNote} onChange={(e) => setAttNote(e.target.value)} />
      </div>
      <div className="field">
        <label>اللوح</label>
        <Segmented value={memorization} options={MEM} onChange={setMemorization} />
        <input className="input input-xs" placeholder="ملاحظة اللوح" value={memNote} onChange={(e) => setMemNote(e.target.value)} />
      </div>
      <div className="field">
        <label>الورد</label>
        <Segmented value={revision} options={REV} onChange={setRevision} />
        <input className="input input-xs" placeholder="ملاحظة الورد" value={revNote} onChange={(e) => setRevNote(e.target.value)} />
      </div>

      <div className="audit-note">
        سيتم تسجيل هذا التعديل في <strong>سجل التغييرات</strong> مع ذكر المستخدم والتاريخ والوقت.
      </div>
    </Modal>
  )
}
