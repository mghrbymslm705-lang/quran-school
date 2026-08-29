// سكربت تفريغ قاعدة التطوير: يحذف كل البيانات التجريبية ثم ينشئ مشرفًا واحدًا
// لتتمكن من الدخول وإدخال البيانات الحقيقية. يمنع إعادة التوليد التجريبي
// لأن وجود مستخدم مشرف يجعل دالة seed تتخطى الإنشاء.
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

// مشرف واحد لتسجيل الدخول (غيّر كلمته لاحقًا عبر الإعدادات أو سكربت منفصل)
db.prepare(
  `INSERT INTO users (id, username, email, password_hash, full_name, role, status)
   VALUES (?, ?, ?, ?, ?, 'supervisor', 'active')`
).run(uuid(), 'admin', null, hashPassword('admin123'), 'المشرف')

// تنظيف قاعدة الإنتاج إن وُجدت (لضمان بداية نظيفة)
const prodPath = path.resolve(process.cwd(), '..', 'school.production.db')
if (fs.existsSync(prodPath)) {
  fs.rmSync(prodPath, { force: true })
  console.log('[reset] تم حذف قاعدة الإنتاج الموجودة')
}

console.log('[reset] تم حذف كل البيانات التجريبية. مشرف جاهز: admin / admin123')
console.log('[reset] عدد المستخدمين الآن: ' + db.prepare('SELECT COUNT(*) c FROM users').get().c)
