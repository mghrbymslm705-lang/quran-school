import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerRoutes } from './routes.js'
import { seed } from './seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json())

// بيانات تجريبية: تُنشأ تلقائيًا عند أول تشغيل فقط (عندما تكون القاعدة فارغة)،
// في التطوير والإنتاج على السواء، وتُتخطّى تلقائيًا إن وُجدت بيانات. انظر seed.js.
seed()
registerRoutes(app)

// في الإنتاج يخدم الخادم نفسه الواجهة المبنية (dist) على نفس الرابط الثابت،
// فيكون التطبيق نسخة مركزية واحدة لكل المستخدمين (لا نسخ مستقلة لكل معلم).
// في التطوير يبقى عمل الواجهة عبر خادم Vite (مع وكيل /api) دون مساس.
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '..', '..', 'dist')
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        if (path.basename(filePath) === 'version.json') {
          res.setHeader('Cache-Control', 'no-store')
        }
      }
    })
  )
  // ملف إصدار التطبيق — لا يُخزَّن مؤقتًا حتى تُكتشف التحديثات فورًا.
  app.get('/version.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(path.join(distDir, 'version.json'))
  })
  // كل المسارات غير المعروفة تُعيد صفحة الدخول (SPA) فيرى المستخدم شاشة تسجيل الدخول مباشرة.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// معالج أخطاء عام: يمنع تسريب تفاصيل الخطأ (مثل أخطاء SQL) للمستخدم النهائي،
// ويسجّل التفاصيل في الخادم فقط. يُركّب بعد كل المسارات.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server error]', err && err.stack ? err.stack : err)
  if (res.headersSent) return
  res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقًا أو التواصل مع المسؤول.' })
})

const PORT = process.env.PORT || 4000
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`مخدّم المدرسة القرآنية يعمل على المنفذ ${PORT}`)
  })
}

export { app }
