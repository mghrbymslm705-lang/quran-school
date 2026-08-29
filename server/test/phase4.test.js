import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-phase4-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')

function loginAs(username, password) {
  return request(app).post('/api/auth/login').send({ username, password })
}
async function tokenFor(username, password) {
  const res = await loginAs(username, password)
  assert.equal(res.status, 200, `فشل دخول ${username}`)
  return res.body.token
}
const today = () => new Date().toISOString().slice(0, 10)
const q = (obj) => new URLSearchParams(obj).toString()

let adminToken, t1Token, t2Token, t1Id, t2Id
before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  t1Token = await tokenFor('teacher1', 'teacher123')
  t1Id = (await request(app).get('/api/teachers').set('Authorization', `Bearer ${t1Token}`)).body.find((t) => t.user_id)
  t2Token = await tokenFor('teacher2', 'teacher123')
})

function groupIdByCode(code, token) {
  return request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).then((r) => r.body.find((g) => g.code === code).id)
}
function studentIdByCode(code, token) {
  return request(app)
    .get('/api/students?q=' + code)
    .set('Authorization', `Bearer ${token}`)
    .then((r) => r.body[0].id)
}

// 1) المشرف يرى جميع الحلقات
test('المشرف يرى جميع الحلقات (3)', async () => {
  const res = await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.status, 200)
  assert.equal(res.body.length, 3)
})

// 2) المشرف يرى جميع الطلاب
test('المشرف يرى جميع الطلاب (10)', async () => {
  const res = await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.body.length, 10)
})

// 3) المعلم لا يرى حلقات المعلمين الآخرين
test('المعلم الأول لا يرى حلقة المعلم الثاني', async () => {
  const g3 = await groupIdByCode('G3', adminToken)
  const t1 = await request(app).get('/api/groups').set('Authorization', `Bearer ${t1Token}`)
  const ids = new Set(t1.body.map((g) => g.id))
  assert.equal(ids.has(g3), false, 'المعلم الأول يرى حلقة G3!')
})

// 4) الإحصائيات اليومية صحيحة (مبنية على بيانات البذور)
test('الإحصائيات اليومية صحيحة', async () => {
  const res = await request(app).get('/api/daily/summary?' + q({ date: today() })).set('Authorization', `Bearer ${adminToken}`)
  const s = res.body
  assert.equal(s.total_students, 10)
  assert.equal(s.on_time, 3)
  assert.equal(s.late, 1)
  assert.equal(s.heard, 2)
})

