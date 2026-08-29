// طبقة الوصول للبيانات (متّصلة بالخادم الحقيقي)
// هذه الطبقة تحافظ على نفس الواجهة التي تستخدمها مكوّنات الواجهة،
// لكنها الآن تجلب البيانات من قاعدة البيانات عبر الـ API،
// وفرض الصلاحيات يتم على الخادم (وليس في الواجهة).

import type {
  SchoolData,
  Student,
  DailyRecord,
  DailyEntry,
  AttendanceState,
  MemorizationState,
  RevisionState,
  Circle,
  Teacher,
  User,
  TeacherFile,
  TeacherStats,
  AssignmentHistoryRow,
  DailyReportResponse,
  StudentReport,
  CircleReportResponse
} from '../types'

export type { TeacherFile, TeacherStats, AssignmentHistoryRow } from '../types'

const API = '/api'

let token: string | null = localStorage.getItem('qs_token') || null
let cache: SchoolData = { users: [], teachers: [], circles: [], students: [], daily: [] }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function getData(): SchoolData {
  return cache
}
export function setToken(t: string | null) {
  token = t
  if (t) localStorage.setItem('qs_token', t)
  else localStorage.removeItem('qs_token')
}

// ===== typed API error =====
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getErrorMessage(err: unknown, fallback?: string): string {
  const saveDef = 'تعذر حفظ التغييرات بسبب خطأ في الخادم. لم يتم حفظ التعديل. يرجى المحاولة مرة أخرى.'
  const def = fallback || saveDef
  if (err instanceof ApiError) {
    switch (err.status) {
      case 400: return err.message || 'البيانات المدخلة غير صحيحة، يرجى مراجعتها.'
      case 401: return 'انتهت جلسة الدخول، يرجى تسجيل الدخول من جديد.'
      case 403: return 'ليس لديك صلاحية لتنفيذ هذا الإجراء.'
      case 404: return err.message || 'العنصر المطلوب غير موجود.'
      case 409: return err.message || 'البيانات مكررة، يرجى تعديلها.'
      default: return fallback ? `${fallback} بسبب خطأ في الخادم.` : saveDef
    }
  }
  if (err instanceof TypeError && /fetch|network|Failed to fetch/i.test(err.message)) {
    return 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.'
  }
  if (err instanceof Error && /fetch|network|Failed to fetch/i.test(err.message)) {
    return 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.'
  }
  return fallback ? `${fallback}. يرجى المحاولة مرة أخرى.` : saveDef
}

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...opts
    })
  } catch {
    throw new ApiError(0, 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new ApiError(res.status, err.error || 'حدث خطأ في الخادم')
  }
  return res.json() as Promise<T>
}

// ---- Helper: handle 404 by refreshing cache ----
export async function handleNotFoundError(err: unknown): Promise<void> {
  if (err instanceof ApiError && err.status === 404) {
    await refreshAll()
  }
}

// ---- مزامنة البيانات من الخادم ----
export async function refreshAll() {
  const [studentsRaw, teachersRaw, circlesRaw, daily] = await Promise.all([
    api<any[]>('/students?status=all').catch(() => []),
    api<any[]>('/teachers').catch(() => []),
    api<any[]>('/groups').catch(() => []),
    api<any[]>('/daily').catch(() => [])
  ])
  const students = studentsRaw.map(mapStudent)
  const circles = circlesRaw.map((g) => mapGroup(g, studentsRaw))
  const teachers = teachersRaw.map((t) => mapTeacher(t, circles))
  cache = { users: [], students, teachers, circles, daily }
  emit()
}

