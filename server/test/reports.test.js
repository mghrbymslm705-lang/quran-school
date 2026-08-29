// اختبارات المرحلة العاشرة: مركز التقارير المركزي للمشرف.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-reports-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')
const { db } = await import('../src/db.js')

const login = (u, p) => request(app).post('/api/auth/login').send({ username: u, password: p })
const tokenFor = async (u, p) => (await login(u, p)).body.token
const get = (p, t, q) => request(app).get(p + (q ? '?' + q : '')).set('Authorization', `Bearer ${t}`)

const D = '2025-05-05'
let admin, t1
let G1, G2, G3, T1, T2
let S1, S2, S3, S4, S5, S6

function ins(table, obj) {
  const cols = Object.keys(obj)
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  db.prepare(sql).run(...cols.map((c) => obj[c]))
}

function makeStudent(code, name, groupId, teacherId, enrollment, historyStart) {
  const id = randomUUID()
  ins('students', {
    id,
    student_code: code,
    full_name: name,
    enrollment_date: enrollment,
    status: 'active',
    phone: '0500000000',
    address: ' شارع الخصوصية',
    family_contact: 'والد الطالب'
  })
  ins('student_group_history', {
    id: randomUUID(),
    student_id: id,
    group_id: groupId,
    teacher_id: teacherId,
    start_date: historyStart,
    end_date: null,
    reason: null
  })
  return id
}

function makeDaily(studentId, groupId, teacherId, att, mem, rev, note, amount) {
  const recId = randomUUID()
  ins('daily_records', {
    id: recId,
    student_id: studentId,
    teacher_id: teacherId,
    group_id: groupId,
    record_date: D,
    note: note || null
  })
  ins('attendances', { id: randomUUID(), daily_record_id: recId, status: att, note: null })
  ins('memorization_records', {
    id: randomUUID(),
    daily_record_id: recId,
    status: mem,
    amount: amount || null,
    mastery_status: mem === 'heard' ? 'mastered' : 'not_evaluated',
    note: null
  })
  ins('revision_records', { id: randomUUID(), daily_record_id: recId, status: rev, amount: null, quality: 'not_evaluated', note: null })
}

before(async () => {
  admin = await tokenFor('admin', 'admin123')
  t1 = await tokenFor('teacher1', 'teacher123')
  const t1uid = db.prepare("SELECT id FROM users WHERE username='teacher1'").get().id
  const t2uid = db.prepare("SELECT id FROM users WHERE username='teacher2'").get().id
  T1 = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(t1uid).id
  T2 = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(t2uid).id

  G1 = randomUUID()
  G2 = randomUUID()
  G3 = randomUUID()
  ins('groups', { id: G1, name: 'حلقة تجريب 1', teacher_id: T1, status: 'active' })
  ins('groups', { id: G2, name: 'حلقة تجريب 2', teacher_id: T2, status: 'active' })
  ins('groups', { id: G3, name: 'حلقة تجريب 3', teacher_id: T1, status: 'active' })

  S1 = makeStudent('R001', 'أحمد التجريبي', G1, T1, '2025-01-01', '2025-01-01')
  S2 = makeStudent('R002', 'سعيد التجريبي', G1, T1, '2025-01-01', '2025-01-01')
  S3 = makeStudent('R003', 'فهد التجريبي', G1, T1, '2025-01-01', '2025-01-01')
  S4 = makeStudent('R004', 'خالد التجريبي', G1, T1, '2025-01-01', '2025-01-01')
  S5 = makeStudent('R005', 'وليد التجريبي', G2, T2, '2025-01-01', '2025-01-01')
  S6 = makeStudent('R006', 'سلمان التجريبي', G2, T2, '2025-01-01', '2025-01-01')

  makeDaily(S1, G1, T1, 'on_time', 'heard', 'reviewed', 'ملاحظة مهمة للأحمد', '3')
  makeDaily(S2, G1, T1, 'late', 'not_heard', 'not_reviewed', null, null)
  makeDaily(S4, G1, T1, 'excused_absent', 'heard', 'reviewed', null, null)
  makeDaily(S5, G2, T2, 'on_time', 'heard', 'reviewed', null, '5')
})

// 1) المشرف يرى التقرير الكامل
test('المشرف يرى التقرير اليومي الكامل', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D)
  assert.equal(r.status, 200)
  assert.ok(r.body.rows.length >= 6)
})

// 2) المعلم لا يستطيع الوصول إلى مركز التقارير
test('المعلم محظور من مركز التقارير (403)', async () => {
  const r = await get('/api/reports/daily', t1, 'date=' + D)
  assert.equal(r.status, 403)
})

// 3) التقرير يجمع بيانات عدة حلقات
test('التقرير يجمع بيانات عدة حلقات', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D)
  const names = r.body.rows.map((x) => x.group_name)
  assert.ok(names.includes('حلقة تجريب 1'))
  assert.ok(names.includes('حلقة تجريب 2'))
})

