import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-assign-reason-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')
const { db } = await import('../src/db.js')

function loginAs(username, password) {
  return request(app).post('/api/auth/login').send({ username, password })
}
async function tokenFor(username, password) {
  const res = await loginAs(username, password)
  assert.equal(res.status, 200, `فشل دخول ${username}: ${JSON.stringify(res.body)}`)
  return res.body.token
}

let adminToken, teacherToken, t1Id, t2Id, groupId

before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  teacherToken = await tokenFor('teacher1', 'teacher123')

  // جلب معرّفي المعلمين
  const teachers = await request(app).get('/api/teachers').set('Authorization', `Bearer ${adminToken}`)
  t1Id = teachers.body[0]?.id
  t2Id = teachers.body[1]?.id
  assert.ok(t1Id && t2Id, 'يجب وجود معلمين على الأقل')

  // جلب حلقة
  const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)
  groupId = groups.body[0]?.id
  assert.ok(groupId, 'يجب وجود حلقة واحدة على الأقل')
})

after(() => {
  try { fs.unlinkSync(tmp) } catch {}
})

// ==================== اختبارات السبب ====================

test('1. تغيير المحفظ مع سبب محفوظ', async () => {
  const r = await request(app).put(`/api/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`).send({
    teacher_id: t2Id,
    assign_reason: 'إعادة توزيع الحلقات'
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)

  // تحقق من السجل في group_teacher_history
  const history = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ? AND end_date IS NULL').get(groupId)
  assert.ok(history, 'يجب وجود سجل تاريخ مفتوح')
  assert.equal(history.teacher_id, t2Id)
  assert.equal(history.reason, 'إعادة توزيع الحلقات')
})

test('2. السبب يظهر في سجل الإسناد للمعلم', async () => {
  const r = await request(app).get(`/api/teachers/${t2Id}/group-history`).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  const record = r.body.find(h => h.group_id === groupId && !h.end_date)
  assert.ok(record, 'يجب وجود سجل مفتوح للمعلم')
  assert.equal(record.reason, 'إعادة توزيع الحلقات')
})

test('3. السبب يظهر في سجل الإسناد للحلقة', async () => {
  const r = await request(app).get(`/api/groups/${groupId}/teacher-history`).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  const record = r.body.find(h => !h.end_date)
  assert.ok(record, 'يجب وجود سجل مفتوح للحلقة')
  assert.equal(record.reason, 'إعادة توزيع الحلقات')
})

test('4. تغيير المحفظ بدون سبب يستخدم الافتراضي', async () => {
  // أعد المحفظ إلى t1 بدون سبب
  const r = await request(app).put(`/api/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`).send({
    teacher_id: t1Id
  })
  assert.equal(r.status, 200)

  const history = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ? AND end_date IS NULL').get(groupId)
  assert.ok(history)
  assert.equal(history.teacher_id, t1Id)
  assert.equal(history.reason, 'reassign')
})

test('5. سبب "سبب آخر" مع نص مخصص', async () => {
  const r = await request(app).put(`/api/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`).send({
    teacher_id: t2Id,
    assign_reason: 'انتقال المحفظ إلى حلقة أخرى'
  })
  assert.equal(r.status, 200)

  const history = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ? AND end_date IS NULL').get(groupId)
  assert.ok(history)
  assert.equal(history.reason, 'انتقال المحفظ إلى حلقة أخرى')
})

test('6. تعويض محفظ', async () => {
  const r = await request(app).put(`/api/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`).send({
    teacher_id: t1Id,
    assign_reason: 'تعويض محفظ'
  })
  assert.equal(r.status, 200)

  const history = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ? AND end_date IS NULL').get(groupId)
  assert.ok(history)
  assert.equal(history.reason, 'تعويض محفظ')
})

test('7. تغيير تنظيمي', async () => {
  const r = await request(app).put(`/api/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`).send({
    teacher_id: t2Id,
    assign_reason: 'تغيير تنظيمي'
  })
  assert.equal(r.status, 200)

  const history = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ? AND end_date IS NULL').get(groupId)
  assert.ok(history)
  assert.equal(history.reason, 'تغيير تنظيمي')
})

test('8. لا يُنشأ سجل جديد إذا لم يتغير المحفظ', async () => {
  // المحفظ الحالي هو t2
  const before = db.prepare('SELECT COUNT(*) AS c FROM group_teacher_history WHERE group_id = ?').get(groupId)

  const r = await request(app).put(`/api/groups/${groupId}`).set('Authorization', `Bearer ${adminToken}`).send({
    name: 'اسم الحلقة الجديد',
    teacher_id: t2Id
  })
  assert.equal(r.status, 200)

  const after = db.prepare('SELECT COUNT(*) AS c FROM group_teacher_history WHERE group_id = ?').get(groupId)
  // لا يجب أن يزداد العدد إذا كان المحفظ هو نفسه
  assert.equal(after.c, before.c, 'لا يجب إنشاء سجل جديد إذا لم يتغير المحفظ')
})

test('9. المعلم لا يستطيع تغيير إسناد المحفظ', async () => {
  const r = await request(app).put(`/api/groups/${groupId}`).set('Authorization', `Bearer ${teacherToken}`).send({
    teacher_id: t1Id,
    assign_reason: 'سبب غير مصرّح'
  })
  assert.equal(r.status, 403)
})

test('10. السبب يُسجّل في audit_logs', async () => {
  const r = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  const groupLog = r.body.rows.find(l => l.entity_type === 'group')
  assert.ok(groupLog, 'يجب وجود سجل تدقيق للحلقة')
})

test('11. اختبارات المراحل السابقة لا تتأثر', async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })
  assert.equal(login.status, 200)

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(me.status, 200)
  assert.equal(me.body.user.role, 'supervisor')
})
