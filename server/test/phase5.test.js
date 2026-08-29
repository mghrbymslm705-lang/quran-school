import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-phase5-${Date.now()}.db`)
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

let adminToken, t1Token, t2Token, newStudentId
before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  t1Token = await tokenFor('teacher1', 'teacher123')
  t2Token = await tokenFor('teacher2', 'teacher123')
  const g2 = await groupIdByCode('G2', adminToken)
  const res = await request(app)
    .post('/api/students')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'طالب للتعديل', student_code: 'SNEDIT', group_id: g2 })
  newStudentId = res.body.id
})

function groupIdByCode(code, token) {
  return request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).then((r) => r.body.find((g) => g.code === code).id)
}
function studentIdByCode(code, token) {
  return request(app)
    .get('/api/students?status=all&q=' + code)
    .set('Authorization', `Bearer ${token}`)
    .then((r) => r.body.find((s) => s.student_code === code).id)
}

// 1) إنشاء حلقة باسم مخصص
test('إنشاء حلقة باسم مخصص', async () => {
  const res = await request(app)
    .post('/api/groups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'حلقة عثمان بن عفان' })
  assert.equal(res.status, 201)
  const groups = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(groups.find((g) => g.name === 'حلقة عثمان بن عفان'))
})

// 2) تعديل اسم الحلقة
test('تعديل اسم الحلقة', async () => {
  const g = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body.find(
    (x) => x.name === 'حلقة عثمان بن عفان'
  )
  const put = await request(app)
    .put('/api/groups/' + g.id)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'حلقة عثمان المحدّثة' })
  assert.equal(put.status, 200)
  const after = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(after.find((x) => x.name === 'حلقة عثمان المحدّثة'))
})

// 3) تعيين معلم للحلقة
test('تعيين معلم للحلقة', async () => {
  const g = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body.find(
    (x) => x.name === 'حلقة عثمان المحدّثة'
  )
  const t2 = (await request(app).get('/api/teachers').set('Authorization', `Bearer ${adminToken}`)).body.find(
    (t) => t.username === 'teacher2'
  )
  const put = await request(app)
    .put('/api/groups/' + g.id)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ teacher_id: t2.id })
  assert.equal(put.status, 200)
  const after = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body.find(
    (x) => x.id === g.id
  )
  assert.equal(after.teacher_id, t2.id)
})

// 4) إنشاء طالب
test('إنشاء طالب', async () => {
  const g2 = await groupIdByCode('G2', adminToken)
  const res = await request(app)
    .post('/api/students')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'طالب جديد', student_code: 'SN999', group_id: g2 })
  assert.equal(res.status, 201)
  const found = (await request(app).get('/api/students?status=all&q=SN999').set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(found.length, 1)
})

// 5) منع تكرار رقم الطالب
test('منع تكرار رقم الطالب', async () => {
  const res = await request(app)
    .post('/api/students')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'مكرر', student_code: 'S001', group_id: (await groupIdByCode('G2', adminToken)) })
  assert.equal(res.status, 409)
  assert.ok(/رقم الطالب/.test(res.body.error), 'يجب أن تظهر رسالة "رقم الطالب مستخدم بالفعل"')
})

// 6) تعديل بيانات الطالب
test('تعديل بيانات الطالب', async () => {
  const put = await request(app)
    .put('/api/students/' + newStudentId)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'اسم محدّث' })
  assert.equal(put.status, 200)
  const s = (await request(app).get('/api/students?status=all&q=SNEDIT').set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.equal(s.full_name, 'اسم محدّث')
})

// 7) تعديل المحفوظ الحالي
test('تعديل المحفوظ الحالي', async () => {
  await request(app)
    .put('/api/students/' + newStudentId)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ current_memorization: 'سورة الكهف', current_memorization_status: 'mastered' })
  const s = (await request(app).get('/api/students?status=all&q=SNEDIT').set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.equal(s.current_memorization, 'سورة الكهف')
  assert.equal(s.current_memorization_status, 'mastered')
})

// 8) تعديل السلوك
test('تعديل السلوك', async () => {
  await request(app)
    .put('/api/students/' + newStudentId)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ behavior: 'ممتاز' })
  const s = (await request(app).get('/api/students?status=all&q=SNEDIT').set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.equal(s.behavior, 'ممتاز')
})

// 9) تعديل الحالة الصحية + إتاحتها للمعلم
test('تعديل الحالة الصحية', async () => {
  await request(app)
    .put('/api/students/' + newStudentId)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ health_status: 'ربو', health_visible_to_teacher: 1 })
  const s = (await request(app).get('/api/students?status=all&q=SNEDIT').set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.equal(s.health_status, 'ربو')
})

// 10) احترام health_visible_to_teacher
test('احترام health_visible_to_teacher', async () => {
  const all = (await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`)).body
  const visible = all.find((s) => s.id === newStudentId)
  assert.equal(visible.health_status, 'ربو', 'المعلم يرى الحالة الصحية عند السماح')
  const s001 = await studentIdByCode('S001', adminToken)
  const hidden = all.find((s) => s.id === s001)
  assert.equal(hidden.health_status, undefined, 'المعلم لا يرى الحالة الصحية عند المنع')
})

// 11) نقل طالب بين حلقات
test('نقل طالب بين حلقات', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const g2 = await groupIdByCode('G2', adminToken)
  const res = await request(app)
    .post('/api/students/' + sid + '/transfer')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ group_id: g2 })
  assert.equal(res.status, 200)
})