// 4) التقرير يجمع بيانات عدة محفظين
test('التقرير يجمع بيانات عدة محفظين', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D)
  const teachers = r.body.rows.map((x) => x.teacher_name)
  assert.ok(teachers.length >= 2)
})

// 5) فلتر الحلقة يعمل
test('فلتر الحلقة يعمل', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D + '&group_id=' + G1)
  assert.equal(r.body.summary.total_students, 4)
  assert.ok(r.body.rows.every((x) => x.group_name === 'حلقة تجريب 1'))
})

// 6) فلتر المحفظ يعمل
test('فلتر المحفظ يعمل', async () => {
  const t2name = db.prepare('SELECT full_name FROM teachers WHERE id = ?').get(T2).full_name
  const r = await get('/api/reports/daily', admin, 'date=' + D + '&teacher_id=' + T2)
  assert.ok(r.body.rows.length >= 2)
  assert.ok(r.body.rows.every((x) => x.teacher_name === t2name))
  const ids = r.body.rows.map((x) => x.student_id)
  assert.ok(ids.includes(S5))
  assert.ok(ids.includes(S6))
})

// 7) فلتر التاريخ يعمل (تاريخ بلا سجلات يرجع الكل كغير مسجّل)
test('فلتر التاريخ يعمل', async () => {
  const r = await get('/api/reports/daily', admin, 'date=2020-01-01')
  assert.equal(r.status, 200)
  assert.ok(r.body.rows.every((x) => x.recorded === false))
  assert.equal(r.body.summary.registered, 0)
})

// 8) الطالب غير المسجل يظهر كـ not_recorded
test('الطالب غير المسجل يظهر كـ not_recorded', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D + '&student_id=' + S3)
  const row = r.body.rows.find((x) => x.student_id === S3)
  assert.ok(row)
  assert.equal(row.recorded, false)
  assert.equal(row.attendance, 'not_recorded')
})

// 9-11) not_recorded لا يحسب غيابًا/لم يسمع/لم يراجع
test('not_recorded لا يُحسب لا غيابًا ولا سماعًا ولا مراجعة', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D + '&group_id=' + G1)
  const s = r.body.summary
  assert.equal(s.on_time, 1) // S1
  assert.equal(s.late, 1) // S2
  assert.equal(s.excused, 1) // S4
  assert.equal(s.not_recorded_att, 1) // S3
  assert.equal(s.heard, 2) // S1,S4
  assert.equal(s.not_heard, 1) // S2
})

// 12) الإحصائيات مطابقة لقاعدة البيانات
test('إحصائيات التقرير مطابقة لقاعدة البيانات (حلقة 1)', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D + '&group_id=' + G1)
  const s = r.body.summary
  assert.equal(s.total_students, 4)
  assert.equal(s.registered, 3)
  assert.equal(s.not_registered, 1)
  assert.equal(s.on_time + s.late + s.excused + s.not_recorded_att, 4)
  assert.equal(s.heard + s.not_heard + s.not_recorded_mem, 4)
  assert.equal(s.reviewed + s.not_reviewed + s.not_recorded_rev, 4)
})

// 13) تقرير الطالب الدوري صحيح
test('تقرير الطالب الدوري صحيح', async () => {
  const r = await get('/api/reports/student', admin, 'student_id=' + S1 + '&range=custom&from=' + D + '&to=' + D)
  assert.equal(r.status, 200)
  const d = r.body
  assert.equal(d.recorded_days, 1)
  assert.equal(d.on_time, 1)
  assert.equal(d.heard, 1)
  assert.equal(d.reviewed, 1)
  assert.equal(d.unrecorded_days, 0)
  assert.equal(d.memorization_amount_sum, 3)
})

// 14) تقرير الحلقة صحيح + نسبة الالتزام
test('تقرير الحلقة صحيح ونسبة الالتزام محسوبة', async () => {
  const r = await get('/api/reports/circle', admin, 'group_id=' + G1 + '&from=' + D + '&to=' + D)
  assert.equal(r.status, 200)
  const rows = r.body.students
  assert.equal(rows.length, 4)
  const s1 = rows.find((x) => x.student_id === S1)
  assert.equal(s1.commitment_rate, 100) // المحاور الثلاثة مسجّلة
  const s3 = rows.find((x) => x.student_id === S3)
  assert.equal(s3.commitment_rate, 0) // لم يُسجَّل
  assert.equal(s3.required_days, 1)
})

// 15-17) لا تظهر بيانات الهاتف/العنوان/جهة الاتصال
test('لا تظهر بيانات الهاتف أو العنوان أو جهة الاتصال في التقرير', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D)
  const json = JSON.stringify(r.body)
  assert.ok(!json.includes('0500000000'))
  assert.ok(!json.includes('شارع الخصوصية'))
  assert.ok(!json.includes('والد الطالب'))
})

// 18) ملاحظات الطالب تظهر للمشرف
test('ملاحظات اليوم تظهر للمشرف', async () => {
  const r = await get('/api/reports/daily', admin, 'date=' + D)
  const row = r.body.rows.find((x) => x.student_id === S1)
  assert.ok(row.note.includes('ملاحظة مهمة'))
})

