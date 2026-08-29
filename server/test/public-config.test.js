// اختبارات إعدادات النشر العامة: الرابط الرسمي، منع localhost في الإنتاج، واستخدام APP_PUBLIC_URL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

process.env.NODE_ENV = 'test'
const { app } = await import('../src/server.js')

test('GET /api/config يعيد الرابط ورقم واتساب وبيئة التشغيل', async () => {
  const res = await request(app).get('/api/config')
  assert.equal(res.status, 200)
  assert.ok(typeof res.body.appUrl === 'string', 'appUrl should be a string')
  assert.ok(typeof res.body.whatsappNumber === 'string', 'whatsappNumber should be a string')
  assert.equal(res.body.environment, 'test')
})

test('في الإنتاج لا يظهر localhost أبدًا في الرابط المشترك', async () => {
  const prevEnv = process.env.NODE_ENV
  const prevUrl = process.env.APP_PUBLIC_URL
  process.env.NODE_ENV = 'production'
  delete process.env.APP_PUBLIC_URL
  try {
    const res = await request(app)
      .get('/api/config')
      .set('Host', 'school.example.com')
      .set('X-Forwarded-Proto', 'https')
    assert.equal(res.status, 200)
    assert.ok(res.body.appUrl, 'appUrl should be set')
    assert.ok(
      !res.body.appUrl.includes('localhost'),
      'production appUrl must not contain localhost, got: ' + res.body.appUrl
    )
    assert.equal(res.body.appUrl, 'https://school.example.com')
  } finally {
    process.env.NODE_ENV = prevEnv
    if (prevUrl === undefined) delete process.env.APP_PUBLIC_URL
    else process.env.APP_PUBLIC_URL = prevUrl
  }
})

test('عند ضبط APP_PUBLIC_URL يُستخدم كما هو (مع إزالة الشرطة المائلة الزائدة)', async () => {
  const prevEnv = process.env.NODE_ENV
  const prevUrl = process.env.APP_PUBLIC_URL
  process.env.NODE_ENV = 'production'
  process.env.APP_PUBLIC_URL = 'https://app.madrasa.ma/'
  try {
    const res = await request(app).get('/api/config')
    assert.equal(res.body.appUrl, 'https://app.madrasa.ma')
  } finally {
    process.env.NODE_ENV = prevEnv
    if (prevUrl === undefined) delete process.env.APP_PUBLIC_URL
    else process.env.APP_PUBLIC_URL = prevUrl
  }
})
