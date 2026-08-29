// طبقة تقارير المشرف المركزية
// كل التقارير مشتقّة حصرًا من البيانات الموجودة في قاعدة البيانات.
// لا توجد أي عملية إدخال هنا — المصدر الوحيد هو سجلات المتابعة اليومية.

import { db } from './db.js'
import { todayStr, allowedStudentIds } from './lib.js'

// ============ أدوات مساعدة ============

function orNR(v) {
  return v == null || v === 'not_recorded' ? 'not_recorded' : v
}

function inclusiveDays(a, b) {
  const d1 = new Date(a + 'T00:00:00Z')
  const d2 = new Date(b + 'T00:00:00Z')
  return Math.round((d2 - d1) / 86400000) + 1
}

function shiftDays(s, delta) {
  const d = new Date(s + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

// عدد الأيام التي كان فيها الطالب نشطًا ومسندًا إلى حلقة ضمن الفترة [from,to]
// لا نحسب الأيام قبل التحاقه أو بعد خروجه/أرشفته.
function activeDaysInRange(studentId, from, to) {
  const enrollment =
    db.prepare('SELECT enrollment_date FROM students WHERE id = ?').get(studentId)?.enrollment_date || '2000-01-01'
  const hist = db
    .prepare(
      `SELECT start_date, end_date FROM student_group_history
       WHERE student_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`
    )
    .all(studentId, to, from)

  if (hist.length === 0) {
    let s = enrollment < from ? from : enrollment
    if (s <= to) return inclusiveDays(s, to)
    return 0
  }

  let total = 0
  for (const h of hist) {
    let s = h.start_date
    if (s < enrollment) s = enrollment
    let e = h.end_date || '9999-12-31'
    if (e > to) e = to
    if (s > to || e < from) continue
    const cs = s < from ? from : s
    const ce = e > to ? to : e
    if (cs <= ce) total += inclusiveDays(cs, ce)
  }
  return total
}

// تجميع إحصائيات محاور اليوم من صفوف سبق تعيين محاورها إلى نصوص (att/mem/rev)
export function tallyDailyRecords(rows) {
  const c = {
    on_time: 0,
    late: 0,
    excused: 0,
    not_recorded_att: 0,
    heard: 0,
    not_heard: 0,
    not_recorded_mem: 0,
    reviewed: 0,
    not_reviewed: 0,
    not_recorded_rev: 0
  }
  for (const x of rows) {
    const att = orNR(x.att || x.attendance_status || x.attendance)
    const mem = orNR(x.mem || x.memorization_status || x.memorization)
    const rev = orNR(x.rev || x.revision_status || x.revision)
    if (att === 'on_time') c.on_time++
    else if (att === 'late') c.late++
    else if (att === 'excused_absent') c.excused++
    else c.not_recorded_att++
    if (mem === 'heard') c.heard++
    else if (mem === 'not_heard') c.not_heard++
    else c.not_recorded_mem++
    if (rev === 'reviewed') c.reviewed++
    else if (rev === 'not_reviewed') c.not_reviewed++
    else c.not_recorded_rev++
  }
  return c
}

function buildStudentInfo(studentId) {
  return db
    .prepare(
      `SELECT s.full_name, s.student_code, g.name AS group_name, t.full_name AS teacher_name
       FROM students s
       LEFT JOIN student_group_history h ON h.student_id = s.id AND h.end_date IS NULL
       LEFT JOIN groups g ON g.id = h.group_id
       LEFT JOIN teachers t ON t.id = h.teacher_id
       WHERE s.id = ?`
    )
    .get(studentId)
}

// ============ 1) التقرير اليومي المركزي ============

export function buildDailyReport({ date, group_id, teacher_id, student_id, status, q, auth }) {
  const d = date || todayStr()
  const ids = allowedStudentIds(auth)
  const where = ["s.status != 'archived'"]
  const params = []

  if (group_id && group_id !== 'all') {
    where.push('cur.group_id = ?')
    params.push(group_id)
  }
  if (teacher_id && teacher_id !== 'all') {
    where.push('cur.teacher_id = ?')
    params.push(teacher_id)
  }
  if (student_id && student_id !== 'all') {
    where.push('s.id = ?')
    params.push(student_id)
  }
  if (q) {
    where.push('(s.full_name LIKE ? OR s.student_code LIKE ?)')
    params.push('%' + q + '%', '%' + q + '%')
  }
  if (ids !== null) {
    where.push(`s.id IN (${ids.map(() => '?').join(',')})`)
    params.push(...ids)
  }

  const raw = db
    .prepare(
      `WITH cur AS (
         SELECT student_id, group_id, teacher_id
         FROM student_group_history
         WHERE end_date IS NULL
       )
       SELECT
         s.id AS student_id,
         s.student_code,
         s.full_name,
         s.nickname,
         g.name AS group_name,
         t.full_name AS teacher_name,
         dr.id AS daily_id,
         a.status AS att,
         m.status AS mem,
         m.amount AS mem_amount,
         m.mastery_status AS mastery,
         r.status AS rev,
         r.quality AS rev_quality,
         dr.note AS daily_note,
         a.note AS att_note,
         m.note AS mem_note,
         r.note AS rev_note
       FROM students s
       JOIN cur ON cur.student_id = s.id
       LEFT JOIN groups g ON g.id = cur.group_id
       LEFT JOIN teachers t ON t.id = cur.teacher_id
       LEFT JOIN daily_records dr
         ON dr.student_id = s.id AND dr.record_date = ? AND dr.group_id = cur.group_id
       LEFT JOIN attendances a ON a.daily_record_id = dr.id
       LEFT JOIN memorization_records m ON m.daily_record_id = dr.id
       LEFT JOIN revision_records r ON r.daily_record_id = dr.id
       WHERE ${where.join(' AND ')}
       ORDER BY g.name, s.student_code, s.full_name`
    )
    .all(d, ...params)

  const rows = raw.map((r) => {
    const att = orNR(r.att)
    const mem = orNR(r.mem)
    const rev = orNR(r.rev)
    const recorded = !!r.daily_id
    const parts = [r.daily_note, r.att_note, r.mem_note, r.rev_note].filter(Boolean)
    return {
      student_id: r.student_id,
      student_code: r.student_code,
      full_name: r.full_name,
      nickname: r.nickname || '',
      group_name: r.group_name || '',
      teacher_name: r.teacher_name || '',
      recorded,
      attendance: att,
      memorization: mem,
      memorization_amount: r.mem_amount || '',
      mastery: r.mastery || 'not_evaluated',
      revision: rev,
      revision_quality: r.rev_quality || 'not_evaluated',
      note: parts.join(' | ')
    }
  })

  const summary = {
    total_students: rows.length,
    ...tallyDailyRecords(rows)
  }
  summary.registered = rows.filter((r) => r.recorded).length
  summary.not_registered = summary.total_students - summary.registered

  const filtered =
    status === 'recorded'
      ? rows.filter((r) => r.recorded)
      : status === 'not_recorded'
      ? rows.filter((r) => !r.recorded)
      : rows

  return { date: d, summary, rows: filtered }
}

// ============ 2) التقرير الدوري للطالب ============

export function buildStudentReport({ student_id, range, from, to, auth }) {
  const today = todayStr()
  let f
  let t
  if (range === '7') {
    t = today
    f = shiftDays(today, -6)
  } else if (range === '30') {
    t = today
    f = shiftDays(today, -29)
  } else if (range === 'custom') {
    f = from
    t = to
  } else {
    const s = db.prepare('SELECT enrollment_date FROM students WHERE id = ?').get(student_id)
    f = s?.enrollment_date || '2000-01-01'
    t = today
  }

  const records = db
    .prepare(
      `SELECT dr.record_date, a.status AS att, m.status AS mem, m.amount AS mem_amount,
              m.mastery_status AS mastery, r.status AS rev, dr.note
       FROM daily_records dr
       LEFT JOIN attendances a ON a.daily_record_id = dr.id
       LEFT JOIN memorization_records m ON m.daily_record_id = dr.id
       LEFT JOIN revision_records r ON r.daily_record_id = dr.id
       WHERE dr.student_id = ? AND dr.record_date BETWEEN ? AND ?
       ORDER BY dr.record_date DESC`
    )
    .all(student_id, f, t)

  const required = activeDaysInRange(student_id, f, t)
  const recorded = records.length
  const unrecorded = Math.max(0, required - recorded)

  const on_time = records.filter((r) => r.att === 'on_time').length
  const late = records.filter((r) => r.att === 'late').length
  const excused = records.filter((r) => r.att === 'excused_absent').length
  const heard = records.filter((r) => r.mem === 'heard').length
  const not_heard = records.filter((r) => r.mem === 'not_heard').length
  const reviewed = records.filter((r) => r.rev === 'reviewed').length
  const not_reviewed = records.filter((r) => r.rev === 'not_reviewed').length

  let memSum = 0
  let memCount = 0
  const mastery = { mastered: 0, needs_review: 0, not_evaluated: 0 }
  const daily_notes = []
  for (const r of records) {
    if (r.mem_amount) {
      const n = parseInt(String(r.mem_amount).replace(/[^0-9]/g, ''), 10)
      if (!isNaN(n)) {
        memSum += n
        memCount++
      }
    }
    if (r.mastery) mastery[r.mastery] = (mastery[r.mastery] || 0) + 1
    if (r.note) daily_notes.push({ date: r.record_date, note: r.note })
  }

  const info = buildStudentInfo(student_id)
  return {
    student_id,
    full_name: info?.full_name || '',
    student_code: info?.student_code || '',
    group_name: info?.group_name || '',
    teacher_name: info?.teacher_name || '',
    range: range || 'all',
    from: f,
    to: t,
    required_days: required,
    recorded_days: recorded,
    unrecorded_days: unrecorded,
    on_time,
    late,
    excused_absent: excused,
    heard,
    not_heard,
    reviewed,
    not_reviewed,
    memorization_amount_sum: memSum,
    memorization_amount_records: memCount,
    mastery,
    daily_notes
  }
}

// ============ 3) تقرير الحلقة ============

function fetchCircleNotes(group_id, from, to) {
  const rows = db
    .prepare(
      `SELECT dr.student_id, dr.record_date, dr.note, a.note AS an, m.note AS mn, r.note AS rn
       FROM daily_records dr
       LEFT JOIN attendances a ON a.daily_record_id = dr.id
       LEFT JOIN memorization_records m ON m.daily_record_id = dr.id
       LEFT JOIN revision_records r ON r.daily_record_id = dr.id
       WHERE dr.group_id = ? AND dr.record_date BETWEEN ? AND ?`
    )
    .all(group_id, from, to)
  const byStudent = {}
  for (const nr of rows) {
    const parts = [nr.note, nr.an, nr.mn, nr.rn].filter(Boolean)
    if (parts.length) {
      ;(byStudent[nr.student_id] ||= []).push({ date: nr.record_date, note: parts.join(' | ') })
    }
  }
  return byStudent
}

export function buildCircleReport({ group_id, from, to, auth }) {
  const today = todayStr()
  const f = from || shiftDays(today, -29)
  const t = to || today

  const raw = db
    .prepare(
      `WITH cur AS (
         SELECT student_id, group_id, teacher_id
         FROM student_group_history
         WHERE group_id = ? AND end_date IS NULL
       )
       SELECT
         s.id AS student_id,
         s.student_code,
         s.full_name,
         s.nickname,
         COUNT(dr.id) AS days_count,
         SUM(CASE WHEN a.status = 'on_time' THEN 1 ELSE 0 END) AS on_time,
         SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN a.status = 'excused_absent' THEN 1 ELSE 0 END) AS excused,
         SUM(CASE WHEN m.status = 'heard' THEN 1 ELSE 0 END) AS heard,
         SUM(CASE WHEN m.status = 'not_heard' THEN 1 ELSE 0 END) AS not_heard,
         SUM(CASE WHEN r.status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
         SUM(CASE WHEN r.status = 'not_reviewed' THEN 1 ELSE 0 END) AS not_reviewed,
         SUM(CASE WHEN COALESCE(a.status,'not_recorded') != 'not_recorded'
                       AND COALESCE(m.status,'not_recorded') != 'not_recorded'
                       AND COALESCE(r.status,'not_recorded') != 'not_recorded' THEN 1 ELSE 0 END) AS complete_days
       FROM students s
       JOIN cur ON cur.student_id = s.id
       LEFT JOIN daily_records dr
         ON dr.student_id = s.id AND dr.record_date BETWEEN ? AND ? AND dr.group_id = ?
       LEFT JOIN attendances a ON a.daily_record_id = dr.id
       LEFT JOIN memorization_records m ON m.daily_record_id = dr.id
       LEFT JOIN revision_records r ON r.daily_record_id = dr.id
       WHERE s.status != 'archived'
       GROUP BY s.id
       ORDER BY s.full_name`
    )
    .all(group_id, f, t, group_id)

  const notesByStudent = fetchCircleNotes(group_id, f, t)

  const students = raw.map((r) => {
    const required = activeDaysInRange(r.student_id, f, t)
    const complete = r.complete_days || 0
    const commitment_rate = required > 0 ? Math.round((complete / required) * 100) : 0
    return {
      student_id: r.student_id,
      student_code: r.student_code,
      full_name: r.full_name,
      nickname: r.nickname || '',
      days_count: r.days_count || 0,
      on_time: r.on_time || 0,
      late: r.late || 0,
      heard: r.heard || 0,
      not_heard: r.not_heard || 0,
      reviewed: r.reviewed || 0,
      not_reviewed: r.not_reviewed || 0,
      required_days: required,
      complete_days: complete,
      commitment_rate,
      important_notes: notesByStudent[r.student_id] || []
    }
  })

  return { group_id, from: f, to: t, students }
}
