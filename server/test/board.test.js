import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'
import { createBoard, localDate } from '../board.js'

const quiet = { log() {}, error() {} }
const USERS = [
  { id: 'u-ana', name: 'Ana', role: 'vodja', createdAt: 'x' },
  { id: 'u-bor', name: 'Borut', role: 'delavec', createdAt: 'x' },
]
const DB = { version: 2, requests: [{ id: 'r1', title: 'x' }], tasks: [], stock: [], faults: [], services: [], suppliers: [], users: USERS }
const tmp = (p = 'nabava-board-') => fs.mkdtempSync(path.join(os.tmpdir(), p))
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const iso = (offsetDays) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return localDate(d)
}

let dir, server, base, app, dbBefore
before(async () => {
  dir = tmp()
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(DB))
  dbBefore = fs.readFileSync(path.join(dir, 'db.json'))
  const dist = tmp('nabava-dist-')
  fs.writeFileSync(path.join(dist, 'index.html'), '<h1>ok</h1>')
  app = createApp({ dataDir: dir, distDir: dist, log: quiet })
  server = app.server
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => {
  app.chat.close()
  server.close()
})

test('prazna tabla; neznan uporabnik -> 403', async () => {
  const r = await fetch(base + '/api/board?user=u-ana')
  assert.deepEqual(await r.json(), { rev: 0, items: [] })
  assert.equal((await fetch(base + '/api/board?user=nekdo')).status, 403)
  assert.equal((await post(base, '/api/board/items', { user: 'nekdo', text: 'a' })).status, 403)
})

test('dodaj: polja, ime vzame strežnik, zapis v data/board.json', async () => {
  const r = await post(base, '/api/board/items', { user: 'u-ana', wo: ' 24-0815 ', customer: 'Gorenje', date: iso(1), text: 'Preveri\nmere', machine: 'Okuma Genos' })
  assert.equal(r.status, 201)
  const it = await r.json()
  assert.equal(it.wo, '24-0815')
  assert.equal(it.text, 'Preveri mere')
  assert.equal(it.name, 'Ana')
  assert.equal(it.machine, 'Okuma Genos')
  assert.equal(it.done, null)
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'))
  assert.equal(file.items.length, 1)
  assert.equal(file.rev, 1)
  assert.ok(!fs.existsSync(path.join(dir, 'board.json.tmp')))
})

test('validacija: prazno, slab datum, predolgo se skrajša', async () => {
  assert.equal((await post(base, '/api/board/items', { user: 'u-ana', wo: '  ', text: '' })).status, 400)
  assert.equal((await post(base, '/api/board/items', { user: 'u-ana', text: 'a', date: '5.10.2026' })).status, 400)
  assert.equal((await post(base, '/api/board/items', { user: 'u-ana', text: 'a', date: '2026-13-45' })).status, 400)
  const it = await (await post(base, '/api/board/items', { user: 'u-bor', text: 'x'.repeat(1000), date: iso(-2) })).json()
  assert.equal(it.text.length, 300)
})

test('dvojni klik (enak vnos v 10 s) ne naredi dvojnika', async () => {
  const body = { user: 'u-bor', wo: 'DUP-1', customer: 'K', text: 'dvojnik', date: iso(3) }
  const a = await (await post(base, '/api/board/items', body)).json()
  const b = await (await post(base, '/api/board/items', body)).json()
  assert.equal(a.id, b.id)
})

test('kljukica Narejeno: vklop/izklop, 404 za neznano', async () => {
  const items = (await (await fetch(base + '/api/board?user=u-ana')).json()).items
  const it = items.find((i) => i.wo === 'DUP-1')
  let r = await (await post(base, '/api/board/done', { user: 'u-ana', id: it.id })).json()
  assert.equal(r.done.name, 'Ana')
  r = await (await post(base, '/api/board/done', { user: 'u-bor', id: it.id })).json()
  assert.equal(r.done, null)
  assert.equal((await post(base, '/api/board/done', { user: 'u-ana', id: 'ni' })).status, 404)
})

test('odstrani postavko', async () => {
  const it = await (await post(base, '/api/board/items', { user: 'u-ana', text: 'pomota' })).json()
  assert.equal((await post(base, '/api/board/remove', { user: 'u-ana', id: it.id })).status, 200)
  const items = (await (await fetch(base + '/api/board?user=u-ana')).json()).items
  assert.ok(!items.some((i) => i.id === it.id))
  assert.equal((await post(base, '/api/board/remove', { user: 'u-ana', id: it.id })).status, 404)
})

test('SSE: dogodek "board" z celotnim seznamom pride vsem v živo', async () => {
  const ac = new AbortController()
  const res = await fetch(`${base}/api/chat/events?user=u-bor`, { signal: ac.signal })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const waitFor = async (needle) => {
    const t0 = Date.now()
    while (!buf.includes(needle)) {
      if (Date.now() - t0 > 3000) throw new Error('timeout ' + needle)
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
    }
  }
  await waitFor('event: hello')
  await post(base, '/api/board/items', { user: 'u-ana', wo: 'LIVE-1', text: 'v živo' })
  await waitFor('event: board')
  assert.match(buf, /LIVE-1/)
  ac.abort()
})

