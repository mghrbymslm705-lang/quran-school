// طبقة قاعدة البيانات (SQLite عبر node:sqlite)
// جميع الجداول والعلاقات والقيود مُعرّفة هنا.
// لا يوجد أي حذف نهائي للطلاب؛ الأرشفة هي الآلية المعتمدة.

import { DatabaseSync } from 'node:sqlite'
import { resolveDbPath } from './db-path.js'

const DB_PATH = resolveDbPath()

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA foreign_keys = ON;')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('supervisor','teacher')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teachers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id              TEXT PRIMARY KEY,
  student_code    TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  date_of_birth   TEXT,
  enrollment_date TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','transferred','withdrawn','archived')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT,
  teacher_id  TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_group_history (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id  TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_records (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id    TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  group_id      TEXT REFERENCES groups(id) ON DELETE SET NULL,
  record_date   TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, record_date)
);

CREATE TABLE IF NOT EXISTS attendances (
  id               TEXT PRIMARY KEY,
  daily_record_id  TEXT NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'not_recorded'
                   CHECK (status IN ('present','absent','excused_absent','not_recorded')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memorization_records (
  id               TEXT PRIMARY KEY,
  daily_record_id  TEXT NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'no_lawh'
                   CHECK (status IN ('heard','not_heard','no_lawh')),
  amount           TEXT,
  mastery_status   TEXT CHECK (mastery_status IN ('mastered','needs_review','not_evaluated')),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revision_records (
  id               TEXT PRIMARY KEY,
  daily_record_id  TEXT NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'not_evaluated'
                   CHECK (status IN ('reviewed','not_reviewed','not_evaluated')),
  amount           TEXT,
  quality          TEXT CHECK (quality IN ('good','average','weak','not_evaluated')),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_notes (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id   TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  note         TEXT NOT NULL,
  note_type    TEXT NOT NULL DEFAULT 'general'
               CHECK (note_type IN ('daily','pedagogical','administrative','general')),
  deleted_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  old_data     TEXT,
  new_data     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_teacher_history (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id   TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  reason       TEXT,
  assigned_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`

db.exec(SCHEMA)

// ============ التهجير الآمن للمرحلة الثالثة ============
// لا يُعيد إنشاء الجداول كل مرة، بل يُطبَّق مرة واحدة فقط.
db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)')
function migrated(name) {
  return db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)
}
function markMigration(name) {
  db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(name)
}

// إضافة حقول ملف الطالب (آمنة عند التكرار)
const studentColumns = [
  'nickname TEXT',
  'phone TEXT',
  'address TEXT',
  'family_contact TEXT',
  'health_status TEXT',
  'health_visible_to_teacher INTEGER DEFAULT 0',
  'behavior TEXT',
  'current_memorization TEXT',
  'current_memorization_status TEXT'
]
for (const col of studentColumns) {
  try {
    db.exec(`ALTER TABLE students ADD COLUMN ${col}`)
  } catch {
    // العمود موجود مسبقًا
  }
}

// إضافة ملاحظات إدارية لجدول المعلمين (آمنة عند التكرار)
const teacherColumns = ['admin_notes TEXT']
for (const col of teacherColumns) {
  try {
    db.exec(`ALTER TABLE teachers ADD COLUMN ${col}`)
  } catch {
    // العمود موجود مسبقًا
  }
}

// إضافة ملاحظة للسجل اليومي (آمنة عند التكرار)
const dailyColumns = ['note TEXT']
for (const col of dailyColumns) {
  try {
    db.exec(`ALTER TABLE daily_records ADD COLUMN ${col}`)
  } catch {
    // العمود موجود مسبقًا
  }
}

// إعادة تعريف جداول المحاور اليومية الثلاثة بالحالات الجديدة (مرة واحدة)
if (!migrated('v3_daily_axes')) {
  db.exec(`
    DROP TABLE IF EXISTS attendances;
    DROP TABLE IF EXISTS memorization_records;
    DROP TABLE IF EXISTS revision_records;

    CREATE TABLE attendances (
      id               TEXT PRIMARY KEY,
      daily_record_id  TEXT NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
      status           TEXT NOT NULL DEFAULT 'not_recorded'
                       CHECK (status IN ('on_time','late','excused_absent','not_recorded')),
      note             TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE memorization_records (
      id               TEXT PRIMARY KEY,
      daily_record_id  TEXT NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
      status           TEXT NOT NULL DEFAULT 'not_recorded'
                       CHECK (status IN ('heard','not_heard','not_recorded')),
      amount           TEXT,
      mastery_status   TEXT CHECK (mastery_status IN ('mastered','needs_review','not_evaluated')),
      note            TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE revision_records (
      id               TEXT PRIMARY KEY,
      daily_record_id  TEXT NOT NULL UNIQUE REFERENCES daily_records(id) ON DELETE CASCADE,
      status           TEXT NOT NULL DEFAULT 'not_recorded'
                       CHECK (status IN ('reviewed','not_reviewed','not_recorded')),
      amount           TEXT,
      quality          TEXT CHECK (quality IN ('good','average','weak','not_evaluated')),
      note            TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  markMigration('v3_daily_axes')
}

// فهارس لتحسين الأداء (آمنة عند التكرار)
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(record_date)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_daily_records_group_date ON daily_records(group_id, record_date)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_student_group_history_student ON student_group_history(student_id, end_date)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_attendances_record ON attendances(daily_record_id)')
} catch {
  // تجاهل أي خطأ في الإفهرس
}

// ============ إعدادات المؤسسة ============
if (!migrated('v12_school_settings')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS school_settings (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      name          TEXT NOT NULL DEFAULT 'المدرسة القرآنية',
      description   TEXT DEFAULT '',
      address       TEXT DEFAULT '',
      phone         TEXT DEFAULT '',
      email         TEXT DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO school_settings (id, name) VALUES (1, 'المدرسة القرآنية');
  `)
  markMigration('v12_school_settings')
}

// عرض الطالب مع حلقته الحالية (مشتقّة من آخر سجل تاريخ نشط).
export const STUDENT_WITH_CURRENT_GROUP = `
  SELECT s.*,
         (SELECT group_id FROM student_group_history
            WHERE student_id = s.id AND end_date IS NULL
            ORDER BY start_date DESC LIMIT 1) AS current_group_id,
         (SELECT teacher_id FROM student_group_history
            WHERE student_id = s.id AND end_date IS NULL
            ORDER BY start_date DESC LIMIT 1) AS current_teacher_id
  FROM students s
`

export function nowISO() {
  return new Date().toISOString()
}

export default db
