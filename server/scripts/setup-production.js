// إعداد أول مشرف في بيئة الإنتاج بشكل آمن.
//
// القواعد الأمنية:
//   - يُشغَّل في الإنتاج فقط (NODE_ENV=production).
//   - لا يُنشئ أي حساب بكلمة مرور افتراضية معروفة.
//   - يطلب اسم مستخدم وكلمة مرور قوية، ويُخزّنها عبر bcrypt (لا نص صريح).
//   - لا تُطبع أي كلمة مرور في السجلات.
//
// الاستخدام التفاعلي:
//   NODE_ENV=production node scripts/setup-production.js
// استخدام غير تفاعلي (للأتمتة):
//   NODE_ENV=production SETUP_USERNAME=admin SETUP_PASSWORD='كلمة-قوية' node scripts/setup-production.js
import readline from 'node:readline'

// لا نلمس بيئة التطوير أبدًا: نشترط الإنتاج صراحةً.
if (process.env.NODE_ENV !== 'production') {
  console.error('[setup] سكربت الإعداد مخصص لبيئة الإنتاج فقط.')
  console.error('[setup] شغّله بوضع الإنتاج: NODE_ENV=production node scripts/setup-production.js')
  process.exit(1)
}

function promptPassword(query) {
  return new Promise((resolve) => {
    process.stdout.write(query)
    let pwd = ''
    const stdin = process.stdin
    stdin.resume()
    stdin.setRawMode(true)
    const onData = (c) => {
      const ch = c.toString()
      if (ch === '\u0003') { stdin.setRawMode(false); process.exit(1) }
      if (ch === '\r' || ch === '\n') {
        process.stdout.write('\n')
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', onData)
        resolve(pwd)
      } else if (ch === '\u007f' || ch === '\b') {
        if (pwd.length > 0) { pwd = pwd.slice(0, -1); process.stdout.write('\b \b') }
      } else {
        pwd += ch
        process.stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

function ask(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(query, (a) => { rl.close(); resolve(a.trim()) })
  })
}

function isStrong(p) {
  return typeof p === 'string' && p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p)
}

async function main() {
  // استيراد ديناميكي بعد التأكد من بيئة الإنتاج (حتى يختار المسار الصحيح).
  const { db } = await import('../src/db.js')
  const { hashPassword } = await import('../src/auth.js')
  const { uuid } = await import('../src/lib.js')

  const existing = db
    .prepare("SELECT id FROM users WHERE role = 'supervisor' AND status = 'active'")
    .get()
  if (existing) {
    console.log('[setup] يوجد مشرف نشط بالفعل. الإعداد الأولي غير مطلوب.')
    process.exit(0)
  }

  let username = process.env.SETUP_USERNAME
  let fullName = process.env.SETUP_FULL_NAME || 'مشرف النظام'
  let password = process.env.SETUP_PASSWORD

  if (!username) {
    username = await ask('اسم مستخدم المشرف: ')
    password = await promptPassword('كلمة المرور (8+ أحرف وأرقام): ')
  }
  if (!username || !password) {
    console.error('[setup] اسم المستخدم وكلمة المرور مطلوبان.')
    process.exit(1)
  }
  if (!isStrong(password)) {
    console.error('[setup] كلمة المرور ضعيفة: يجب أن تكون 8 خانات على الأقل وتحتوي أحرفًا وأرقامًا.')
    process.exit(1)
  }

  const taken = db.prepare('SELECT id FROM users WHERE lower(username) = ?').get(String(username).trim().toLowerCase())
  if (taken) {
    console.error('[setup] اسم المستخدم مستخدم مسبقًا.')
    process.exit(1)
  }

  const id = uuid()
  db.prepare(
    'INSERT INTO users (id, username, email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, String(username).trim(), String(username).trim() + '@school.local', hashPassword(password), fullName, 'supervisor', 'active')

  console.log('[setup] تم إنشاء حساب المشرف بنجاح. يمكنك تسجيل الدخول باستخدام اسم المستخدم الذي أدخلته.')
  process.exit(0)
}

main().catch((e) => {
  console.error('[setup] فشل الإعداد:', e && e.message ? e.message : e)
  process.exit(1)
})
