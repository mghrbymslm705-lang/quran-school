import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-phase3-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')
const { todayStr } = await import('../src/lib.js')

function loginAs(username, password) {
  return request(app).post('/api/auth/login').send({ username, password })
}
async function tokenFor(username, password) {
  const res = await loginAs(username, password)
  assert.equal(res.status, 200, `فشل دخول ${username}`)
  return res.body.token
}

let adminToken, t1Token
before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  t1Token = await tokenFor('teacher1', 'teacher123')
})

// 1) المعلم لا يرى الحقول الخاصة للطالب (خصوصية على مستوى الخادم)
test('المعلم لا يرى الحقول الخاصة (phone/address/family_contact/notes)', async () => {
  const res = await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`)
  assert.equal(res.status, 200)
  assert.ok(res.body.length > 0)
  const forbidden = ['phone', 'address', 'family_contact', 'notes', 'current_memorization', 'current_memorization_status', 'behavior']
  // الحقول المسموحة للمعلم يجب ألا تتضمن المحظورة
  for (const s of res.body) {
    assert.equal('phone' in s, false, 'تسرّب رقم الهاتف للمعلم!')
    assert.equal('address' in s, false, 'تسرّب العنوان للمعلم!')
    assert.equal('family_contact' in s, false, 'تسرّب بيانات ولي الأمر للمعلم!')
    assert.equal('notes' in s, false, 'تسرّب ملاحظات الإدارة للمعلم!')
    // الحقول المسموحة يجب أن تكون حاضرة
    assert.equal('id' in s, true)
    assert.equal('full_name' in s, true)
  }
})

// 2) المشرف يرى جميع الحقول الخاصة
test('المشرف يرى الحقول الخاصة كاملة', async () => {
  const res = await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.status, 200)
  const s = res.body[0]
  assert.equal('phone' in s, true, 'المشرف يجب أن يرى الهاتف')
  assert.equal('address' in s, true)
  assert.equal('family_contact' in s, true)
  assert.equal('notes' in s, true)
})

// 3) الحالة الصحية تعرض للمعلم فقط إن سمحت الإدارة (S002 مسموح، S001 ممنوع)
test('الحالة الصحية تُعرض للمعلم حسب الصلاحية', async () => {
  const s002 = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`).query({ q: 'S002' })).body[0]
  const s001 = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`).query({ q: 'S001' })).body[0]
  const t002 = (await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`).query({ q: 'S002' })).body[0]
  const t001 = (await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`).query({ q: 'S001' })).body[0]
  assert.equal(t002.health_status, s002.health_status, 'S002 مسموح عرضه للمعلم')
  assert.equal('health_status' in t001, false, 'S001 ممنوع عرضه للمعلم')
})

// 4) تسجيل اليوم الثلاثي المحاور مع ملاحظات لكل محور
test('تسجيل اليوم الثلاثي مع ملاحظات', async () => {
  const students = (await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`).query({ q: 'S006' })).body
  const student = students[0]
  const res = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({
    student_id: student.id,
    attendance: { status: 'on_time', note: 'وصل مبكرًا' },
    memorization: { status: 'heard', amount: 'صفحتان', note: 'أتقن الآيات' },
    revision: { status: 'reviewed', note: 'مراجعة جيدة' }
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const dr = (await request(app).get('/api/daily').set('Authorization', `Bearer ${t1Token}`).query({ student_id: student.id })).body
  assert.equal(dr.length, 1)
  const r = dr[0]
  assert.equal(r.attendance_status, 'on_time')
  assert.equal(r.attendance_note, 'وصل مبكرًا')
  assert.equal(r.memorization_status, 'heard')
  assert.equal(r.memorization_amount, 'صفحتان')
  assert.equal(r.memorization_note, 'أتقن الآيات')
  assert.equal(r.revision_status, 'reviewed')
  assert.equal(r.revision_note, 'مراجعة جيدة')
})

// 5) الافتراضي لكل محور = not_recorded ولا يتحول لسلبي تلقائيًا
test('تسجيل يوم بدون محاور = not_recorded', async () => {
  const student = (await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`).query({ q: 'S005' })).body[0]
  const res = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: student.id })
  assert.equal(res.status, 201)
  const att = (await request(app).get('/api/daily').set('Authorization', `Bearer ${t1Token}`).query({ student_id: student.id })).body[0]
  assert.equal(att.attendance_status, 'not_recorded')
  assert.ok(att.memorization_status == null, 'لم يُنشأ سجل تحفيظ') // لم تُنشأ لأن لم تُرسل
  assert.ok(att.revision_status == null, 'لم يُنشأ سجل مراجعة')
})

// 6) ملخّص يومي مجمّع للمشرف
test('ملخّص يومي مجمّع', async () => {
  const res = await request(app).get('/api/daily/summary').set('Authorization', `Bearer ${adminToken}`).query({ date: todayStr() })
  assert.equal(res.status, 200)
  assert.equal(res.body.total_students, 10)
  for (const k of ['on_time', 'late', 'excused', 'not_recorded_att', 'heard', 'not_heard', 'not_recorded_mem', 'reviewed', 'not_reviewed', 'not_recorded_rev']) {
    assert.ok(k in res.body, `مفتاح الملخّص المفقود: ${k}`)
  }
})

// 7) ملخّص يومي مُصفّى لمعلم (نطاقه فقط)
test('ملخّص يومي مُصفّى لنطاق المعلم', async () => {
  const res = await request(app).get('/api/daily/summary').set('Authorization', `Bearer ${t1Token}`).query({ date: todayStr() })
  assert.equal(res.status, 200)
  assert.equal(res.body.total_students, 7, 'نطاق المعلم الأول = 7 طلاب')
})
