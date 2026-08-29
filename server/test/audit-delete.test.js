// اختبارات حذف سجل التدقيق (المرحلة: إدارة البيانات والحذف الآمن).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

process.env.NODE_ENV = 'test'
const tmp = path.join(os.tmpdir(), `qs-audit-${Date.now()}.db`)
if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
process.env.DB_PATH = tmp

const { app } = await import('../src/server.js')
const { db } = await import('../src/db.js')
const { hashPassword } = await import('../src/auth.js')
const { uuid } = await import('../src/lib.js')

const login = (u, p) => request(app).post('/api/auth/login').send({ username: u, password: p })
const tokenFor = async (u, p) => (await login(u, p)).body.token
const get = (p, t) => request(app).get(p).set('Authorization', `Bearer ${t}`)
const del = (p, t, body) => request(app).delete(p).set('Authorization', `Bearer ${t}`).send(body || {})
const post = (p, t, body) => request(app).post(p).set('Authorization', `Bearer ${t}`).send(body || {})

let supToken, teacherToken, supUserId
const nowISO = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

function ins(table, obj) {
  const cols = Object.keys(obj)
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  db.prepare(sql).run(...cols.map((c) => obj[c]))
}

before(async () => {
  supUserId = uuid()
  ins('users', {
    id: supUserId,
    username: 'sup_aud',
    email: 's@x.com',
    password_hash: hashPassword('sup1234'),
    full_name: 'المشرف',
    role: 'supervisor',
    status: 'active'
  })
  const tUid = uuid()
  ins('users', {
    id: tUid,
    username: 'tech_aud',
    email: 't@x.com',
    password_hash: hashPassword('tech1234'),
    full_name: 'أستاذ محمد',
    role: 'teacher',
    status: 'active'
  })
  ins('teachers', { id: uuid(), user_id: tUid, full_name: 'أستاذ محمد', status: 'active' })
  supToken = await tokenFor('sup_aud', 'sup1234')
  teacherToken = await tokenFor('tech_aud', 'tech1234')
})

// ===== المعاينة قبل الحذف =====
test('معاينة الحذف عبر ids لا تحذف فعليًا وتعيد العدد وأقدم/أحدث سجل', async () => {
  const id = uuid()
  ins('audit_logs', { id, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2020-01-01 10:00:00' })
  const r = await post('/api/audit/preview-delete', supToken, { ids: [id] })
  assert.equal(r.status, 200)
  assert.equal(r.body.count, 1)
  assert.ok('oldest' in r.body && 'newest' in r.body)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id).c, 1, 'يجب ألا يحذف المعاينة')
})

test('معاينة الحذف عبر فترة مخصصة لا تحذف', async () => {
  const r = await post('/api/audit/preview-delete', supToken, { from: '2019-01-01', to: '2020-06-01' })
  assert.equal(r.status, 200)
  assert.ok(r.body.count >= 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c, 1, 'لا يجب أن يتغير عدد السجلات الكلي')
})

// ===== حذف سجل واحد =====
test('حذف سجل واحد (مشرف) مع تأكيد ونافذة احتياطية', async () => {
  const id = uuid()
  ins('audit_logs', { id, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2020-02-02 10:00:00' })
  const noConfirm = await del(`/api/audit/${id}`, supToken, {})
  assert.equal(noConfirm.status, 400)
  const yes = await del(`/api/audit/${id}`, supToken, { confirmText: 'حذف', backup: true })
  assert.equal(yes.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id).c, 0)
})

test('المعلم ممنوع من حذف سجل تدقيق واحد (403)', async () => {
  const id = uuid()
  ins('audit_logs', { id, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2020-03-03 10:00:00' })
  const r = await del(`/api/audit/${id}`, teacherToken, { confirmText: 'حذف' })
  assert.equal(r.status, 403)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id).c, 1)
})

test('حذف سجل غير موجود يرجع 404', async () => {
  const r = await del(`/api/audit/${uuid()}`, supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 404)
})

// ===== الحذف الجماعي =====
test('حذف جماعي بواسطة ids يحذف المحدد فقط', async () => {
  const id1 = uuid()
  const id2 = uuid()
  ins('audit_logs', { id: id1, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: nowISO() })
  ins('audit_logs', { id: id2, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: nowISO() })
  const no = await del('/api/audit/bulk', supToken, { ids: [id1] })
  assert.equal(no.status, 400)
  const yes = await del('/api/audit/bulk', supToken, { ids: [id1], confirmText: 'حذف' })
  assert.equal(yes.status, 200)
  assert.equal(yes.body.deleted, 1)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id1).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id2).c, 1)
})