// ---- تحويل أسماء الحقول ( snake_case من الخادم → camelCase في الواجهة ) ----
function mapStudent(s: any): Student {
  return {
    id: s.id,
    name: s.full_name,
    student_code: s.student_code,
    circleId: s.current_group_id ?? '',
    nickname: s.nickname || undefined,
    birthDate: s.date_of_birth || undefined,
    enrollmentDate: s.enrollment_date,
    status: s.status,
    note: s.notes || undefined,
    guardianName: undefined,
    guardianPhone: undefined,
    // الحقول الخاصة (الخادم يفرض الخصوصية: المعلم لا يستلمها إلا حسب الصلاحية)
    phone: s.phone || undefined,
    address: s.address || undefined,
    familyContact: s.family_contact || undefined,
    healthStatus: s.health_status || undefined,
    healthVisibleToTeacher: !!s.health_visible_to_teacher,
    behavior: s.behavior || undefined,
    currentMemorization: s.current_memorization || undefined,
    currentMemorizationStatus: s.current_memorization_status || undefined
  }
}
function mapGroup(g: any, students: any[]): Circle {
  const studentIds = students.filter((s) => s.current_group_id === g.id).map((s) => s.id)
  return {
    id: g.id,
    name: g.name,
    teacherId: g.teacher_id ?? '',
    studentIds,
    code: g.code || undefined,
    status: g.status || undefined,
    notes: g.notes || undefined,
    scheduleNote: g.notes || undefined
  }
}
function mapTeacher(t: any, circles: Circle[]): Teacher {
  return {
    id: t.id,
    userId: t.user_id,
    name: t.full_name,
    username: t.username || undefined,
    email: t.email || undefined,
    phone: t.phone || undefined,
    active: (t.status || 'active') === 'active',
    status: t.status || 'active',
    adminNotes: t.admin_notes ?? null,
    createdAt: t.created_at || null,
    studentCount: typeof t.student_count === 'number' ? t.student_count : undefined,
    lastDailyAt: t.last_daily_at || null,
    circleIds: circles.filter((c) => c.teacherId === t.id).map((c) => c.id)
  }
}

// ---- المصادقة ----
export async function loginRequest(username: string, password: string): Promise<{ token: string; user: any }> {
  const body = await api<{ token: string; user: any }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
  setToken(body.token)
  await refreshAll()
  return body
}

export async function fetchMe(): Promise<any | null> {
  if (!token) return null
  try {
    const me = await api<{ user: any }>('/auth/me')
    await refreshAll()
    return me.user
  } catch {
    setToken(null)
    return null
  }
}

export async function updateMe(data: { full_name?: string; username?: string; email?: string }): Promise<{ user: any; token?: string }> {
  const res = await api<{ user: any; token?: string }>('/me', {
    method: 'PUT',
    body: JSON.stringify(data)
  })
  if (res.token) setToken(res.token)
  return res
}

export async function changeMyPassword(data: { current_password: string; new_password: string; confirm_password: string }): Promise<void> {
  await api('/me/password', { method: 'PUT', body: JSON.stringify(data) })
}

export interface SchoolSettings {
  name: string
  description: string
  address: string
  phone: string
  email: string
}

export async function getSchoolSettings(): Promise<SchoolSettings> {
  return api<SchoolSettings>('/settings/school')
}

export async function updateSchoolSettings(data: SchoolSettings): Promise<SchoolSettings> {
  return api<SchoolSettings>('/settings/school', { method: 'PUT', body: JSON.stringify(data) })
}

// ---- الطلاب ----
export function getStudents(opts?: { circleIds?: string[] }): Student[] {
  let list = [...cache.students]
  if (opts?.circleIds && opts.circleIds.length) {
    const set = new Set(opts.circleIds)
    list = list.filter((s) => set.has(s.circleId))
  }
  return list
}
export function getStudent(id: string): Student | undefined {
  return cache.students.find((s) => s.id === id)
}
export async function addStudent(input: Omit<Student, 'id'>): Promise<Student> {
  await api('/students', {
    method: 'POST',
    body: JSON.stringify({
      full_name: input.name,
      student_code: input.student_code || 'S' + Date.now().toString().slice(-6),
      date_of_birth: input.birthDate || undefined,
      enrollment_date: input.enrollmentDate,
      status: input.status || 'active',
      notes: input.note,
      group_id: input.circleId || undefined,
      nickname: input.nickname,
      phone: input.phone,
      address: input.address,
      family_contact: input.familyContact,
      health_status: input.healthStatus,
      health_visible_to_teacher: input.healthVisibleToTeacher ? 1 : 0,
      behavior: input.behavior,
      current_memorization: input.currentMemorization,
      current_memorization_status: input.currentMemorizationStatus
    })
  })
  await refreshAll()
  return cache.students[cache.students.length - 1]
}

