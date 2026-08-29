// إعدادات مركزية للتطبيق — لا تُضمَّن أي روابط أو أسرار داخل الكود مباشرة.
// كل القيم تأتي من متغيرات البيئة (ملف server/.env أو متغيرات النظام).
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// قارئ .env بسيط وآمن (مطابق لنهج db-path): يملأ المتغيرات فقط إن لم تكن معرّفة مسبقًا،
// ولا يطبع أي قيم حساسة، ولا يعتمد على حزمة خارجية.
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
    if (process.env[key] === undefined) process.env[key] = val
  }
}
loadEnv()

export const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '212605706006'

export const environment = process.env.NODE_ENV || 'development'

// يحدد الرابط الرسمي الثابت للتطبيق.
// - إن وُجد APP_PUBLIC_URL يُستخدم كما هو (مع إزالة أي شرطة مائلة زائدة).
// - وإلا يُشتق من ترويسة Host والبروتوكول (مع افتراض https في الإنتاج).
// في الإنتاج يُمنع تمامًا ظهور localhost في روابط المشاركة؛ لذا نعتمد على اسم النطاق
// الحقيقي (ترويسة Host أو X-Forwarded-Proto خلف الوكيل العكسي).
export function resolvePublicUrl(req) {
  if (process.env.APP_PUBLIC_URL) {
    return process.env.APP_PUBLIC_URL.replace(/\/+$/, '')
  }
  const host = req && req.headers && req.headers.host
  if (host) {
    const proto = req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    return `${proto}://${host}`.replace(/\/+$/, '')
  }
  return ''
}
