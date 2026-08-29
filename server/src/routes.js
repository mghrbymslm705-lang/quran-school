// جميع مسارات الـ API مع فرض الصلاحيات على طبقة الخادم (وليس الواجهة فقط).
import express from 'express'
import { db, STUDENT_WITH_CURRENT_GROUP } from './db.js'
import { tallyDailyRecords, buildDailyReport, buildStudentReport, buildCircleReport } from './reports.js'
import { hashPassword, verifyPassword, signToken, loadUserByUsername, loadUserById } from './auth.js'
import { uuid, todayStr, teacherGroupIds, allowedStudentIds, isAllowedStudent, isAllowedGroup, audit } from './lib.js'
import { runBackup } from '../scripts/backup.js'
import { resolvePublicUrl, WHATSAPP_NUMBER, environment } from './config.js'

function safeUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    status: row.status,
    teacherId: row.teacher_id ?? null
  }
}

// ---- الوسائط (Middleware) ----
function authenticate(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'غير مصرّح' })
  let payload
  try {
    payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
  } catch {
    return res.status(401).json({ error: 'رمز غير صالح' })
  }
  const user = loadUserById(payload.sub)
  if (!user || user.status !== 'active') return res.status(403).json({ error: 'الحساب غير مفعل' })
  req.auth = safeUser(user)
  next()
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية للوصول' })
    }
    next()
  }
}

function isUniqueError(e) {
  return /UNIQUE constraint failed/i.test(e.message)
}

// الحقول التي يُسمح للمعلم برؤيتها من ملف الطالب (خصوصية على مستوى الخادم).
const TEACHER_STUDENT_FIELDS = [
  'id', 'full_name', 'nickname', 'health_status',
  'current_memorization', 'current_memorization_status', 'behavior', 'status',
  'current_group_id', 'current_teacher_id'
]
function toTeacherStudent(row) {
  const o = {}
  for (const f of TEACHER_STUDENT_FIELDS) o[f] = row[f]
  // الحالة الصحية تُعرض للمعلم فقط إن سمحت الإدارة
  if (!row.health_visible_to_teacher) o.health_status = undefined
  return o
}

// ---- مساعدات ----
function currentGroupOf(studentId) {
  return db
    .prepare('SELECT group_id, teacher_id FROM student_group_history WHERE student_id = ? AND end_date IS NULL ORDER BY start_date DESC LIMIT 1')
    .get(studentId)
}