export async function updateStudent(id: string, input: Partial<Student>): Promise<void> {
  await api(`/students/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      full_name: input.name,
      date_of_birth: input.birthDate,
      enrollment_date: input.enrollmentDate,
      status: input.status,
      notes: input.note,
      nickname: input.nickname,
      phone: input.phone,
      address: input.address,
      family_contact: input.familyContact,
      health_status: input.healthStatus,
      health_visible_to_teacher: input.healthVisibleToTeacher,
      behavior: input.behavior,
      current_memorization: input.currentMemorization,
      current_memorization_status: input.currentMemorizationStatus
    })
  })
  await refreshAll()
}

// نقل الطالب بين الحلقات مع الاحتفاظ بالتاريخ
export async function transferStudent(id: string, groupId: string, reason?: string): Promise<void> {
  await api(`/students/${id}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ group_id: groupId, reason: reason || '' })
  })
  await refreshAll()
}

// أرشفة الطالب (ليست حذفًا)
export async function archiveStudent(id: string): Promise<void> {
  await api(`/students/${id}/archive`, { method: 'POST' })
  await refreshAll()
}

// إعادة تفعيل طالب مؤرشف
export async function reactivateStudent(id: string, groupId?: string): Promise<void> {
  await api(`/students/${id}/reactivate`, {
    method: 'POST',
    body: JSON.stringify({ group_id: groupId || undefined })
  })
  await refreshAll()
}

// سجل انتقالات الطالب بين الحلقات (مشرف)
export interface GroupHistoryRow {
  id: string
  group_id: string
  teacher_id: string | null
  start_date: string
  end_date: string | null
  reason: string | null
  group_name: string | null
  teacher_name: string | null
}
export async function getStudentGroupHistory(id: string): Promise<GroupHistoryRow[]> {
  return api<GroupHistoryRow[]>(`/students/${id}/group-history`)
}

// ---- الحلقات ----
export function getCircles(opts?: { teacherId?: string }): Circle[] {
  let list = [...cache.circles]
  if (opts?.teacherId) list = list.filter((c) => c.teacherId === opts.teacherId)
  return list
}
export function getCircle(id: string): Circle | undefined {
  return cache.circles.find((c) => c.id === id)
}

