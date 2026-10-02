import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'

const quiet = { log() {}, error() {} }
let dir
let dist
let server
let base

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nabava-api-'))
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'nabava-dist-'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<h1>ok</h1>')
  fs.writeFileSync(path.join(dir, 'db.json'), '{pokvarjeno')
  server = createApp({ dataDir: dir, distDir: dist, log: quiet }).server
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

test('GET /api/data ob pokvarjeni datoteki: prazna baza + db.corrupt-*', async () => {
  const r = await fetch(base + '/api/data')
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.version, 2)
  assert.deepEqual(j.requests, [])
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('db.corrupt-')).length, 1)
})

test('PUT /api/data + GET: ista oblika, db.prev.json ob drugem PUT', async () => {
  const body1 = { version: 2, requests: [{ id: 'a' }], tasks: [], stock: [], faults: [], services: [], suppliers: [], users: [] }
  let r = await fetch(base + '/api/data', { method: 'PUT', body: JSON.stringify(body1) })
  assert.deepEqual(await r.json(), { ok: true })
  assert.deepEqual(await (await fetch(base + '/api/data')).json(), body1)
  const body2 = { ...body1, requests: [{ id: 'b' }] }
  r = await fetch(base + '/api/data', { method: 'PUT', body: JSON.stringify(body2) })
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'db.prev.json'), 'utf8')), body1)
  // pokvarjena datoteka je se vedno tam
  const corrupt = fs.readdirSync(dir).filter((f) => f.startsWith('db.corrupt-'))
  assert.equal(fs.readFileSync(path.join(dir, corrupt[0]), 'utf8'), '{pokvarjeno')
})

test('PUT z neveljavnim JSON -> 400 in db.json nedotaknjen', async () => {
  const before = fs.readFileSync(path.join(dir, 'db.json'), 'utf8')
  const r = await fetch(base + '/api/data', { method: 'PUT', body: '{ne json' })
  assert.equal(r.status, 400)
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), before)
})

test('statika in SPA fallback', async () => {
  const r = await fetch(base + '/neki/pot')
  assert.equal(r.status, 200)
  assert.match(await r.text(), /ok/)
})

test('OPTIONS /api/data -> 204', async () => {
  const r = await fetch(base + '/api/data', { method: 'OPTIONS' })
  assert.equal(r.status, 204)
})
