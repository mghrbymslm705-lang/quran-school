import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-phase7-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')

function loginAs(username, password) {
  return request(app).post('/api/auth/login').send({ username, password })
}
async function tokenFor(username, password) {
  const res = await loginAs(username, password)
  assert.equal(res.status, 200, `فشل دخول ${username}: ${JSON.stringify(res.body)}`)
  return res.body.token
}
const post = (p, b, t) => request(app).post(p).set('Authorization', `Bearer ${t}`).send(b)
const get = (p, t, q) => request(app).get(p + (q ? '?' + q : '')).set('Authorization', `Bearer ${t}`)

const D = '1999-01-01' // تاريخ للقراءة فقط (لا كتابة عليه)
let __c = 0
const ud = () => '2002-01-' + String(++__c).padStart(2, '0') // تاريخ فريد لكل اختبار كتابة

let adminToken, t1Token, t2Token

before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  t1Token = await tokenFor('teacher1', 'teacher123')
  t2Token = await tokenFor('teacher2', 'teacher123')
})

async function studentIdByCode(code, token) {
  const r = await get('/api/students?status=all', token)
  return r.body.find((s) => s.student_code === code)?.id
}
function groupIdByCode(code, token) {
  return get('/api/groups', token).then((r) => r.body.find((g) => g.code === code).id)
}
async function bulk(token, records) {
  return post('/api/daily/bulk', { records }, token)
}

// 1) المعلم يرى حلقته فقط
test('المعلم يرى حلقته فقط', async () => {
  const g1 = await groupIdByCode('G1', adminToken)
  const g2 = await groupIdByCode('G2', adminToken)
  const g3 = await groupIdByCode('G3', adminToken)
  const r = await get('/api/groups', t1Token)
  const ids = r.body.map((g) => g.id)
  assert.ok(ids.includes(g1) && ids.includes(g2))
  assert.ok(!ids.includes(g3))
})

// 2) المعلم يرى طلاب حلقته فقط
test('المعلم يرى طلاب حلقته فقط', async () => {
  const s1 = await studentIdByCode('S001', adminToken)
  const s8 = await studentIdByCode('S008', adminToken)
  const r = await get('/api/students', t1Token)
  const ids = r.body.map((s) => s.id)
  assert.ok(ids.includes(s1))
  assert.ok(!ids.includes(s8))
})

// 3) فتح التسجيل اليومي يعرض الطلاب النشطين
test('فتح التسجيل اليومي يعرض الطلاب النشطين', async () => {
  const g1 = await groupIdByCode('G1', adminToken)
  const r = await get('/api/students?status=active&circle_id=' + g1, t1Token)
  assert.ok(r.body.length >= 1)
})

// 4) المؤرشف لا يظهر
test('المؤرشف لا يظهر', async () => {
  const code = 'SZX' + Date.now()
  const cr = await post('/api/students', { full_name: 'مؤرشف', student_code: code, group_id: await groupIdByCode('G1', adminToken) }, adminToken)
  const sid = cr.body.id
  await post(`/api/students/${sid}/archive`, {}, adminToken)
  const r = await get('/api/students?status=active', t1Token)
  assert.ok(!r.body.some((s) => s.id === sid))
})

// 5) الحالة الافتراضية not_recorded
test('الحالة الافتراضية not_recorded', async () => {
  const s1 = await studentIdByCode('S001', adminToken)
  const r = await get('/api/daily', t1Token, 'student_id=' + s1 + '&date=' + D)
  assert.equal(r.body.length, 0)
})

// 6) تسجيل الحضور يعمل
test('تسجيل الحضور يعمل', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  await bulk(t1Token, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s1 + '&date=' + d)
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].attendance_status, 'on_time')
})

