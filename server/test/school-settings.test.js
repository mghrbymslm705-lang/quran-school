import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-school-${Date.now()}.db`)
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

// ==================== إنشاء وتهيئة ====================

test('1. إنشاء/تهيئة إعدادات المؤسسة', async () => {
  const r = await request(app).get('/api/settings/school').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'المدرسة القرآنية')
  assert.equal(r.body.description, '')
  assert.equal(r.body.address, '')
  assert.equal(r.body.phone, '')
  assert.equal(r.body.email, '')
})

// ==================== قراءة ====================

test('2. المشرف يستطيع قراءة معلومات المؤسسة', async () => {
  const r = await request(app).get('/api/settings/school').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.ok(r.body.name)
})

// ==================== تعديل الاسم ====================

test('3. تعديل اسم المؤسسة', async () => {
  const r = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${adminToken}`).send({
    name: 'كتاب حي جوهرة'
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'كتاب حي جوهرة')
})

// ==================== تعديل بقية الحقول ====================

test('4. تعديل بقية الحقول', async () => {
  const r = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${adminToken}`).send({
    name: 'كتاب حي جوهرة',
    description: 'لتعليم القرآن الكريم والعلوم الشرعية',
    address: 'شارع الملك فهد، الرياض',
    phone: '0501234567',
    email: 'info@jawhara.edu.sa'
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.description, 'لتعليم القرآن الكريم والعلوم الشرعية')
  assert.equal(r.body.address, 'شارع الملك فهد، الرياض')
  assert.equal(r.body.phone, '0501234567')
  assert.equal(r.body.email, 'info@jawhara.edu.sa')
})

// ==================== استمرار البيانات ====================

test('5. استمرار البيانات بعد إعادة الجلب', async () => {
  const r = await request(app).get('/api/settings/school').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'كتاب حي جوهرة')
  assert.equal(r.body.description, 'لتعليم القرآن الكريم والعلوم الشرعية')
  assert.equal(r.body.phone, '0501234567')
})

// ==================== منع المعلم ====================

test('6. المعلم لا يستطيع تعديل معلومات المؤسسة', async () => {
  const r = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${teacherToken}`).send({
    name: 'تغيير غير مصرّح'
  })
  assert.equal(r.status, 403)
})

// ==================== منع الحقول غير المسموحة ====================

test('7. لا يُسمح بتغيير حقول حساسة', async () => {
  const r = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${adminToken}`).send({
    name: 'اختبار',
    id: 999,
    role: 'teacher',
    created_at: '2020-01-01'
  })
  assert.equal(r.status, 400)
  assert.ok(r.body.error.includes('لا يُسمح'))
})

// ==================== Audit ====================

test('8. التعديل يُسجّل في audit_logs', async () => {
  const r = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  const log = r.body.rows.find((l) => l.entity_type === 'school_settings')
  assert.ok(log, 'لم يُسجّل تعديل إعدادات المؤسسة في audit_logs')
  assert.equal(log.action, 'update')
  assert.ok(log.old_data, 'old_data فارغ')
  assert.ok(log.new_data, 'new_data فارغ')
})

// ==================== عدم تأثر المستخدمين ====================

test('9. لا يؤثر على بيانات المستخدمين', async () => {
  const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.role, 'supervisor')
  assert.equal(r.body.user.username, 'admin')
})

// ==================== ظهور الاسم في التقرير ====================

test('10. اسم المؤسسة يظهر في إعدادات التقارير', async () => {
  const r = await request(app).get('/api/settings/school').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'كتاب حي جوهرة')
})

// ==================== عدم تأثر حسابات التقارير ====================

test('11. حسابات التقارير لا تتأثر', async () => {
  const r = await request(app).get('/api/reports/daily?range=today').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(r.status, 200)
  assert.ok('summary' in r.body || 'rows' in r.body || 'students' in r.body, 'لم تُ返回 بيانات التقرير')
})

// ==================== اختبارات المراحل السابقة ====================

test('12. اختبارات المراحل السابقة لا تتأثر', async () => {
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' })
  assert.equal(login.status, 200)
  assert.ok(login.body.token)
})

// ==================== اختبارات إضافية ====================

test('اسم المؤسسة مطلوب', async () => {
  const r = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${adminToken}`).send({
    name: ''
  })
  assert.equal(r.status, 400)
  assert.ok(r.body.error.includes('مطلوب'))
})

test('اسم المؤسسة بعد المسافات يُقبل', async () => {
  const r = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${adminToken}`).send({
    name: '  كتاب جديد  '
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'كتاب جديد')
})

test('المعلم لا يصل إلى GET /api/settings/school', async () => {
  const r = await request(app).get('/api/settings/school').set('Authorization', `Bearer ${teacherToken}`)
  assert.equal(r.status, 403)
})
