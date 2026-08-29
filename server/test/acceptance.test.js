import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-acc-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')
const { db, STUDENT_WITH_CURRENT_GROUP } = await import('../src/db.js')
const { runBackup } = await import('../scripts/backup.js')
const { resolveBackupDir } = await import('../src/db-path.js')

function loginAs(username, password) {
  return request(app).post('/api/auth/login').send({ username, password })
}
async function tokenFor(username, password) {
  const res = await loginAs(username, password)
  assert.equal(res.status, 200, `فشل دخول ${username}: ${JSON.stringify(res.body)}`)
  return res.body.token
}
async function teacherIdByUsername(username, adminToken) {
  const res = await request(app).get('/api/teachers').set('Authorization', `Bearer ${adminToken}`)
  return res.body.find((t) => t.username === username).id
}
async function createStudent(adminToken, code, groupId) {
  const res = await request(app)
    .post('/api/students')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: `طالب قبول ${code}`, student_code: code, group_id: groupId })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body.id
}

let adminToken, t1Token, t2Token, t1Id, t2Id

before(async () => {
  adminToken = await tokenFor('admin', 'admin123')
  t1Token = await tokenFor('teacher1', 'teacher123')
  t2Token = await tokenFor('teacher2', 'teacher123')
  t1Id = await teacherIdByUsername('teacher1', adminToken)
  t2Id = await teacherIdByUsername('teacher2', adminToken)
})

after(() => {
  try { fs.unlinkSync(tmp) } catch {}
})

// ===== 3) إعدادات المؤسسة تُحفظ وتُسترجع =====
test('إعدادات المدرسة: حفظ ثم استرجاع بنفس القيم', async () => {
  const put = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'مدرسة الإسراء', description: 'وصف', address: 'عنوان', phone: '0123', email: 'a@b.c' })
  assert.equal(put.status, 200)
  assert.equal(put.body.name, 'مدرسة الإسراء')
  const get = await request(app).get('/api/settings/school').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(get.status, 200)
  assert.equal(get.body.name, 'مدرسة الإسراء')
  assert.equal(get.body.phone, '0123')
})

test('إعدادات المدرسة: رفض الحقول المحظورة', async () => {
  const res = await request(app).put('/api/settings/school').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'x', password_hash: 'y' })
  assert.equal(res.status, 400)
})

// ===== 4) ملف المشرف: تعديل الاسم/اسم المستخدم وكلمة المرور =====
test('تعديل اسم المستخدم يُفعّل الدخول الجديد ويعطّل القديم', async () => {
  const put = await request(app).put('/api/me').set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'المشرف الأول', username: 'admin_new', email: 'sup@x.com' })
  assert.equal(put.status, 200)
  assert.equal(put.body.user.username, 'admin_new')
  const ok = await loginAs('admin_new', 'admin123')
  assert.equal(ok.status, 200)
  const old = await loginAs('admin', 'admin123')
  assert.equal(old.status, 401)
  // إعادة الاسم الأصلي لبقية الاختبارات في هذا الملف
  await request(app).put('/api/me').set('Authorization', `Bearer ${ok.body.token}`)
    .send({ full_name: 'المشرف', username: 'admin', email: 'admin@school' })
  adminToken = (await loginAs('admin', 'admin123')).body.token
})