// 5) not_recorded لا يُحسب غيابًا
test('not_recorded لا يُحسب كغياب', async () => {
  const s = (await request(app).get('/api/daily/summary?' + q({ date: today() })).set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(s.not_recorded_att, 0, 'يجب ألا يُحسب غير المسجّل كغياب')
  assert.equal(s.late, 1, 'المتأخرون = 1 فقط')
})

// 6) not_recorded لا يُحسب كـ not_heard
test('not_recorded لا يُحسب كـ not_heard', async () => {
  const s = (await request(app).get('/api/daily/summary?' + q({ date: today() })).set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(s.not_heard, 0)
  assert.equal(s.not_recorded_mem, 2, 'طلابان ليس لهم سجل لوح = not_recorded')
})

// 7) not_recorded لا يُحسب كـ not_reviewed
test('not_recorded لا يُحسب كـ not_reviewed', async () => {
  const s = (await request(app).get('/api/daily/summary?' + q({ date: today() })).set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(s.not_reviewed, 2)
  assert.equal(s.not_recorded_rev, 0)
})

// 8) فلتر "لم يسمع" يعمل
test('فلتر اللوح (heard / not_heard) يعمل', async () => {
  const heard = await request(app).get('/api/daily?' + q({ date: today(), mem: 'heard' })).set('Authorization', `Bearer ${adminToken}`)
  const notHeard = await request(app).get('/api/daily?' + q({ date: today(), mem: 'not_heard' })).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(heard.body.length, 2, 'سمع = 2 حسب البذور')
  assert.equal(notHeard.body.length, 0, 'لا يوجد not_heard في البذور')
})

// 9) فلتر "لم يراجع" يعمل
test('فلتر الورد (reviewed / not_reviewed) يعمل', async () => {
  const rev = await request(app).get('/api/daily?' + q({ date: today(), rev: 'reviewed' })).set('Authorization', `Bearer ${adminToken}`)
  const notRev = await request(app).get('/api/daily?' + q({ date: today(), rev: 'not_reviewed' })).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(rev.body.length, 2)
  assert.equal(notRev.body.length, 2)
})

// 9ب) فلاتر not_recorded / not_on_time تعمل
test('فلاتر not_recorded و not_on_time تعمل', async () => {
  const d = '2026-03-03'
  const s7 = await studentIdByCode('S006', adminToken)
  const s8 = await studentIdByCode('S007', adminToken)
  await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: s7, record_date: d, attendance: { status: 'on_time' }, memorization: { status: 'heard' } })
  await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: s8, record_date: d, memorization: { status: 'heard' } }) // بلا حضور (status افتراضي not_recorded)
  const onTime = await request(app).get('/api/daily?' + q({ date: d, att: 'on_time' })).set('Authorization', `Bearer ${adminToken}`)
  assert.ok(onTime.body.find((r) => r.student_id === s7), 'S007 يجب أن يظهر في on_time')
  const notOnTime = await request(app).get('/api/daily?' + q({ date: d, att: 'not_on_time' })).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(notOnTime.body.find((r) => r.student_id === s7), undefined, 'S007 لا يجب أن يظهر في not_on_time')
  const notRec = await request(app).get('/api/daily?' + q({ date: d, att: 'not_recorded' })).set('Authorization', `Bearer ${adminToken}`)
  assert.ok(notRec.body.find((r) => r.student_id === s8), 'S008 (حضوره not_recorded) يجب أن يظهر في not_recorded')
  assert.equal(notRec.body.find((r) => r.student_id === s7), undefined, 'S007 لا يجب أن يظهر في not_recorded')
})

// 10) فتح الحلقة يعرض طلابها فقط
test('ملخّص الحلقة يعرض طلابها فقط (G1 = 4)', async () => {
  const g1 = await groupIdByCode('G1', adminToken)
  const res = await request(app).get('/api/daily/summary?' + q({ date: today(), group_id: g1 })).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.body.circles.length, 1)
  assert.equal(res.body.circles[0].total_students, 4)
  assert.equal(res.body.circles[0].registered, 4)
})

// 11) فتح ملف الطالب يعرض السجل التاريخي الصحيح
test('سجل الطالب التاريخي صحيح', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const res = await request(app).get('/api/daily?' + q({ student_id: sid, date: today() })).set('Authorization', `Bearer ${adminToken}`)
  assert.ok(res.body.length >= 1)
  const rec = res.body.find((r) => r.student_id === sid)
  assert.equal(rec.attendance_status, 'on_time')
})

// 12) المشرف يستطيع تعديل تسجيل الطالب
test('المشرف يعدّل تسجيل الطالب (heard → not_heard)', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const rec = (await request(app).get('/api/daily?' + q({ student_id: sid, date: today() })).set('Authorization', `Bearer ${adminToken}`)).body[0]
  const patch = await request(app).patch('/api/daily/' + rec.id).set('Authorization', `Bearer ${adminToken}`).send({ memorization: { status: 'not_heard' } })
  assert.equal(patch.status, 200)
  const after = (await request(app).get('/api/daily?' + q({ student_id: sid, date: today() })).set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.equal(after.memorization_status, 'not_heard')
})

// 13) التعديل يحدث على السجل الموجود (لا إنشاء جديد)
test('التعديل يُحدّث السجل الموجود دون تكرار', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const all = (await request(app).get('/api/daily?' + q({ student_id: sid, date: today() })).set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(all.length, 1, 'يجب ألا يُنشأ سجل مكرر')
})

