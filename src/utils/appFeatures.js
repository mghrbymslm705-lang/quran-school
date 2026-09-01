// Pure, framework-free helpers for the app's communication / sharing / PWA features.
// Kept in plain JS so it can be unit-tested with `node --test` without a TS loader.

export const APP_NAME = 'نظام إدارة المدرسة القرآنية'
export const WHATSAPP_NUMBER = '212605706006'

/**
 * @param {'supervisor'|'teacher'} role
 * @returns {boolean}
 */
export function canContactSupervisor(role) {
  return role === 'supervisor' || role === 'teacher'
}

/**
 * @param {'supervisor'|'teacher'} role
 * @returns {boolean}
 */
export function canInstallApp(role) {
  return role === 'supervisor' || role === 'teacher'
}

/**
 * @param {'supervisor'|'teacher'} role
 * @returns {boolean}
 */
export function canShareApp(role) {
  return role === 'supervisor'
}

export function defaultContactMessage() {
  return 'السلام عليكم، أود التواصل بخصوص منصة إدارة المدرسة القرآنية.'
}

// رسالة المشاركة الجاهزة التي تُرسل للأساتذة (تُستبدل العلامة {url} بالرابط الرسمي).
export const TEACHER_SHARE_TEMPLATE = [
  'السلام عليكم ورحمة الله وبركاته،',
  'هذا هو الرابط الرسمي لمنصة إدارة المدرسة القرآنية.',
  'يمكنكم الدخول باستعمال حسابكم الشخصي من الهاتف أو الحاسوب:',
  '',
  '{url}'
].join('\n')

/**
 * @param {string} url
 * @returns {string}
 */
export function buildTeacherShareMessage(url) {
  return TEACHER_SHARE_TEMPLATE.replace('{url}', url || '')
}

/**
 * @param {string} [phone]
 * @param {string} [message]
 * @returns {string}
 */
export function buildWhatsappLink(phone = WHATSAPP_NUMBER, message = defaultContactMessage()) {
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message)
}

// رسالة إرسال بيانات دخول المعلم عبر واتساب.
export function buildTeacherCredentialsMessage(phone, username, password) {
  return [
    'السلام عليكم ورحمة الله وبركاته،',
    'بيانات دخولك في منصة إدارة المدرسة القرآنية:',
    'اسم المستخدم: ' + username,
    'كلمة المرور: ' + password,
    'للدخول اضغط على الرابط:',
    location.origin || ''
  ].join('\n')
}

/**
 * @param {string} [origin]
 * @returns {string}
 */
export function getAppShareUrl(origin) {
  if (origin) return origin
  if (typeof location !== 'undefined') return location.origin
  return ''
}
