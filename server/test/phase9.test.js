// اختبارات المرحلة التاسعة: فصل بيئة الإنتاج عن التطوير.
// تُشغَّل في عمليتها الخاصة مع NODE_ENV=production وقاعدة إنتاج مؤقتة.
process.env.NODE_ENV = 'production'
process.env.DB_PATH = undefined
const os = await import('node:os')
const path = await import('node:path')
process.env.DATABASE_PATH = path.join(os.tmpdir(), 'qs9-prod-' + Date.now() + '.db')

const test = (await import('node:test')).test
const assert = (await import('node:assert')).default

const dbPath = await import('../src/db-path.js')
const { db } = await import('../src/db.js')
const { seed } = await import('../src/seed.js')
const backup = await import('../scripts/backup.js')
const fs = (await import('node:fs')).default
const { DatabaseSync } = await import('node:sqlite')

function tables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
}
function indexes() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all().map((r) => r.name)
}
function usersCount() {
  return db.prepare('SELECT COUNT(*) c FROM users').get().c
}

// 1) التطوير يستخدم قاعدة التطوير
test('development يستخدم قاعدة التطوير (school.db)', () => {
  const prev = { ...process.env }
  try {
    delete process.env.DATABASE_PATH
    delete process.env.DB_PATH
    process.env.NODE_ENV = 'development'
    assert.ok(dbPath.resolveDbPath().endsWith('school.db'))
  } finally {
    Object.assign(process.env, prev)
  }
})

// 2) الإنتاج يستخدم قاعدة مستقلة
test('production يستخدم قاعدة مستقلة (school.production.db)', () => {
  const prev = { ...process.env }
  try {
    delete process.env.DATABASE_PATH
    delete process.env.DB_PATH
    process.env.NODE_ENV = 'production'
    const p = dbPath.resolveDbPath()
    assert.ok(p.endsWith('school.production.db'))
    assert.ok(!p.endsWith('school.db'))
  } finally {
    Object.assign(process.env, prev)
  }
})

// 3) الإنتاج لا يحتوي بيانات seed تلقائيًا
test('production لا يحتوي بيانات seed تلقائيًا', () => {
  assert.equal(usersCount(), 0)
  const t = db.prepare("SELECT id FROM students WHERE student_code = 'S001'").get()
  assert.equal(t, undefined)
})

// 4) seed يرفض العمل في production
test('seed يرفض العمل في production', () => {
  seed()
  assert.equal(usersCount(), 0)
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get()
  assert.equal(admin, undefined)
})

// 5) لا يوجد حساب admin/admin123 تلقائي في الإنتاج
test('لا يوجد حساب admin افتراضي في الإنتاج', () => {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get()
  assert.equal(admin, undefined)
})

// 6) قاعدة الإنتاج تحتوي على جميع الجداول اللازمة
test('قاعدة الإنتاج تحتوي على جميع الجداول', () => {
  const t = tables()
  for (const name of [
    'users', 'teachers', 'students', 'groups', 'student_group_history',
    'daily_records', 'attendances', 'memorization_records', 'revision_records',
    'student_notes', 'audit_logs', 'group_teacher_history', '_migrations'
  ]) {
    assert.ok(t.includes(name), 'جدول مفقود: ' + name)
  }
})

// 7) قاعدة الإنتاج تحتوي على الفهارس اللازمة
test('قاعدة الإنتاج تحتوي على الفهارس', () => {
  const idx = indexes()
  for (const name of [
    'idx_daily_records_date', 'idx_daily_records_group_date',
    'idx_student_group_history_student', 'idx_audit_logs_created', 'idx_attendances_record'
  ]) {
    assert.ok(idx.includes(name), 'فهرس مفقود: ' + name)
  }
})

// 8) النسخ الاحتياطي يستهدف قاعدة الإنتاج الصحيحة (مجلد منفصل)
test('النسخ الاحتياطي يستهدف قاعدة الإنتاج (backups/production)', () => {
  const target = backup.runBackup()
  assert.ok(target.includes(path.join('backups', 'production')))
  assert.ok(fs.existsSync(target))
  // النسخة نسخة SQLite صالحة
  const copy = new DatabaseSync(target)
  assert.ok(copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get())
  copy.close()
})

// 9) فشل الإعداد (وضع غير إنتاجي) لا يلمس قاعدة التطوير
test('فشل الإعداد في غير الإنتاج لا ينشئ/يحذف قاعدة التطوير', async () => {
  const { spawnSync } = await import('node:child_process')
  const devDb = path.join(os.tmpdir(), 'qs9-dev-untouched-' + Date.now() + '.db')
  const r = spawnSync('node', ['--experimental-sqlite', 'scripts/setup-production.js'], {
    cwd: path.join(process.cwd()),
    env: { ...process.env, NODE_ENV: 'development', DATABASE_PATH: devDb },
    encoding: 'utf8'
  })
  assert.notEqual(r.status, 0)
  // لم يُنشأ أي ملف لقاعدة التطوير (السكربت رفض قبل لمس أي قاعدة)
  assert.equal(fs.existsSync(devDb), false)
})

// 9ب) الإعداد الآمن ينشئ مشرفًا دون كلمة افتراضية (إنتاج)
test('الإعداد الآمن ينشئ مشرفًا في الإنتاج بكلمة قوية', async () => {
  const { spawnSync } = await import('node:child_process')
  const prodDb = path.join(os.tmpdir(), 'qs9-prod-setup-' + Date.now() + '.db')
  const r = spawnSync('node', ['--experimental-sqlite', 'scripts/setup-production.js'], {
    cwd: path.join(process.cwd()),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_PATH: prodDb,
      SETUP_USERNAME: 'boss',
      SETUP_PASSWORD: 'Str0ngPass!23'
    },
    encoding: 'utf8'
  })
  assert.equal(r.status, 0, r.stderr)
  const d = new DatabaseSync(prodDb)
  const u = d.prepare("SELECT username, password_hash, role, status FROM users WHERE username='boss'").get()
  assert.ok(u, 'لم يُنشأ المشرف')
  assert.equal(u.role, 'supervisor')
  assert.equal(u.status, 'active')
  assert.notEqual(u.password_hash, 'Str0ngPass!23')
  assert.ok(u.password_hash.length > 20)
  d.close()
  fs.rmSync(prodDb, { force: true })
})
