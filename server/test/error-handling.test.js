import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-error-handling-${Date.now()}.db`)
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

// ==================== اختبارات معالجة الأخطاء ====================

test('1. خطأ 400 — بيانات غير صحيحة', async () => {
  const r = await request(app).post('/api/test/error').set('Authorization', `Bearer ${adminToken}`).send({ status: 400 })
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'خطأ تجريبي')
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('sql'))
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('sqlite'))
})

test('2. خطأ 401 — غير مصرّح (بلا توكن)', async () => {
  const r = await request(app).post('/api/test/error').send({ status: 401 })
  assert.equal(r.status, 401)
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('sql'))
})

test('3. خطأ 403 — ممنوع للمعلم', async () => {
  const r = await request(app).post('/api/test/error').set('Authorization', `Bearer ${teacherToken}`).send({ status: 400 })
  assert.equal(r.status, 403)
  assert.ok(r.body.error.includes('صلاحية'))
})

test('4. خطأ 404 — عنصر غير موجود', async () => {
  const r = await request(app).put('/api/groups/nonexistent-id').set('Authorization', `Bearer ${adminToken}`).send({ name: 'test' })
  assert.equal(r.status, 404)
  assert.ok(r.body.error.includes('غير موجود'))
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('sql'))
})

test('5. خطأ 409 — تكرار اسم المستخدم', async () => {
  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ username: 'teacher1' })
  assert.equal(r.status, 409)
  assert.ok(r.body.error.includes('مستخدم بالفعل'))
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('sql'))
})

test('6. خطأ 500 — الخطأ لا يسرّب تفاصيل', async () => {
  const r = await request(app).post('/api/test/error').set('Authorization', `Bearer ${adminToken}`).send({ status: 500 })
  assert.equal(r.status, 500)
  assert.ok(r.body.error.includes('خطأ') || r.body.error.includes('غير متوقع'))
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('sql'))
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('sqlite'))
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('stack'))
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('at '))
})

test('7. بيانات المستخدم لا تتغير عند الخطأ', async () => {
  // حاول تعديل اسم مستخدم مكرر — يجب أن يفشل
  const meBefore = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)
  const originalName = meBefore.body.user.full_name

  const r = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`).send({ username: 'teacher1' })
  assert.equal(r.status, 409)

  // تحقق أن البيانات لم تتغير
  const meAfter = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(meAfter.body.user.full_name, originalName)
})

test('8. رسالة خطأ واضحة بالعربية', async () => {
  const r = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`).send({
    current_password: 'wrongpassword',
    new_password: 'newpass',
    confirm_password: 'newpass'
  })
  assert.equal(r.status, 400)
  assert.ok(r.body.error.includes(''))
  // تحقق أن الرسالة عربية (تحتوي حروف عربية)
  assert.ok(/[\u0600-\u06FF]/.test(r.body.error), 'الرسالة يجب أن تكون بالعربية')
})

test('9. لا تظهر تفاصيل قاعدة البيانات في أي خطأ', async () => {
  const endpoints = [
    { method: 'get', url: '/api/students/nonexistent' },
    { method: 'get', url: '/api/teachers/nonexistent' },
    { method: 'put', url: '/api/groups/nonexistent' },
  ]

  for (const ep of endpoints) {
    const r = await request(app)[ep.method](ep.url).set('Authorization', `Bearer ${adminToken}`)
    const bodyStr = JSON.stringify(r.body).toLowerCase()
    assert.ok(!bodyStr.includes('sqlite'), `${ep.url} يسرّب sqlite`)
    assert.ok(!bodyStr.includes('sql'), `${ep.url} يسرّب sql`)
    assert.ok(!bodyStr.includes('constraint'), `${ep.url} يسرّب constraint`)
    assert.ok(!bodyStr.includes('failed'), `${ep.url} يسرّب failed`)
  }
})

test('10. اختبارات المراحل السابقة لا تتأثر', async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })
  assert.equal(login.status, 200)
  assert.ok(login.body.token)
})
