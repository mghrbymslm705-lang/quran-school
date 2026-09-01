// مصادقة آمنة: تشفير كلمة المرور بـ bcrypt + رموز JWT.
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || ''
if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET غير مُعَيَّن. يُرجى تعيينه في متغيرات البيئة.')
}
const SALT_ROUNDS = 10

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS)
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash)
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, teacherId: user.teacherId ?? null, username: user.username },
    JWT_SECRET,
    { expiresIn: '12h' }
  )
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

// جلب المستخدم من قاعدة البيانات مع معرّف المعلم المرتبط (إن وُجد).
export function loadUserById(id) {
  const row = db
    .prepare(
      `SELECT u.*, t.id AS teacher_id
       FROM users u LEFT JOIN teachers t ON t.user_id = u.id
       WHERE u.id = ?`
    )
    .get(id)
  return row || null
}

export function loadUserByUsername(username) {
  const key = String(username).trim().toLowerCase()
  const row = db
    .prepare(
      `SELECT u.*, t.id AS teacher_id
       FROM users u LEFT JOIN teachers t ON t.user_id = u.id
       WHERE lower(u.username) = ? OR lower(u.email) = ?`
    )
    .get(key, key)
  return row || null
}