// 12) حفظ تاريخ النقل
test('حفظ تاريخ النقل', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const hist = (await request(app).get('/api/students/' + sid + '/group-history').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(hist.length >= 2, 'يجب وجود سجل انتساب أولي + سجل نقل')
  assert.ok(hist.some((h) => h.reason === 'transfer'))
})

// 13) عدم حذف السجلات اليومية السابقة
test('عدم حذف السجلات اليومية السابقة', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const recs = (await request(app).get('/api/daily?student_id=' + sid + '&date=' + today()).set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(recs.length >= 1, 'يجب أن يبقى السجل اليومي السابق')
})

// 14) عدم ظهور الطالب في الحلقة القديمة
test('عدم ظهور الطالب في الحلقة القديمة', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const g1 = await groupIdByCode('G1', adminToken)
  const inG1 = (await request(app).get('/api/students?circle_id=' + g1).set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(inG1.find((s) => s.id === sid), undefined)
})

// 15) ظهور الطالب في الحلقة الجديدة
test('ظهور الطالب في الحلقة الجديدة', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const g2 = await groupIdByCode('G2', adminToken)
  const inG2 = (await request(app).get('/api/students?circle_id=' + g2).set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(inG2.find((s) => s.id === sid), 'يجب أن يظهر الطالب في الحلقة الجديدة')
})

// 16) أرشفة الطالب
test('أرشفة الطالب', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const res = await request(app).post('/api/students/' + sid + '/archive').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.status, 200)
  const s = (await request(app).get('/api/students?status=all&q=S001').set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.equal(s.status, 'archived')
})

// 17) اختفاء الطالب من التشغيل اليومي
test('اختفاء الطالب من التشغيل اليومي', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const def = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(def.find((s) => s.id === sid), undefined, 'المشرف لا يراه في القائمة التشغيلية الافتراضية')
  const t1 = (await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`)).body
  assert.equal(t1.find((s) => s.id === sid), undefined, 'المعلم القديم لا يراه')
})

// 18) بقاء تاريخه
test('بقاء تاريخ الطالب المؤرشف', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const hist = (await request(app).get('/api/students/' + sid + '/group-history').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(hist.length >= 2)
  const recs = (await request(app).get('/api/daily?student_id=' + sid).set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(recs.length >= 1)
})

// 19) إعادة تفعيل الطالب
test('إعادة تفعيل الطالب', async () => {
  const sid = await studentIdByCode('S001', adminToken)
  const g2 = await groupIdByCode('G2', adminToken)
  const res = await request(app)
    .post('/api/students/' + sid + '/reactivate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ group_id: g2 })
  assert.equal(res.status, 200)
  const s = (await request(app).get('/api/students?status=all&q=S001').set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.equal(s.status, 'active')
  const def = (await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(def.find((x) => x.id === sid), 'يظهر مجددًا في القائمة النشطة')
})

// 20) أرشفة حلقة دون حذف تاريخها
test('أرشفة حلقة دون حذف تاريخها', async () => {
  const create = await request(app)
    .post('/api/groups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'حلقة مؤقتة للأرشفة' })
  const cid = create.body.id
  const sid = (
    await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ full_name: 'طالب في حلقة مؤقتة', student_code: 'SARCH', group_id: cid })
  ).body.id
  await request(app).put('/api/groups/' + cid).set('Authorization', `Bearer ${adminToken}`).send({ status: 'inactive' })
  const groups = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(groups.find((g) => g.id === cid && g.status === 'inactive'), 'موجودة في قائمة الحلقات')
  const sum = (await request(app).get('/api/daily/summary').set('Authorization', `Bearer ${adminToken}`)).body
  assert.equal(sum.circles.some((c) => c.id === cid), false, 'غير موجودة في الملخّص التشغيلي')
  const st = (await request(app).get('/api/students?status=all&q=SARCH').set('Authorization', `Bearer ${adminToken}`)).body[0]
  assert.ok(st, 'الطالب لم يُحذف')
  const hist = (await request(app).get('/api/students/' + sid + '/group-history').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(hist.length >= 1)
})

// 21) تسجيل العمليات الإدارية في audit_logs
test('تسجيل العمليات الإدارية في سجل التدقيق', async () => {
  const audit = (await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)).body.rows
  assert.ok(audit.find((a) => a.entity_type === 'student' && a.action === 'create'), 'إنشاء طالب')
  assert.ok(audit.find((a) => a.action === 'transfer'), 'نقل طالب')
  assert.ok(audit.find((a) => a.action === 'archive'), 'أرشفة طالب')
})

// 22) منع المعلم من الوصول إلى البيانات الخاصة
test('منع المعلم من رؤية البيانات الخاصة', async () => {
  const res = (await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`)).body
  for (const s of res) {
    assert.equal('phone' in s, false)
    assert.equal('address' in s, false)
    assert.equal('family_contact' in s, false)
  }
})

// 23) منع المعلم من تعديل بيانات الطالب الإدارية
test('منع المعلم من تعديل بيانات الطالب', async () => {
  const sid = await studentIdByCode('S002', adminToken)
  const res = await request(app)
    .put('/api/students/' + sid)
    .set('Authorization', `Bearer ${t1Token}`)
    .send({ phone: '000000', behavior: 'changed' })
  assert.equal(res.status, 403)
})

// 24) سلامة الأساسيات (مراحل سابقة لم تُكسر)
test('سلامة الأساسيات من المراحل السابقة', async () => {
  const sum = (await request(app).get('/api/daily/summary').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(sum.total_students > 0)
  const groups = (await request(app).get('/api/groups').set('Authorization', `Bearer ${adminToken}`)).body
  assert.ok(groups.length >= 3)
})