function groupPayload(g) {
  const count = db
    .prepare('SELECT COUNT(*) AS c FROM student_group_history WHERE group_id = ? AND end_date IS NULL')
    .get(g.id).c
  const teacher = db.prepare('SELECT full_name FROM teachers WHERE id = ?').get(g.teacher_id)
  return { ...g, student_count: count, teacher_name: teacher ? teacher.full_name : null }
}

  function studentPayload(row) {
    if (!row) return null
    const { teacher_id, ...rest } = row
    return rest
  }

  // إسناد معلم لحلقة مع توثيق التاريخ (يُغلق السجل المفتوح سابقًا لتفادي التضارب)
  function assignGroupTeacher(groupId, teacherId, user, reason) {
    const open = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ? AND end_date IS NULL').get(groupId)
    if (open) db.prepare('UPDATE group_teacher_history SET end_date = ? WHERE id = ?').run(todayStr(), open.id)
    if (teacherId) {
      db.prepare(
        'INSERT INTO group_teacher_history (id, group_id, teacher_id, start_date, reason, assigned_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuid(), groupId, teacherId, todayStr(), reason || null, user?.id ?? null)
    }
    db.prepare('UPDATE groups SET teacher_id = ? WHERE id = ?').run(teacherId || null, groupId)
  }

// ---- أدوات إدارة البيانات والحذف الآمن ----
function isValidDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
}
// تنفيذ عمليات متعددة داخل معاملة ذرية (Atomic) — إما تنجح كلها أو تُتراجع كلها.
function withTransaction(fn) {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* تجاهل خطأ التراجع */
    }
    throw e
  }
}
function daysAgoISO(days) {
  const d = new Date(Date.now() - days * 86400000)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
// تحديد نقطة قطع حذف سجل التدقيق (يمنع الحذف الكلي دفعة واحدة)
function resolveAuditCutoff(olderThan, customDate) {
  if (olderThan === '30d') return daysAgoISO(30)
  if (olderThan === '90d') return daysAgoISO(90)
  if (olderThan === '6m') return daysAgoISO(180)
  if (olderThan === '1y') return daysAgoISO(365)
  if (olderThan === 'custom') {
    if (!isValidDateStr(customDate)) throw new Error('تاريخ الحذف المخصص غير صالح.')
    return customDate + ' 23:59:59'
  }
  throw new Error('يرجى تحديد نطاق حذف سجل التدقيق (30/90/6 أشهر/سنة/مخصص).')
}
// بناء شرط حذف سجل التدقيق من مواصفة: ids | (from,to) | olderThan
function buildAuditDeleteWhere(spec) {
  const where = []
  const params = []
  if (Array.isArray(spec.ids) && spec.ids.length) {
    const ph = spec.ids.map(() => '?').join(',')
    where.push(`id IN (${ph})`)
    spec.ids.forEach((id) => params.push(id))
    return { clause: 'WHERE ' + where.join(' AND '), params }
  }
  if (spec.from && spec.to) {
    where.push('created_at >= ?')
    params.push(spec.from + ' 00:00:00')
    where.push('created_at <= ?')
    params.push(spec.to + ' 23:59:59')
    return { clause: 'WHERE ' + where.join(' AND '), params }
  }
  if (spec.olderThan) {
    const cutoff = resolveAuditCutoff(spec.olderThan, spec.customDate)
    where.push('created_at < ?')
    params.push(cutoff)
    return { clause: 'WHERE ' + where.join(' AND '), params }
  }
  throw new Error('حدّد السجلات المراد حذفها (معرفات أو فترة زمنية).')
}
function matchesConfirm(confirmText, entityName) {
  const c = (confirmText || '').trim()
  if (c === 'حذف') return true
  if (entityName != null && c === String(entityName).trim()) return true
  return false
}
// بناء شرط تصفية السجلات اليومية حسب الفترة والنطاق
function buildDailyWhere({ from, to, scope, group_id, student_id }) {
  const where = []
  const params = []
  if (from) {
    where.push('dr.record_date >= ?')
    params.push(from)
  }
  if (to) {
    where.push('dr.record_date <= ?')
    params.push(to)
  }
  if (scope === 'group') {
    where.push('dr.group_id = ?')
    params.push(group_id)
  } else if (scope === 'student') {
    where.push('dr.student_id = ?')
    params.push(student_id)
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  return { clause, params }
}
// نسخة احتياطية اختيارية قبل الحذف — إن فشلت لا يُستكمل الحذف.
function ensureBackupBeforeDelete(backup) {
  if (!backup) return null
  return runBackup()
}

export function registerRoutes(app) {
  const api = express.Router()
  api.use(authenticate)

  // ============ المصادقة ============
  api.get('/auth/me', (req, res) => res.json({ user: req.auth }))

  // ============ إدارة حساب المشرف ============
  api.put('/me', requireRole('supervisor'), (req, res) => {
    const { full_name, username, email } = req.body || {}
    const user = loadUserById(req.auth.id)
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' })

    // رفض محاولة تغيير role أو id
    if (req.body.role || req.body.id || req.body.password_hash || req.body.status) {
      return res.status(400).json({ error: 'لا يُسمح بتغيير هذه الحقول' })
    }

    const newFullName = (full_name ?? user.full_name).trim()
    const newUsername = (username ?? user.username).trim()
    const newEmail = (email !== undefined ? email : user.email)
    if (!newFullName || !newUsername) {
      return res.status(400).json({ error: 'الاسم واسم المستخدم مطلوبان' })
    }

    // فحص تكرار اسم المستخدم
    if (newUsername.toLowerCase() !== user.username.toLowerCase()) {
      const exists = db.prepare('SELECT id FROM users WHERE lower(username) = ? AND id != ?').get(newUsername.toLowerCase(), user.id)
      if (exists) return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل' })
    }

    const oldData = { full_name: user.full_name, username: user.username, email: user.email }

    db.prepare('UPDATE users SET full_name = ?, username = ?, email = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newFullName, newUsername, newEmail || null, user.id)

    audit({ user: req.auth, action: 'update', entity_type: 'user', entity_id: user.id, old_data: oldData, new_data: { full_name: newFullName, username: newUsername, email: newEmail || null } })

    const updated = loadUserById(user.id)
    const token = signToken(updated)
    res.json({ user: safeUser(updated), token })
  })

  api.put('/me/password', requireRole('supervisor'), (req, res) => {
    const { current_password, new_password, confirm_password } = req.body || {}
    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' })
    }
    if (new_password.length < 4) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة لا تقل عن 4 أحرف' })
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'كلمتا المرور غير متطابقتين' })
    }

    const user = loadUserById(req.auth.id)
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' })

    if (!verifyPassword(current_password, user.password_hash)) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' })
    }

    const newHash = hashPassword(new_password)
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newHash, user.id)

    audit({ user: req.auth, action: 'password_change', entity_type: 'user', entity_id: user.id, old_data: null, new_data: null })

    res.json({ ok: true })
  })

  // ============ إعدادات المؤسسة ============
  api.get('/settings/school', requireRole('supervisor'), (req, res) => {
    const row = db.prepare('SELECT * FROM school_settings WHERE id = 1').get()
    if (!row) {
      db.prepare('INSERT OR IGNORE INTO school_settings (id, name) VALUES (1, ?)').run('المدرسة القرآنية')
      return res.json({ name: 'المدرسة القرآنية', description: '', address: '', phone: '', email: '' })
    }
    return res.json({
      name: row.name,
      description: row.description || '',
      address: row.address || '',
      phone: row.phone || '',
      email: row.email || ''
    })
  })

  api.put('/settings/school', requireRole('supervisor'), (req, res) => {
    const { name, description, address, phone, email } = req.body || {}
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'اسم المؤسسة مطلوب' })
    }
    // رفض الحقول غير المسموحة
    const forbidden = ['id', 'role', 'password_hash', 'created_at', 'updated_at']
    for (const key of forbidden) {
      if (req.body[key] !== undefined) return res.status(400).json({ error: 'لا يُسمح بتغيير هذه الحقول' })
    }

    const old = db.prepare('SELECT * FROM school_settings WHERE id = 1').get() || {}
    const oldData = { name: old.name, description: old.description, address: old.address, phone: old.phone, email: old.email }

    const newName = name.trim()
    const newDesc = (description || '').trim()
    const newAddr = (address || '').trim()
    const newPhone = (phone || '').trim()
    const newEmail = (email || '').trim()

    db.prepare(`INSERT INTO school_settings (id, name, description, address, phone, email, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=?, description=?, address=?, phone=?, email=?, updated_at=datetime('now')`)
      .run(newName, newDesc, newAddr, newPhone, newEmail, newName, newDesc, newAddr, newPhone, newEmail)

    audit({ user: req.auth, action: 'update', entity_type: 'school_settings', entity_id: '1', old_data: oldData, new_data: { name: newName, description: newDesc, address: newAddr, phone: newPhone, email: newEmail } })

    return res.json({ name: newName, description: newDesc, address: newAddr, phone: newPhone, email: newEmail })
  })

  // ============ المعلمون ============
  api.get('/teachers', (req, res) => {
    if (req.auth.role === 'supervisor') {
      const teachers = db.prepare('SELECT * FROM teachers ORDER BY full_name').all()
      const users = db.prepare('SELECT id, username, email, role, status, created_at FROM users WHERE role = ?').all('teacher')
      const userMap = Object.fromEntries(users.map((u) => [u.id, u]))
      const groups = db.prepare('SELECT id, name, teacher_id FROM groups').all()
      // عدد الطلاب الحاليين لكل معلم (عبر حلقاته النشطة، دون المؤرشفين)
      const studentCounts = db
        .prepare(
          `SELECT g.teacher_id, COUNT(DISTINCT h.student_id) c
           FROM student_group_history h
           JOIN groups g ON g.id = h.group_id
           JOIN students s ON s.id = h.student_id
           WHERE h.end_date IS NULL AND s.status != 'archived' AND g.teacher_id IS NOT NULL
           GROUP BY g.teacher_id`
        )
        .all()
      const scMap = Object.fromEntries(studentCounts.map((r) => [r.teacher_id, r.c]))
      // آخر تسجيل يومي لكل معلم
      const lastDaily = db.prepare('SELECT teacher_id, MAX(record_date) mx FROM daily_records GROUP BY teacher_id').all()
      const ldMap = Object.fromEntries(lastDaily.map((r) => [r.teacher_id, r.mx]))
      const result = teachers.map((t) => {
        const tGroups = groups.filter((g) => g.teacher_id === t.id)
        const u = userMap[t.user_id] || {}
        return {
          id: t.id,
          user_id: t.user_id,
          full_name: t.full_name,
          phone: t.phone,
          admin_notes: t.admin_notes || null,
          status: u.status || t.status,
          username: u.username,
          email: u.email,
          created_at: u.created_at || null,
          group_names: tGroups.map((g) => g.name),
          group_count: tGroups.length,
          student_count: scMap[t.id] || 0,
          last_daily_at: ldMap[t.id] || null
        }
      })
      return res.json(result)
    }
    // المعلم يرى حسابه فقط
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.auth.teacherId)
    return res.json(t ? [t] : [])
  })

  api.post('/teachers', requireRole('supervisor'), (req, res) => {
    const { full_name, username, password, phone, email, admin_notes, status = 'active', group_ids = [] } = req.body || {}
    if (!full_name || !username || !password) {
      return res.status(400).json({ error: 'الاسم واسم المستخدم وكلمة المرور مطلوبة' })
    }
    // الدور يُحدَّد من الخادم حصرًا — رفض أي محاولة تصعيد صلاحيات
    if (req.body.role && req.body.role !== 'teacher') {
      return res.status(400).json({ error: 'لا يمكن إنشاء حساب بصلاحية غير معلم عبر هذه الواجهة' })
    }
    const userId = uuid()
    const teacherId = uuid()
    try {
      db.prepare(
        'INSERT INTO users (id, username, email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, username, email || null, hashPassword(password), full_name, 'teacher', status)
      db.prepare(
        'INSERT INTO teachers (id, user_id, full_name, phone, status, admin_notes) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(teacherId, userId, full_name, phone || null, status, admin_notes || null)
      // إسناد الحلقات المطلوبة (مع توثيق التاريخ)
      for (const gid of group_ids) {
        assignGroupTeacher(gid, teacherId, req.auth, 'enrollment')
      }
      audit({ user: req.auth, action: 'create', entity_type: 'teacher', entity_id: teacherId, new_data: { full_name, username } })
      return res.status(201).json({ id: teacherId, user_id: userId })
    } catch (e) {
      if (isUniqueError(e)) return res.status(409).json({ error: 'اسم المستخدم مستخدم مسبقًا' })
      throw e
    }
  })

  api.put('/teachers/:id', requireRole('supervisor'), (req, res) => {
    const { full_name, phone, email, admin_notes, status, group_ids } = req.body || {}
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    const old = { full_name: t.full_name, phone: t.phone, status: t.status, email: t.email }
    // الدور لا يُعدَّل أبدًا عبر هذه الواجهة (يمنع تصعيد الصلاحيات)
    if (req.body.role && req.body.role !== 'teacher') {
      return res.status(400).json({ error: 'لا يمكن تغيير صلاحية المعلم عبر هذه الواجهة' })
    }
    db.prepare('UPDATE teachers SET full_name = ?, phone = ?, status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = datetime(\'now\') WHERE id = ?')
      .run(full_name ?? t.full_name, phone ?? t.phone, status ?? t.status, admin_notes !== undefined ? admin_notes || null : null, t.id)
    // تحديث الحساب المرتبط (البريد + حالة التفعيل التي تمنع/تسمح الدخول)
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id)
    if (u) {
      db.prepare('UPDATE users SET email = COALESCE(?, email), status = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(email !== undefined ? (email || null) : null, status ?? u.status, t.user_id)
    }
    if (group_ids) {
      // الحلقات الجديدة: إسناد موثَّق. الحلقات السابقة غير المدرجة: فك الإسناد مع إغلاق تاريخها
      const current = db.prepare('SELECT id FROM groups WHERE teacher_id = ?').all(t.id).map((g) => g.id)
      for (const gid of group_ids) assignGroupTeacher(gid, t.id, req.auth, 'reassign')
      for (const gid of current) {
        if (!group_ids.includes(gid)) assignGroupTeacher(gid, null, req.auth, 'unassign')
      }
    }
    audit({ user: req.auth, action: 'update', entity_type: 'teacher', entity_id: t.id, old_data: old, new_data: { full_name, phone, email, status, admin_notes } })
    return res.json({ ok: true })
  })

  // ملف المعلم الكامل (مشرف فقط)
  api.get('/teachers/:id', requireRole('supervisor'), (req, res) => {
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    const u = db.prepare('SELECT id, username, email, status, created_at FROM users WHERE id = ?').get(t.user_id) || {}
    const groups = db.prepare('SELECT id, name FROM groups WHERE teacher_id = ?').all(t.id)
    const groupStats = groups.map((g) => ({
      id: g.id,
      name: g.name,
      student_count: db
        .prepare(
          `SELECT COUNT(DISTINCT h.student_id) c FROM student_group_history h
           JOIN students s ON s.id = h.student_id
           WHERE h.end_date IS NULL AND h.group_id = ? AND s.status != 'archived'`
        )
        .get(g.id).c
    }))
    const totalStudents = groupStats.reduce((a, g) => a + g.student_count, 0)
    const lastDaily = db.prepare('SELECT MAX(record_date) mx FROM daily_records WHERE teacher_id = ?').get(t.id)
    const recent = db
      .prepare(
        `SELECT dr.record_date, g.name AS group_name, COUNT(*) AS records
         FROM daily_records dr JOIN groups g ON g.id = dr.group_id
         WHERE dr.teacher_id = ? GROUP BY dr.record_date, g.id ORDER BY dr.record_date DESC LIMIT 10`
      )
      .all(t.id)
    return res.json({
      id: t.id,
      user_id: t.user_id,
      full_name: t.full_name,
      phone: t.phone,
      admin_notes: t.admin_notes || null,
      username: u.username,
      email: u.email,
      status: u.status || t.status,
      created_at: u.created_at || null,
      groups: groupStats,
      group_count: groups.length,
      total_students: totalStudents,
      last_daily_at: lastDaily?.mx || null,
      recent_activity: recent
    })
  })

  // إحصائيات تسجيل المعلم ضمن فترة (اليوم / 7 / 30 يومًا)
  api.get('/teachers/:id/stats', requireRole('supervisor'), (req, res) => {
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    const range = req.query.range || 'today'
    const days = range === '7' ? 7 : range === '30' ? 30 : 1
    const today = todayStr()
    const from = days > 1 ? new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10) : today
    const gWhere = 'g.teacher_id = ?'
    const total = db
      .prepare(
        `SELECT COUNT(DISTINCT h.student_id) c FROM student_group_history h
         JOIN groups g ON g.id = h.group_id JOIN students s ON s.id = h.student_id
         WHERE h.end_date IS NULL AND ${gWhere} AND s.status != 'archived'`
      )
      .get(t.id).c
    const reg = db
      .prepare(
        `SELECT COUNT(DISTINCT dr.student_id) c FROM daily_records dr
         JOIN groups g ON g.id = dr.group_id JOIN students s ON s.id = dr.student_id
         WHERE dr.record_date >= ? AND dr.record_date <= ? AND g.teacher_id = ? AND s.status != 'archived'`
      )
      .get(from, today, t.id).c
    const registered = reg
    const notRegistered = Math.max(0, total - registered)
    const completion = total > 0 ? Math.round((registered / total) * 100) : 0
    const groupCount = db.prepare('SELECT COUNT(*) c FROM groups WHERE teacher_id = ?').get(t.id).c
    const lastDaily = db.prepare('SELECT MAX(record_date) mx FROM daily_records WHERE teacher_id = ?').get(t.id)
    return res.json({
      range,
      total_students: total,
      registered,
      not_registered: notRegistered,
      completion_pct: completion,
      group_count: groupCount,
      last_daily_at: lastDaily?.mx || null
    })
  })

  // سجل نشاط المعلم الإداري (العمليات التي قام بها هذا المستخدم) — مشرف فقط
  api.get('/teachers/:id/audit', requireRole('supervisor'), (req, res) => {
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    const rows = db
      .prepare(
        `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.old_data, a.new_data, a.created_at,
                u.full_name AS user_name, u.username
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 200`
      )
      .all(t.user_id)
    res.json(
      rows.map((r) => ({
        ...r,
        old_data: r.old_data ? JSON.parse(r.old_data) : null,
        new_data: r.new_data ? JSON.parse(r.new_data) : null
      }))
    )
  })

  // تاريخ إسناد الحلقات لهذا المعلم
  api.get('/teachers/:id/group-history', requireRole('supervisor'), (req, res) => {
    const rows = db
      .prepare(
        `SELECT h.id, h.group_id, h.teacher_id, h.start_date, h.end_date, h.reason,
                g.name AS group_name
         FROM group_teacher_history h
         LEFT JOIN groups g ON g.id = h.group_id
         WHERE h.teacher_id = ?
         ORDER BY h.start_date DESC`
      )
      .all(req.params.id)
    res.json(rows)
  })

  // تعطيل حساب المعلم (لا يحذف أي بيانات؛ يمنع تسجيل الدخول فقط)
  api.post('/teachers/:id/deactivate', requireRole('supervisor'), (req, res) => {
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    const oldStatus = db.prepare('SELECT status FROM users WHERE id = ?').get(t.user_id)?.status
    db.prepare("UPDATE users SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(t.user_id)
    db.prepare("UPDATE teachers SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(t.id)
    audit({ user: req.auth, action: 'deactivate', entity_type: 'teacher', entity_id: t.id, old_data: { status: oldStatus }, new_data: { status: 'inactive' } })
    return res.json({ ok: true })
  })

  // إعادة تفعيل حساب المعلم
  api.post('/teachers/:id/reactivate', requireRole('supervisor'), (req, res) => {
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    db.prepare("UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(t.user_id)
    db.prepare("UPDATE teachers SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(t.id)
    audit({ user: req.auth, action: 'reactivate', entity_type: 'teacher', entity_id: t.id, old_data: { status: 'inactive' }, new_data: { status: 'active' } })
    return res.json({ ok: true })
  })

  // إعادة تعيين كلمة المرور (لا تُرجَع ولا تُسجَّل في سجل التدقيق)
  api.post('/teachers/:id/reset-password', requireRole('supervisor'), (req, res) => {
    const { password, confirm } = req.body || {}
    if (!password || password.length < 4) return res.status(400).json({ error: 'كلمة المرور قصيرة جدًا' })
    if (password !== confirm) return res.status(400).json({ error: 'كلمتا المرور غير متطابقتين' })
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hashPassword(password), t.user_id)
    // لا نُضمّن كلمة المرور في سجل التدقيق
    audit({ user: req.auth, action: 'reset_password', entity_type: 'teacher', entity_id: t.id, new_data: { reset: true } })
    return res.json({ ok: true })
  })

  // تاريخ إسناد المعلمين لحلقة معيّنة
  api.get('/groups/:id/teacher-history', requireRole('supervisor'), (req, res) => {
    const rows = db
      .prepare(
        `SELECT h.id, h.group_id, h.teacher_id, h.start_date, h.end_date, h.reason,
                t.full_name AS teacher_name
         FROM group_teacher_history h
         LEFT JOIN teachers t ON t.id = h.teacher_id
         WHERE h.group_id = ?
         ORDER BY h.start_date DESC`
      )
      .all(req.params.id)
    res.json(rows)
  })

  // ============ الطلاب ============
  function listStudents(auth, q, status, circleId, teacherId) {
    const ids = allowedStudentIds(auth)
    if (ids !== null && ids.length === 0) return []
    let sql = STUDENT_WITH_CURRENT_GROUP
    const where = []
    const params = []
    if (ids !== null) {
      where.push(`s.id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    if (q) {
      where.push('(lower(s.full_name) LIKE ? OR lower(s.student_code) LIKE ?)')
      params.push('%' + q.toLowerCase() + '%', '%' + q.toLowerCase() + '%')
    }
    // الحالة: إن وُجدت صراحةً تُطبَّق؛ أما الافتراضي فهو استبعاد المؤرشفين من التشغيل اليومي
    if (status && status !== 'all') {
      where.push('s.status = ?')
      params.push(status)
    } else if (!status) {
      where.push("s.status != 'archived'")
    }
    if (circleId) {
      where.push('current_group_id = ?')
      params.push(circleId)
    }
    if (teacherId) {
      where.push('current_teacher_id = ?')
      params.push(teacherId)
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ')
    sql += ' ORDER BY s.full_name'
    return db.prepare(sql).all(...params)
  }

  api.get('/students', (req, res) => {
    const rows = listStudents(req.auth, req.query.q, req.query.status, req.query.circle_id, req.query.teacher_id)
    const mapped = rows.map((r) => (req.auth.role === 'supervisor' ? r : toTeacherStudent(r)))
    res.json(mapped)
  })

  api.post('/students', requireRole('supervisor'), (req, res) => {
    const {
      full_name, student_code, date_of_birth, enrollment_date, status = 'active', notes,
      group_id, nickname, phone, address, family_contact, health_status,
      health_visible_to_teacher = 0, behavior, current_memorization, current_memorization_status
    } = req.body || {}
    if (!full_name || !student_code) return res.status(400).json({ error: 'الاسم والرقم الدراسي مطلوبان' })
    const id = uuid()
    try {
      db.prepare(
        `INSERT INTO students (id, student_code, full_name, date_of_birth, enrollment_date, status, notes,
           nickname, phone, address, family_contact, health_status, health_visible_to_teacher, behavior,
           current_memorization, current_memorization_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, student_code, full_name, date_of_birth || null, enrollment_date || todayStr(), status, notes || null,
        nickname || null, phone || null, address || null, family_contact || null, health_status || null,
        health_visible_to_teacher ? 1 : 0, behavior || null, current_memorization || null, current_memorization_status || null
      )
      // سجل انتساب أولي في الحلقة إن وُجدت
      if (group_id) {
        const g = db.prepare('SELECT id, teacher_id FROM groups WHERE id = ?').get(group_id)
        if (!g) return res.status(400).json({ error: 'الحلقة غير موجودة' })
        db.prepare(
          'INSERT INTO student_group_history (id, student_id, group_id, teacher_id, start_date, reason) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuid(), id, group_id, g.teacher_id || null, todayStr(), 'enrollment')
      }
      audit({ user: req.auth, action: 'create', entity_type: 'student', entity_id: id, new_data: { full_name, student_code, group_id } })
      return res.status(201).json({ id })
    } catch (e) {
      if (isUniqueError(e)) return res.status(409).json({ error: 'رقم الطالب مستخدم مسبقًا' })
      throw e
    }
  })

  api.put('/students/:id', requireRole('supervisor'), (req, res) => {
    const {
      full_name, date_of_birth, enrollment_date, status, notes,
      nickname, phone, address, family_contact, health_status,
      health_visible_to_teacher, behavior, current_memorization, current_memorization_status
    } = req.body || {}
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
    if (!s) return res.status(404).json({ error: 'الطالب غير موجود' })
    const old = { full_name: s.full_name, status: s.status }
    db.prepare(
      `UPDATE students SET full_name = ?, date_of_birth = ?, enrollment_date = ?, status = ?, notes = ?,
         nickname = ?, phone = ?, address = ?, family_contact = ?, health_status = ?, health_visible_to_teacher = ?,
         behavior = ?, current_memorization = ?, current_memorization_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      full_name ?? s.full_name, date_of_birth ?? s.date_of_birth, enrollment_date ?? s.enrollment_date, status ?? s.status, notes ?? s.notes,
      nickname ?? s.nickname, phone ?? s.phone, address ?? s.address, family_contact ?? s.family_contact,
      health_status ?? s.health_status, health_visible_to_teacher !== undefined ? (health_visible_to_teacher ? 1 : 0) : s.health_visible_to_teacher,
      behavior ?? s.behavior, current_memorization ?? s.current_memorization, current_memorization_status ?? s.current_memorization_status, s.id
    )
    audit({ user: req.auth, action: 'update', entity_type: 'student', entity_id: s.id, old_data: old, new_data: { full_name, status } })
    return res.json({ ok: true })
  })

  api.post('/students/:id/archive', requireRole('supervisor'), (req, res) => {
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
    if (!s) return res.status(404).json({ error: 'الطالب غير موجود' })
    db.prepare("UPDATE students SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(s.id)
    audit({ user: req.auth, action: 'archive', entity_type: 'student', entity_id: s.id, old_data: { status: s.status }, new_data: { status: 'archived' } })
    return res.json({ ok: true })
  })

  // نقل الطالب بين الحلقات مع الاحتفاظ بالتاريخ
  api.post('/students/:id/transfer', requireRole('supervisor'), (req, res) => {
    const { group_id, reason } = req.body || {}
    if (!group_id) return res.status(400).json({ error: 'معرّف الحلقة المطلوب النقل إليها مطلوب' })
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
    if (!s) return res.status(404).json({ error: 'الطالب غير موجود' })
    const g = db.prepare('SELECT id, teacher_id, name FROM groups WHERE id = ?').get(group_id)
    if (!g) return res.status(400).json({ error: 'الحلقة غير موجودة' })
    const active = db.prepare('SELECT * FROM student_group_history WHERE student_id = ? AND end_date IS NULL').get(s.id)
    const oldGroup = active ? db.prepare('SELECT name FROM groups WHERE id = ?').get(active.group_id) : null
    if (active) {
      db.prepare('UPDATE student_group_history SET end_date = ? WHERE id = ?').run(todayStr(), active.id)
    }
    db.prepare(
      'INSERT INTO student_group_history (id, student_id, group_id, teacher_id, start_date, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uuid(), s.id, group_id, g.teacher_id || null, todayStr(), reason || 'transfer')
    audit({
      user: req.auth,
      action: 'transfer',
      entity_type: 'student_group',
      entity_id: s.id,
      old_data: { group: oldGroup ? oldGroup.name : null },
      new_data: { group: g.name }
    })
    return res.json({ ok: true })
  })

  // إعادة تفعيل طالب مؤرشف (مع الحفاظ على كامل تاريخه السابق)
  api.post('/students/:id/reactivate', requireRole('supervisor'), (req, res) => {
    const { group_id } = req.body || {}
    if (!group_id) return res.status(400).json({ error: 'معرّف الحلقة المطلوب إعادة التفعيل فيها مطلوب' })
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
    if (!s) return res.status(404).json({ error: 'الطالب غير موجود' })
    const oldStatus = s.status
    db.prepare("UPDATE students SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(s.id)
    if (group_id) {
      const g = db.prepare('SELECT id, teacher_id, name FROM groups WHERE id = ?').get(group_id)
      if (!g) return res.status(400).json({ error: 'الحلقة غير موجودة' })
      const active = db.prepare('SELECT * FROM student_group_history WHERE student_id = ? AND end_date IS NULL').get(s.id)
      if (active) db.prepare('UPDATE student_group_history SET end_date = ? WHERE id = ?').run(todayStr(), active.id)
      db.prepare(
        'INSERT INTO student_group_history (id, student_id, group_id, teacher_id, start_date, reason) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuid(), s.id, group_id, g.teacher_id || null, todayStr(), 'reactivation')
    }
    audit({
      user: req.auth,
      action: 'reactivate',
      entity_type: 'student',
      entity_id: s.id,
      old_data: { status: oldStatus },
      new_data: { status: 'active', group_id: group_id || null }
    })
    return res.json({ ok: true })
  })

  // سجل انتقالات الطالب بين الحلقات (للمشرف)
  api.get('/students/:id/group-history', requireRole('supervisor'), (req, res) => {
    const rows = db
      .prepare(
        `SELECT h.id, h.group_id, h.teacher_id, h.start_date, h.end_date, h.reason,
                g.name AS group_name, t.full_name AS teacher_name
         FROM student_group_history h
         LEFT JOIN groups g ON g.id = h.group_id
         LEFT JOIN teachers t ON t.id = h.teacher_id
         WHERE h.student_id = ?
         ORDER BY h.start_date DESC`
      )
      .all(req.params.id)
    res.json(rows)
  })

  // ============ الحلقات ============
  api.get('/groups', (req, res) => {
    let groups = db.prepare('SELECT * FROM groups ORDER BY name').all()
    if (req.auth.role === 'teacher') {
      const ids = teacherGroupIds(req.auth.teacherId)
      groups = groups.filter((g) => ids.includes(g.id))
    }
    res.json(groups.map(groupPayload))
  })

  api.post('/groups', requireRole('supervisor'), (req, res) => {
    const { name, code, teacher_id, status = 'active', notes, assign_reason } = req.body || {}
    if (!name) return res.status(400).json({ error: 'اسم الحلقة مطلوب' })
    const id = uuid()
    db.prepare('INSERT INTO groups (id, name, code, teacher_id, status, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, code || null, null, status, notes || null)
    if (teacher_id) assignGroupTeacher(id, teacher_id, req.auth, assign_reason || 'assign')
    audit({ user: req.auth, action: 'create', entity_type: 'group', entity_id: id, new_data: { name, teacher_id } })
    return res.status(201).json({ id })
  })

  api.put('/groups/:id', requireRole('supervisor'), (req, res) => {
    const { name, code, teacher_id, status, notes, assign_reason } = req.body || {}
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id)
    if (!g) return res.status(404).json({ error: 'الحلقة غير موجودة' })
    db.prepare('UPDATE groups SET name = ?, code = ?, status = ?, notes = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(name ?? g.name, code ?? g.code, status ?? g.status, notes ?? g.notes, g.id)
    // تحديث إسناد المعلم فقط إذا تغير فعلياً
    if (teacher_id !== undefined && (teacher_id || null) !== (g.teacher_id || null)) {
      assignGroupTeacher(g.id, teacher_id || null, req.auth, assign_reason || 'reassign')
    }
    audit({ user: req.auth, action: 'update', entity_type: 'group', entity_id: g.id })
    return res.json({ ok: true })
  })

  // ============ السجل اليومي + الحضور + اللوح + المراجعة ============

  // ملخّص يومي مجمّع (لمتابعة المشرف)
  function circleMetrics(g, d) {
    const total = db.prepare(
      `SELECT COUNT(DISTINCT h.student_id) c FROM student_group_history h
       JOIN students s ON s.id = h.student_id
       WHERE h.end_date IS NULL AND h.group_id = ? AND s.status != 'archived'`
    ).get(g.id).c
    const recs = db.prepare(
      `SELECT dr.student_id, a.status att, m.status mem, r.status rev
       FROM daily_records dr
       JOIN students s ON s.id = dr.student_id
       LEFT JOIN attendances a ON a.daily_record_id = dr.id
       LEFT JOIN memorization_records m ON m.daily_record_id = dr.id
       LEFT JOIN revision_records r ON r.daily_record_id = dr.id
       WHERE dr.record_date = ? AND dr.group_id = ? AND s.status != 'archived'`
    ).all(d, g.id)
    const c = { on_time: 0, late: 0, excused: 0, not_recorded_att: 0, heard: 0, not_heard: 0, not_recorded_mem: 0, reviewed: 0, not_reviewed: 0, not_recorded_rev: 0 }
    for (const x of recs) {
      if (x.att === 'on_time') c.on_time++
      else if (x.att === 'late') c.late++
      else if (x.att === 'excused_absent') c.excused++
      else c.not_recorded_att++
      if (x.mem === 'heard') c.heard++
      else if (x.mem === 'not_heard') c.not_heard++
      else c.not_recorded_mem++
      if (x.rev === 'reviewed') c.reviewed++
      else if (x.rev === 'not_reviewed') c.not_reviewed++
      else c.not_recorded_rev++
    }
    const registered = new Set(recs.map((r) => r.student_id)).size
    return {
      id: g.id,
      name: g.name,
      teacher_id: g.teacher_id,
      teacher_name: g.teacher_name,
      total_students: total,
      registered,
      not_registered: Math.max(0, total - registered),
      ...c
    }
  }

  api.get('/daily/summary', (req, res) => {
    const { date, group_id, teacher_id, student_id } = req.query
    const ids = allowedStudentIds(req.auth)
    const d = date || todayStr()
    const effTeacher = teacher_id || (req.auth.role === 'teacher' ? req.auth.teacherId : null)
    const where = []
    const params = []
    where.push('dr.record_date = ?'); params.push(d)
    if (group_id) { where.push('dr.group_id = ?'); params.push(group_id) }
    if (effTeacher) { where.push('dr.teacher_id = ?'); params.push(effTeacher) }
    if (student_id) { where.push('dr.student_id = ?'); params.push(student_id) }
    if (ids !== null) { where.push(`dr.student_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids) }
    const w = 'WHERE ' + where.join(' AND ')
    const recs = db.prepare(
      `SELECT dr.student_id, a.status att, m.status mem, r.status rev
       FROM daily_records dr
       JOIN students s ON s.id = dr.student_id AND s.status != 'archived'
       LEFT JOIN attendances a ON a.daily_record_id = dr.id
       LEFT JOIN memorization_records m ON m.daily_record_id = dr.id
       LEFT JOIN revision_records r ON r.daily_record_id = dr.id
       ${w}`
    ).all(...params)
    const c = tallyDailyRecords(recs)
    // عدد الطلاب النشطين (غير المؤرشفين) في النطاق
    const tw = []
    const tp = []
    if (group_id) { tw.push('h.group_id = ?'); tp.push(group_id) }
    if (effTeacher) { tw.push('h.group_id IN (SELECT id FROM groups WHERE teacher_id = ?)'); tp.push(effTeacher) }
    if (student_id) { tw.push('h.student_id = ?'); tp.push(student_id) }
    if (ids !== null) { tw.push(`h.student_id IN (${ids.map(() => '?').join(',')})`); tp.push(...ids) }
    tw.push("s.status != 'archived'")
    const twq = tw.length ? 'WHERE ' + tw.join(' AND ') : ''
    const total = db.prepare(`SELECT COUNT(DISTINCT h.student_id) c FROM student_group_history h JOIN students s ON s.id = h.student_id ${twq}`).get(...tp).c
    const registered = new Set(recs.map((r) => r.student_id)).size
    const not_registered = Math.max(0, total - registered)

    // تفصيل الحلقات (للمشرف، أو للمعلم ضمن حلقاته)
    let circles = []
    if (student_id) {
      circles = []
    } else if (group_id) {
      if (req.auth.role === 'teacher' && !teacherGroupIds(req.auth.teacherId).includes(group_id)) {
        return res.status(403).json({ error: 'غير مصرّح لك بهذه الحلقة' })
      }
      const g = db.prepare(
        `SELECT g.id, g.name, g.teacher_id, (SELECT full_name FROM teachers WHERE id = g.teacher_id) AS teacher_name
         FROM groups g WHERE g.id = ?`
      ).get(group_id)
      circles = g ? [circleMetrics(g, d)] : []
    } else {
      const gWhere = []
      const gParams = []
      if (effTeacher) { gWhere.push('g.teacher_id = ?'); gParams.push(effTeacher) }
      gWhere.push("g.status = 'active'")
      const groups = db.prepare(
        `SELECT g.id, g.name, g.teacher_id, (SELECT full_name FROM teachers WHERE id = g.teacher_id) AS teacher_name
         FROM groups g WHERE ${gWhere.join(' AND ')}`
      ).all(...gParams)
      circles = groups.map((g) => circleMetrics(g, d))
    }

    res.json({ total_students: total, registered, not_registered, records: recs.length, ...c, circles })
  })

  api.get('/daily', (req, res) => {
    const { date, group_id, student_id, att, mem, rev, from, to } = req.query
    const ids = allowedStudentIds(req.auth)
    let sql = `SELECT dr.id, dr.student_id, dr.group_id, dr.teacher_id, dr.record_date, dr.note AS note,
                      a.status AS attendance_status, a.note AS attendance_note,
                      m.status AS memorization_status, m.amount AS memorization_amount, m.mastery_status, m.note AS memorization_note,
                      r.status AS revision_status, r.quality AS revision_quality, r.note AS revision_note
               FROM daily_records dr
               LEFT JOIN attendances a ON a.daily_record_id = dr.id
               LEFT JOIN memorization_records m ON m.daily_record_id = dr.id
               LEFT JOIN revision_records r ON r.daily_record_id = dr.id
               WHERE 1=1`
    const params = []
    if (date) { sql += ' AND dr.record_date = ?'; params.push(date) }
    if (from) { sql += ' AND dr.record_date >= ?'; params.push(from) }
    if (to) { sql += ' AND dr.record_date <= ?'; params.push(to) }
    if (group_id) { sql += ' AND dr.group_id = ?'; params.push(group_id) }
    if (student_id) { sql += ' AND dr.student_id = ?'; params.push(student_id) }
    // فلاتر المحاور: تدعم القيم الصريحة إضافة إلى "not_recorded" و"not_on_time" و"all"
    if (att && att !== 'all') {
      if (att === 'not_recorded') { sql += ' AND (a.status IS NULL OR a.status = ?)'; params.push('not_recorded') }
      else if (att === 'not_on_time') { sql += ' AND (a.status IS NULL OR a.status != ?)'; params.push('on_time') }
      else { sql += ' AND a.status = ?'; params.push(att) }
    }
    if (mem && mem !== 'all') {
      if (mem === 'not_recorded') { sql += ' AND (m.status IS NULL OR m.status = ?)'; params.push('not_recorded') }
      else { sql += ' AND m.status = ?'; params.push(mem) }
    }
    if (rev && rev !== 'all') {
      if (rev === 'not_recorded') { sql += ' AND (r.status IS NULL OR r.status = ?)'; params.push('not_recorded') }
      else { sql += ' AND r.status = ?'; params.push(rev) }
    }
    if (ids !== null) { sql += ` AND dr.student_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids) }
    sql += ' ORDER BY dr.record_date DESC, dr.student_id'
    res.json(db.prepare(sql).all(...params))
  })

  api.post('/daily', (req, res) => {
    const { student_id, record_date, attendance = {}, memorization = {}, revision = {}, note } = req.body || {}
    if (!student_id) return res.status(400).json({ error: 'معرف الطالب مطلوب' })
    if (!isAllowedStudent(req.auth, student_id)) return res.status(403).json({ error: 'لا تملك صلاحية لهذا الطالب' })
    const ATT = ['on_time', 'late', 'excused_absent', 'not_recorded']
    const MEM = ['heard', 'not_heard', 'not_recorded']
    const REV = ['reviewed', 'not_reviewed', 'not_recorded']
    const MAST = ['mastered', 'needs_review', 'not_evaluated']
    const QUAL = ['good', 'average', 'weak', 'not_evaluated']
    if (attendance.status && !ATT.includes(attendance.status)) return res.status(400).json({ error: 'حالة الحضور غير صحيحة' })
    if (memorization.status && !MEM.includes(memorization.status)) return res.status(400).json({ error: 'حالة التسميع غير صحيحة' })
    if (revision.status && !REV.includes(revision.status)) return res.status(400).json({ error: 'حالة المراجعة غير صحيحة' })
    if (memorization.mastery_status && !MAST.includes(memorization.mastery_status)) return res.status(400).json({ error: 'درجة الإتقان غير صحيحة' })
    if (revision.quality && !QUAL.includes(revision.quality)) return res.status(400).json({ error: 'جودة المراجعة غير صحيحة' })
    const rdate = record_date || todayStr()
    const cur = currentGroupOf(student_id)
    const id = uuid()
    try {
      db.prepare('INSERT INTO daily_records (id, student_id, teacher_id, group_id, record_date, created_by, updated_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, student_id, req.auth.teacherId || (cur ? cur.teacher_id : null), cur ? cur.group_id : null, rdate, req.auth.id, req.auth.id, typeof note === 'string' ? note : null)
      db.prepare('INSERT INTO attendances (id, daily_record_id, status, note) VALUES (?, ?, ?, ?)')
        .run(uuid(), id, attendance.status || 'not_recorded', attendance.note || null)
      const memOk = memorization.status || memorization.amount || memorization.note
      if (memOk) {
        db.prepare('INSERT INTO memorization_records (id, daily_record_id, status, amount, mastery_status, note) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuid(), id, memorization.status || 'not_recorded', memorization.amount || null, memorization.mastery_status || null, memorization.note || null)
      }
      const revOk = revision.status || revision.amount || revision.note
      if (revOk) {
        db.prepare('INSERT INTO revision_records (id, daily_record_id, status, amount, quality, note) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuid(), id, revision.status || 'not_recorded', revision.amount || null, revision.quality || null, revision.note || null)
      }
      // المشرف الذي ينشئ تسجيلًا يدويًا يُسجَّل كعملية إنشاء في سجل التدقيق
      if (req.auth.role === 'supervisor') {
        audit({
          user: req.auth,
          action: 'create',
          entity_type: 'daily_record',
          entity_id: id,
          new_data: {
            student_id,
            record_date: rdate,
            attendance: attendance.status || 'not_recorded',
            memorization: memorization.status || 'not_recorded',
            revision: revision.status || 'not_recorded',
            by_role: 'supervisor'
          }
        })
      }
      return res.status(201).json({ id })
    } catch (e) {
      if (isUniqueError(e)) return res.status(409).json({ error: 'يوجد سجل يومي لهذا الطالب في نفس التاريخ' })
      throw e
    }
  })

  // حفظ جماعي للتسجيل اليومي (معاملة واحدة + فحص النطاق لكل طالب)
  api.post('/daily/bulk', (req, res) => {
    const { records } = req.body || {}
    if (!Array.isArray(records)) return res.status(400).json({ error: 'صيغة غير صحيحة' })
    if (records.length === 0) return res.status(400).json({ error: 'لا توجد سجلات للحفظ' })

    const ATT = ['on_time', 'late', 'excused_absent', 'not_recorded']
    const MEM = ['heard', 'not_heard', 'not_recorded']
    const REV = ['reviewed', 'not_reviewed', 'not_recorded']
    const MAST = ['mastered', 'needs_review', 'not_evaluated']

    const results = []
    const valid = []
    for (const item of records) {
      const student_id = item && item.student_id
      if (!student_id) {
        results.push({ student_id: null, status: 'error', error: 'معرف الطالب مطلوب' })
        continue
      }
      if (!isAllowedStudent(req.auth, student_id)) {
        results.push({ student_id, status: 'error', error: 'لا تملك صلاحية لهذا الطالب' })
        continue
      }
      const attendance = item.attendance || {}
      const memorization = item.memorization || {}
      const revision = item.revision || {}
      if (attendance.status && !ATT.includes(attendance.status)) {
        results.push({ student_id, status: 'error', error: 'حالة حضور غير صحيحة' })
        continue
      }
      if (memorization.status && !MEM.includes(memorization.status)) {
        results.push({ student_id, status: 'error', error: 'حالة تسميع غير صحيحة' })
        continue
      }
      if (revision.status && !REV.includes(revision.status)) {
        results.push({ student_id, status: 'error', error: 'حالة مراجعة غير صحيحة' })
        continue
      }
      if (memorization.mastery_status && !MAST.includes(memorization.mastery_status)) {
        results.push({ student_id, status: 'error', error: 'حالة إتقان غير صحيحة' })
        continue
      }
      valid.push({
        student_id,
        record_date: item.record_date || todayStr(),
        note: typeof item.note === 'string' ? item.note : null,
        attendance: { status: attendance.status || 'not_recorded', note: attendance.note ?? null },
        memorization: {
          status: memorization.status || 'not_recorded',
          amount: memorization.amount ?? null,
          mastery_status: memorization.mastery_status ?? null,
          note: memorization.note ?? null
        },
        revision: { status: revision.status || 'not_recorded', note: revision.note ?? null }
      })
    }

    if (valid.length > 0) {
      try {
        db.exec('BEGIN')
        for (const it of valid) {
          const cur = currentGroupOf(it.student_id)
          const existing = db
            .prepare('SELECT * FROM daily_records WHERE student_id = ? AND record_date = ?')
            .get(it.student_id, it.record_date)
          let recId
          if (existing) {
            recId = existing.id
            db.prepare("UPDATE daily_records SET note = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
              it.note,
              req.auth.id,
              recId
            )
          } else {
            recId = uuid()
            db.prepare(
              'INSERT INTO daily_records (id, student_id, teacher_id, group_id, record_date, created_by, updated_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(
              recId,
              it.student_id,
              req.auth.teacherId || (cur ? cur.teacher_id : null),
              cur ? cur.group_id : null,
              it.record_date,
              req.auth.id,
              req.auth.id,
              it.note
            )
          }
          const attEx = db.prepare('SELECT * FROM attendances WHERE daily_record_id = ?').get(recId)
          if (attEx)
            db.prepare("UPDATE attendances SET status = ?, note = ?, updated_at = datetime('now') WHERE daily_record_id = ?").run(
              it.attendance.status,
              it.attendance.note,
              recId
            )
          else
            db.prepare('INSERT INTO attendances (id, daily_record_id, status, note) VALUES (?, ?, ?, ?)').run(
              uuid(),
              recId,
              it.attendance.status,
              it.attendance.note
            )
          const memEx = db.prepare('SELECT * FROM memorization_records WHERE daily_record_id = ?').get(recId)
          if (memEx)
            db.prepare(
              "UPDATE memorization_records SET status = ?, amount = ?, mastery_status = ?, note = ?, updated_at = datetime('now') WHERE daily_record_id = ?"
            ).run(it.memorization.status, it.memorization.amount, it.memorization.mastery_status, it.memorization.note, recId)
          else
            db.prepare(
              'INSERT INTO memorization_records (id, daily_record_id, status, amount, mastery_status, note) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(uuid(), recId, it.memorization.status, it.memorization.amount, it.memorization.mastery_status, it.memorization.note)
          const revEx = db.prepare('SELECT * FROM revision_records WHERE daily_record_id = ?').get(recId)
          if (revEx)
            db.prepare("UPDATE revision_records SET status = ?, note = ?, updated_at = datetime('now') WHERE daily_record_id = ?").run(
              it.revision.status,
              it.revision.note,
              recId
            )
          else
            db.prepare('INSERT INTO revision_records (id, daily_record_id, status, note) VALUES (?, ?, ?, ?)').run(
              uuid(),
              recId,
              it.revision.status,
              it.revision.note
            )
          results.push({ student_id: it.student_id, status: existing ? 'updated' : 'created' })
        }
        db.exec('COMMIT')
      } catch (e) {
        try {
          db.exec('ROLLBACK')
        } catch {}
        console.error('Bulk daily save failed:', e)
        return res.status(500).json({ error: 'فشل حفظ بعض السجلات' })
      }
    }

    const created = results.filter((r) => r.status === 'created').length
    const updated = results.filter((r) => r.status === 'updated').length
    const errors = results.filter((r) => r.status === undefined || r.status === 'error').length
    return res.json({ ok: true, created, updated, errors, results })
  })

  // ============ مركز التقارير المركزي (المشرف فقط) ============
  function isValidDate(s) {
    if (typeof s !== 'string') return false
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
    const d = new Date(s + 'T00:00:00Z')
    if (isNaN(d.getTime())) return false
    return d.toISOString().slice(0, 10) === s
  }

  const reports = express.Router()
  reports.use((req, res, next) => {
    if (req.auth?.role !== 'supervisor') {
      return res.status(403).json({ error: 'غير مصرّح لك بالوصول إلى التقارير' })
    }
    next()
  })

  reports.get('/daily', (req, res) => {
    const { date, group_id, teacher_id, student_id, status, q } = req.query
    const data = buildDailyReport({ date, group_id, teacher_id, student_id, status, q, auth: req.auth })
    res.json(data)
  })

  reports.get('/student', (req, res) => {
    const { student_id, range, from, to } = req.query
    if (!student_id) return res.status(400).json({ error: 'مطلوب معرّف الطالب' })
    const ids = allowedStudentIds(req.auth)
    if (ids !== null && !ids.includes(student_id)) {
      return res.status(403).json({ error: 'غير مصرّح لك بهذا الطالب' })
    }
    if (range === 'custom') {
      if (!from) return res.status(400).json({ error: 'يرجى اختيار تاريخ البداية.' })
      if (!to) return res.status(400).json({ error: 'يرجى اختيار تاريخ النهاية.' })
      if (!isValidDate(from) || !isValidDate(to)) {
        return res.status(400).json({ error: 'صيغة التاريخ غير صحيحة' })
      }
      if (from > to) {
        return res.status(400).json({ error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية.' })
      }
    }
    const data = buildStudentReport({ student_id, range, from, to, auth: req.auth })
    res.json(data)
  })

  reports.get('/circle', (req, res) => {
    const { group_id, from, to } = req.query
    if (!group_id) return res.status(400).json({ error: 'مطلوب معرّف الحلقة' })
    const data = buildCircleReport({ group_id, from, to, auth: req.auth })
    res.json(data)
  })

  api.use('/reports', reports)

  api.patch('/daily/:id', (req, res) => {
    const { attendance, memorization, revision } = req.body || {}
    const dr = db.prepare('SELECT * FROM daily_records WHERE id = ?').get(req.params.id)
    if (!dr) return res.status(404).json({ error: 'السجل غير موجود' })
    if (!isAllowedStudent(req.auth, dr.student_id)) return res.status(403).json({ error: 'لا تملك صلاحية' })

    const { note } = req.body || {}

    // القراءة قبل التعديل لتسجيل الفروق في سجل التدقيق
    const oldAtt = db.prepare('SELECT * FROM attendances WHERE daily_record_id = ?').get(dr.id)
    const oldMem = db.prepare('SELECT * FROM memorization_records WHERE daily_record_id = ?').get(dr.id)
    const oldRev = db.prepare('SELECT * FROM revision_records WHERE daily_record_id = ?').get(dr.id)

    if (attendance) {
      db.prepare('UPDATE attendances SET status = ?, note = COALESCE(?, note), updated_at = datetime(\'now\') WHERE daily_record_id = ?')
        .run(attendance.status || 'not_recorded', attendance.note ?? null, dr.id)
    }
    if (memorization) {
      const ex = db.prepare('SELECT * FROM memorization_records WHERE daily_record_id = ?').get(dr.id)
      if (ex) {
        db.prepare('UPDATE memorization_records SET status = ?, amount = ?, mastery_status = ?, note = COALESCE(?, note), updated_at = datetime(\'now\') WHERE daily_record_id = ?')
          .run(memorization.status || ex.status, memorization.amount ?? ex.amount, memorization.mastery_status ?? ex.mastery_status, memorization.note ?? null, dr.id)
      } else {
        db.prepare('INSERT INTO memorization_records (id, daily_record_id, status, amount, mastery_status, note) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuid(), dr.id, memorization.status || 'not_recorded', memorization.amount || null, memorization.mastery_status || null, memorization.note || null)
      }
    }
    if (revision) {
      const ex = db.prepare('SELECT * FROM revision_records WHERE daily_record_id = ?').get(dr.id)
      if (ex) {
        db.prepare('UPDATE revision_records SET status = ?, amount = ?, quality = ?, note = COALESCE(?, note), updated_at = datetime(\'now\') WHERE daily_record_id = ?')
          .run(revision.status || ex.status, revision.amount ?? ex.amount, revision.quality ?? ex.quality, revision.note ?? null, dr.id)
      } else {
        db.prepare('INSERT INTO revision_records (id, daily_record_id, status, amount, quality, note) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuid(), dr.id, revision.status || 'not_recorded', revision.amount || null, revision.quality || null, revision.note || null)
      }
    }
      db.prepare("UPDATE daily_records SET updated_at = datetime('now'), updated_by = ?, note = COALESCE(?, note) WHERE id = ?").run(req.auth.id, typeof note === 'string' ? note : null, dr.id)

    // تسجيل التعديل في سجل التدقيق (يظهر أن التعديل تم بواسطة المستخدم الحالي ودوره)
    const newAtt = db.prepare('SELECT * FROM attendances WHERE daily_record_id = ?').get(dr.id)
    const newMem = db.prepare('SELECT * FROM memorization_records WHERE daily_record_id = ?').get(dr.id)
    const newRev = db.prepare('SELECT * FROM revision_records WHERE daily_record_id = ?').get(dr.id)
    const logAxis = (entity_type, oldRow, newRow) => {
      if (!newRow) return
      const os = oldRow?.status ?? null
      const ns = newRow.status
      const on = oldRow?.note ?? null
      const nn = newRow.note ?? null
      if (os === ns && on === nn) return
      // تجاهل إنشاء سجل "غير مسجّل" فارغ (لا قيمة حقيقية)
      if (!oldRow && ns === 'not_recorded' && !nn) return
      audit({
        user: req.auth,
        action: 'update',
        entity_type,
        entity_id: dr.id,
        old_data: { student_id: dr.student_id, status: os, note: on },
        new_data: { student_id: dr.student_id, status: ns, note: nn, by_role: req.auth.role }
      })
    }
    logAxis('attendance', oldAtt, newAtt)
    logAxis('memorization_record', oldMem, newMem)
    logAxis('revision_record', oldRev, newRev)

    return res.json({ ok: true })
  })

  // ============ سجل التدقيق (المشرف فقط) ============
  api.get('/audit', requireRole('supervisor'), (req, res) => {
    const { entity_type, action, user, from, to, q, sort } = req.query
    const where = []
    const params = []
    if (entity_type) {
      where.push('a.entity_type = ?')
      params.push(entity_type)
    }
    if (action) {
      where.push('a.action = ?')
      params.push(action)
    }
    if (user) {
      where.push('a.user_id = ?')
      params.push(user)
    }
    if (from) {
      where.push('a.created_at >= ?')
      params.push(from + ' 00:00:00')
    }
    if (to) {
      where.push('a.created_at <= ?')
      params.push(to + ' 23:59:59')
    }
    if (q) {
      where.push('(u.full_name LIKE ? OR u.username LIKE ? OR a.entity_type LIKE ? OR a.action LIKE ? OR a.entity_id LIKE ?)')
      const like = '%' + q + '%'
      params.push(like, like, like, like, like)
    }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${clause}`).get(...params).c
    const order = sort === 'asc' ? 'ASC' : 'DESC'
    const rows = db
      .prepare(
        `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.old_data, a.new_data, a.created_at,
                u.full_name AS user_name, u.username, u.role AS user_role
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ${clause}
         ORDER BY a.created_at ${order}
         LIMIT 2000`
      )
      .all(...params)
    res.json({
      total,
      rows: rows.map((r) => ({
        ...r,
        old_data: r.old_data ? JSON.parse(r.old_data) : null,
        new_data: r.new_data ? JSON.parse(r.new_data) : null
      }))
    })
  })

  // ============ ملاحظات الطلاب ============
  api.get('/students/:id/notes', (req, res) => {
    if (!isAllowedStudent(req.auth, req.params.id)) return res.status(403).json({ error: 'لا تملك صلاحية' })
    const notes = db.prepare('SELECT * FROM student_notes WHERE student_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(req.params.id)
    res.json(notes)
  })

  api.post('/students/:id/notes', (req, res) => {
    if (!isAllowedStudent(req.auth, req.params.id)) return res.status(403).json({ error: 'لا تملك صلاحية' })
    const { note, note_type = 'general' } = req.body || {}
    if (!note) return res.status(400).json({ error: 'نص الملاحظة مطلوب' })
    // المعلم لا يستطيع إنشاء ملاحظة إدارية
    if (req.auth.role === 'teacher' && note_type === 'administrative') {
      return res.status(403).json({ error: 'غير مصرّح بإنشاء ملاحظة إدارية' })
    }
    const id = uuid()
    db.prepare('INSERT INTO student_notes (id, student_id, teacher_id, note, note_type) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.params.id, req.auth.teacherId || null, note, note_type)
    return res.status(201).json({ id })
  })

  api.delete('/notes/:id', (req, res) => {
    const n = db.prepare('SELECT * FROM student_notes WHERE id = ?').get(req.params.id)
    if (!n) return res.status(404).json({ error: 'غير موجود' })
    if (n.note_type === 'administrative' && req.auth.role !== 'supervisor') {
      return res.status(403).json({ error: 'غير مصرّح بحذف ملاحظة إدارية' })
    }
    if (n.note_type !== 'administrative' && req.auth.role === 'teacher' && n.teacher_id !== req.auth.teacherId) {
      return res.status(403).json({ error: 'غير مصرّح' })
    }
    db.prepare('UPDATE student_notes SET deleted_at = datetime(\'now\') WHERE id = ?').run(n.id)
    return res.json({ ok: true })
  })

  // مسار اختبار الأخطاء (يُستخدم في الاختبارات فقط)
  if (process.env.NODE_ENV === 'test') {
    api.post('/test/error', requireRole('supervisor'), (req, res) => {
      const { status } = req.body || {}
      if (status === 500) throw new Error('خطأ تجريبي في الخادم')
      return res.status(status || 400).json({ error: 'خطأ تجريبي' })
    })
  }

  // ============ مركز إدارة البيانات والحذف الآمن (المشرف فقط) ============

  // ملخّص الإحصائيات لمركز إدارة البيانات
  api.get('/data-management/summary', requireRole('supervisor'), (req, res) => {
    const students = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status != 'archived' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived,
           COUNT(*) AS total
         FROM students`
      )
      .get()
    const teachers = db
      .prepare(
        `SELECT
           SUM(CASE WHEN t.status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN t.status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
           COUNT(*) AS total
         FROM teachers t`
      )
      .get()
    const groups = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
           COUNT(*) AS total
         FROM groups`
      )
      .get()
    const dailyRecords = db.prepare('SELECT COUNT(*) AS c FROM daily_records').get().c
    const auditLogs = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c
    return res.json({
      students: { active: students.active || 0, archived: students.archived || 0, total: students.total || 0 },
      teachers: { active: teachers.active || 0, inactive: teachers.inactive || 0, total: teachers.total || 0 },
      groups: { active: groups.active || 0, inactive: groups.inactive || 0, total: groups.total || 0 },
      dailyRecords,
      auditLogs
    })
  })

  // نسخة احتياطية يدوية قبل الحذف
  api.post('/data-management/backup', requireRole('supervisor'), (req, res) => {
    try {
      const file = runBackup()
      return res.json({ ok: true, file, createdAt: new Date().toISOString() })
    } catch {
      return res.status(500).json({ error: 'تعذّر إنشاء النسخة الاحتياطية، حاول مرة أخرى.' })
    }
  })

  // الحذف النهائي لطالب (داخل معاملة ذرية + تأكيد كتابي)
  api.delete('/students/:id/permanent', requireRole('supervisor'), (req, res) => {
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
    if (!s) return res.status(404).json({ error: 'الطالب غير موجود' })
    const { confirmText, backup } = req.body || {}
    if (!matchesConfirm(confirmText, s.full_name)) {
      return res.status(400).json({ error: 'يرجى كتابة «حذف» أو اسم الطالب للتأكيد.' })
    }
    const rel = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM daily_records WHERE student_id = ?) AS daily,
           (SELECT COUNT(*) FROM student_group_history WHERE student_id = ?) AS history,
           (SELECT COUNT(*) FROM student_notes WHERE student_id = ?) AS notes`
      )
      .get(s.id, s.id, s.id)
    let backupFile = null
    try {
      backupFile = ensureBackupBeforeDelete(backup)
    } catch {
      return res.status(500).json({ error: 'تعذّر إنشاء النسخة الاحتياطية، لم يتم حذف أي بيانات.' })
    }
    try {
      withTransaction(() => {
        db.prepare('DELETE FROM students WHERE id = ?').run(s.id)
      })
    } catch {
      return res.status(500).json({ error: 'تعذّر حذف الطالب نهائيًا بسبب خطأ في الخادم.' })
    }
    audit({
      user: req.auth,
      action: 'delete',
      entity_type: 'student',
      entity_id: s.id,
      old_data: { full_name: s.full_name, status: s.status, related: rel },
      new_data: { deleted: true, backup_file: backupFile }
    })
    return res.json({ ok: true })
  })

  // الحذف النهائي لمعلم (محمي + داخل معاملة)
  api.delete('/teachers/:id/permanent', requireRole('supervisor'), (req, res) => {
    const t = db
      .prepare('SELECT t.*, u.role AS user_role FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.id = ?')
      .get(req.params.id)
    if (!t) return res.status(404).json({ error: 'المعلم غير موجود' })
    // حماية حسابات المشرفين من الحذف عبر هذا المسار
    if (t.user_role === 'supervisor') {
      return res.status(400).json({ error: 'لا يمكن حذف حساب مشرف من هنا.' })
    }
    // منع حذف آخر مستخدم يحمل دور مشرف في النظام
    const supCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'supervisor' AND status = 'active'").get().c
    if (supCount <= 0) {
      return res.status(400).json({ error: 'لا يمكن حذف آخر حساب مشرف في النظام.' })
    }
    // لا يُسمح بالحذف إن كان المعلم مرتبطًا بحلقة نشطة حاليًا
    const assigned = db.prepare("SELECT COUNT(*) AS c FROM groups WHERE teacher_id = ? AND status = 'active'").get(t.id).c
    if (assigned > 0) {
      return res.status(409).json({
        error: 'لا يمكن حذف هذا المعلم لأنه مرتبط بحلقة نشطة. افصل إسناد الحلقة أولًا ثم أعد المحاولة.'
      })
    }
    const { confirmText, backup } = req.body || {}
    if (!matchesConfirm(confirmText, t.full_name)) {
      return res.status(400).json({ error: 'يرجى كتابة «حذف» أو اسم المعلم للتأكيد.' })
    }
    let backupFile = null
    try {
      backupFile = ensureBackupBeforeDelete(backup)
    } catch {
      return res.status(500).json({ error: 'تعذّر إنشاء النسخة الاحتياطية، لم يتم حذف أي بيانات.' })
    }
    try {
      // حذف المستخدم يُفرّع حذفه تلقائيًا إلى صف المعلم (CASCADE)،
      // بينما تُبقى السجلات التاريخية (الحلقات/السجلات اليومية) سليمة عبر SET NULL.
      withTransaction(() => {
        db.prepare('DELETE FROM users WHERE id = ?').run(t.user_id)
      })
    } catch {
      return res.status(500).json({ error: 'تعذّر حذف المعلم نهائيًا بسبب خطأ في الخادم.' })
    }
    audit({
      user: req.auth,
      action: 'delete',
      entity_type: 'teacher',
      entity_id: t.id,
      old_data: { full_name: t.full_name },
      new_data: { deleted: true, backup_file: backupFile }
    })
    return res.json({ ok: true })
  })

  // أرشفة/تعطيل حلقة (ليست حذفًا)
  api.post('/groups/:id/archive', requireRole('supervisor'), (req, res) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id)
    if (!g) return res.status(404).json({ error: 'الحلقة غير موجودة' })
    db.prepare("UPDATE groups SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(g.id)
    audit({
      user: req.auth,
      action: 'archive',
      entity_type: 'group',
      entity_id: g.id,
      old_data: { status: g.status },
      new_data: { status: 'inactive' }
    })
    return res.json({ ok: true })
  })

  // الحذف النهائي لحلقة (محمي بفحص الطلاب النشطين + داخل معاملة)
  api.delete('/groups/:id/permanent', requireRole('supervisor'), (req, res) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id)
    if (!g) return res.status(404).json({ error: 'الحلقة غير موجودة' })
    const activeStudents = db.prepare('SELECT COUNT(*) AS c FROM student_group_history WHERE group_id = ? AND end_date IS NULL').get(g.id).c
    const dailyCount = db.prepare('SELECT COUNT(*) AS c FROM daily_records WHERE group_id = ?').get(g.id).c
    const historyCount = db.prepare('SELECT COUNT(*) AS c FROM student_group_history WHERE group_id = ?').get(g.id).c
    const teacherHistory = db.prepare('SELECT COUNT(*) AS c FROM group_teacher_history WHERE group_id = ?').get(g.id).c
    if (activeStudents > 0) {
      return res.status(409).json({
        error: `لا يمكن حذف هذه الحلقة لأنها تضم ${activeStudents} طالبًا نشطًا. انقل الطلاب أو أرشفهم أولًا.`,
        related: { activeStudents, dailyCount, historyCount, teacherHistory }
      })
    }
    const { confirmText, backup } = req.body || {}
    if (!matchesConfirm(confirmText, g.name)) {
      return res.status(400).json({ error: 'يرجى كتابة «حذف» أو اسم الحلقة للتأكيد.' })
    }
    let backupFile = null
    try {
      backupFile = ensureBackupBeforeDelete(backup)
    } catch {
      return res.status(500).json({ error: 'تعذّر إنشاء النسخة الاحتياطية، لم يتم حذف أي بيانات.' })
    }
    try {
      withTransaction(() => {
        db.prepare('DELETE FROM groups WHERE id = ?').run(g.id)
      })
    } catch {
      return res.status(500).json({ error: 'تعذّر حذف الحلقة نهائيًا بسبب خطأ في الخادم.' })
    }
    audit({
      user: req.auth,
      action: 'delete',
      entity_type: 'group',
      entity_id: g.id,
      old_data: { name: g.name, related: { dailyCount, historyCount, teacherHistory } },
      new_data: { deleted: true, backup_file: backupFile }
    })
    return res.json({ ok: true })
  })

  // معاينة السجلات اليومية المرشّحة للحذف (لا حذف فعلي)
  api.post('/daily/preview', requireRole('supervisor'), (req, res) => {
    const { from, to, scope, group_id, student_id } = req.body || {}
    if (!isValidDateStr(from) || !isValidDateStr(to)) {
      return res.status(400).json({ error: 'يرجى تحديد فترة صحيحة (من تاريخ وإلى تاريخ).' })
    }
    if (scope === 'group' && !group_id) return res.status(400).json({ error: 'يرجى اختيار الحلقة.' })
    if (scope === 'student' && !student_id) return res.status(400).json({ error: 'يرجى اختيار الطالب.' })
    const { clause, params } = buildDailyWhere({ from, to, scope, group_id, student_id })
    const daily = db.prepare(`SELECT COUNT(*) AS c FROM daily_records dr ${clause}`).get(...params).c
    const attendance = db
      .prepare(`SELECT COUNT(*) AS c FROM attendances a JOIN daily_records dr ON dr.id = a.daily_record_id ${clause}`)
      .get(...params).c
    const memorization = db
      .prepare(`SELECT COUNT(*) AS c FROM memorization_records m JOIN daily_records dr ON dr.id = m.daily_record_id ${clause}`)
      .get(...params).c
    const revision = db
      .prepare(`SELECT COUNT(*) AS c FROM revision_records r JOIN daily_records dr ON dr.id = r.daily_record_id ${clause}`)
      .get(...params).c
    return res.json({
      from,
      to,
      scope,
      group_id: scope === 'group' ? group_id : undefined,
      student_id: scope === 'student' ? student_id : undefined,
      counts: { daily, attendance, memorization, revision }
    })
  })

  // الحذف الجماعي للسجلات اليومية (محمي + داخل معاملة + تسجيل تدقيق)
  api.delete('/daily/bulk', requireRole('supervisor'), (req, res) => {
    const { from, to, scope, group_id, student_id, confirmText, backup } = req.body || {}
    if (!isValidDateStr(from) || !isValidDateStr(to)) {
      return res.status(400).json({ error: 'يرجى تحديد فترة صحيحة (من تاريخ وإلى تاريخ).' })
    }
    if (scope === 'group' && !group_id) return res.status(400).json({ error: 'يرجى اختيار الحلقة.' })
    if (scope === 'student' && !student_id) return res.status(400).json({ error: 'يرجى اختيار الطالب.' })
    if (!matchesConfirm(confirmText)) {
      return res.status(400).json({ error: 'يرجى كتابة «حذف» للتأكيد.' })
    }
    const { clause, params } = buildDailyWhere({ from, to, scope, group_id, student_id })
    let backupFile = null
    try {
      backupFile = ensureBackupBeforeDelete(backup)
    } catch {
      return res.status(500).json({ error: 'تعذّر إنشاء النسخة الاحتياطية، لم يتم حذف أي بيانات.' })
    }
    let deleted = 0
    try {
      withTransaction(() => {
        deleted = db.prepare(`SELECT COUNT(*) AS c FROM daily_records AS dr ${clause}`).get(...params).c
        db.prepare(`DELETE FROM daily_records AS dr ${clause}`).run(...params)
      })
    } catch {
      return res.status(500).json({ error: 'تعذّر حذف السجلات اليومية بسبب خطأ في الخادم.' })
    }
    audit({
      user: req.auth,
      action: 'bulk_delete',
      entity_type: 'daily_records',
      entity_id: null,
      old_data: {
        from,
        to,
        scope,
        group_id: scope === 'group' ? group_id : undefined,
        student_id: scope === 'student' ? student_id : undefined,
        count: deleted
      },
      new_data: { deleted: true, backup_file: backupFile }
    })
    return res.json({ ok: true, deleted })
  })

  // معاينة سجل التدقيق القديم المرشّح للحذف
  api.post('/audit/preview', requireRole('supervisor'), (req, res) => {
    const { olderThan, customDate } = req.body || {}
    let cutoff
    try {
      cutoff = resolveAuditCutoff(olderThan, customDate)
    } catch (e) {
      return res.status(400).json({ error: e.message || 'خيار الحذف غير صالح.' })
    }
    const count = db.prepare('SELECT COUNT(*) AS c FROM audit_logs WHERE created_at < ?').get(cutoff).c
    return res.json({ olderThan, cutoff, count })
  })

  // معاينة سجل التدقيق المرشّح للحذف (ids | from,to | olderThan) — لا تحذف
  api.post('/audit/preview-delete', requireRole('supervisor'), (req, res) => {
    const { ids, from, to, olderThan, customDate } = req.body || {}
    let filter
    try {
      filter = buildAuditDeleteWhere({ ids, from, to, olderThan, customDate })
    } catch (e) {
      return res.status(400).json({ error: e.message || 'خيار الحذف غير صالح.' })
    }
    const row = db
      .prepare(`SELECT COUNT(*) AS c, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM audit_logs ${filter.clause}`)
      .get(...filter.params)
    return res.json({ count: row.c, oldest: row.oldest, newest: row.newest })
  })

  // الحذف الجماعي لسجل التدقيق (ids | from,to | olderThan) — محمي + داخل معاملة + نسخة احتياطية اختيارية
  api.delete('/audit/bulk', requireRole('supervisor'), (req, res) => {
    const { ids, from, to, olderThan, customDate, confirmText, backup } = req.body || {}
    if (!matchesConfirm(confirmText)) {
      return res.status(400).json({ error: 'يرجى كتابة «حذف» للتأكيد.' })
    }
    let filter
    try {
      filter = buildAuditDeleteWhere({ ids, from, to, olderThan, customDate })
    } catch (e) {
      return res.status(400).json({ error: e.message || 'خيار الحذف غير صالح.' })
    }
    let backupFile = null
    try {
      backupFile = ensureBackupBeforeDelete(backup)
    } catch {
      return res.status(500).json({ error: 'تعذّر إنشاء النسخة الاحتياطية، لم يتم حذف أي بيانات.' })
    }
    let deleted = 0
    try {
      withTransaction(() => {
        deleted = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${filter.clause}`).get(...filter.params).c
        db.prepare(`DELETE FROM audit_logs ${filter.clause}`).run(...filter.params)
      })
    } catch {
      return res.status(500).json({ error: 'تعذّر حذف سجل التدقيق بسبب خطأ في الخادم.' })
    }
    // سجلّ ملخّصًا موجزًا لعملية التنظيف (دون إعادة إنشاء سجل لكل عنصر محذوف)
    audit({
      user: req.auth,
      action: 'bulk_delete',
      entity_type: 'audit_log',
      entity_id: null,
      old_data: { filter: { ids: ids || undefined, from: from || undefined, to: to || undefined, olderThan: olderThan || undefined }, count: deleted },
      new_data: { deleted: true, backup_file: backupFile }
    })
    return res.json({ ok: true, deleted })
  })

  // حذف سجل تغيير واحد (محمي + داخل معاملة)
  api.delete('/audit/:id', requireRole('supervisor'), (req, res) => {
    const rec = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(req.params.id)
    if (!rec) return res.status(404).json({ error: 'السجل غير موجود' })
    const { confirmText } = req.body || {}
    if (!matchesConfirm(confirmText)) {
      return res.status(400).json({ error: 'يرجى كتابة «حذف» للتأكيد.' })
    }
    let backupFile = null
    try {
      backupFile = ensureBackupBeforeDelete(req.body && req.body.backup)
    } catch {
      return res.status(500).json({ error: 'تعذّر إنشاء النسخة الاحتياطية، لم يتم حذف أي بيانات.' })
    }
    try {
      withTransaction(() => {
        db.prepare('DELETE FROM audit_logs WHERE id = ?').run(rec.id)
      })
    } catch {
      return res.status(500).json({ error: 'تعذّر حذف السجل بسبب خطأ في الخادم.' })
    }
    audit({
      user: req.auth,
      action: 'delete',
      entity_type: 'audit_log',
      entity_id: rec.id,
      old_data: { action: rec.action, entity_type: rec.entity_type },
      new_data: { deleted: true, backup_file: backupFile }
    })
    return res.json({ ok: true })
  })

  // مسار تسجيل الدخول (بلا توثيق) يُركّب خارج الوسيط العام
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' })
    const user = loadUserByUsername(username)
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' })
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'الحساب غير مفعل' })
    const token = signToken(user)
    res.json({ token, user: safeUser(user) })
  })

  // إعدادات عامة يقرأها التطبيق (الرابط الرسمي وزر التواصل). غير حساسة، لذا بلا مصادقة.
  app.get('/api/config', (req, res) => {
    res.json({
      appUrl: resolvePublicUrl(req),
      whatsappNumber: WHATSAPP_NUMBER,
      environment
    })
  })

  app.use('/api', api)
}
