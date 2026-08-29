// اختبارات مركز إدارة البيانات والحذف الآمن (المرحلة الجديدة).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-dm-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')
const { db } = await import('../src/db.js')
const { hashPassword } = await import('../src/auth.js')
const { uuid } = await import('../src/lib.js')

const login = (u, p) => request(app).post('/api/auth/login').send({ username: u, password: p })
const tokenFor = async (u, p) => (await login(u, p)).body.token
const get = (p, t) => request(app).get(p).set('Authorization', `Bearer ${t}`)
const del = (p, t, body) => request(app).delete(p).set('Authorization', `Bearer ${t}`).send(body || {})
const post = (p, t, body) => request(app).post(p).set('Authorization', `Bearer ${t}`).send(body || {})

let supToken, teacherToken, supUserId

function ins(table, obj) {
  const cols = Object.keys(obj)
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  db.prepare(sql).run(...cols.map((c) => obj[c]))
}
function makeTeacher(name) {
  const uid = uuid()
  ins('users', {
    id: uid,
    username: 't_' + name,
    email: name + '@x.com',
    password_hash: hashPassword('x12345'),
    full_name: name,
    role: 'teacher',
    status: 'active'
  })
  const tid = uuid()
  ins('teachers', { id: tid, user_id: uid, full_name: name, status: 'active' })
  return { uid, tid }
}
const nowISO = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

before(async () => {
  supUserId = uuid()
  ins('users', {
    id: supUserId,
    username: 'sup_dm',
    email: 's@x.com',
    password_hash: hashPassword('sup1234'),
    full_name: 'المشرف',
    role: 'supervisor',
    status: 'active'
  })
  const tUid = uuid()
  ins('users', {
    id: tUid,
    username: 'tech_dm',
    email: 't@x.com',
    password_hash: hashPassword('tech1234'),
    full_name: 'أستاذ محمد',
    role: 'teacher',
    status: 'active'
  })
  ins('teachers', { id: uuid(), user_id: tUid, full_name: 'أستاذ محمد', status: 'active' })
  supToken = await tokenFor('sup_dm', 'sup1234')
  teacherToken = await tokenFor('tech_dm', 'tech1234')
})

// ===== الصلاحيات =====
test('المشرف يستطيع جلب ملخّص إدارة البيانات', async () => {
  const r = await get('/api/data-management/summary', supToken)
  assert.equal(r.status, 200)
  assert.ok('students' in r.body && 'teachers' in r.body)
})

test('المعلم يحصل على 403 على ملخّص إدارة البيانات', async () => {
  const r = await get('/api/data-management/summary', teacherToken)
  assert.equal(r.status, 403)
})

test('المعلم ممنوع من الحذف النهائي للطلاب (403)', async () => {
  const sid = uuid()
  ins('students', { id: sid, student_code: 'Z9', full_name: 'ممنوع', enrollment_date: '2025-01-01', status: 'active' })
  const r = await del(`/api/students/${sid}/permanent`, teacherToken, { confirmText: 'حذف' })
  assert.equal(r.status, 403)
  assert.ok(db.prepare('SELECT 1 FROM students WHERE id = ?').get(sid))
})

test('المعلم ممنوع من حذف السجلات اليومية (403)', async () => {
  const r = await del('/api/daily/bulk', teacherToken, { from: '2025-01-01', to: '2025-01-31', scope: 'all', confirmText: 'حذف' })
  assert.equal(r.status, 403)
})

test('المعلم ممنوع من حذف سجل التدقيق (403)', async () => {
  const r = await del('/api/audit/bulk', teacherToken, { olderThan: '30d', confirmText: 'حذف' })
  assert.equal(r.status, 403)
})

// ===== الطلاب: تأكيد + حذف ذري للعلاقات =====
test('الحذف النهائي للطالب يرفض بدون تأكيد صحيح', async () => {
  const sid = uuid()
  ins('students', { id: sid, student_code: 'X1', full_name: 'وليد', enrollment_date: '2025-01-01', status: 'active' })
  const r = await del(`/api/students/${sid}/permanent`, supToken, {})
  assert.equal(r.status, 400)
  assert.ok(db.prepare('SELECT 1 FROM students WHERE id = ?').get(sid))
})

test('الحذف النهائي للطالب يحذف جميع البيانات المرتبطة (لا سجلات يتيمة)', async () => {
  const sid = uuid()
  ins('students', { id: sid, student_code: 'X2', full_name: 'سالم', enrollment_date: '2025-01-01', status: 'active' })
  const gid = uuid()
  ins('groups', { id: gid, name: 'حلقة1', status: 'active' })
  ins('student_group_history', { id: uuid(), student_id: sid, group_id: gid, teacher_id: null, start_date: '2025-01-02' })
  ins('daily_records', { id: uuid(), student_id: sid, record_date: '2025-02-01' })
  ins('student_notes', { id: uuid(), student_id: sid, note: 'ملاحظة', note_type: 'general' })
  const r = await del(`/api/students/${sid}/permanent`, supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM students WHERE id = ?').get(sid).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM daily_records WHERE student_id = ?').get(sid).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM student_notes WHERE student_id = ?').get(sid).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM student_group_history WHERE student_id = ?').get(sid).c, 0)
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action='delete' AND entity_type='student' AND entity_id=?").get(sid))
})

