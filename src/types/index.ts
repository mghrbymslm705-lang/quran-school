// أنواع البيانات الأساسية للنظام
// هذه الأنواع مصممة لتكون قابلة للتوسع مستقبلًا (ربطها لاحقًا بقاعدة بيانات حقيقية).

export type Role = 'supervisor' | 'teacher'

export interface User {
  id: string
  username: string
  email?: string
  // ملاحظة: كلمة المرور هنا لأغراض النموذج الأولي فقط (DEMO).
  // في الإصدار الحقيقي تُستبدل بآلية مصادقة آمنة على الخادم.
  password: string
  name: string
  role: Role
  active: boolean
  teacherId?: string // يُربط بحساب المعلم عند role = teacher
}

export interface Teacher {
  id: string
  userId: string
  name: string
  username?: string
  email?: string
  phone?: string
  active: boolean
  status?: string
  adminNotes?: string | null
  createdAt?: string | null
  studentCount?: number
  lastDailyAt?: string | null
  circleIds: string[]
}

export interface TeacherGroupStat {
  id: string
  name: string
  student_count: number
}

export interface TeacherFile {
  id: string
  user_id: string
  full_name: string
  username: string
  email?: string
  phone?: string
  admin_notes: string | null
  status: string
  created_at: string | null
  groups: TeacherGroupStat[]
  group_count: number
  total_students: number
  last_daily_at: string | null
  recent_activity: { record_date: string; group_name: string; records: number }[]
}

export interface TeacherStats {
  range: string
  total_students: number
  registered: number
  not_registered: number
  completion_pct: number
  group_count: number
  last_daily_at: string | null
}

export interface AssignmentHistoryRow {
  id: string
  group_id: string
  teacher_id: string | null
  start_date: string
  end_date: string | null
  reason: string | null
  group_name?: string | null
  teacher_name?: string | null
}

export interface Circle {
  id: string
  name: string
  teacherId: string
  studentIds: string[]
  code?: string
  status?: string
  notes?: string
  scheduleNote?: string
}

// المحاور اليومية الثلاثة (لكل محور ثلاث حالات + "غير مسجّل")
export type AttendanceState = 'on_time' | 'late' | 'excused_absent' | 'not_recorded'
export type MemorizationState = 'heard' | 'not_heard' | 'not_recorded'
export type RevisionState = 'reviewed' | 'not_reviewed' | 'not_recorded'

export interface Student {
  id: string
  name: string
  student_code?: string
  circleId: string
  nickname?: string
  birthDate?: string
  guardianName?: string
  guardianPhone?: string
  enrollmentDate: string
  status?: string
  note?: string
  // حقول خاصة/إدارية (تظهر للمشرف فقط؛ المعلم يراها حسب الصلاحية)
  phone?: string
  address?: string
  familyContact?: string
  healthStatus?: string
  healthVisibleToTeacher?: boolean
  behavior?: string
  currentMemorization?: string
  currentMemorizationStatus?: string
}

// سجل الحضور والتسميع والمراجعة اليومي
export interface DailyRecord {
  date: string // YYYY-MM-DD
  circleId: string
  entries: DailyEntry[]
}

export type MasteryState = 'mastered' | 'needs_review' | 'not_evaluated'

export interface DailyEntry {
  studentId: string
  attendance: AttendanceState
  attendanceNote?: string
  memorization: MemorizationState
  memorizationAmount?: string
  memorizationMastery?: MasteryState
  memorizationNote?: string
  revision: RevisionState
  revisionNote?: string
  note?: string
}

export interface SchoolData {
  users: User[]
  teachers: Teacher[]
  circles: Circle[]
  students: Student[]
  // سجلات الخادم بأسماء snake_case، تُعامل بحرية هنا
  daily: any[]
}

// ============ مركز التقارير ============
export interface ReportRow {
  student_id: string
  student_code: string
  full_name: string
  nickname: string
  group_name: string
  teacher_name: string
  recorded: boolean
  attendance: AttendanceState
  memorization: MemorizationState
  memorization_amount: string
  mastery: MasteryState
  revision: RevisionState
  revision_quality: 'good' | 'average' | 'weak' | 'not_evaluated'
  note: string
}

export interface ReportSummary {
  total_students: number
  registered: number
  not_registered: number
  on_time: number
  late: number
  excused: number
  not_recorded_att: number
  heard: number
  not_heard: number
  not_recorded_mem: number
  reviewed: number
  not_reviewed: number
  not_recorded_rev: number
}

export interface DailyReportResponse {
  date: string
  summary: ReportSummary
  rows: ReportRow[]
}

export interface StudentReportNote {
  date: string
  note: string
}

export interface StudentReport {
  student_id: string
  full_name: string
  student_code: string
  group_name: string
  teacher_name: string
  range: string
  from: string
  to: string
  required_days: number
  recorded_days: number
  unrecorded_days: number
  on_time: number
  late: number
  excused_absent: number
  heard: number
  not_heard: number
  reviewed: number
  not_reviewed: number
  memorization_amount_sum: number
  memorization_amount_records: number
  mastery: { mastered: number; needs_review: number; not_evaluated: number }
  daily_notes: StudentReportNote[]
}

export interface CircleReportRow {
  student_id: string
  student_code: string
  full_name: string
  nickname: string
  days_count: number
  on_time: number
  late: number
  heard: number
  not_heard: number
  reviewed: number
  not_reviewed: number
  required_days: number
  complete_days: number
  commitment_rate: number
  important_notes: StudentReportNote[]
}

export interface CircleReportResponse {
  group_id: string
  from: string
  to: string
  students: CircleReportRow[]
}

