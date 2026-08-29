// يولّد ملف version.json داخل dist بعد كل بناء، ليتمكن التطبيق من اكتشاف
// الإصدارات الجديدة ومطالبة المستخدم بالتحديث. يُستدعى من سكربت البناء.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.cwd(), 'dist')
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

const version = `${new Date().toISOString()}·${Math.random().toString(36).slice(2, 8)}`
writeFileSync(
  resolve(distDir, 'version.json'),
  JSON.stringify({ version, generatedAt: new Date().toISOString() }, null, 2),
  'utf8'
)
console.log('[version] wrote dist/version.json ->', version)