// إنشاء/تعديل الحلقة يتم يدويًا بواسطة المشرف (يختار الاسم والبيانات بنفسه)
export async function addCircle(input: {
  name: string
  code?: string
  teacherId?: string
  status?: string
  notes?: string
  assignReason?: string
}): Promise<void> {
  await api('/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      code: input.code || undefined,
      teacher_id: input.teacherId || undefined,
      status: input.status || 'active',
      notes: input.notes || undefined,
      assign_reason: input.assignReason || undefined
    })
  })
  await refreshAll()
}
export async function updateCircle(
  id: string,
  input: { name?: string; code?: string; teacherId?: string; status?: string; notes?: string; assignReason?: string }
): Promise<void> {
  await api(`/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: input.name,
      code: input.code,
      teacher_id: input.teacherId,
      status: input.status,
      notes: input.notes,
      assign_reason: input.assignReason
    })
  })
  await refreshAll()
}

// ---- المعلمون ----
export function getTeachers(): Teacher[] {
  return [...cache.teachers]
}
export function getTeacher(id?: string): Teacher | undefined {
  if (!id) return undefined
  return cache.teachers.find((t) => t.id === id)
}
export async function addTeacher(input: {
  name: string
  username: string
  password: string
  phone?: string
  email?: string
  adminNotes?: string
  active: boolean
  circleIds: string[]
}): Promise<void> {
  await api('/teachers', {
    method: 'POST',
    body: JSON.stringify({
      full_name: input.name,
      username: input.username,
      password: input.password,
      phone: input.phone,
      email: input.email,
      admin_notes: input.adminNotes,
      status: input.active ? 'active' : 'inactive',
      group_ids: input.circleIds
    })
  })
  await refreshAll()
}

export async function updateTeacher(
  id: string,
  input: {
    name?: string
    phone?: string
    email?: string
    adminNotes?: string
    active?: boolean
    circleIds?: string[]
  }
): Promise<void> {
  await api(`/teachers/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      full_name: input.name,
      phone: input.phone,
      email: input.email,
      admin_notes: input.adminNotes,
      status: input.active === undefined ? undefined : input.active ? 'active' : 'inactive',
      group_ids: input.circleIds
    })
  })
  await refreshAll()
}

export async function deactivateTeacher(id: string): Promise<void> {
  await api(`/teachers/${id}/deactivate`, { method: 'POST' })
  await refreshAll()
}
export async function reactivateTeacher(id: string): Promise<void> {
  await api(`/teachers/${id}/reactivate`, { method: 'POST' })
  await refreshAll()
}
export async function resetTeacherPassword(id: string, password: string, confirm: string): Promise<void> {
  await api(`/teachers/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password, confirm })
  })
  await refreshAll()
}

export async function getTeacherFile(id: string): Promise<TeacherFile> {
  return api<TeacherFile>(`/teachers/${id}`)
}
export async function getTeacherStats(id: string, range: 'today' | '7' | '30' = 'today'): Promise<TeacherStats> {
  return api<TeacherStats>(`/teachers/${id}/stats?range=${range}`)
}
export async function getTeacherAudit(id: string): Promise<AuditRow[]> {
  return api<AuditRow[]>(`/teachers/${id}/audit`)
}
export async function getTeacherGroupHistory(id: string): Promise<AssignmentHistoryRow[]> {
  return api<AssignmentHistoryRow[]>(`/teachers/${id}/group-history`)
}
export async function getGroupTeacherHistory(groupId: string): Promise<AssignmentHistoryRow[]> {
  return api<AssignmentHistoryRow[]>(`/groups/${groupId}/teacher-history`)
}

// ---- السجل اليومي (ثلاثة محاور) ----
export function getDailyRecord(circleId: string, date: string): DailyRecord | undefined {
  const recs = cache.daily.filter((r: any) => r.group_id === circleId && r.record_date === date)
  const entries: DailyEntry[] = recs.map((r: any) => ({
    studentId: r.student_id,
    attendance: (r.attendance_status as AttendanceState) || 'not_recorded',
    attendanceNote: r.attendance_note || '',
    memorization: (r.memorization_status as MemorizationState) || 'not_recorded',
    memorizationAmount: r.memorization_amount || '',
    memorizationMastery: (r.mastery_status as any) || undefined,
    memorizationNote: r.memorization_note || '',
    revision: (r.revision_status as RevisionState) || 'not_recorded',
    revisionNote: r.revision_note || '',
    note: r.note || ''
  }))
  return { date, circleId, entries }
}

export async function saveDailyRecord(record: DailyRecord): Promise<void> {
  for (const e of record.entries) {
    const existing = cache.daily.find(
      (r: any) => r.student_id === e.studentId && r.record_date === record.date
    )
    const payload: any = { attendance: { status: e.attendance, note: e.attendanceNote || null } }
    if (e.memorization !== 'not_recorded' || e.memorizationNote || e.memorizationAmount) {
      payload.memorization = { status: e.memorization, amount: e.memorizationAmount || null, note: e.memorizationNote || null }
    }
    if (e.revision !== 'not_recorded' || e.revisionNote) {
      payload.revision = { status: e.revision, note: e.revisionNote || null }
    }
    if (existing) {
      await api(`/daily/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
    } else {
      await api('/daily', {
        method: 'POST',
        body: JSON.stringify({ student_id: e.studentId, record_date: record.date, ...payload })
      })
    }
  }
  await refreshAll()
}

