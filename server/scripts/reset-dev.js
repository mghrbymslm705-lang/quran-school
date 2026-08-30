// سكربت تفريغ قاعدة التطوير: يحذف كل البيانات ثم ينشئ مشرفًا واحدًا
// ليتمكن من الدخول وإدخال البيانات الحقيقية.
// الاستخدام: SETUP_USERNAME=admin SETUP_PASSWORD=xxx node scripts/reset-dev.js
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../src/db.js'
import { hashPassword } from '../src/auth.js'
import { uuid } from '../src/lib.js'

const TABLES = [
  'attendances',
  'memorization_records',
  'revision_records',
  'daily_records',
  'student_notes',
  'student_group_history',
  'group_teacher_history',
  'audit_logs',
  'groups',
  'teachers',
  'students',
  'users'
]

db.exec('PRAGMA foreign_keys = OFF')
for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run()
db.exec('PRAGMA foreign_keys = ON')

const username = process.env.SETUP_USERNAME || 'admin'
const password = process.env.SETUP_PASSWORD || 'Admin1234'

db.prepare(
  `INSERT INTO users (id, username, email, password_hash, full_name, role, status)
   VALUES (?, ?, ?, ?, ?, 'supervisor', 'active')`
).run(uuid(), username, null, hashPassword(password), 'المشرف')

// تنظيف قاعدة الإنتاج إن وُجدت (لضمان بداية نظيفة)
const prodPath = path.resolve(process.cwd(), '..', 'school.production.db')
if (fs.existsSync(prodPath)) {
  fs.rmSync(prodPath, { force: true })
  console.log('[reset] تم حذف قاعدة الإنتاج الموجودة')
}

console.log(`[reset] تم حذف كل البيانات. مشرف جاهز: ${username}`)
console.log('[reset] عدد المستخدمين الآن: ' + db.prepare('SELECT COUNT(*) c FROM users').get().c)