test('notify/poll: nove tuje odprte postavke (z nujno za zapadle/danes), lastne in narejene ne', async () => {
  const first = await (await fetch(base + '/api/notify/poll?user=u-bor')).json()
  assert.deepEqual(first.items, [])
  assert.equal(first.bseq, app.board.rev)
  const chatSeq = first.seq
  await post(base, '/api/board/items', { user: 'u-ana', wo: 'N-1', customer: 'Hidria', date: iso(0), text: 'Danes!' })
  await post(base, '/api/board/items', { user: 'u-ana', wo: 'N-2', date: iso(5), text: 'Čez teden', machine: 'MB-46VAE' })
  await post(base, '/api/board/items', { user: 'u-bor', wo: 'N-3', text: 'moja' })
  const done = await (await post(base, '/api/board/items', { user: 'u-ana', wo: 'N-4', text: 'bo narejena' })).json()
  await post(base, '/api/board/done', { user: 'u-ana', id: done.id })
  const p = await (await fetch(`${base}/api/notify/poll?user=u-bor&since=${chatSeq}&bsince=${first.bseq}`)).json()
  const b = p.items.filter((i) => i.kind === 'board')
  assert.deepEqual(b.map((i) => i.body.split(' ')[1]), ['N-1', 'N-2'])
  assert.equal(b[0].nujno, true)
  assert.equal(b[1].nujno, false)
  assert.equal(b[1].machine, 'MB-46VAE')
  assert.equal(b[0].title, 'Kaj se mudi · Ana')
  assert.equal(b[0].url, '/#/mudi')
  assert.match(b[0].body, /^DN N-1 · Hidria · rok \d+\. \d+\. — Danes!$/)
  assert.equal(p.bseq, app.board.rev)
  const again = await (await fetch(`${base}/api/notify/poll?user=u-bor&since=${p.seq}&bsince=${p.bseq}`)).json()
  assert.equal(again.items.length, 0)
})

test('db.json nedotaknjen, obstoječi API in klepet delata', async () => {
  assert.ok(dbBefore.equals(fs.readFileSync(path.join(dir, 'db.json'))))
  assert.equal((await fetch(base + '/api/data')).status, 200)
  assert.equal((await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'razno', text: 'še dela' })).status, 201)
  assert.equal((await fetch(base + '/api/chat/bootstrap?user=u-ana')).status, 200)
})

test('board.prev.json in dnevna kopija v backups/', () => {
  assert.ok(fs.existsSync(path.join(dir, 'board.prev.json')))
  const b = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('board-'))
  assert.equal(b.length, 1) // več zapisov v istem dnevu = ena kopija
  assert.ok(!fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('board-') && f.endsWith('.tmp')))
})

test('ponovni zagon: stanje se obnovi; pokvarjen board.json se ne prepiše', () => {
  const d = tmp()
  const deps = { userById: (id) => USERS.find((u) => u.id === id) }
  const b1 = createBoard(d, quiet, deps)
  const it = b1.add({ user: 'u-ana', wo: 'A', text: 'ena', date: iso(0) })
  b1.setDone({ user: 'u-bor', id: it.id, on: true })
  const b2 = createBoard(d, quiet, deps)
  assert.equal(b2.view().items.length, 1)
  assert.equal(b2.view().items[0].done.name, 'Borut')
  assert.equal(b2.rev, 2)
  fs.writeFileSync(path.join(d, 'board.json'), '{pokvarjeno')
  const b3 = createBoard(d, quiet, deps)
  assert.equal(b3.view().items.length, 0)
  const corrupt = fs.readdirSync(d).filter((f) => f.startsWith('board.corrupt-'))
  assert.equal(corrupt.length, 1)
  assert.equal(fs.readFileSync(path.join(d, corrupt[0]), 'utf8'), '{pokvarjeno')
  b3.add({ user: 'u-ana', text: 'nova' }) // delovanje po okvari
  assert.equal(fs.readFileSync(path.join(d, corrupt[0]), 'utf8'), '{pokvarjeno')
})

test('narejene postavke se po 14 dneh skrijejo iz pogleda', () => {
  const d = tmp()
  let t = new Date('2026-10-01T10:00:00Z')
  const b = createBoard(d, quiet, { userById: (id) => USERS.find((u) => u.id === id), now: () => t })
  const it = b.add({ user: 'u-ana', text: 'stara' })
  b.setDone({ user: 'u-ana', id: it.id, on: true })
  assert.equal(b.view().items.length, 1)
  t = new Date('2026-10-20T10:00:00Z')
  assert.equal(b.view().items.length, 0)
})
