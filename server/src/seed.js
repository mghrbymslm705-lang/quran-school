// بيانات تجريبية واضحة ومميزة (DEMO) — لا تحتوي على بيانات شخصية حقيقية.
// تُستخدم للاختبار فقط وتُنشأ عند تشغيل الخادم لأول مرة إذا كانت القاعدة فارغة.
import { db } from './db.js'
import { hashPassword } from './auth.js'
import { uuid, todayStr } from './lib.js'

function seed() {
  // ممنوع تشغيل بيانات تجريبية في الإنتاج (أمان): يتوقف بأمان مع رسالة واضحة.
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed] ممنوع تشغيل بيانات تجريبية في بيئة الإنتاج. تم إيقاف التنفيذ بأمان.')
    return
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = 'admin'").get()
  if (existing) {
    console.log('[seed] البيانات التجريبية موجودة مسبقًا، تم تخطي الإنشاء.')
    return
  }

  const adminId = uuid()
  db.prepare('INSERT INTO users (id, username, email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(adminId, 'admin', 'admin@school.edu', hashPassword('admin123'), 'أ. محمد العتيبي', 'supervisor', 'active')

  const teachers = [
    { username: 'teacher1', name: 'أ. عبدالله الحمدان', phone: '0501112222', status: 'active' },
    { username: 'teacher2', name: 'أ. سارة القحطاني', phone: '0503334444', status: 'active' },
    { username: 'teacher3', name: 'أ. خالد المطيري', phone: '0505556666', status: 'inactive' }
  ]
  const teacherIds = {}
  for (const t of teachers) {
    const uid = uuid()
    const tid = uuid()
    db.prepare('INSERT INTO users (id, username, email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, t.username, t.username + '@school.edu', hashPassword('teacher123'), t.name, 'teacher', t.status)
    db.prepare('INSERT INTO teachers (id, user_id, full_name, phone, status) VALUES (?, ?, ?, ?, ?)')
      .run(tid, uid, t.name, t.phone, t.status)
    teacherIds[t.username] = { tid, uid }
  }

  const groups = [
    { name: 'حلقة الصباح', code: 'G1', teacher: 'teacher1' },
    { name: 'حلقة المساء', code: 'G2', teacher: 'teacher1' },
    { name: 'حلقة العصر', code: 'G3', teacher: 'teacher2' }
  ]
  const groupIds = {}
  for (const g of groups) {
    const gid = uuid()
    const t = teacherIds[g.teacher]
    db.prepare('INSERT INTO groups (id, name, code, teacher_id, status) VALUES (?, ?, ?, ?, ?)')
      .run(gid, g.name, g.code, t ? t.tid : null, 'active')
    groupIds[g.code] = { gid, tid: t ? t.tid : null }
    // تسجيل تاريخ إسناد المعلم للحلقة منذ الإنشاء
    if (t) {
      db.prepare('INSERT INTO group_teacher_history (id, group_id, teacher_id, start_date, reason, assigned_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuid(), gid, t.tid, '2024-09-01', 'enrollment', adminId)
    }
  }

  // 10 طلاب موزّعين على الحلقات (أسماء توضيحية غير حقيقية)
  const students = [
    { name: 'يوسف الراشد', code: 'S001', group: 'G1' },
    { name: 'عمر السبيعي', code: 'S002', group: 'G1' },
    { name: 'محمد الزهراني', code: 'S003', group: 'G1' },
    { name: 'أحمد القرني', code: 'S004', group: 'G1' },
    { name: 'عبدالرحمن الدوسري', code: 'S005', group: 'G2' },
    { name: 'سلمان العنزي', code: 'S006', group: 'G2' },
    { name: 'فيصل الحربي', code: 'S007', group: 'G2' },
    { name: 'نواف الشمري', code: 'S008', group: 'G3' },
    { name: 'ريان الغامدي', code: 'S009', group: 'G3' },
    { name: 'طلال المطيري', code: 'S010', group: 'G3' }
  ]
  const enroll = '2024-09-01'
  // حقول خاصة/إدارية تجريبية (غير حقيقية) لاختبار الخصوصية
  const privateDemo = [
    { phone: '0501110001', health: 'لا توجد', healthVisible: 0, behavior: 'ملتزم', mem: 'سورة الفاتحة', memStatus: 'mastered' },
    { phone: '0501110002', health: 'حساسية بسيطة (مسموح العرض)', healthVisible: 1, behavior: 'متعاون', mem: 'سورة البقرة', memStatus: 'needs_review' },
    { phone: '0501110003', health: 'لا توجد', healthVisible: 0, behavior: 'ملتزم', mem: 'سورة آل عمران', memStatus: 'not_evaluated' },
    { phone: '0501110004', health: 'لا توجد', healthVisible: 0, behavior: 'جيد', mem: 'سورة النساء', memStatus: 'not_evaluated' },
    { phone: '0501110005', health: 'لا توجد', healthVisible: 0, behavior: 'ملتزم', mem: 'سورة المائدة', memStatus: 'not_evaluated' },
    { phone: '0501110006', health: 'لا توجد', healthVisible: 0, behavior: 'جيد', mem: 'سورة الأنعام', memStatus: 'not_evaluated' },
    { phone: '0501110007', health: 'لا توجد', healthVisible: 0, behavior: 'ملتزم', mem: 'سورة الأعراف', memStatus: 'not_evaluated' },
    { phone: '0501110008', health: 'لا توجد', healthVisible: 0, behavior: 'ممتاز', mem: 'سورة يونس', memStatus: 'not_evaluated' },
    { phone: '0501110009', health: 'لا توجد', healthVisible: 0, behavior: 'جيد', mem: 'سورة هود', memStatus: 'not_evaluated' },
    { phone: '0501110010', health: 'لا توجد', healthVisible: 0, behavior: 'ملتزم', mem: 'سورة يوسف', memStatus: 'not_evaluated' }
  ]
  students.forEach((s, idx) => {
    const sid = uuid()
    const p = privateDemo[idx] || privateDemo[0]
    db.prepare(
      `INSERT INTO students (id, student_code, full_name, enrollment_date, status, nickname, phone, address, family_contact, health_status, health_visible_to_teacher, behavior, current_memorization, current_memorization_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sid, s.code, s.name, enroll, 'active',
      null, p.phone, 'عنوان تجريبي', 'ولي الأمر تجريبي', p.health, p.healthVisible, p.behavior, p.mem, p.memStatus
    )
    const g = groupIds[s.group]
    db.prepare('INSERT INTO student_group_history (id, student_id, group_id, teacher_id, start_date, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuid(), sid, g.gid, g.tid, enroll, 'enrollment')
  })

  // سجلات يومية تجريبية لليوم لإظهار عمل النظام (G1)
  const g1Students = db
    .prepare('SELECT s.id FROM students s JOIN student_group_history h ON h.student_id = s.id WHERE h.group_id = ? AND h.end_date IS NULL')
    .all(groupIds['G1'].gid)
  const attFor = ['on_time', 'on_time', 'late', 'on_time']
  g1Students.forEach((row, i) => {
    const drId = uuid()
    db.prepare('INSERT INTO daily_records (id, student_id, teacher_id, group_id, record_date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(drId, row.id, groupIds['G1'].tid, groupIds['G1'].gid, todayStr(), adminId)
    db.prepare('INSERT INTO attendances (id, daily_record_id, status) VALUES (?, ?, ?)')
      .run(uuid(), drId, attFor[i] || 'on_time')
    if (i % 2 === 0) {
      db.prepare('INSERT INTO memorization_records (id, daily_record_id, status, amount) VALUES (?, ?, ?, ?)')
        .run(uuid(), drId, 'heard', 'صفحة')
    }
    db.prepare('INSERT INTO revision_records (id, daily_record_id, status) VALUES (?, ?, ?)')
      .run(uuid(), drId, i % 2 === 0 ? 'reviewed' : 'not_reviewed')
  })

  console.log('[seed] تم إنشاء البيانات التجريبية:')
  console.log('       مشرف : admin / admin123')
  console.log('       معلم  : teacher1 / teacher123  (حلقات G1,G2)')
  console.log('       معلم  : teacher2 / teacher123  (حلقة G3)')
  console.log('       معلم معطّل: teacher3 / teacher123')
}

export { seed }
