// نسخ احتياطي لقاعدة البيانات — آمن للتشغيل أثناء عمل الخادم.
//
// يستهدف قاعدة البيئة الحالية فقط:
//   - development → ملف school.db + مجلد backups/development
//   - production  → ملف school.production.db + مجلد backups/production
// لا يخلط نسخ التطوير والإنتاج (مجلدات منفصلة).
//
// الاستخدام:
//   node scripts/backup.js              → إنشاء نسخة جديدة بطابع زمني
//   node scripts/backup.js restore <ملف> → استعادة نسخة (يحتفظ بنسخة من الحالية أولًا)
//
// الأمان: النسخة تُنشأ عبر VACUUM INTO (لقطة متسقة حتى أثناء الكتابة على القاعدة)،
// ولا تُطبع أي بيانات حساسة (أسماء الملفات فقط).
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { resolveDbPath, resolveBackupDir } from '../src/db-path.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolveDbPath()
const BACKUP_DIR = resolveBackupDir()

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function quote(p) {
  return `'${String(p).replace(/'/g, "''")}'`
}

// نسخة متسقة وآمنة عبر VACUUM INTO (تعمل حتى لو القاعدة مفتوحة وقيد الكتابة).
function safeCopy(sourceDbPath, targetPath) {
  const src = new DatabaseSync(sourceDbPath)
  try {
    src.exec(`VACUUM INTO ${quote(targetPath)}`)
  } finally {
    src.close()
  }
}

export function runBackup() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('قاعدة البيانات غير موجودة بعد:', DB_PATH)
    process.exit(1)
  }
  ensureDir()
  const target = path.join(BACKUP_DIR, `school-${stamp()}.db`)
  safeCopy(DB_PATH, target)
  console.log('تم إنشاء نسخة احتياطية:', target)
  console.log('للاستعادة: node scripts/backup.js restore', target)
  return target
}

export function runRestore(src) {
  if (!src) {
    console.error('حدّد مسار ملف النسخة: node scripts/backup.js restore <ملف>')
    process.exit(1)
  }
  if (!fs.existsSync(src)) {
    console.error('ملف النسخة غير موجود:', src)
    process.exit(1)
  }
  ensureDir()
  if (fs.existsSync(DB_PATH)) {
    const before = path.join(BACKUP_DIR, `school-before-restore-${stamp()}.db`)
    safeCopy(DB_PATH, before)
    fs.rmSync(DB_PATH)
    console.log('تم أخذ نسخة من الحالية قبل الاستعادة:', before)
  }
  safeCopy(src, DB_PATH)
  console.log('تمت الاستعادة من:', src)
}

// التشغيل المباشر فقط (عند الاستدعاء كسكربت، لا عند الاستيراد من الاختبارات).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  if (process.argv[2] === 'restore') {
    runRestore(process.argv[3])
  } else {
    runBackup()
  }
}
