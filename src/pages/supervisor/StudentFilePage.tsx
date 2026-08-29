import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { useSchoolData } from '../../data/useSchoolData'
import {
  getStudent,
  getCircles,
  getTeacher,
  getStudentHistory,
  getStudentStats,
  getStudentGroupHistory,
  refreshAll,
  type DailyHistoryRow,
  type GroupHistoryRow
} from '../../data/store'
import { AttendanceChip, MemorizationChip, RevisionChip } from '../../components/StatusChips'
import { DailyEditModal } from '../../components/DailyEditModal'
import { AddStudentDialog, StudentFileDialog } from '../../components/StudentDialogs'
import { TransferDialog, ArchiveDialog, ReactivateDialog } from '../../components/StudentListView'
import { EmptyState } from '../../components/States'
import type { Student } from '../../types'

const RANGES = [
  { v: 7, label: 'آخر 7 أيام' },
  { v: 30, label: 'آخر 30 يومًا' },
  { v: 0, label: 'كل الفترة' }
]

// قسم واضح داخل ملف الطالب (يساعد على فصل المعلومات حسب نوعها وصلاحيتها)
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card section">
      <div className="section-head">
        <h3>{title}</h3>
        {hint && <span className="muted section-hint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function StudentFilePage() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [range, setRange] = useState(7)
  const [editRec, setEditRec] = useState<DailyHistoryRow | null>(null)
  const [editStudent, setEditStudent] = useState(false)
  const [transfer, setTransfer] = useState(false)
  const [archive, setArchive] = useState(false)
  const [reactivate, setReactivate] = useState(false)
  const [groupHistory, setGroupHistory] = useState<GroupHistoryRow[]>([])

  const data = useSchoolData((d) => ({
    students: d.students,
    circles: d.circles,
    teachers: d.teachers,
    daily: d.daily
  }))
  const student = data.students.find((s) => s.id === id)
  const circle = student ? data.circles.find((c) => c.id === student.circleId) : undefined
  const teacherName = circle ? getTeacher(circle.teacherId)?.name : '—'
  const history = student ? getStudentHistory(student.id) : []
  const stats = student ? getStudentStats(student.id, range) : null

  useEffect(() => {
    if (!student) return
    let active = true
    getStudentGroupHistory(student.id)
      .then((h) => active && setGroupHistory(h))
      .catch(() => active && setGroupHistory([]))
    return () => {
      active = false
    }
  }, [student])

  if (!student) {
    return (
      <Layout title="ملف الطالب" subtitle="">
        <div className="empty">الطالب غير موجود.</div>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
          رجوع
        </button>
      </Layout>
    )
  }

  const isArchived = student.status === 'archived'
  const s = student as Student

  const sectionRow = (label: string, value?: string) => (
    <div className="row" style={{ justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, textAlign: 'end' }}>{value || '—'}</span>
    </div>
  )

  return (
    <Layout title={s.name} subtitle="ملف الطالب الإداري والتربوي">
      <div className="page-head">
        <div>
          <h2>{s.name}</h2>
          <p>رقم الطالب: {s.student_code || s.id}</p>
        </div>
        <div className="row gap-2">
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>
            رجوع
          </button>
          {!isArchived && (
            <>
              <button className="btn btn-soft" onClick={() => setEditStudent(true)}>
                تعديل
              </button>
              <button className="btn btn-soft" onClick={() => setTransfer(true)}>
                نقل إلى حلقة
              </button>
              <button className="btn btn-danger" onClick={() => setArchive(true)}>
                أرشفة
              </button>
            </>
          )}
          {isArchived && <button className="btn btn-soft" onClick={() => setReactivate(true)}>تفعيل</button>}
        </div>
      </div>

      <Section title="1 · البيانات الأساسية">
        {sectionRow('الاسم', s.name)}
        {sectionRow('الكنية', s.nickname)}
        {sectionRow('رقم الطالب', s.student_code)}
        {sectionRow('تاريخ الالتحاق', s.enrollmentDate)}
        {sectionRow('تاريخ الميلاد', s.birthDate)}
        {sectionRow('الحالة', isArchived ? 'مؤرشف' : 'نشط')}
      </Section>

      <Section title="2 · الوضع التعليمي" hint="المحفوظ الحالي وحالته">
        {sectionRow('المحفوظ الحالي', s.currentMemorization)}
        {sectionRow('حالة المحفوظ', s.currentMemorizationStatus)}
        <div className="row" style={{ justifyContent: 'space-between', margin: '0.75rem 0 0.5rem' }}>
          <h4 style={{ margin: 0 }}>الأداء</h4>
          <select className="select select-sm" value={range} onChange={(e) => setRange(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.v} value={r.v}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {stats && (
          <div className="stat-grid stat-grid-2">
            <div className="stat-card">
              <div className="stat-value">{stats.onTimePct}%</div>
              <div className="stat-label">نسبة الحضور في الوقت</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.heardPct}%</div>
              <div className="stat-label">نسبة سماع اللوح</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.reviewedPct}%</div>
              <div className="stat-label">نسبة مراجعة الورد</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.notRecordedDays}</div>
              <div className="stat-label">أيام غير مسجّلة</div>
            </div>
          </div>
        )}
        <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
          النسب تحسب فقط على الأيام المسجّلة فعليًا.
        </div>
      </Section>

      <Section title="3 · السلوك">
        {sectionRow('السلوك', s.behavior)}
      </Section>

      <Section title="4 · الحالة الصحية">
        {sectionRow('الحالة الصحية', s.healthStatus)}
        {sectionRow('عرضها للمعلم', s.healthVisibleToTeacher ? 'نعم' : 'لا')}
      </Section>

      <Section title="5 · البيانات الإدارية الخاصة" hint="مشرف فقط">
        {sectionRow('رقم الهاتف', s.phone)}
        {sectionRow('العنوان', s.address)}
        {sectionRow('جهة الاتصال', s.familyContact)}
        {sectionRow('ملاحظات إدارية', s.note)}
      </Section>

      <Section title="6 · الحلقة الحالية">
        {sectionRow('الحلقة', circle?.name)}
        {sectionRow('المعلم', teacherName)}
      </Section>

      <Section title="7 · سجل الانتقالات بين الحلقات">
        {groupHistory.length === 0 ? (
          <EmptyState>لا يوجد سجل انتقالات.</EmptyState>
        ) : (
          <div className="timeline">
            {groupHistory.map((h) => (
              <div key={h.id} className="timeline-row">
                <div className="timeline-date">{h.start_date}</div>
                <div className="timeline-body">
                  <div>
                    <strong>{h.group_name || '—'}</strong> — {h.teacher_name || 'بدون معلم'}
                  </div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {h.reason || ''} {h.end_date ? `— انتهى في ${h.end_date}` : '— الحلقة الحالية'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="8 · السجل اليومي" hint="من الأحدث إلى الأقدم">
        {history.length === 0 ? (
          <EmptyState>لا يوجد سجل يومي لهذا الطالب.</EmptyState>
        ) : (
          <div className="timeline">
            {history.map((h) => {
              const note = [h.attendance_note, h.memorization_note, h.revision_note].find((n) => n && n.trim())
              return (
                <div key={h.id} className="timeline-row">
                  <div className="timeline-date">{h.record_date}</div>
                  <div className="timeline-body">
                    <div className="row gap-2 wrap">
                      <AttendanceChip status={h.attendance_status || 'not_recorded'} />
                      <MemorizationChip status={h.memorization_status || 'not_recorded'} />
                      <RevisionChip status={h.revision_status || 'not_recorded'} />
                    </div>
                    {note && <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>ملاحظة: {note}</div>}
                  </div>
                  <button className="btn btn-soft btn-sm" onClick={() => setEditRec(h)}>
                    تعديل
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {editRec && (
        <DailyEditModal
          student={s}
          date={editRec.record_date}
          existing={editRec}
          onClose={() => setEditRec(null)}
          onSaved={() => refreshAll()}
        />
      )}
      {editStudent && (
        <AddStudentDialog
          circles={data.circles}
          student={s}
          onClose={() => setEditStudent(false)}
        />
      )}
      {transfer && <TransferDialog student={s} circles={data.circles} onClose={() => setTransfer(false)} />}
      {archive && <ArchiveDialog student={s} onClose={() => setArchive(false)} />}
      {reactivate && <ReactivateDialog student={s} circles={data.circles} onClose={() => setReactivate(false)} />}
    </Layout>
  )
}
