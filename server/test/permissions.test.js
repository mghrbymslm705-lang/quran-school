import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-test-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')
const { db } = await import('../src/db.js')

function loginAs(username, password) {
  return request(app).post('/api/auth/login').send({ username, password })
}
async function tokenFor(username, password) {
  const res = await loginAs(username, password)
  assert.equal(res.status, 200, `فشل دخول ${username}`)
  return res.body.token
}

let adminToken, t1Token, t2Token

before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  t1Token = await tokenFor('teacher1', 'teacher123')
  t2Token = await tokenFor('teacher2', 'teacher123')
})

after(() => {
  try { fs.unlinkSync(tmp) } catch {}
})

// 1) المشرف يرى جميع الطلاب
test('المشرف يرى جميع الطلاب (10)', async () => {
  const res = await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.status, 200)
  assert.equal(res.body.length, 10)
})

// 2) المعلم الأول يرى طلاب حلقته فقط (G1=4 + G2=3 = 7)
test('المعلم الأول يرى طلاب حلقاته فقط (7)', async () => {
  const res = await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`)
  assert.equal(res.status, 200)
  assert.equal(res.body.length, 7)
})

// 3) المعلم الأول لا يرى طلاب المعلم الثاني
test('المعلم الأول لا يرى طلاب المعلم الثاني', async () => {
  const t2 = await request(app).get('/api/students').set('Authorization', `Bearer ${t2Token}`)
  const t2Ids = new Set(t2.body.map((s) => s.id))
  const t1 = await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`)
  const leak = t1.body.find((s) => t2Ids.has(s.id))
  assert.equal(leak, undefined, 'تسرّب طالب من معلم آخر!')
})

// 4) المعلم لا يستطيع تغيير role الخاص به (لا توجد واجهة تعديل الدور؛ محاولة إنشاء مستخدم مرفوضة)
test('المعلم لا يستطيع الوصول لإنشاء مستخدمين', async () => {
  const res = await request(app).post('/api/teachers').set('Authorization', `Bearer ${t1Token}`).send({ full_name: 'x', username: 'x', password: 'x' })
  assert.equal(res.status, 403)
})

// 5) المعلم لا يستطيع إنشاء مشرف
test('المعلم لا يستطيع إنشاء حساب مشرف', async () => {
  const res = await request(app).post('/api/teachers').set('Authorization', `Bearer ${t1Token}`).send({ full_name: 'مشرف مزيف', username: 'fake', password: 'pass' })
  assert.equal(res.status, 403)
  // تأكد أن الحساب لم يُنشأ أصلًا
  const login = await loginAs('fake', 'pass')
  assert.equal(login.status, 401)
})

// 6) نقل طالب لا يحذف سجله السابق
test('نقل طالب يحافظ على السجل السابق (end_date يُضبط)', async () => {
  const student = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`).query({ q: 'S001' })).body[0]
  const g3 = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body.find((g) => g.code === 'G3')
  const res = await request(app).post(`/api/students/${student.id}/transfer`).set('Authorization', `Bearer ${adminToken}`).send({ group_id: g3.id, reason: 'تجربة' })
  assert.equal(res.status, 200)
  const hist = db.prepare('SELECT * FROM student_group_history WHERE student_id = ? ORDER BY start_date').all(student.id)
  assert.equal(hist.length, 2, 'يجب أن يوجد سجلان')
  assert.ok(hist[0].end_date, 'السجل القديم يجب أن له end_date')
  assert.equal(hist[1].end_date, null, 'السجل الجديد يجب أن يكون نشطًا')
  assert.equal(hist[1].group_id, g3.id)
})

// 7) أرشفة الطالب لا تحذف سجلاته اليومية
test('أرشفة الطالب تحافظ على سجلاته اليومية', async () => {
  const student = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`).query({ q: 'S001' })).body[0]
  const before = db.prepare('SELECT COUNT(*) c FROM daily_records WHERE student_id = ?').get(student.id).c
  assert.ok(before > 0, 'يجب أن توجد سجلات يومية قبل الأرشفة')
  const res = await request(app).post(`/api/students/${student.id}/archive`).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.status, 200)
  const after = db.prepare('SELECT COUNT(*) c FROM daily_records WHERE student_id = ?').get(student.id).c
  assert.equal(after, before, 'السجلات اليومية يجب ألا تُحذف')
  const st = db.prepare('SELECT status FROM students WHERE id = ?').get(student.id)
  assert.equal(st.status, 'archived')
})

// 8) عدم تسجيل طالب في يوم معين لا يحوّله إلى غائب
test('عدم وجود سجل = not_recorded وليس absent', async () => {
  // طالب G2 ليس له سجل يومي في البذور
  const student = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`).query({ q: 'S005' })).body[0]
  const existing = db.prepare('SELECT * FROM daily_records WHERE student_id = ?').all(student.id)
  assert.equal(existing.length, 0, 'S005 ليس له سجل يومي')
  // إنشاء سجل جديد بدون تحديد حضور -> يجب أن يكون not_recorded
  const res = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: student.id })
  assert.equal(res.status, 201)
  const att = db.prepare('SELECT status FROM attendances WHERE daily_record_id = ?').get(res.body.id)
  assert.equal(att.status, 'not_recorded')
})

// 9) لا يمكن إنشاء سجل يومي مكرر لنفس الطالب ونفس التاريخ
test('منع تكرار السجل اليومي لنفس الطالب والتاريخ', async () => {
  const student = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`).query({ q: 'S006' })).body[0]
  const first = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: student.id })
  assert.equal(first.status, 201)
  const second = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: student.id })
  assert.equal(second.status, 409, 'يجب رفض التكرار')
})

// 10) المشرف يستطيع رؤية السجل التاريخي للطالب
test('المشرف يرى السجل اليومي التاريخي والمعلم الآخر لا يرى طالبًا ليس له', async () => {
  const student = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`).query({ q: 'S002' })).body[0]
  // المشرف يرى سجل الطالب
  const res = await request(app).get('/api/daily').set('Authorization', `Bearer ${adminToken}`).query({ group_id: student.current_group_id })
  assert.equal(res.status, 200)
  assert.ok(res.body.some((r) => r.student_id === student.id), 'يجب أن يظهر سجل الطالب للمشرف')
  // المعلم الآخر (مجموعته مختلفة) لا يرى سجل هذا الطالب
  const t2res = await request(app).get('/api/daily').set('Authorization', `Bearer ${t2Token}`)
  assert.equal(t2res.body.some((r) => r.student_id === student.id), false, 'المعلم الآخر لا يجب أن يرى سجل طالب ليس من طلابه')
})

// أمان إضافي: حساب معطّل لا يدخل
test('حساب معلم معطّل يُرفض عند الدخول', async () => {
  const res = await loginAs('teacher3', 'teacher123')
  assert.equal(res.status, 403)
})
