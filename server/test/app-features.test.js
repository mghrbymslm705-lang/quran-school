import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..') // server/test -> project root (quran-school)

const {
  APP_NAME,
  WHATSAPP_NUMBER,
  canContactSupervisor,
  canInstallApp,
  canShareApp,
  buildWhatsappLink,
  buildTeacherShareMessage,
  TEACHER_SHARE_TEMPLATE,
  defaultContactMessage
} = await import('../../src/utils/appFeatures.js')

test('contact is allowed for supervisor and teacher', () => {
  assert.equal(canContactSupervisor('supervisor'), true)
  assert.equal(canContactSupervisor('teacher'), true)
})

test('install is allowed for supervisor and teacher', () => {
  assert.equal(canInstallApp('supervisor'), true)
  assert.equal(canInstallApp('teacher'), true)
})

test('share is supervisor-only (teacher cannot share)', () => {
  assert.equal(canShareApp('supervisor'), true)
  assert.equal(canShareApp('teacher'), false)
})

test('whatsapp link uses wa.me with the configured number and an encoded message', () => {
  const url = buildWhatsappLink()
  assert.ok(url.startsWith('https://wa.me/' + WHATSAPP_NUMBER + '?text='))
  assert.ok(url.includes(encodeURIComponent(defaultContactMessage())))
})

test('contact message matches the exact supervisor WhatsApp text', () => {
  assert.equal(defaultContactMessage(), 'السلام عليكم، أود التواصل بخصوص منصة إدارة المدرسة القرآنية.')
})

test('teacher share message embeds the official url and the required wording', () => {
  const msg = buildTeacherShareMessage('https://app.example')
  assert.ok(msg.includes('https://app.example'))
  assert.ok(msg.includes('الرابط الرسمي لمنصة إدارة المدرسة القرآنية'))
  assert.equal(TEACHER_SHARE_TEMPLATE.includes('{url}'), true)
})

test('PWA manifest exists and contains the required fields', () => {
  const p = resolve(root, 'public/manifest.webmanifest')
  assert.equal(existsSync(p), true, 'manifest.webmanifest is missing')
  const manifest = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(manifest.name, APP_NAME)
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.dir, 'rtl')
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2)
})

test('service worker and PWA icons exist', () => {
  assert.equal(existsSync(resolve(root, 'public/sw.js')), true, 'sw.js is missing')
  assert.equal(existsSync(resolve(root, 'public/icon-192.png')), true, 'icon-192.png is missing')
  assert.equal(existsSync(resolve(root, 'public/icon-512.png')), true, 'icon-512.png is missing')
})

test('index.html references the web app manifest', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8')
  assert.ok(/rel=["']manifest["']/.test(html), 'index.html does not link the manifest')
})
