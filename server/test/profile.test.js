import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-profile-${Date.now()}.db`)
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

let adminToken, teacherToken

before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  teacherToken = await tokenFor('teacher1', 'teacher123')
})

after(() => {
  try { fs.unlinkSync(tmp) } catch {}
})

// ==================== بيانات الحساب ====================

test('1. المشرف يستطيع قراءة بيانات حسابه', async () => {
  const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.username, 'admin')
  assert.equal(r.body.user.role, 'supervisor')
})

test('2. المشرف يستطيع تغيير اسمه', async () => {
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ full_name: 'الأستاذ محمد' })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.full_name, 'الأستاذ محمد')
})

test('3. الاسم الجديد يظهر بعد إعادة الجلب', async () => {
  const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.full_name, 'الأستاذ محمد')
})

test('4. المشرف يستطيع تغيير اسم المستخدم', async () => {
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ username: 'admin_new' })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.username, 'admin_new')
  // يُعيد رمز JWT جديد
  assert.ok(r.body.token, 'لم يُعاد رمز JWT جديد')
})

test('5. اسم المستخدم المكرر يرجع 409', async () => {
  // teacher1 اسم مستخدم موجود مسبقاً
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ username: 'teacher1' })
  assert.equal(r.status, 409)
  assert.ok(r.body.error.includes('مستخدم بالفعل'))
})

test('6. لا يمكن تغيير الدور', async () => {
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ role: 'teacher' })
  assert.equal(r.status, 400)
  assert.ok(r.body.error.includes('لا يُسمح'))
})

test('7. لا يمكن تعديل user ID', async () => {
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ id: 'fake-id' })
  assert.equal(r.status, 400)
})

test('8. المعلم ممنوع من API الخاص بإعدادات المشرف', async () => {
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${teacherToken}`).send({ full_name: 'test' })
  assert.equal(r.status, 403)
})

// ==================== كلمة المرور ====================

test('9. كلمة المرور القديمة الخاطئة مرفوضة', async () => {
  const r = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`).send({
    current_password: 'wrongpassword',
    new_password: 'newpass123',
    confirm_password: 'newpass123'
  })
  assert.equal(r.status, 400)
  assert.ok(r.body.error.includes('غير صحيحة'))
})

test('10. كلمة المرور الجديدة يتم تشفيرها بـ bcrypt', async () => {
  const r = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`).send({
    current_password: 'admin123',
    new_password: 'newpass123',
    confirm_password: 'newpass123'
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  // تحقق أن كلمة المرور مشفرة في قاعدة البيانات
  const user = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('admin_new')
  assert.ok(user.password_hash.startsWith('$2'), 'كلمة المرور غير مشفرة بـ bcrypt')
  assert.notEqual(user.password_hash, 'newpass123', 'كلمة المرور محفوظة كنص صريح')
})

test('11. كلمة المرور لا تظهر في API', async () => {
  const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)
  assert.ok(!('password_hash' in r.body.user), 'ظهر password_hash في الاستجابة')
  assert.ok(!('password' in r.body.user), 'ظهر password في الاستجابة')
})

test('12. كلمة المرور لا تظهر في audit_logs', async () => {
  const r = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  for (const log of r.body.rows) {
    if (log.action === 'password_change') {
      assert.ok(!log.old_data || !JSON.stringify(log.old_data).includes('password'), 'كلمة المرور ظهرت في old_data')
      assert.ok(!log.new_data || !JSON.stringify(log.new_data).includes('password'), 'كلمة المرور ظهرت في new_data')
    }
  }
})

test('13. تغيير الاسم يسجل في audit_logs', async () => {
  const r = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  const nameLog = r.body.rows.find((l) => l.entity_type === 'user' && l.action === 'update')
  assert.ok(nameLog, 'لم يُسجّل تغيير الاسم في audit_logs')
  assert.ok(nameLog.old_data, 'old_data فارغ')
  assert.ok(nameLog.new_data, 'new_data فارغ')
})

test('14. تغيير كلمة المرور يسجل في audit_logs دون السر', async () => {
  const r = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  const pwLog = r.body.rows.find((l) => l.action === 'password_change')
  assert.ok(pwLog, 'لم يُسجّل تغيير كلمة المرور في audit_logs')
  assert.ok(!pwLog.old_data, 'old_data يجب أن يكون فارغاً لكلمة المرور')
  assert.ok(!pwLog.new_data, 'new_data يجب أن يكون فارغاً لكلمة المرور')
})

test('15. تسجيل الدخول يعمل بعد تغيير بيانات الحساب', async () => {
  const r = await loginAs('admin_new', 'newpass123')
  assert.equal(r.status, 200)
  assert.ok(r.body.token)
  assert.equal(r.body.user.username, 'admin_new')
})

test('16. جميع اختبارات المراحل السابقة لا تتأثر (إعادة اسم المستخدم الأصلي)', async () => {
  // أعد اسم المستخدم إلى admin لضمان عدم تأثر الاختبارات الأخرى
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ username: 'admin', full_name: 'المشرف العام' })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.username, 'admin')
  assert.equal(r.body.user.full_name, 'المشرف العام')
})

// ==================== اختبارات إضافية ====================

test('كلمة المرور الجديدة لا تقل عن 4 أحرف', async () => {
  const r = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`).send({
    current_password: 'newpass123',
    new_password: 'ab',
    confirm_password: 'ab'
  })
  assert.equal(r.status, 400)
  assert.ok(r.body.error.includes('4 أحرف'))
})

test('كلمتا المرور غير متطابقتين تُرفض', async () => {
  const r = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`).send({
    current_password: 'newpass123',
    new_password: 'newpass123',
    confirm_password: 'different123'
  })
  assert.equal(r.status, 400)
  assert.ok(r.body.error.includes('غير متطابقتين'))
})

test('المعلم لا يصل إلى PUT /api/me/password', async () => {
  const r = await request(app).put('/api/me/password').set('Authorization', `Bearer ${teacherToken}`).send({
    current_password: 'teacher123',
    new_password: 'newpass123',
    confirm_password: 'newpass123'
  })
  assert.equal(r.status, 403)
})
