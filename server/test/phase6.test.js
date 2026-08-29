import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-phase6-${Date.now()}.db`)
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
const H = (t) => ({ Authorization: `Bearer ${t}` })
const post = (p, b, t) => request(app).post(p).set('Authorization', `Bearer ${t}`).send(b)
const get = (p, t, q) => request(app).get(p + (q ? '?' + q : '')).set('Authorization', `Bearer ${t}`)
const put = (p, b, t) => request(app).put(p).set('Authorization', `Bearer ${t}`).send(b)
const del = (p, t) => request(app).delete(p).set('Authorization', `Bearer ${t}`)
const today = () => new Date().toISOString().slice(0, 10)
const uniq = () => 'u' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000)

let adminToken, t1Token, t2Token, t1Id, t2Id

before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  t1Token = await tokenFor('teacher1', 'teacher123')
  t2Token = await tokenFor('teacher2', 'teacher123')
  const list = (await get('/api/teachers', adminToken)).body
  t1Id = list.find((t) => t.username === 'teacher1').id
  t2Id = list.find((t) => t.username === 'teacher2').id
})

function groupIdByCode(code, token) {
  return request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).then((r) => r.body.find((g) => g.code === code).id)
}
function teacherIdByUsername(username, token) {
  return get('/api/teachers', token).then((r) => r.body.find((t) => t.username === username)).then((t) => t && t.id)
}
async function createTeacher(token, overrides = {}) {
  const username = overrides.username || uniq()
  const res = await post('/api/teachers', {
    full_name: overrides.full_name || 'معلم اختبار',
    username,
    password: overrides.password || 'pass1234',
    phone: overrides.phone,
    email: overrides.email,
    admin_notes: overrides.admin_notes,
    status: overrides.status || 'active',
    group_ids: overrides.group_ids || []
  }, token)
  return { res, username }
}

// 1) المشرف يرى قائمة المعلمين
test('المشرف يرى قائمة المعلمين', async () => {
  const r = await get('/api/teachers', adminToken)
  assert.equal(r.status, 200)
  assert.ok(r.body.length >= 3)
})

// 2) المعلم لا يرى قائمة المعلمين الإدارية
test('المعلم لا يرى قائمة المعلمين الإدارية', async () => {
  const r = await get('/api/teachers', t1Token)
  assert.equal(r.status, 200)
  // يرى حسابه فقط ولا يرى معلمًا آخر
  assert.ok(r.body.length <= 1)
  const ids = r.body.map((t) => t.id)
  assert.ok(!ids.includes(t2Id))
})

// 3) المشرف ينشئ معلمًا
test('المشرف ينشئ معلمًا', async () => {
  const { res } = await createTeacher(adminToken)
  assert.equal(res.status, 201)
  assert.ok(res.body.id)
})

// 4) منع اسم المستخدم المكرر
test('منع اسم المستخدم المكرر', async () => {
  const u = uniq()
  const a = await createTeacher(adminToken, { username: u })
  assert.equal(a.res.status, 201)
  const b = await createTeacher(adminToken, { username: u })
  assert.equal(b.res.status, 409)
  assert.match(b.res.body.error, /مستخدم/)
})

// 5) الحساب ينشأ بدور teacher
test('الحساب ينشأ بدور teacher', async () => {
  const { res, username } = await createTeacher(adminToken)
  assert.equal(res.status, 201)
  const login = await loginAs(username, 'pass1234')
  assert.equal(login.status, 200)
  const tok = login.body.token
  // كمعلم يرى فقط حسابه (وليس كل القائمة الإدارية)
  const list = await get('/api/teachers', tok)
  assert.equal(list.body.length, 1)
  // لا يستطيع إنشاء معلم (ليس مشرفًا)
  const tryCreate = await createTeacher(tok)
  assert.equal(tryCreate.res.status, 403)
})

// 6) منع إنشاء supervisor من واجهة المعلم
test('منع إنشاء supervisor من واجهة المعلم', async () => {
  const u = uniq()
  const r = await post('/api/teachers', { full_name: 'x', username: u, password: 'pass1234', role: 'supervisor' }, t1Token)
  assert.equal(r.status, 403)
})

// 7) منع تصعيد الصلاحيات عبر API (حتى من المشرف)
test('منع تصعيد الصلاحيات عبر API', async () => {
  const u = uniq()
  const asSup = await post('/api/teachers', { full_name: 'x', username: u, password: 'pass1234', role: 'supervisor' }, adminToken)
  assert.equal(asSup.status, 400)
  const asTeacher = await post('/api/teachers', { full_name: 'x', username: uniq(), password: 'pass1234', role: 'teacher' }, t1Token)
  assert.equal(asTeacher.status, 403)
})

// 8) المعلم يستطيع تسجيل الدخول بحسابه
test('المعلم يستطيع تسجيل الدخول بحسابه', async () => {
  const login = await loginAs('teacher1', 'teacher123')
  assert.equal(login.status, 200)
})

// 9) تعطيل المعلم يمنع تسجيل الدخول
test('تعطيل المعلم يمنع تسجيل الدخول', async () => {
  const { res, username } = await createTeacher(adminToken)
  const id = res.body.id
  assert.equal((await loginAs(username, 'pass1234')).status, 200)
  const deact = await post(`/api/teachers/${id}/deactivate`, {}, adminToken)
  assert.equal(deact.status, 200)
  assert.equal((await loginAs(username, 'pass1234')).status, 403)
})

// 10) إعادة تفعيل المعلم تسمح بالدخول
test('إعادة تفعيل المعلم تسمح بالدخول', async () => {
  const { res, username } = await createTeacher(adminToken)
  const id = res.body.id
  await post(`/api/teachers/${id}/deactivate`, {}, adminToken)
  const react = await post(`/api/teachers/${id}/reactivate`, {}, adminToken)
  assert.equal(react.status, 200)
  assert.equal((await loginAs(username, 'pass1234')).status, 200)
})

// 11) المشرف يستطيع إعادة تعيين كلمة المرور
test('المشرف يستطيع إعادة تعيين كلمة المرور', async () => {
  const { res, username } = await createTeacher(adminToken)
  const id = res.body.id
  const rp = await post(`/api/teachers/${id}/reset-password`, { password: 'newpass9', confirm: 'newpass9' }, adminToken)
  assert.equal(rp.status, 200)
  assert.equal((await loginAs(username, 'newpass9')).status, 200)
})

// 12) كلمة المرور لا تظهر في API
test('كلمة المرور لا تظهر في API', async () => {
  const list = await get('/api/teachers', adminToken)
  const str = JSON.stringify(list.body)
  assert.ok(!str.includes('password'))
  assert.ok(!str.includes('password_hash'))
})

// 13) كلمة المرور لا تظهر في audit_logs
test('كلمة المرور لا تظهر في audit_logs', async () => {
  const { res, username } = await createTeacher(adminToken)
  const id = res.body.id
  await post(`/api/teachers/${id}/reset-password`, { password: 'secret99', confirm: 'secret99' }, adminToken)
  const aud = await get(`/api/teachers/${id}/audit`, adminToken)
  const str = JSON.stringify(aud.body)
  assert.ok(!str.includes('secret99'))
  assert.ok(!str.includes('pass1234'))
})

// 14) المشرف يرى حلقات المعلم
test('المشرف يرى حلقات المعلم', async () => {
  const g2 = await groupIdByCode('G2', adminToken)
  const { res } = await createTeacher(adminToken, { group_ids: [g2] })
  const id = res.body.id
  const file = await get(`/api/teachers/${id}`, adminToken)
  assert.equal(file.status, 200)
  assert.ok(Array.isArray(file.body.groups))
  assert.ok(file.body.groups.some((g) => g.id === g2))
})

// 15) تغيير معلم الحلقة يطبّق على النطاق الحالي
test('تغيير معلم الحلقة يطبّق على النطاق الحالي', async () => {
  const g = await post('/api/groups', { name: 'حلقة نطاق', code: 'GS' + uniq() }, adminToken)
  const gid = g.body.id
  await post('/api/teachers', { full_name: 'معلم نطاق1', username: uniq(), password: 'pass1234', group_ids: [gid] }, adminToken)
  // نعيد الإسناد لمعلم آخر
  const re = await put(`/api/groups/${gid}`, { teacher_id: t2Id }, adminToken)
  assert.equal(re.status, 200)
  const t1Groups = (await get('/api/groups', t1Token)).body.map((x) => x.id)
  const t2Groups = (await get('/api/groups', t2Token)).body.map((x) => x.id)
  assert.ok(!t1Groups.includes(gid))
  assert.ok(t2Groups.includes(gid))
})

// 16) المعلم القديم لا يرى الطلاب الحاليين بعد انتقال الحلقة
test('المعلم القديم لا يرى الطلاب الحاليين بعد انتقال الحلقة', async () => {
  const g = await post('/api/groups', { name: 'حلقة قديم', code: 'GO' + uniq() }, adminToken)
  const gid = g.body.id
  // أنشئ معلمًا قديمًا حقيقيًا
  const oldU = uniq()
  await createTeacher(adminToken, { username: oldU, password: 'pass1234', group_ids: [gid] })
  const oldTok = await tokenFor(oldU, 'pass1234')
  const st = await post('/api/students', { full_name: 'طالب نطاق', student_code: 'SN' + uniq(), group_id: gid }, adminToken)
  const sid = st.body.id
  // قبل النقل المعلم القديم يراه
  assert.ok((await get('/api/students', oldTok)).body.some((s) => s.id === sid))
  // نقل الحلقة لمعلم آخر
  await put(`/api/groups/${gid}`, { teacher_id: t2Id }, adminToken)
  const after = (await get('/api/students', oldTok)).body
  assert.ok(!after.some((s) => s.id === sid))
})

// 17) المعلم الجديد يرى الطلاب الحاليين
test('المعلم الجديد يرى الطلاب الحاليين', async () => {
  const g = await post('/api/groups', { name: 'حلقة جديد', code: 'GN' + uniq() }, adminToken)
  const gid = g.body.id
  await createTeacher(adminToken, { username: 'newt' + uniq(), password: 'pass1234', group_ids: [gid] })
  const st = await post('/api/students', { full_name: 'طالب جديد', student_code: 'SJ' + uniq(), group_id: gid }, adminToken)
  const sid = st.body.id
  await put(`/api/groups/${gid}`, { teacher_id: t2Id }, adminToken)
  const t2Students = (await get('/api/students', t2Token)).body
  assert.ok(t2Students.some((s) => s.id === sid))
})

// 18) التسجيلات التاريخية لا تحذف
test('التسجيلات التاريخية لا تحذف', async () => {
  const g = await post('/api/groups', { name: 'حلقة تسجيل', code: 'GR' + uniq() }, adminToken)
  const gid = g.body.id
  const st = await post('/api/students', { full_name: 'طالب تسجيل', student_code: 'SR' + uniq(), group_id: gid }, adminToken)
  const sid = st.body.id
  const drec = await post('/api/daily', { student_id: sid, record_date: today(), attendance: { status: 'on_time' } }, adminToken)
  assert.equal(drec.status, 201)
  await put(`/api/groups/${gid}`, { teacher_id: t2Id }, adminToken)
  const daily = await get('/api/daily', adminToken, 'group_id=' + gid)
  assert.ok(daily.body.length >= 1)
})

// 19) بيانات الطلاب السابقة لا تحذف
test('بيانات الطلاب السابقة لا تحذف', async () => {
  const g = await post('/api/groups', { name: 'حلقة بيانات', code: 'GB' + uniq() }, adminToken)
  const gid = g.body.id
  const st = await post('/api/students', { full_name: 'طالب بيانات', student_code: 'SB' + uniq(), group_id: gid }, adminToken)
  const sid = st.body.id
  await put(`/api/groups/${gid}`, { teacher_id: t2Id }, adminToken)
  const all = (await get('/api/students?status=all', adminToken)).body
  assert.ok(all.some((s) => s.id === sid))
})

// 20) إحصائيات المعلم صحيحة
test('إحصائيات المعلم صحيحة', async () => {
  const groups = (await get('/api/teachers/' + t1Id, adminToken)).body.groups.map((g) => g.id)
  const all = (await get('/api/students?status=all', adminToken)).body
  const expected = all.filter((s) => groups.includes(s.current_group_id) && s.status !== 'archived').length
  const stats = (await get(`/api/teachers/${t1Id}/stats?range=today`, adminToken)).body
  assert.equal(stats.total_students, expected)
  assert.ok(stats.completion_pct >= 0 && stats.completion_pct <= 100)
})

// 21) نسبة التسجيل صحيحة
test('نسبة التسجيل صحيحة', async () => {
  const sum = (await get('/api/daily/summary?teacher_id=' + t1Id, adminToken)).body
  const stats = (await get(`/api/teachers/${t1Id}/stats?range=today`, adminToken)).body
  assert.equal(stats.registered, sum.registered)
  assert.ok(stats.registered >= 0 && stats.registered <= stats.total_students)
  const expectedPct = stats.total_students > 0 ? Math.round((stats.registered / stats.total_students) * 100) : 0
  assert.equal(stats.completion_pct, expectedPct)
})

// 22) المعلم لا يستطيع تعديل معلم آخر
test('المعلم لا يستطيع تعديل معلم آخر', async () => {
  const r = await put(`/api/teachers/${t2Id}`, { full_name: 'محاولة' }, t1Token)
  assert.equal(r.status, 403)
})

// 23) المعلم لا يستطيع تعطيل حساب
test('المعلم لا يستطيع تعطيل حساب', async () => {
  const r = await post(`/api/teachers/${t2Id}/deactivate`, {}, t1Token)
  assert.equal(r.status, 403)
})

// 24) المعلم لا يستطيع الوصول إلى audit_logs
test('المعلم لا يستطيع الوصول إلى audit_logs', async () => {
  assert.equal((await get('/api/audit', t1Token)).status, 403)
  assert.equal((await get(`/api/teachers/${t2Id}/audit`, t1Token)).status, 403)
})

// 25) العمليات الإدارية تسجل في audit_logs
test('العمليات الإدارية تسجل في audit_logs', async () => {
  const { res } = await createTeacher(adminToken, { username: uniq(), full_name: 'موثّق' })
  const id = res.body.id
  await post(`/api/teachers/${id}/deactivate`, {}, adminToken)
  const aud = (await get('/api/audit', adminToken)).body.rows
  assert.ok(aud.some((a) => a.entity_type === 'teacher' && a.action === 'create'))
  assert.ok(aud.some((a) => a.entity_type === 'teacher' && a.action === 'deactivate'))
})

// 26) انحدار: واجهات المراحل السابقة ما زالت تعمل
test('انحدار: واجهات المراحل السابقة تعمل', async () => {
  assert.equal((await get('/api/students?status=all', adminToken)).status, 200)
  assert.equal((await get('/api/groups', adminToken)).status, 200)
  const g = await groupIdByCode('G1', adminToken)
  const st = await post('/api/students', { full_name: 'انحدار', student_code: 'SD' + uniq(), group_id: g }, adminToken)
  assert.equal(st.status, 201)
  assert.equal((await post(`/api/students/${st.body.id}/transfer`, { group_id: (await groupIdByCode('G2', adminToken)), reason: 't' }, adminToken)).status, 200)
  assert.equal((await post(`/api/students/${st.body.id}/archive`, {}, adminToken)).status, 200)
  assert.equal((await post(`/api/students/${st.body.id}/reactivate`, { group_id: g }, adminToken)).status, 200)
})