// 2ب) الأيام غير المسجلة لا تُحسب قبل التحاق الطالب
test('الأيام غير المسجلة لا تُحسب قبل التحاق الطالب بالحلقة', async () => {
  const lateStu = makeStudent('R901', 'متأخر الانضمام', G1, T1, '2025-05-20', '2025-05-20')
  const earlyStu = makeStudent('R902', 'مبكر الانضمام', G1, T1, '2025-05-01', '2025-05-01')
  const r = await get(
    '/api/reports/student',
    admin,
    'student_id=' + lateStu + '&range=custom&from=2025-05-01&to=2025-05-31'
  )
  assert.equal(r.body.required_days, 12) // من 20 إلى 31 مايو
  assert.equal(r.body.unrecorded_days, 12)
  const r2 = await get(
    '/api/reports/student',
    admin,
    'student_id=' + earlyStu + '&range=custom&from=2025-05-01&to=2025-05-31'
  )
  assert.equal(r2.body.required_days, 31)
})

// 20) الفترة المخصصة: كل من from و to موجودان → 200
test('الفترة المخصصة بـ from/to صحيحين ترجع 200', async () => {
  const r = await get('/api/reports/student', admin, `student_id=${S1}&range=custom&from=2025-01-01&to=2025-12-31`)
  assert.equal(r.status, 200)
  assert.equal(r.body.recorded_days, 1)
})

// 21) الفترة المخصصة بدون from → 400 برسالة عربية دقيقة
test('الفترة المخصصة بدون تاريخ البداية ترجع 400', async () => {
  const r = await get('/api/reports/student', admin, `student_id=${S1}&range=custom&to=2025-12-31`)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'يرجى اختيار تاريخ البداية.')
})

// 22) الفترة المخصصة بدون to → 400
test('الفترة المخصصة بدون تاريخ النهاية ترجع 400', async () => {
  const r = await get('/api/reports/student', admin, `student_id=${S1}&range=custom&from=2025-01-01`)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'يرجى اختيار تاريخ النهاية.')
})

// 23) from بعد to → 400
test('تاريخ البداية بعد تاريخ النهاية يرجع 400', async () => {
  const r = await get('/api/reports/student', admin, `student_id=${S1}&range=custom&from=2025-12-31&to=2025-01-01`)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية.')
})

// 24) تاريخ غير صالح → 400
test('تاريخ غير صالح في الفترة المخصصة يرجع 400', async () => {
  const r = await get('/api/reports/student', admin, `student_id=${S1}&range=custom&from=2025-13-40&to=2025-01-01`)
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'صيغة التاريخ غير صحيحة')
})

// 25) طالب موجود بفترة مخصصة لا تحتوي سجلات → 200 بأرقام صفرية
test('طالب بفترة مخصصة بلا سجلات يرجع 200 بأرقام صفرية', async () => {
  const r = await get('/api/reports/student', admin, `student_id=${S1}&range=custom&from=2020-01-01&to=2020-01-31`)
  assert.equal(r.status, 200)
  assert.equal(r.body.recorded_days, 0)
  assert.equal(r.body.on_time, 0)
  assert.equal(r.body.heard, 0)
  assert.equal(r.body.reviewed, 0)
  assert.equal(r.body.memorization_amount_sum, 0)
})

// 26) لا يظهر SQL أو stack trace في الردود
test('لا يظهر SQL أو stack trace في ردود أخطاء التقارير', async () => {
  const r = await get('/api/reports/student', admin, `student_id=${S1}&range=custom&from=2025-13-40&to=2025-01-01`)
  const txt = JSON.stringify(r.body)
  assert.ok(!/(SELECT|INSERT|UPDATE|DELETE|TypeError|SyntaxError|ReferenceError|stack|Trace)/i.test(txt))
})

// 27) المعلم محظور من تقرير الطالب (403)
test('المعلم محظور من تقرير الطالب (403)', async () => {
  const r = await get('/api/reports/student', t1, `student_id=${S1}&range=custom&from=2025-01-01&to=2025-12-31`)
  assert.equal(r.status, 403)
})

// 28) النطاقات 7/30/all لا تتأثر بالإصلاح
test('نطاقات 7 و30 وall تعمل بعد الإصلاح', async () => {
  for (const rng of ['7', '30', 'all']) {
    const r = await get('/api/reports/student', admin, `student_id=${S1}&range=${rng}`)
    assert.equal(r.status, 200, `range=${rng} يجب أن يرجع 200`)
    assert.ok(typeof r.body.recorded_days === 'number')
  }
})

// 19) الطباعة لا تعرض عناصر الواجهة — مغطاة بصنف .no-print في CSS (لا اختبار HTTP)
test('واجهة الطباعة تستبعد عناصر التنقل عبر صنف no-print', () => {
  // التحقق من وجود الصنف في ملف التنسيق
  const css = fs.readFileSync(path.join(process.cwd(), '..', 'src', 'styles.css'), 'utf8')
  assert.ok(css.includes('.no-print'))
  assert.ok(css.includes('@media print'))
})