test('تغيير كلمة المرور: رفض الخطأ/القصير/عدم التطابق ثم القبول', async () => {
  const wrong = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`)
    .send({ current_password: 'bad', new_password: 'new1', confirm_password: 'new1' })
  assert.equal(wrong.status, 400)
  const short = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`)
    .send({ current_password: 'admin123', new_password: '12', confirm_password: '12' })
  assert.equal(short.status, 400)
  const mismatch = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`)
    .send({ current_password: 'admin123', new_password: 'newpass', confirm_password: 'other' })
  assert.equal(mismatch.status, 400)
  const ok = await request(app).put('/api/me/password').set('Authorization', `Bearer ${adminToken}`)
    .send({ current_password: 'admin123', new_password: 'newpass', confirm_password: 'newpass' })
  assert.equal(ok.status, 200)
  const loginNew = await loginAs('admin', 'newpass')
  assert.equal(loginNew.status, 200)
  // إعادة كلمة المرور الأصلية
  await request(app).put('/api/me/password').set('Authorization', `Bearer ${loginNew.body.token}`)
    .send({ current_password: 'newpass', new_password: 'admin123', confirm_password: 'admin123' })
})

// ===== 12) الخصوصية: كلمة المرور لا تظهر + المعلم لا يصل لملف معلم آخر (IDOR) =====
test('سجل التدقيق لا يحتوي على كلمات مرور', async () => {
  const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(res.status, 200)
  const dump = JSON.stringify(res.body)
  assert.equal(/password_hash|"password"/i.test(dump), false, 'تسرّب كلمة مرور في سجل التدقيق!')
})

test('المعلم لا يصل إلى ملف معلم آخر (IDOR على /api/teachers/:id)', async () => {
  const res = await request(app).get(`/api/teachers/${t2Id}`).set('Authorization', `Bearer ${t1Token}`)
  assert.equal(res.status, 403)
  const put = await request(app).put(`/api/teachers/${t2Id}`).set('Authorization', `Bearer ${t1Token}`)
    .send({ full_name: 'اختراق' })
  assert.equal(put.status, 403)
})

test('منع تصعيد صلاحية المعلم إلى مشرف عبر الإنشاء', async () => {
  const res = await request(app).post('/api/teachers').set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'x', username: 'evil_x', password: 'pass', role: 'supervisor' })
  assert.equal(res.status, 400)
})

// ===== 7) دورة حياة المعلم: إنشاء -> تعطيل -> إعادة تفعيل -> إعادة تعيين كلمة =====
test('دورة حياة المعلم: تعطيل يمنع الدخول ثم إعادة التفعيل تسمح به', async () => {
  const created = await request(app).post('/api/teachers').set('Authorization', `Bearer ${adminToken}`)
    .send({ full_name: 'معلم قبول', username: 'acc_teacher', password: 'teacher123', group_ids: [] })
  assert.equal(created.status, 201)
  const id = created.body.id
  const deact = await request(app).put(`/api/teachers/${id}`).set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'inactive' })
  assert.equal(deact.status, 200)
  const loginBlocked = await loginAs('acc_teacher', 'teacher123')
  assert.equal(loginBlocked.status, 403)
  const react = await request(app).put(`/api/teachers/${id}`).set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'active' })
  assert.equal(react.status, 200)
  const loginOk = await loginAs('acc_teacher', 'teacher123')
  assert.equal(loginOk.status, 200)
})

// ===== 6+17) الحلقات: إسناد معلم موثّق، تغيير المعلم يُغلق السابق (سجل واحد مفتوح) =====
test('الحلقة: إسناد معلم يُوثَّق، وتغييره يُبقي سجلًا واحدًا مفتوحًا', async () => {
  const g = await request(app).post('/api/groups').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'حلقة قبول 1', code: 'ACC1', teacher_id: t1Id, assign_reason: 'assign' })
  assert.equal(g.status, 201)
  const gid = g.body.id
  const hist1 = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ?').all(gid)
  assert.equal(hist1.length, 1)
  assert.equal(hist1[0].teacher_id, t1Id)
  assert.equal(hist1[0].end_date, null)
  assert.equal(hist1[0].reason, 'assign')
  // تغيير المعلم
  const upd = await request(app).put(`/api/groups/${gid}`).set('Authorization', `Bearer ${adminToken}`)
    .send({ teacher_id: t2Id, assign_reason: 'reassign' })
  assert.equal(upd.status, 200)
  const hist2 = db.prepare('SELECT * FROM group_teacher_history WHERE group_id = ? ORDER BY start_date').all(gid)
  assert.equal(hist2.length, 2, 'يجب أن يوجد سجلان')
  const open = hist2.filter((h) => h.end_date === null)
  assert.equal(open.length, 1, 'يجب أن يوجد سجل مفتوح واحد فقط')
  assert.equal(open[0].teacher_id, t2Id)
  assert.equal(open[0].reason, 'reassign')
})

test('المعلم يرى حلقاته فقط', async () => {
  const res = await request(app).get('/api/groups').set('Authorization', `Bearer ${t1Token}`)
  assert.equal(res.status, 200)
  assert.ok(res.body.every((g) => g.teacher_id === t1Id), 'معلم يرى حلقة ليست له!')
})

// ===== 8+17) الطالب: نقل بين الحلقات يُغلق السابق، أرشفة تُخفيه من الإحصاء =====
test('الطالب: النقل يحافظ على سجل واحد مفتوح، والأرشفة تُخفيه من العدد', async () => {
  const g1 = await request(app).post('/api/groups').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'حلقة نقل أ', code: 'TR1', teacher_id: t1Id })
  const g2 = await request(app).post('/api/groups').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'حلقة نقل ب', code: 'TR2', teacher_id: t1Id })
  const sid = await createStudent(adminToken, 'ACC_STU_1', g1.body.id)
  const before = db.prepare('SELECT COUNT(*) c FROM student_group_history WHERE student_id = ? AND end_date IS NULL').get(sid).c
  assert.equal(before, 1)
  const tr = await request(app).post(`/api/students/${sid}/transfer`).set('Authorization', `Bearer ${adminToken}`)
    .send({ group_id: g2.body.id, reason: 'تجربة نقل' })
  assert.equal(tr.status, 200)
  const open = db.prepare('SELECT COUNT(*) c FROM student_group_history WHERE student_id = ? AND end_date IS NULL').get(sid).c
  assert.equal(open, 1, 'يجب أن يوجد سجل مفتوح واحد بعد النقل')
  // أرشفة
  const arch = await request(app).post(`/api/students/${sid}/archive`).set('Authorization', `Bearer ${adminToken}`)
  assert.equal(arch.status, 200)
  const list = await request(app).get('/api/students').set('Authorization', `Bearer ${adminToken}`)
  assert.equal(list.body.some((s) => s.id === sid), false, 'الطالب المؤرشف يظهر في القائمة الافتراضية!')
  // العدد في الحلقة لا يشمل المؤرشف
  const cnt = db.prepare('SELECT COUNT(DISTINCT h.student_id) c FROM student_group_history h JOIN students s ON s.id=h.student_id WHERE h.group_id=? AND h.end_date IS NULL AND s.status != \'archived\'').get(g2.body.id).c
  assert.equal(cnt, 0, 'طالب مؤرشف يُحسب في عدة الحلقة!')
})

// المعلم لا يستطيع نقل/أرشفة طالب (صلاحية مشرف فقط)
test('المعلم لا يستطيع نقل أو أرشفة طالب', async () => {
  const list = await request(app).get('/api/students').set('Authorization', `Bearer ${t1Token}`)
  const sid = list.body[0].id
  const tr = await request(app).post(`/api/students/${sid}/transfer`).set('Authorization', `Bearer ${t1Token}`)
    .send({ group_id: 'x' })
  assert.equal(tr.status, 403)
  const arch = await request(app).post(`/api/students/${sid}/archive`).set('Authorization', `Bearer ${t1Token}`)
  assert.equal(arch.status, 403)
})

// ===== 9) السجل اليومي: not_recorded لا يُحسب غيابًا =====
test('السجل اليومي: عدم التسجيل لا يُحسب غيابًا في ملخّص الحلقة', async () => {
  const g = await request(app).post('/api/groups').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'حلقة غياب', code: 'ABS1', teacher_id: t1Id })
  const sid = await createStudent(adminToken, 'ACC_STU_ABS', g.body.id)
  const today = new Date().toISOString().slice(0, 10)
  const dr = await request(app).post('/api/daily').set('Authorization', `Bearer ${t1Token}`)
    .send({ student_id: sid, record_date: today, attendance: { status: 'not_recorded' } })
  assert.equal(dr.status, 201)
  const sum = await request(app).get('/api/daily/summary').set('Authorization', `Bearer ${adminToken}`).query({ date: today, group_id: g.body.id })
  assert.equal(sum.status, 200)
  const circle = sum.body.circles?.find((c) => c.id === g.body.id)
  assert.ok(circle, 'الحلقة غير موجودة في الملخّص')
  // طالب واحد لم يُسجَّل حضوره: يجب أن يكون في not_recorded_att لا في late/excused (أي لا يُحسب غائبًا)
  assert.equal(circle.not_recorded_att, 1, 'الطالب غير المسجّل يجب أن يكون في عدّاد غير المسجّل')
  assert.equal(circle.late, 0, 'طالب غير مسجّل يُحسب متأخرًا!')
  assert.equal(circle.excused, 0, 'طالب غير مسجّل يُحسب غائبًا بعذر!')
})

// ===== 17) سلامة قاعدة البيانات: لا سجلات مفتوحة مكررة =====
test('سلامة القاعدة: لا يوجد طالب بأكثر من سجل حلقة مفتوح، ولا حلقة بأكثر من معلم مفتوح', async () => {
  const multiStudent = db.prepare(
    'SELECT student_id, COUNT(*) c FROM student_group_history WHERE end_date IS NULL GROUP BY student_id HAVING c > 1'
  ).all()
  assert.equal(multiStudent.length, 0, 'طالب بسجلات حلقة مفتوحة متعددة!')
  const multiGroup = db.prepare(
    'SELECT group_id, COUNT(*) c FROM group_teacher_history WHERE end_date IS NULL GROUP BY group_id HAVING c > 1'
  ).all()
  assert.equal(multiGroup.length, 0, 'حلقة بمعلمين مفتوحين متعددين!')
})

// ===== 13) النسخ الاحتياطي ينشئ ملفًا صالحًا =====
test('النسخ الاحتياطي: إنشاء نسخة من قاعدة الاختبار', async () => {
  const target = runBackup()
  assert.ok(fs.existsSync(target), 'لم يُنشأ ملف النسخة')
  assert.ok(fs.statSync(target).size > 0)
  fs.unlinkSync(target)
})
