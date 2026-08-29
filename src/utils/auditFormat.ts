// أدوات عرض سجل التدقيق بصيغة عربية مفهومة (تمنع ظهور [object Object]).
export interface AuditCtx {
  studentName?: (id: string) => string | undefined
  teacherName?: (id: string) => string | undefined
  groupName?: (id: string) => string | undefined
}

const ENTITY_LABELS: Record<string, string> = {
  student: 'الطالب',
  teacher: 'المعلم',
  group: 'الحلقة',
  groups: 'الحلقة',
  daily_records: 'السجل اليومي',
  daily_record: 'السجل اليومي',
  attendance: 'الحضور',
  memorization_record: 'اللوح',
  revision_record: 'الورد',
  audit_log: 'سجل التغييرات',
  user: 'المستخدم',
  school_settings: 'إعدادات المؤسسة',
  student_group: 'إسناد الطالب للحلقة',
  teacher_group: 'إسناد المعلم للحلقة'
}

const ACTION_LABELS: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  edit: 'تعديل',
  delete: 'حذف',
  bulk_delete: 'تنظيف',
  archive: 'أرشفة',
  reactivate: 'إعادة تفعيل',
  deactivate: 'تعطيل',
  activate: 'تفعيل',
  transfer: 'نقل',
  reset_password: 'تغيير كلمة المرور',
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج'
}

const FIELD_LABELS: Record<string, string> = {
  full_name: 'الاسم',
  username: 'اسم المستخدم',
  status: 'الحالة',
  group_id: 'الحلقة',
  teacher_id: 'المحفظ',
  student_id: 'الطالب',
  student_code: 'الرقم الدراسي',
  name: 'الاسم',
  code: 'الرمز',
  notes: 'ملاحظات',
  phone: 'الهاتف',
  email: 'البريد الإلكتروني',
  reason: 'السبب',
  role: 'الدور',
  by_role: 'بواسطة',
  amount: 'الكمية',
  mastery_status: 'درجة الإتقان',
  quality: 'الجودة',
  attendance_status: 'الحضور',
  memorization_status: 'اللوح',
  revision_status: 'الورد',
  note: 'ملاحظة'
}

const STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  inactive: 'معطل',
  archived: 'مؤرشف',
  suspended: 'موقوف',
  transferred: 'منقول',
  withdrawn: 'منسحب',
  present: 'حاضر',
  absent: 'غائب',
  excused_absent: 'غياب بعذر',
  on_time: 'حضر في الوقت',
  late: 'متأخر',
  heard: 'سمع اللوح',
  not_heard: 'لم يسمع اللوح',
  reviewed: 'راجع الورد',
  not_reviewed: 'لم يراجع',
  not_recorded: 'غير مسجّل'
}

// حقول تقنية لا تُعرض للمستخدم أبدًا (ولا كلمات المرور)
const TECH_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'password_hash',
  'token',
  'old_data',
  'new_data',
  'by_role',
  'related',
  'backup_file'
])

export function entityLabel(t: string): string {
  return ENTITY_LABELS[t] || t
}
export function actionLabel(a: string): string {
  return ACTION_LABELS[a] || a
}
function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ')
}

function formatVal(v: any, ctx?: AuditCtx): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا'
  if (typeof v === 'object') {
    try {
      const keys = Object.keys(v)
      if (keys.length === 0) return '—'
      return keys.map((k) => `${fieldLabel(k)}: ${formatVal(v[k], ctx)}`).join('، ')
    } catch {
      return '—'
    }
  }
  if (typeof v === 'string' && STATUS_LABELS[v]) return STATUS_LABELS[v]
  if (ctx) {
    if (ctx.studentName && ctx.studentName(v)) return ctx.studentName(v)!
    if (ctx.teacherName && ctx.teacherName(v)) return ctx.teacherName(v)!
    if (ctx.groupName && ctx.groupName(v)) return ctx.groupName(v)!
  }
  return String(v)
}

function entityNameOf(rec: any, ctx: AuditCtx): string | null {
  const d = rec.new_data && typeof rec.new_data === 'object' ? rec.new_data : rec.old_data && typeof rec.old_data === 'object' ? rec.old_data : {}
  if (d && (d.full_name || d.name)) return d.full_name || d.name
  const id = rec.entity_id
  if (id && ctx) {
    if (ctx.studentName && ctx.studentName(id)) return ctx.studentName(id)!
    if (ctx.teacherName && ctx.teacherName(id)) return ctx.teacherName(id)!
    if (ctx.groupName && ctx.groupName(id)) return ctx.groupName(id)!
  }
  return null
}

// الوصف الديناميكي للكيان (يصلح مشكلة «الطالب: —» لكل السجلات)
export function auditEntityName(rec: any, ctx: AuditCtx = {}): string {
  const label = entityLabel(rec.entity_type)
  if (rec.entity_type === 'school_settings') return 'إعدادات المؤسسة'
  if (rec.entity_type === 'user') return 'حساب المشرف'
  const name = entityNameOf(rec, ctx)
  return name ? `${label}: ${name}` : label
}

export interface AuditChangeLine {
  label: string
  from?: string
  to?: string
}
export interface AuditChangeView {
  title: string
  lines: AuditChangeLine[]
  summary?: string
}

export function formatAuditChange(rec: any, ctx: AuditCtx = {}): AuditChangeView {
  const entity = entityLabel(rec.entity_type)
  const action = actionLabel(rec.action)
  const oldD = rec.old_data && typeof rec.old_data === 'object' ? rec.old_data : {}
  const newD = rec.new_data && typeof rec.new_data === 'object' ? rec.new_data : {}

  if (rec.action === 'reset_password' || newD.reset === true) {
    return { title: 'تم تغيير كلمة المرور', lines: [] }
  }
  if (rec.action === 'login' || rec.action === 'logout') {
    return { title: action, lines: [] }
  }
  if (rec.action === 'create') {
    const lines: AuditChangeLine[] = Object.keys(newD)
      .filter((k) => !TECH_FIELDS.has(k))
      .map((k) => ({ label: fieldLabel(k), to: formatVal(newD[k], ctx) }))
    return { title: `تم إنشاء ${entity}`, lines }
  }
  if (rec.action === 'delete') {
    return { title: `حذف ${entity}`, lines: [{ label: 'العنصر', to: entityNameOf(rec, ctx) || '—' }] }
  }
  if (rec.action === 'bulk_delete' && rec.entity_type === 'audit_log') {
    const count = newD.deleted ?? oldD.count ?? '—'
    return { title: 'تنظيف سجل التغييرات', lines: [{ label: 'عدد السجلات المحذوفة', to: String(count) }] }
  }

  // تعديل / أرشفة / نقل / تفعيل ...
  const title = `${entity} — ${action}`
  const lines: AuditChangeLine[] = []
  const keys = new Set([...Object.keys(oldD), ...Object.keys(newD)])
  for (const k of keys) {
    if (TECH_FIELDS.has(k)) continue
    const from = oldD[k]
    const to = newD[k]
    if (JSON.stringify(from) === JSON.stringify(to)) continue
    lines.push({ label: fieldLabel(k), from: formatVal(from, ctx), to: formatVal(to, ctx) })
  }
  return { title, lines }
}
