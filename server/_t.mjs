process.env.NODE_ENV='test'
import { app } from './src/server.js'
import request from 'supertest'
const login = (u,p)=>request(app).post('/api/auth/login').send({username:u,password:p})
const r = await login('teacher1','teacher123')
const t = r.body.token
const res = await request(app).get('/api/daily/summary?date='+new Date().toISOString().slice(0,10)).set('Authorization','Bearer '+t)
console.log('status', res.status)
console.log(JSON.stringify(res.body).slice(0,800))
