import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-phase8-${Date.now()}.db`)
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
const put = (p, b, t) => request(app).put(p).set('Authorization', `Bearer ${t}`).send(b)
const patch = (p, b, t) => request(app).patch(p).set('Authorization', `Bearer ${t}`).send(b)
const del = (p, t) => request(app).delete(p).set('Authorization', `Bearer ${t}`)

const D = '1999-01-01'
let __c = 0
const ud = () => '2004-01-' + String(++__c).padStart(2, '0')

let admin, t1, t2

before(async () => {
  admin = await tokenFor('admin', 'admin123')
  t1 = await tokenFor('teacher1', 'teacher123')
  t2 = await tokenFor('teacher2', 'teacher123')
})

async function sidByCode(code, token) {
  const r = await get('/api/students?status=all', token)
  return r.body.find((s) => s.student_code === code)?.id
}
function gidByCode(code, token) {
  return get('/api/groups', token).then((r) => r.body.find((g) => g.code === code)?.id)
}
async function bulk(token, records) {
  return post('/api/daily/bulk', { records }, token)
}

// 1) الصلاحيات: المعلم لا يصل إلى ملف معلم آخر
test('المعلم لا يطلع على ملف معلم آخر', async () => {
  const teachers = await get('/api/teachers', admin)
  const other = teachers.body.find((t) => t.username === 'teacher2')
  const r = await get('/api/teachers/' + other.id, t1)
  assert.equal(r.status, 403)
})

// 2) الصلاحيات: المعلم لا يصل إلى سجل التدقيق
test('المعلم لا يصل إلى سجل التدقيق', async () => {
  const r = await get('/api/audit', t1)
  assert.equal(r.status, 403)
})

// 3) الخصوصية: المعلم لا يستلم الحقول الخاصة
test('المعلم لا يستلم حقول الهاتف والعنوان وجهة الاتصال', async () => {
  const r = await get('/api/students?status=all', t1)
  assert.ok(r.body.length >= 1)
  for (const s of r.body) {
    assert.ok(!('phone' in s), 'ظهر حقل phone للمعلم')
    assert.ok(!('address' in s), 'ظهر حقل address للمعلم')
    assert.ok(!('family_contact' in s), 'ظهر حقل family_contact للمعلم')
  }
})

// 4) الخصوصية: المعلم لا يرى طالبًا خارج نطاقه
test('المعلم لا يرى طالبًا خارج حلقاته', async () => {
  const r = await get('/api/students?status=all', t1)
  const ids = r.body.map((s) => s.id)
  const s8 = await sidByCode('S008', admin)
  assert.ok(!ids.includes(s8), 'ظهر طالب خارج النطاق')
})

// 5) التسجيل اليومي: المعلم يسجّل ويراه المشرف
test('التسجيل اليومي يظهر للمشرف', async () => {
  const d = ud()
  const s1 = await sidByCode('S001', admin)
  await bulk(t1, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  const r = await get('/api/daily', admin, 'student_id=' + s1 + '&date=' + d)
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].attendance_status, 'on_time')
})

// 6) التسجيل الجماعي
test('التسجيل الجماعي ينشئ سجلات متعددة', async () => {
  const d = ud()
  const s1 = await sidByCode('S001', admin)
  const s2 = await sidByCode('S002', admin)
  const s5 = await sidByCode('S005', admin)
  const res = await bulk(t1, [
    { student_id: s1, record_date: d, attendance: { status: 'on_time' } },
    { student_id: s2, record_date: d, attendance: { status: 'on_time' } },
    { student_id: s5, record_date: d, attendance: { status: 'on_time' } }
  ])
  assert.equal(res.body.created, 3)
})

// 7) الإحصائيات: not_recorded لا يُحسب ضمن not_heard
test('not_recorded يبقى منفصلًا عن not_heard في الإحصائيات', async () => {
  const d = ud()
  const g1 = await gidByCode('G1', admin)
  const s1 = await sidByCode('S001', admin)
  await bulk(t1, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  const r = await get('/api/daily/summary', admin, 'group_id=' + g1 + '&date=' + d)
  const s = r.body
  assert.equal(s.heard, 0, 'يجب ألا يُحسب أي سماع')
  assert.equal(s.not_heard, 0, 'يجب ألا يُحسب أي لم يسمع')
  assert.equal(s.not_recorded_mem, 1, 'المحور غير المسجّل يُحسب كـ not_recorded وحده')
})

// 8) النقل: الحفاظ على التاريخ
test('نقل الطالب يحفظ التاريخ السابق', async () => {
  const code = 'SX' + Date.now()
  const g1 = await gidByCode('G1', admin)
  const g2 = await gidByCode('G2', admin)
  const cr = await post('/api/students', { full_name: 'منقول', student_code: code, group_id: g1 }, admin)
  const sid = cr.body.id
  await post('/api/students/' + sid + '/transfer', { group_id: g2, reason: 'نقل' }, admin)
  const h = await get('/api/students/' + sid + '/group-history', admin)
  assert.equal(h.body.length, 2)
  const oldRow = h.body.find((x) => x.group_id === g1)
  const newRow = h.body.find((x) => x.group_id === g2)
  assert.ok(oldRow && oldRow.end_date, 'يجب إغلاق السجل القديم بتاريخ نهاية')
  assert.ok(newRow && !newRow.end_date, 'السجل الجديد مفتوح')
})

// 9) الأرشفة: ناعمة ولا تحذف التاريخ
test('الأرشفة لا تحذف الطالب من قاعدة البيانات', async () => {
  const code = 'SA' + Date.now()
  const g1 = await gidByCode('G1', admin)
  const cr = await post('/api/students', { full_name: 'مؤرشف', student_code: code, group_id: g1 }, admin)
  const sid = cr.body.id
  await post('/api/students/' + sid + '/archive', {}, admin)
  const active = await get('/api/students?status=active', admin)
  assert.ok(!active.body.some((s) => s.id === sid))
  const archived = await get('/api/students?status=archived', admin)
  assert.ok(archived.body.some((s) => s.id === sid))
  const h = await get('/api/students/' + sid + '/group-history', admin)
  assert.ok(h.body.length >= 1)
})

// 10) إعادة التفعيل
test('إعادة التفعيل تعيد الطالب نشطًا ضمن حلقة', async () => {
  const code = 'SR' + Date.now()
  const g1 = await gidByCode('G1', admin)
  const g2 = await gidByCode('G2', admin)
  const cr = await post('/api/students', { full_name: 'معاد', student_code: code, group_id: g1 }, admin)
  const sid = cr.body.id
  await post('/api/students/' + sid + '/archive', {}, admin)
  await post('/api/students/' + sid + '/reactivate', { group_id: g2 }, admin)
  const r = await get('/api/students?status=active', admin)
  const st = r.body.find((s) => s.id === sid)
  assert.ok(st, 'يجب أن يظهر نشطًا')
  assert.equal(st.current_group_id, g2)
})

// 11) المعلمون: إنشاء + كلمة المرور غير مكشوفة + تعطيل يمنع الدخول
test('إنشاء معلم وتعطيله يمنع الدخول', async () => {
  const uname = 'newt' + Date.now()
  const cr = await post('/api/teachers', { full_name: 'معلم جديد', username: uname, password: 'pass1234' }, admin)
  assert.equal(cr.status, 201)
  assert.ok(!('password' in cr.body))
  assert.ok(!('password_hash' in cr.body))
  // الدخول يعمل قبل التعطيل
  assert.equal((await loginAs(uname, 'pass1234')).status, 200)
  await post('/api/teachers/' + cr.body.id + '/deactivate', {}, admin)
  const disabled = await loginAs(uname, 'pass1234')
  assert.equal(disabled.status, 403)
  assert.ok(typeof disabled.body.error === 'string' && disabled.body.error.length > 0)
})

// 12) الحلقات: اسم حر بلا كود إجباري
test('إنشاء حلقة باسم حر دون كود', async () => {
  const name = 'براعم القرآن ' + Date.now()
  const cr = await post('/api/groups', { name }, admin)
  assert.equal(cr.status, 201)
  const groups = await get('/api/groups', admin)
  assert.ok(groups.body.some((g) => g.name === name && g.code === null))
})

// 13) التدقيق: يسجّل عمليات المشرف
test('سجل التدقيق يسجّل إنشاء طالب', async () => {
  const code = 'SZ' + Date.now()
  await post('/api/students', { full_name: 'مسجّل', student_code: code, group_id: await gidByCode('G1', admin) }, admin)
  const a = await get('/api/audit', admin)
  const found = a.body.rows.find((x) => x.entity_type === 'student' && x.action === 'create' && x.new_data && x.new_data.student_code === code)
  assert.ok(found, 'يجب أن يوجد سجل إنشاء الطالب')
  assert.ok(found.new_data && found.new_data.student_code === code)
})

// 14) الحسابات المعطّلة
test('حساب معطّل يُرفض دخوله برسالة واضحة', async () => {
  const r = await loginAs('teacher3', 'teacher123')
  assert.equal(r.status, 403)
  assert.ok(typeof r.body.error === 'string' && r.body.error.length > 0)
})

// 15) كلمات المرور: لا تُعاد في أي API
test('كلمة المرور لا تظهر في أي استجابة', async () => {
  const me = await get('/api/auth/me', t1)
  assert.ok(!('password' in me.body.user))
  const teachers = await get('/api/teachers', admin)
  for (const t of teachers.body) assert.ok(!('password' in t) && !('password_hash' in t))
})

// 16) منع IDOR: المعلم لا يعدّل سجلًا خارج نطاقه
test('المعلم لا يعدّل سجل طالب خارج نطاقه (IDOR)', async () => {
  const d = ud()
  const s8 = await sidByCode('S008', admin) // حلقة G3 (خاصة بمعلم 2)
  const cr = await post('/api/daily', { student_id: s8, record_date: d, attendance: { status: 'on_time' } }, admin)
  const r = await patch('/api/daily/' + cr.body.id, { attendance: { status: 'late' } }, t1)
  assert.equal(r.status, 403)
})

// 17) منع تصعيد الصلاحيات
test('منع تصعيد الصلاحيات عبر إنشاء/تعديل المعلم', async () => {
  const r1 = await post('/api/teachers', { full_name: 'x', username: 'x' + Date.now(), password: 'p12345', role: 'supervisor' }, admin)
  assert.equal(r1.status, 400)
  const r2 = await post('/api/teachers', { full_name: 'y', username: 'y' + Date.now(), password: 'p12345' }, admin)
  assert.equal(r2.status, 201)
  const r3 = await put('/api/teachers/' + r2.body.id, { role: 'supervisor' }, admin)
  assert.equal(r3.status, 400)
})

// 18) منع التلاعب بـ student_id
test('منع تسجيل طالب خارج النطاق عبر student_id', async () => {
  const d = ud()
  const s8 = await sidByCode('S008', admin)
  const res = await bulk(t1, [{ student_id: s8, record_date: d, attendance: { status: 'on_time' } }])
  const item = res.body.results.find((x) => x.student_id === s8)
  assert.equal(item.status, 'error')
})

// 19) عدم تكرار السجلات (upsert)
test('التسجيل المكرر يحدّث ولا يكرّر', async () => {
  const d = ud()
  const s1 = await sidByCode('S001', admin)
  await bulk(t1, [{ student_id: s1, record_date: d, attendance: { status: 'on_time' } }])
  const res = await bulk(t1, [{ student_id: s1, record_date: d, attendance: { status: 'late' } }])
  assert.equal(res.body.results.find((x) => x.student_id === s1).status, 'updated')
  const r = await get('/api/daily', admin, 'student_id=' + s1 + '&date=' + d)
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].attendance_status, 'late')
})

// 20) معالجة الأخطاء: لا تسريب أخطاء SQL
test('رسائل الخطأ لا تسرب تفاصيل SQL', async () => {
  const bad = await loginAs('admin', 'wrong-pass')
  assert.equal(bad.status, 401)
  assert.ok(!/SQLITE/i.test(JSON.stringify(bad.body)))
  const miss = await post('/api/students', { full_name: '' }, admin)
  assert.equal(miss.status, 400)
  assert.ok(!/SQLITE/i.test(JSON.stringify(miss.body)))
})

// 21) السجل التاريخي لا يضيع بعد النقل/التعديل
test('المشرف يعدّل تسجيلًا فيسجّل التدقيق ولا يضيع السجل', async () => {
  const d = ud()
  const s1 = await sidByCode('S001', admin)
  const cr = await post('/api/daily', { student_id: s1, record_date: d, memorization: { status: 'heard' } }, admin)
  const before = await get('/api/daily', admin, 'student_id=' + s1 + '&date=' + d)
  await patch('/api/daily/' + cr.body.id, { memorization: { status: 'not_heard' } }, admin)
  const after = await get('/api/daily', admin, 'student_id=' + s1 + '&date=' + d)
  assert.equal(after.body.length, before.body.length)
  assert.equal(after.body[0].memorization_status, 'not_heard')
  const a = await get('/api/audit', admin)
  assert.ok(a.body.rows.some((x) => x.entity_type === 'memorization_record' && x.action === 'update'))
})

// 22) E2E مبسّط: مشرف → معلم → تسجيل → مشرف يرى
test('تدفق شامل: إنشاء معلم وحلقة وطالب ثم تسجيل المعلم', async () => {
  const uname = 'e2e' + Date.now()
  const tcr = await post('/api/teachers', { full_name: 'معلم e2e', username: uname, password: 'e2e12345' }, admin)
  const gid = (await post('/api/groups', { name: 'حلقة e2e ' + Date.now(), teacher_id: tcr.body.id }, admin)).body.id
  const scode = 'SE' + Date.now()
  const scr = await post('/api/students', { full_name: 'طالب e2e', student_code: scode, group_id: gid }, admin)
  const tt = (await loginAs(uname, 'e2e12345')).body.token
  const d = ud()
  const res = await bulk(tt, [{ student_id: scr.body.id, record_date: d, attendance: { status: 'on_time' }, memorization: { status: 'heard' } }])
  assert.equal(res.body.created, 1)
  const sup = await get('/api/daily', admin, 'student_id=' + scr.body.id + '&date=' + d)
  assert.equal(sup.body[0].attendance_status, 'on_time')
  assert.equal(sup.body[0].memorization_status, 'heard')
})
