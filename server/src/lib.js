// مكتبة مساعدة: النطاق (scoping) حسب الدور + سجل التدقيق + الأدوات.
import crypto from 'node:crypto'
import { db } from './db.js'

export function uuid() {
  return crypto.randomUUID()
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// معرّفات الحلقات التي يدرّسها المعلم.
export function teacherGroupIds(teacherId) {
  if (!teacherId) return []
  return db
    .prepare('SELECT id FROM groups WHERE teacher_id = ?')
    .all(teacherId)
    .map((r) => r.id)
}

// معرّفات الطلاب المسندين للمعلم (عبر سجل الحلقات النشط).
// يرجع null للمشرف (صلاحية كاملة = لا نطاق).
export function allowedStudentIds(auth) {
  if (auth.role === 'supervisor') return null
  const ids = teacherGroupIds(auth.teacherId)
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT DISTINCT h.student_id FROM student_group_history h
       JOIN students s ON s.id = h.student_id
       WHERE h.end_date IS NULL AND h.group_id IN (${placeholders}) AND s.status != 'archived'`
    )
    .all(...ids)
    .map((r) => r.student_id)
}

export function isAllowedStudent(auth, studentId) {
  const ids = allowedStudentIds(auth)
  if (ids === null) return true
  return ids.includes(studentId)
}

export function isAllowedGroup(auth, groupId) {
  if (auth.role === 'supervisor') return true
  return teacherGroupIds(auth.teacherId).includes(groupId)
}

// تسجيل تغيير في سجل التدقيق.
export function audit({ user, action, entity_type, entity_id, old_data, new_data }) {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_data, new_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuid(),
    user?.id ?? null,
    action,
    entity_type,
    entity_id ?? null,
    old_data ? JSON.stringify(old_data) : null,
    new_data ? JSON.stringify(new_data) : null
  )
}