// حفظ جماعي للتسجيل اليومي (يستخدم واجهة /api/daily/bulk)
export async function saveDailyBulk(date: string, entries: DailyEntry[]): Promise<void> {
  const records = entries.map((e) => ({
    student_id: e.studentId,
    record_date: date,
    note: e.note || null,
    attendance: { status: e.attendance, note: e.attendanceNote || null },
    memorization: {
      status: e.memorization,
      amount: e.memorizationAmount || null,
      mastery_status: e.memorizationMastery || null,
      note: e.memorizationNote || null
    },
    revision: { status: e.revision, note: e.revisionNote || null }
  }))
  await api('/daily/bulk', { method: 'POST', body: JSON.stringify({ records }) })
  await refreshAll()
}

// ملخّص يومي مجمّع من الخادم
export interface DailySummary {
  total_students: number
  registered: number
  not_registered: number
  records: number
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
  circles?: CircleSummary[]
}
export interface CircleSummary {
  id: string
  name: string
  teacher_id: string
  teacher_name: string | null
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
export async function getDailySummary(opts?: {
  date?: string
  group_id?: string
  teacher_id?: string
  student_id?: string
}): Promise<DailySummary> {
  const params = new URLSearchParams()
  if (opts?.date) params.set('date', opts.date)
  if (opts?.group_id) params.set('group_id', opts.group_id)
  if (opts?.teacher_id) params.set('teacher_id', opts.teacher_id)
  if (opts?.student_id) params.set('student_id', opts.student_id)
  const qs = params.toString()
  return api<DailySummary>('/daily/summary' + (qs ? '?' + qs : ''))
}

// ===== مركز التقارير المركزي =====
export async function getReportsDaily(opts?: {
  date?: string
  group_id?: string
  teacher_id?: string
  student_id?: string
  status?: string
  q?: string
}): Promise<DailyReportResponse> {
  const params = new URLSearchParams()
  if (opts?.date) params.set('date', opts.date)
  if (opts?.group_id) params.set('group_id', opts.group_id)
  if (opts?.teacher_id) params.set('teacher_id', opts.teacher_id)
  if (opts?.student_id) params.set('student_id', opts.student_id)
  if (opts?.status) params.set('status', opts.status)
  if (opts?.q) params.set('q', opts.q)
  const qs = params.toString()
  return api<DailyReportResponse>('/reports/daily' + (qs ? '?' + qs : ''))
}

export async function getReportStudent(
  studentId: string,
  range: string,
  from?: string,
  to?: string
): Promise<StudentReport> {
  const params = new URLSearchParams()
  params.set('student_id', studentId)
  params.set('range', range)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return api<StudentReport>('/reports/student?' + params.toString())
}

export async function getReportCircle(groupId: string, from?: string, to?: string): Promise<CircleReportResponse> {
  const params = new URLSearchParams()
  params.set('group_id', groupId)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return api<CircleReportResponse>('/reports/circle?' + params.toString())
}

// تحويل عنصر تسجيل يومي إلى حمولة الـ API
export function entryToPayload(e: DailyEntry): any {
  const payload: any = {
    attendance: { status: e.attendance, note: e.attendanceNote || null },
    memorization: {
      status: e.memorization,
      amount: e.memorizationAmount || null,
      mastery_status: e.memorizationMastery || null,
      note: e.memorizationNote || null
    },
    revision: { status: e.revision, note: e.revisionNote || null },
    note: e.note || null
  }
  return payload
}

// إنشاء/تعديل سجل يومي (يستخدمه المشرف للتعديل اليدوي)
export async function postDaily(studentId: string, date: string, entry: DailyEntry): Promise<void> {
  await api('/daily', {
    method: 'POST',
    body: JSON.stringify({ student_id: studentId, record_date: date, ...entryToPayload(entry) })
  })
  await refreshAll()
}
export async function patchDaily(id: string, entry: DailyEntry): Promise<void> {
  await api(`/daily/${id}`, { method: 'PATCH', body: JSON.stringify(entryToPayload(entry)) })
  await refreshAll()
}

// السجل التاريخي لطالب (مرتّب من الأحدث)
export interface DailyHistoryRow {
  id: string
  student_id: string
  group_id: string
  record_date: string
  attendance_status: string
  attendance_note: string
  memorization_status: string
  memorization_amount: string
  memorization_note: string
  revision_status: string
  revision_note: string
}
export function getStudentHistory(studentId: string, opts?: { from?: string; to?: string }): DailyHistoryRow[] {
  let rows = cache.daily.filter((r: any) => r.student_id === studentId) as any[]
  if (opts?.from) rows = rows.filter((r) => r.record_date >= opts.from!)
  if (opts?.to) rows = rows.filter((r) => r.record_date <= opts.to!)
  return rows.sort((a, b) => (a.record_date < b.record_date ? 1 : a.record_date > b.record_date ? -1 : 0))
}

// ملخّص إحصائي لفترة محددة (يفصل not_recorded عن الحالات المسجّلة فعليًا)
export interface StudentStats {
  rangeDays: number
  recordedDays: number
  notRecordedDays: number
  onTimePct: number
  heardPct: number
  reviewedPct: number
}
export function getStudentStats(studentId: string, days: number): StudentStats {
  const to = new Date().toISOString().slice(0, 10)
  const from = days > 0 ? new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10) : undefined
  const rows = getStudentHistory(studentId, from ? { from, to } : undefined)
  const rangeDays = days > 0 ? days : new Set(rows.map((r) => r.record_date)).size || 1
  const recordedDays = rows.length
  const notRecordedDays = Math.max(0, rangeDays - recordedDays)
  const attRecorded = rows.filter((r) => r.attendance_status && r.attendance_status !== 'not_recorded')
  const memRecorded = rows.filter((r) => r.memorization_status && r.memorization_status !== 'not_recorded')
  const revRecorded = rows.filter((r) => r.revision_status && r.revision_status !== 'not_recorded')
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0)
  return {
    rangeDays,
    recordedDays,
    notRecordedDays,
    onTimePct: pct(rows.filter((r) => r.attendance_status === 'on_time').length, attRecorded.length),
    heardPct: pct(rows.filter((r) => r.memorization_status === 'heard').length, memRecorded.length),
    reviewedPct: pct(rows.filter((r) => r.revision_status === 'reviewed').length, revRecorded.length)
  }
}