// 14) لا ينشأ سجل يومي مكرر
test('منع تكرار السجل اليومي', async () => {
  const sid = await studentIdByCode('S006', adminToken)
  const first = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: sid })
  assert.equal(first.status, 201)
  const second = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`).send({ student_id: sid })
  assert.equal(second.status, 409)
})

// 15) تعديل المشرف يُسجَّل في audit_logs
test('تعديل المشرف يُسجَّل في سجل التدقيق', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const rec = (await request(app).get('/api/daily?' + q({ student_id: sid, date: today() })).set('Authorization', `Bearer ${adminToken}`)).body[0]
  await request(app).patch('/api/daily/' + rec.id).set('Authorization', `Bearer ${adminToken}`).send({ memorization: { status: 'heard' } })
  const audit = (await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)).body.rows
  const entry = audit.find(
    (a) => a.entity_type === 'memorization_record' && a.new_data && a.new_data.status === 'heard' && a.old_data && a.old_data.status === 'not_heard'
  )
  assert.ok(entry, 'لا يوجد سجل تدقيق للتعديل')
  assert.equal(entry.new_data.by_role, 'supervisor')
  assert.ok(entry.user_name, 'يجب ذكر المستخدم')
})

// 16) المعلم لا يستطيع تعديل سجل خارج نطاقه
test('المعلم لا يستطيع تعديل سجل خارج حلقاته', async () => {
  const sid = await studentIdByCode('S001', adminToken) // طالب G1 (ليس من حلقات المعلم الثاني)
  const rec = (await request(app).get('/api/daily?' + q({ student_id: sid, date: today() })).set('Authorization', `Bearer ${adminToken}`)).body[0]
  const res = await request(app).patch('/api/daily/' + rec.id).set('Authorization', `Bearer ${t2Token}`).send({ memorization: { status: 'heard' } })
  assert.equal(res.status, 403)
})

// 17) المعلم لا يستطيع الحصول على بيانات الهاتف/العنوان/جهة الاتصال
test('المعلم لا يرى الهاتف/العنوان/جهة الاتصال', async () => {
  const res = await request(app).get('/api/students').set('Authorization', `Bearer ${t2Token}`)
  for (const s of res.body) {
    assert.equal('phone' in s, false)
    assert.equal('address' in s, false)
    assert.equal('family_contact' in s, false)
  }
})

// 18) اختيار تاريخ آخر يعرض بياناته الصحيحة
test('اختيار تاريخ آخر يعرض بياناته', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const past = '2026-01-01'
  await request(app).post('/api/daily').set('Authorization', `Bearer ${adminToken}`).send({ student_id: sid, record_date: past, attendance: { status: 'on_time' } })
  const pastSum = (await request(app).get('/api/daily/summary?' + q({ date: past })).set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(pastSum.registered >= 1)
  assert.ok(pastSum.on_time >= 1)
  const todaySum = (await request(app).get('/api/daily/summary?' + q({ date: today() })).set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(todaySum.on_time, 3, 'بيانات اليوم لا تتأثر بتاريخ آخر')
})

// 19) الحلقات غير النشطة لا تظهر في قائمة الحلقات النشطة
test('الحلقات غير النشطة لا تظهر في الملخّص النشط', async () => {
  const create = await request(app).post('/api/groups').set('Authorization', `Bearer ${adminToken}`).send({ name: 'حلقة مغلقة', status: 'inactive' })
  assert.equal(create.status, 201)
  const inactiveId = create.body.id
  const groups = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(groups.find((g) => g.id === inactiveId), 'موجودة في قائمة الحلقات')
  const sum = (await request(app).get('/api/daily/summary?' + q({ date: today() })).set('Authorization', `Bearer ${adminToken}`)).body
  const inSummary = (sum.circles || []).some((c) => c.id === inactiveId)
  assert.equal(inSummary, false, 'يجب ألا تظهر الحلقة غير النشطة في الملخّص النشط')
})
