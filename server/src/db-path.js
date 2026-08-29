// تحديد مسار قاعدة البيانات ومجلد النسخ حسب بيئة التشغيل.
// يفصل بوضوح بين بيئة التطوير وبيئة الإنتاج دون لمس بيئة التطوير الحالية.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// قارئ .env بسيط وآمن: يملأ متغيرات البيئة فقط إن لم تكن معرّفة مسبقًا،
// ولا يطبع أي قيم حساسة. (لا يعتمد على حزمة خارجية.)
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  const text = fs.readFileSync(envPath, 'utf8')
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    // لا نطغى على متغيرات البيئة المعرّفة مسبقًا (مثل تلك الممرّرة من الاختبارات).
    if (process.env[key] === undefined) process.env[key] = val
  }
}
loadEnv()

// يختار مسار قاعدة البيانات بوضوح وأمان حسب البيئة:
//   - DATABASE_PATH : أولوية قصوى (تجاوز صريح، تستخدمه الاختبارات عبر DB_PATH أيضًا)
//   - DB_PATH       : اسم قديم للتوافق مع الاختبارات الحالية
//   - الإنتاج       : ملف مستقل school.production.db
//   - غير ذلك       : ملف التطوير الحالي school.db
export function resolveDbPath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH
  if (process.env.DB_PATH) return process.env.DB_PATH
  if (process.env.NODE_ENV === 'production') {
    return path.join(__dirname, '..', 'school.production.db')
  }
  return path.join(__dirname, '..', 'school.db')
}

// مجلد النسخ الاحتياطي معزول حسب البيئة لمنع خلط بيانات التطوير والإنتاج.
export function resolveBackupDir() {
  const env = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  return path.join(__dirname, '..', 'backups', env)
}

export const isProduction = () => process.env.NODE_ENV === 'production'