test('الحذف النهائي للطالب يقبل اسم الطالب كتأكيد', async () => {
  const sid = uuid()
  ins('students', { id: sid, student_code: 'X3', full_name: 'فهد', enrollment_date: '2025-01-01', status: 'active' })
  const r = await del(`/api/students/${sid}/permanent`, supToken, { confirmText: 'فهد' })
  assert.equal(r.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM students WHERE id = ?').get(sid).c, 0)
})

// ===== المعلمون: حماية + علاقات =====
test('لا يمكن حذف معلم مرتبط بحلقة نشطة (409)', async () => {
  const { tid } = makeTeacher('معلم محظور')
  const gid = uuid()
  ins('groups', { id: gid, name: 'حلقة ممنوعة', teacher_id: tid, status: 'active' })
  const r = await del(`/api/teachers/${tid}/permanent`, supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 409)
  assert.ok(db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(tid))
})

test('حذف معلم غير مرتبط بحلقة يزيل حسابه نهائيًا', async () => {
  const { uid, tid } = makeTeacher('معلم حر')
  const r = await del(`/api/teachers/${tid}/permanent`, supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM teachers WHERE id = ?').get(tid).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(uid).c, 0)
})

test('لا يمكن حذف حساب مشرف عبر مسار المعلمين (400)', async () => {
  const sUid = uuid()
  ins('users', {
    id: sUid,
    username: 'sup2_dm',
    email: 'sup2@x.com',
    password_hash: hashPassword('x12345'),
    full_name: 'مشرف2',
    role: 'supervisor',
    status: 'active'
  })
  const tid = uuid()
  ins('teachers', { id: tid, user_id: sUid, full_name: 'مشرف2', status: 'active' })
  const r = await del(`/api/teachers/${tid}/permanent`, supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 400)
  assert.ok(db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(tid))
})

// ===== الحلقات =====
test('أرشفة الحلقة تُخفيها (status=inactive)', async () => {
  const gid = uuid()
  ins('groups', { id: gid, name: 'حلقة أرشفة', status: 'active' })
  const r = await post(`/api/groups/${gid}/archive`, supToken, {})
  assert.equal(r.status, 200)
  assert.equal(db.prepare('SELECT status FROM groups WHERE id = ?').get(gid).status, 'inactive')
})

test('حذف حلقة بها طلاب نشطون مرفوض (409)', async () => {
  const gid = uuid()
  ins('groups', { id: gid, name: 'حلقة طلاب', status: 'active' })
  const sid = uuid()
  ins('students', { id: sid, student_code: 'G1', full_name: 'طالب حلقة', enrollment_date: '2025-01-01', status: 'active' })
  ins('student_group_history', { id: uuid(), student_id: sid, group_id: gid, teacher_id: null, start_date: '2025-01-02' })
  const r = await del(`/api/groups/${gid}/permanent`, supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 409)
  assert.ok(db.prepare('SELECT 1 FROM groups WHERE id = ?').get(gid))
})

test('حذف حلقة بلا طلاب نشطين ناجح', async () => {
  const gid = uuid()
  ins('groups', { id: gid, name: 'حلقة فارغة', status: 'active' })
  const r = await del(`/api/groups/${gid}/permanent`, supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM groups WHERE id = ?').get(gid).c, 0)
})

// ===== السجلات اليومية: معاينة + حذف =====
test('معاينة وحذف السجلات اليومية حسب الفترة', async () => {
  const sid = uuid()
  ins('students', { id: sid, student_code: 'D1', full_name: 'طالب سجلات', enrollment_date: '2025-01-01', status: 'active' })
  ins('daily_records', { id: uuid(), student_id: sid, record_date: '2025-01-15' })
  ins('daily_records', { id: uuid(), student_id: sid, record_date: '2025-03-15' })

  const prev = await post('/api/daily/preview', supToken, { from: '2025-01-01', to: '2025-01-31', scope: 'all' })
  assert.equal(prev.status, 200)
  assert.equal(prev.body.counts.daily, 1)

  const no = await del('/api/daily/bulk', supToken, { from: '2025-01-01', to: '2025-01-31', scope: 'all' })
  assert.equal(no.status, 400)

  const yes = await del('/api/daily/bulk', supToken, { from: '2025-01-01', to: '2025-01-31', scope: 'all', confirmText: 'حذف' })
  assert.equal(yes.status, 200)
  assert.equal(yes.body.deleted, 1)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM daily_records WHERE record_date='2025-01-15'").get().c, 0)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM daily_records WHERE record_date='2025-03-15'").get().c, 1)
})

// ===== سجل التدقيق =====
test('جلب سجل التدقيق يُرجع {total, rows} وبيانات JSON مُفكّكة (لا [object Object])', async () => {
  ins('audit_logs', {
    id: uuid(),
    user_id: supUserId,
    action: 'create',
    entity_type: 'student',
    entity_id: uuid(),
    old_data: '{}',
    new_data: JSON.stringify({ full_name: 'أحمد محمد', status: 'active', student_code: 'SX1' }),
    created_at: nowISO()
  })
  const r = await get('/api/audit?entity_type=student', supToken)
  assert.equal(r.status, 200)
  assert.ok('total' in r.body && Array.isArray(r.body.rows))
  const row = r.body.rows.find((x) => x.entity_type === 'student')
  assert.ok(row, 'يجب أن يظهر سجل الطالب')
  assert.equal(typeof row.new_data, 'object', 'new_data يجب أن يكون كائنًا لا نصًا ([object Object])')
  assert.equal(row.new_data.full_name, 'أحمد محمد')
})

test('معاينة حذف سجل التدقيق لا تحذف فعليًا', async () => {
  const id = uuid()
  ins('audit_logs', { id, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2020-01-01 10:00:00' })
  const prev = await post('/api/audit/preview', supToken, { olderThan: '30d' })
  assert.equal(prev.status, 200)
  assert.ok(prev.body.count >= 1)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id).c, 1)
})

test('حذف سجل التدقيق القديم عبر فترة (olderThan) يحذف القديم ويبقي الحديث', async () => {
  const oldId = uuid()
  ins('audit_logs', { id: oldId, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2020-01-01 10:00:00' })
  const newId = uuid()
  ins('audit_logs', { id: newId, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: nowISO() })

  const all = await del('/api/audit/bulk', supToken, { confirmText: 'حذف' })
  assert.equal(all.status, 400, 'يجب رفض الحذف الكلي (بدون فلتر)')

  const yes = await del('/api/audit/bulk', supToken, { olderThan: '30d', confirmText: 'حذف' })
  assert.equal(yes.status, 200)
  assert.ok(yes.body.deleted >= 1)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(oldId).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(newId).c, 1)
})

test('تنظيف السجلات يسجّل سجلًا موجزًا واحدًا (دون حلقة لا نهائية)', async () => {
  const before = db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE action=?').get('bulk_delete').c
  const oldId = uuid()
  ins('audit_logs', { id: oldId, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2020-01-01 10:00:00' })
  await del('/api/audit/bulk', supToken, { olderThan: '30d', confirmText: 'حذف' })
  const after = db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE action=?').get('bulk_delete').c
  assert.equal(after, before + 1, 'يجب إضافة سجل bulk_delete واحد فقط')
})

test('البحث والفرز في سجل التدقيق يعملان', async () => {
  const id = uuid()
  ins('audit_logs', { id, user_id: supUserId, action: 'reset_password', entity_type: 'user', entity_id: supUserId, old_data: '{}', new_data: JSON.stringify({ reset: true }), created_at: '2021-06-01 10:00:00' })
  const q = await get('/api/audit?q=reset_password', supToken)
  assert.equal(q.status, 200)
  assert.ok(q.body.rows.find((x) => x.action === 'reset_password'))
  const asc = await get('/api/audit?sort=asc', supToken)
  const desc = await get('/api/audit?sort=desc', supToken)
  assert.equal(asc.status, 200)
  assert.equal(desc.status, 200)
  if (asc.body.rows.length >= 2) {
    assert.ok(asc.body.rows[0].created_at <= asc.body.rows[asc.body.rows.length - 1].created_at)
    assert.ok(desc.body.rows[0].created_at >= desc.body.rows[desc.body.rows.length - 1].created_at)
  }
})

test('كلمات المرور لا تظهر أبدًا في سجل التدقيق', async () => {
  ins('audit_logs', { id: uuid(), user_id: supUserId, action: 'reset_password', entity_type: 'user', entity_id: supUserId, old_data: '{}', new_data: JSON.stringify({ reset: true }), created_at: nowISO() })
  const leak = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE old_data LIKE '%password%' OR new_data LIKE '%password%'").get().c
  assert.equal(leak, 0)
})

// ===== النسخ الاحتياطي + الأمان =====
test('المشرف يستطيع إنشاء نسخة احتياطية', async () => {
  const r = await post('/api/data-management/backup', supToken, {})
  assert.equal(r.status, 200)
  assert.ok(r.body.file)
})

test('رسائل الخطأ لا تكشف تفاصيل SQL', async () => {
  const r1 = await del('/api/daily/bulk', supToken, { from: 'bad', to: '2025-01-31', scope: 'all', confirmText: 'حذف' })
  assert.equal(r1.status, 400)
  assert.ok(!/sql|sqlite/i.test(JSON.stringify(r1.body)))
  const r2 = await del(`/api/students/${uuid()}/permanent`, supToken, { confirmText: 'حذف' })
  assert.equal(r2.status, 404)
  assert.ok(!/sql|sqlite|stack/i.test(JSON.stringify(r2.body)))
})