// 7) تسجيل اللوح يعمل
test('تسجيل اللوح يعمل', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  await bulk(t1Token, [{ student_id: s1, record_date: d, memorization: { status: 'heard' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s1 + '&date=' + d)
  assert.equal(r.body[0].memorization_status, 'heard')
})

// 8) تسجيل الورد يعمل
test('تسجيل الورد يعمل', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  await bulk(t1Token, [{ student_id: s1, record_date: d, revision: { status: 'reviewed' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s1 + '&date=' + d)
  assert.equal(r.body[0].revision_status, 'reviewed')
})

// 9) المحاور مستقلة عن بعضها
test('المحاور مستقلة عن بعضها', async () => {
  const d = ud()
  const s5 = await studentIdByCode('S005', adminToken)
  await bulk(t1Token, [{ student_id: s5, record_date: d, attendance: { status: 'on_time' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s5 + '&date=' + d)
  assert.equal(r.body[0].attendance_status, 'on_time')
  assert.equal(r.body[0].memorization_status, 'not_recorded')
  assert.equal(r.body[0].revision_status, 'not_recorded')
})

// 10) إضافة ملاحظة تعمل
test('إضافة ملاحظة تعمل', async () => {
  const d = ud()
  const s5 = await studentIdByCode('S005', adminToken)
  await bulk(t1Token, [{ student_id: s5, record_date: d, note: 'يحتاج تصحيح' }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s5 + '&date=' + d)
  assert.equal(r.body[0].note, 'يحتاج تصحيح')
})

// 11) كمية المحفوظ تعمل
test('كمية المحفوظ تعمل', async () => {
  const d = ud()
  const s5 = await studentIdByCode('S005', adminToken)
  await bulk(t1Token, [{ student_id: s5, record_date: d, memorization: { status: 'heard', amount: 'نصف صفحة' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s5 + '&date=' + d)
  assert.equal(r.body[0].memorization_amount, 'نصف صفحة')
})

// 12) الإتقان يعمل
test('الإتقان يعمل', async () => {
  const d = ud()
  const s5 = await studentIdByCode('S005', adminToken)
  await bulk(t1Token, [{ student_id: s5, record_date: d, memorization: { status: 'heard', mastery_status: 'mastered' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s5 + '&date=' + d)
  assert.equal(r.body[0].mastery_status, 'mastered')
})

// 13) الحفظ الجماعي يعمل
test('الحفظ الجماعي يعمل', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  const s2 = await studentIdByCode('S002', adminToken)
  const res = await bulk(t1Token, [
    { student_id: s1, record_date: d, attendance: { status: 'on_time' } },
    { student_id: s2, record_date: d, memorization: { status: 'heard' } }
  ])
  assert.equal(res.body.created, 2)
  const r1 = await get('/api/daily', t1Token, 'student_id=' + s1 + '&date=' + d)
  const r2 = await get('/api/daily', t1Token, 'student_id=' + s2 + '&date=' + d)
  assert.equal(r1.body[0].attendance_status, 'on_time')
  assert.equal(r2.body[0].memorization_status, 'heard')
})

// 14) لا يحدث تكرار للسجل اليومي
test('لا يحدث تكرار للسجل اليومي', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  await bulk(t1Token, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  const res = await bulk(t1Token, [{ student_id: s1, record_date: d, attendance: { status: 'late' } }])
  assert.equal(res.body.results.find((x) => x.student_id === s1).status, 'updated')
  const r = await get('/api/daily', t1Token, 'student_id=' + s1 + '&date=' + d)
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].attendance_status, 'late')
})

// 15) تحديث السجل الموجود يعمل
test('تحديث السجل الموجود يعمل', async () => {
  const d = ud()
  const s2 = await studentIdByCode('S002', adminToken)
  await bulk(t1Token, [{ student_id: s2, record_date: d, memorization: { status: 'heard' } }])
  await bulk(t1Token, [{ student_id: s2, record_date: d, memorization: { status: 'not_heard' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s2 + '&date=' + d)
  assert.equal(r.body[0].memorization_status, 'not_heard')
})

// 16) not_recorded لا يتحول إلى غياب
test('not_recorded لا يتحول إلى غياب', async () => {
  const d = ud()
  const s3 = await studentIdByCode('S003', adminToken)
  const s4 = await studentIdByCode('S004', adminToken)
  await bulk(t1Token, [{ student_id: s3, record_date: d, attendance: { status: 'on_time' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s4 + '&date=' + d)
  assert.equal(r.body.length, 0)
})

// 17) not_recorded لا يتحول إلى not_heard
test('not_recorded لا يتحول إلى not_heard', async () => {
  const d = ud()
  const s3 = await studentIdByCode('S003', adminToken)
  await bulk(t1Token, [{ student_id: s3, record_date: d, attendance: { status: 'on_time' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s3 + '&date=' + d)
  assert.equal(r.body[0].memorization_status, 'not_recorded')
})

// 18) not_recorded لا يتحول إلى not_reviewed
test('not_recorded لا يتحول إلى not_reviewed', async () => {
  const d = ud()
  const s3 = await studentIdByCode('S003', adminToken)
  await bulk(t1Token, [{ student_id: s3, record_date: d, attendance: { status: 'on_time' } }])
  const r = await get('/api/daily', t1Token, 'student_id=' + s3 + '&date=' + d)
  assert.equal(r.body[0].revision_status, 'not_recorded')
})

// 19) المعلم لا يستطيع تسجيل طالب خارج نطاقه
test('المعلم لا يستطيع تسجيل طالب خارج نطاقه', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  const s8 = await studentIdByCode('S008', adminToken)
  const res = await bulk(t1Token, [
    { student_id: s1, record_date: d, attendance: { status: 'on_time' } },
    { student_id: s8, record_date: d, attendance: { status: 'on_time' } }
  ])
  const outOfScope = res.body.results.find((x) => x.student_id === s8)
  assert.equal(outOfScope.status, 'error')
  assert.ok(res.body.created >= 1)
  const r = await get('/api/daily', adminToken, 'student_id=' + s8 + '&date=' + d)
  assert.equal(r.body.length, 0)
})

// 20) المعلم لا يستطيع تسجيل حلقة غير مسندة إليه
test('المعلم لا يستطيع تسجيل حلقة غير مسندة إليه', async () => {
  const g3 = await groupIdByCode('G3', adminToken)
  const r1 = await get('/api/daily', t1Token, 'group_id=' + g3)
  assert.equal(r1.body.length, 0)
  const s8 = await studentIdByCode('S008', adminToken)
  const r2 = await post('/api/daily', { student_id: s8, record_date: D, attendance: { status: 'on_time' } }, t1Token)
  assert.equal(r2.status, 403)
})

// 21) المعلم لا يستطيع تعديل صلاحياته
test('المعلم لا يستطيع الوصول إلى سجل التدقيق', async () => {
  assert.equal((await get('/api/audit', t1Token)).status, 403)
})

// 22) البيانات الخاصة تبقى مخفية
test('البيانات الخاصة تبقى مخفية', async () => {
  const r = await get('/api/students', t1Token)
  const keys = Object.keys(r.body[0])
  for (const k of ['phone', 'address', 'familyContact', 'adminNotes', 'guardianPhone']) {
    assert.ok(!keys.includes(k), `يجب ألا يظهر الحقل ${k}`)
  }
})

// 23) المشرف يرى التسجيل بعد حفظ المعلم
test('المشرف يرى التسجيل بعد حفظ المعلم', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  await bulk(t1Token, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  const g1 = await groupIdByCode('G1', adminToken)
  const r = await get('/api/daily', adminToken, 'group_id=' + g1 + '&date=' + d)
  assert.ok(r.body.some((x) => x.student_id === s1 && x.attendance_status === 'on_time'))
})

// 24) السجل التاريخي يتحدث بشكل صحيح
test('السجل التاريخي يتحدث بشكل صحيح', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  await bulk(t1Token, [{ student_id: s1, record_date: d, revision: { status: 'reviewed' } }])
  const r = await get('/api/daily', adminToken, 'student_id=' + s1 + '&date=' + d)
  assert.ok(r.body.some((x) => x.revision_status === 'reviewed'))
})

// 25) الإحصائيات اليومية تتحدث بعد الحفظ
test('الإحصائيات اليومية تتحدث بعد الحفظ', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  const g1 = await groupIdByCode('G1', adminToken)
  const before = (await get('/api/daily/summary', adminToken, 'group_id=' + g1 + '&date=' + d)).body.registered
  await bulk(t1Token, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  const after = (await get('/api/daily/summary', adminToken, 'group_id=' + g1 + '&date=' + d)).body.registered
  assert.equal(after, before + 1)
})

// 26) نقل الطالب لا يغير التاريخ القديم
test('نقل الطالب لا يغير التاريخ القديم', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  const g1 = await groupIdByCode('G1', adminToken)
  const g2 = await groupIdByCode('G2', adminToken)
  await bulk(t1Token, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  await post(`/api/students/${s1}/transfer`, { group_id: g2, reason: 'نقل' }, adminToken)
  const r = await get('/api/daily', adminToken, 'student_id=' + s1 + '&date=' + d)
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].group_id, g1)
})

// 27) الطالب المؤرشف لا يدخل في التسجيل الجديد
test('الطالب المؤرشف لا يدخل في التسجيل الجديد', async () => {
  const code = 'SZ' + Date.now()
  const cr = await post('/api/students', { full_name: 'مؤرشف2', student_code: code, group_id: await groupIdByCode('G1', adminToken) }, adminToken)
  const sid = cr.body.id
  await post(`/api/students/${sid}/archive`, {}, adminToken)
  const r = await get('/api/students?status=active&circle_id=' + (await groupIdByCode('G1', adminToken)), t1Token)
  assert.ok(!r.body.some((s) => s.id === sid))
})

// 28) فشل الحفظ لا يعطي رسالة نجاح كاذبة
test('فشل الحفظ لا يعطي رسالة نجاح كاذبة', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  const s8 = await studentIdByCode('S008', adminToken)
  const res = await bulk(t1Token, [
    { student_id: s1, record_date: d, attendance: { status: 'bad_value' } },
    { student_id: s8, record_date: d, attendance: { status: 'on_time' } }
  ])
  const oos = res.body.results.find((x) => x.student_id === s8)
  assert.equal(oos.status, 'error')
  assert.ok(res.body.errors >= 1)
})

// 29) transaction تعمل في الحفظ الجماعي
test('transaction تعمل في الحفظ الجماعي', async () => {
  const d = ud()
  const s1 = await studentIdByCode('S001', adminToken)
  const s2 = await studentIdByCode('S002', adminToken)
  const s5 = await studentIdByCode('S005', adminToken)
  const res = await bulk(t1Token, [
    { student_id: s1, record_date: d, attendance: { status: 'on_time' } },
    { student_id: s2, record_date: d, attendance: { status: 'on_time' } },
    { student_id: s5, record_date: d, attendance: { status: 'on_time' } }
  ])
  assert.equal(res.body.created, 3)
})

// 30) انحدار: واجهات المراحل السابقة تعمل
test('انحدار: واجهات المراحل السابقة تعمل', async () => {
  assert.equal((await get('/api/students?status=all', adminToken)).status, 200)
  assert.equal((await get('/api/groups', adminToken)).status, 200)
  const g = await groupIdByCode('G1', adminToken)
  const st = await post('/api/students', { full_name: 'انحدار7', student_code: 'SD7' + Date.now(), group_id: g }, adminToken)
  assert.equal(st.status, 201)
  assert.equal((await post(`/api/students/${st.body.id}/transfer`, { group_id: await groupIdByCode('G2', adminToken), reason: 't' }, adminToken)).status, 200)
  assert.equal((await post(`/api/students/${st.body.id}/archive`, {}, adminToken)).status, 200)
  assert.equal((await post(`/api/students/${st.body.id}/reactivate`, { group_id: g }, adminToken)).status, 200)
  assert.equal((await get('/api/teachers', adminToken)).status, 200)
})