test('حذف جماعي بواسطة فترة مخصصة', async () => {
  const id1 = uuid()
  const id2 = uuid()
  ins('audit_logs', { id: id1, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2019-05-05 10:00:00' })
  ins('audit_logs', { id: id2, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: nowISO() })
  const yes = await del('/api/audit/bulk', supToken, { from: '2019-01-01', to: '2020-01-01', confirmText: 'حذف' })
  assert.equal(yes.status, 200)
  assert.ok(yes.body.deleted >= 1)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id1).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id2).c, 1)
})

test('حذف جماعي بالفترة (olderThan) يحذف القديم ويبقي الحديث', async () => {
  const oldId = uuid()
  const newId = uuid()
  ins('audit_logs', { id: oldId, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2018-01-01 10:00:00' })
  ins('audit_logs', { id: newId, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: nowISO() })
  const yes = await del('/api/audit/bulk', supToken, { olderThan: '30d', confirmText: 'حذف' })
  assert.equal(yes.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(oldId).c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(newId).c, 1)
})

test('الحذف الكلي بدون فلتر مرفوض (400)', async () => {
  const r = await del('/api/audit/bulk', supToken, { confirmText: 'حذف' })
  assert.equal(r.status, 400)
})

test('المعلم ممنوع من الحذف الجماعي (403)', async () => {
  const id = uuid()
  ins('audit_logs', { id, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2018-01-01 10:00:00' })
  const r = await del('/api/audit/bulk', teacherToken, { ids: [id], confirmText: 'حذف' })
  assert.equal(r.status, 403)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE id = ?').get(id).c, 1)
})

// ===== سلامة البيانات الأصلية + عدم كشف كلمات المرور =====
test('حذف سجل تدقيق لا يؤثر على الكيان الأصلي (الطالب)', async () => {
  const sid = uuid()
  ins('students', { id: sid, student_code: 'AX1', full_name: 'أحمد محمد', enrollment_date: '2025-01-01', status: 'active' })
  const id = uuid()
  ins('audit_logs', { id, user_id: supUserId, action: 'update', entity_type: 'student', entity_id: sid, created_at: '2018-01-01 10:00:00' })
  await del('/api/audit/bulk', supToken, { ids: [id], confirmText: 'حذف' })
  assert.equal(db.prepare('SELECT COUNT(*) c FROM students WHERE id = ?').get(sid).c, 1, 'يجب بقاء الطالب')
})

test('سجل تغيير كلمة المرور لا يكشف كلمة المرور أو hash', async () => {
  const id = uuid()
  ins('audit_logs', {
    id,
    user_id: supUserId,
    action: 'reset_password',
    entity_type: 'user',
    entity_id: supUserId,
    old_data: '{}',
    new_data: JSON.stringify({ reset: true }),
    created_at: '2018-01-01 10:00:00'
  })
  const r = await get('/api/audit?action=reset_password', supToken)
  assert.equal(r.status, 200)
  const row = r.body.rows.find((x) => x.id === id)
  assert.ok(row, 'يجب أن يظهر سجل تغيير كلمة المرور')
  assert.equal(row.new_data.reset, true)
  assert.ok(!('password_hash' in row.new_data), 'لا يجب كشف password_hash')
  assert.ok(!('hash' in row.new_data), 'لا يجب كشف hash')
})

// ===== تسجيل ملخّص التنظيف (دون حلقة لا نهائية) =====
test('تنظيف السجلات يسجّل سجلًا موجزًا واحدًا (دون حلقة لا نهائية)', async () => {
  const before = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action=?").get('bulk_delete').c
  const oldId = uuid()
  ins('audit_logs', { id: oldId, user_id: supUserId, action: 'login', entity_type: 'user', entity_id: supUserId, created_at: '2018-01-01 10:00:00' })
  await del('/api/audit/bulk', supToken, { olderThan: '30d', confirmText: 'حذف' })
  const after = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action=?").get('bulk_delete').c
  // بعد الحذف يُضاف سجل bulk_delete واحد (السجلات القديمة المحذوفة لم تُعِد إنشاء سجلات)
  assert.equal(after, before + 1, 'يجب إضافة سجل bulk_delete واحد فقط')
})