// سجل التدقيق (المشرف فقط)
export interface AuditRow {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string
  old_data: any
  new_data: any
  created_at: string
  user_name: string | null
  username: string | null
  user_role: string | null
}
export interface AuditQuery {
  entity_type?: string
  action?: string
  user?: string
  from?: string
  to?: string
  q?: string
  sort?: 'asc' | 'desc'
}
export interface AuditList {
  total: number
  rows: AuditRow[]
}
export async function getAudit(opts: AuditQuery = {}): Promise<AuditList> {
  const q = new URLSearchParams()
  if (opts.entity_type) q.set('entity_type', opts.entity_type)
  if (opts.action) q.set('action', opts.action)
  if (opts.user) q.set('user', opts.user)
  if (opts.from) q.set('from', opts.from)
  if (opts.to) q.set('to', opts.to)
  if (opts.q) q.set('q', opts.q)
  if (opts.sort) q.set('sort', opts.sort)
  const qs = q.toString()
  return api<AuditList>('/audit' + (qs ? '?' + qs : ''))
}
export async function deleteAuditRecord(id: string, backup = false): Promise<void> {
  await api(`/audit/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmText: 'حذف', backup }) })
}
export async function previewAuditDelete(opts: {
  ids?: string[]
  from?: string
  to?: string
  olderThan?: string
  customDate?: string
}): Promise<{ count: number; oldest: string | null; newest: string | null }> {
  return api<{ count: number; oldest: string | null; newest: string | null }>('/audit/preview-delete', {
    method: 'POST',
    body: JSON.stringify(opts)
  })
}
export async function deleteAuditBulk(opts: {
  ids?: string[]
  from?: string
  to?: string
  olderThan?: string
  customDate?: string
  confirmText: string
  backup?: boolean
}): Promise<{ ok: boolean; deleted: number }> {
  return api<{ ok: boolean; deleted: number }>('/audit/bulk', { method: 'DELETE', body: JSON.stringify(opts) })
}

// ===== مركز إدارة البيانات والحذف الآمن (مشرف فقط) =====
export interface DataManagementSummary {
  students: { active: number; archived: number; total: number }
  teachers: { active: number; inactive: number; total: number }
  groups: { active: number; inactive: number; total: number }
  dailyRecords: number
  auditLogs: number
}
export async function getDataManagementSummary(): Promise<DataManagementSummary> {
  return api<DataManagementSummary>('/data-management/summary')
}
export async function createDataBackup(): Promise<{ ok: boolean; file: string; createdAt: string }> {
  return api<{ ok: boolean; file: string; createdAt: string }>('/data-management/backup', { method: 'POST' })
}

export async function deleteStudentPermanent(id: string, confirmText: string, backup = false): Promise<void> {
  await api(`/students/${id}/permanent`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmText, backup })
  })
  await refreshAll()
}
export async function deleteTeacherPermanent(id: string, confirmText: string, backup = false): Promise<void> {
  await api(`/teachers/${id}/permanent`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmText, backup })
  })
  await refreshAll()
}
export async function archiveGroup(id: string): Promise<void> {
  await api(`/groups/${id}/archive`, { method: 'POST' })
  await refreshAll()
}
export async function deleteGroupPermanent(id: string, confirmText: string, backup = false): Promise<void> {
  await api(`/groups/${id}/permanent`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmText, backup })
  })
  await refreshAll()
}


// ---- الإحصائيات (مشتقة من ذاكرة التخزين المؤقت) ----
export interface TodayStats {
  totalStudents: number
  totalCircles: number
  totalTeachers: number
  presentToday: number
  absentToday: number
  heardLuhToday: number
  notHeardLuhToday: number
}
export function getTodayStats(opts?: { circleIds?: string[] }): TodayStats {
  const today = new Date().toISOString().slice(0, 10)
  const students = getStudents(opts)
  const circles = opts?.circleIds ? cache.circles.filter((c) => opts.circleIds!.includes(c.id)) : cache.circles
  const circleIdSet = new Set(circles.map((c) => c.id))

  let presentToday = 0
  let absentToday = 0
  let heardLuhToday = 0
  cache.daily
    .filter((d: any) => d.record_date === today && circleIdSet.has(d.group_id))
    .forEach((rec: any) => {
      const st = rec.attendance_status
      if (st === 'on_time' || st === 'late') presentToday += 1
      else if (st === 'excused_absent') absentToday += 1
      if (rec.memorization_status === 'heard') heardLuhToday += 1
    })

  return {
    totalStudents: students.length,
    totalCircles: circles.length,
    totalTeachers:
      opts?.circleIds ?
        new Set(circles.map((c) => c.teacherId)).size
      : cache.teachers.filter((t) => t.active).length,
    presentToday,
    absentToday,
    heardLuhToday,
    notHeardLuhToday: Math.max(0, presentToday - heardLuhToday)
  }
}
