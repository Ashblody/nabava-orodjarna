import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'
import { createChat, dmId, fold, MAX_TEXT, RATE_LIMIT } from '../chat.js'

const quiet = { log() {}, error() {} }
const USERS = [
  { id: 'u-ana', name: 'Ana', role: 'vodja', createdAt: 'x' },
  { id: 'u-bor', name: 'Borut', role: 'delavec', createdAt: 'x' },
  { id: 'u-cene', name: 'Čene', role: 'delavec', createdAt: 'x' },
]
const DB = { version: 2, requests: [{ id: 'r1', title: 'x' }], tasks: [], stock: [], faults: [], services: [], suppliers: [], users: USERS }

function tmp(prefix = 'nabava-chat-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}
function setup(db = DB) {
  const dir = tmp()
  if (db) fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db))
  return dir
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** minimalen SSE bralnik */
async function openSse(url, headers = {}) {
  const ac = new AbortController()
  const res = await fetch(url, { headers, signal: ac.signal })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const got = []
  const waiters = []
  ;(async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const ev = {}
          for (const line of block.split('\n')) {
            const m = /^(\w+): ?(.*)$/.exec(line)
            if (m) ev[m[1]] = m[2]
          }
          if (ev.event) {
            ev.json = ev.data ? JSON.parse(ev.data) : null
            got.push(ev)
            waiters.splice(0).forEach((w) => w())
          }
        }
      }
    } catch {
      /* abort */
    }
  })()
  const next = async (name, ms = 3000) => {
    const t0 = Date.now()
    for (;;) {
      const i = got.findIndex((e) => e.event === name)
      if (i >= 0) return got.splice(i, 1)[0]
      if (Date.now() - t0 > ms) throw new Error('SSE timeout: ' + name)
      await new Promise((r) => {
        waiters.push(r)
        setTimeout(r, 50)
      })
    }
  }
  return { res, next, got, close: () => ac.abort() }
}

let dir, server, base, chat, dbBefore
before(async () => {
  dir = setup()
  dbBefore = fs.readFileSync(path.join(dir, 'db.json'))
  const dist = tmp('nabava-dist-')
  fs.writeFileSync(path.join(dist, 'index.html'), '<h1>ok</h1>')
  const app = createApp({ dataDir: dir, distDir: dist, log: quiet })
  server = app.server
  chat = app.chat
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => {
  chat.close()
  server.close()
})

test('bootstrap: 4 kanali, osebe brez mene, db.json nedotaknjen', async () => {
  const r = await fetch(base + '/api/chat/bootstrap?user=u-ana')
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.groups.map((g) => g.name), ['Splošno', 'Plani', 'Nujno', 'Razno'])
  assert.deepEqual(j.people.map((p) => p.name).sort(), ['Borut', 'Čene'])
  assert.equal(j.me.name, 'Ana')
  assert.ok(fs.existsSync(path.join(dir, 'chat')))
})

test('neznan ali manjkajoč uporabnik -> 403 / 400', async () => {
  assert.equal((await fetch(base + '/api/chat/bootstrap?user=nekdo')).status, 403)
  assert.equal((await fetch(base + '/api/chat/bootstrap')).status, 400)
  assert.equal((await post(base, '/api/chat/messages', { user: 'nekdo', channel: 'splosno', text: 'a' })).status, 403)
})

test('pošiljanje v skupinski kanal: ime vzame strežnik, seq narašča, shranjeno v jsonl', async () => {
  const r = await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'plani', text: '  Pozdrav!  ', machine: 'Okuma Genos' })
  assert.equal(r.status, 201)
  const m = await r.json()
  assert.equal(m.text, 'Pozdrav!')
  assert.equal(m.name, 'Ana')
  assert.equal(m.machine, 'Okuma Genos')
  const m2 = await (await post(base, '/api/chat/messages', { user: 'u-bor', channel: 'plani', text: 'Živjo' })).json()
  assert.ok(m2.seq > m.seq)
  const lines = fs.readFileSync(path.join(dir, 'chat', 'messages.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[0]).t, 'msg')
})

test('validacija: prazno, predolgo, neznan kanal, sam sebi', async () => {
  assert.equal((await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'plani', text: '   ' })).status, 400)
  assert.equal((await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'plani', text: 'x'.repeat(MAX_TEXT + 1) })).status, 400)
  assert.equal((await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'neki', text: 'a' })).status, 400)
  assert.equal((await post(base, '/api/chat/messages', { user: 'u-ana', to: 'u-ana', text: 'a' })).status, 400)
  assert.equal((await post(base, '/api/chat/messages', { user: 'u-ana', to: 'u-nihce', text: 'a' })).status, 404)
})

test('zasebni 1:1: vidita samo udeleženca', async () => {
  const r = await post(base, '/api/chat/messages', { user: 'u-ana', to: 'u-bor', text: 'Samo midva' })
  assert.equal(r.status, 201)
  const m = await r.json()
  assert.equal(m.channel, dmId('u-ana', 'u-bor'))
  const bBor = await (await fetch(base + '/api/chat/bootstrap?user=u-bor')).json()
  assert.equal(bBor.messages[m.channel].length, 1)
  const bCene = await (await fetch(base + '/api/chat/bootstrap?user=u-cene')).json()
  assert.ok(!Object.keys(bCene.messages).some((k) => k.startsWith('dm:')))
  // Čene ne more brati ali pisati v tuji DM
  assert.equal((await fetch(base + `/api/chat/history?user=u-cene&channel=${encodeURIComponent(m.channel)}`)).status, 400)
  assert.equal((await post(base, '/api/chat/messages', { user: 'u-cene', channel: m.channel, text: 'vdor' })).status, 400)
  const s = await (await fetch(base + '/api/chat/search?user=u-cene&q=midva')).json()
  assert.equal(s.results.length, 0)
  const s2 = await (await fetch(base + '/api/chat/search?user=u-bor&q=midva')).json()
  assert.equal(s2.results.length, 1)
})

test('SSE: sporočilo prispe v živo samo tistim, ki ga smejo videti', async () => {
  const bor = await openSse(`${base}/api/chat/events?user=u-bor`)
  const cene = await openSse(`${base}/api/chat/events?user=u-cene`)
  assert.equal(bor.res.headers.get('content-type').split(';')[0], 'text/event-stream')
  await bor.next('hello')
  await cene.next('hello')
  await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'nujno', text: 'Nujno!' })
  await post(base, '/api/chat/messages', { user: 'u-ana', to: 'u-bor', text: 'Zasebno za Boruta' })
  const a = await bor.next('message')
  assert.equal(a.json.text, 'Nujno!')
  const b = await bor.next('message')
  assert.equal(b.json.text, 'Zasebno za Boruta')
  const c = await cene.next('message')
  assert.equal(c.json.text, 'Nujno!')
  await new Promise((r) => setTimeout(r, 100))
  assert.ok(!cene.got.some((e) => e.event === 'message'), 'Čene ne sme dobiti DM')
  bor.close()
  cene.close()
})

test('SSE: Last-Event-ID ponovi zamujena sporočila', async () => {
  const s0 = chat.seq
  await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'razno', text: 'med odklopom 1' })
  await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'razno', text: 'med odklopom 2' })
  const c = await openSse(`${base}/api/chat/events?user=u-cene`, { 'Last-Event-ID': String(s0) })
  const e1 = await c.next('message')
  const e2 = await c.next('message')
  assert.deepEqual([e1.json.text, e2.json.text], ['med odklopom 1', 'med odklopom 2'])
  c.close()
})

test('kljukica (done): vklop/izklop, razpošlje se, preživi bootstrap', async () => {
  const m = await (await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'plani', text: 'Naredi CAM' })).json()
  const s = await openSse(`${base}/api/chat/events?user=u-bor`)
  await s.next('hello')
  let r = await (await post(base, '/api/chat/done', { user: 'u-bor', id: m.id })).json()
  assert.equal(r.done.name, 'Borut')
  const ev = await s.next('done')
  assert.equal(ev.json.on, true)
  assert.equal(ev.json.id, m.id)
  const b = await (await fetch(base + '/api/chat/bootstrap?user=u-ana')).json()
  assert.equal(b.messages.plani.find((x) => x.id === m.id).done.name, 'Borut')
  r = await (await post(base, '/api/chat/done', { user: 'u-ana', id: m.id })).json() // preklop
  assert.equal(r.done, null)
  assert.equal((await post(base, '/api/chat/done', { user: 'u-ana', id: 'ni-ga' })).status, 404)
  s.close()
})

test('neprebrano + preberi', async () => {
  let b = await (await fetch(base + '/api/chat/bootstrap?user=u-cene')).json()
  const before = b.unread.plani || 0
  await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'plani', text: 'novo za Čeneta' })
  b = await (await fetch(base + '/api/chat/bootstrap?user=u-cene')).json()
  assert.equal(b.unread.plani, before + 1)
  await post(base, '/api/chat/read', { user: 'u-cene', channel: 'plani', seq: b.lastSeq })
  b = await (await fetch(base + '/api/chat/bootstrap?user=u-cene')).json()
  assert.equal(b.unread.plani, undefined)
  // lastna sporočila niso neprebrana
  const a = await (await fetch(base + '/api/chat/bootstrap?user=u-ana')).json()
  assert.equal(a.unread.plani, undefined)
})

test('iskanje: brez šumnikov, po stroju, po kanalu', async () => {
  await post(base, '/api/chat/messages', { user: 'u-bor', channel: 'razno', text: 'Čistilo za šrafe', machine: 'MB-46VAE' })
  let s = await (await fetch(base + '/api/chat/search?user=u-ana&q=' + encodeURIComponent('cistilo'))).json()
  assert.equal(s.results.length, 1)
  assert.equal(s.results[0].channelName, 'Razno')
  s = await (await fetch(base + '/api/chat/search?user=u-ana&machine=MB-46VAE')).json()
  assert.equal(s.results.length, 1)
  s = await (await fetch(base + '/api/chat/search?user=u-ana&q=cistilo&channel=plani')).json()
  assert.equal(s.results.length, 0)
  assert.equal(fold('Šrafé Đ'), 'srafe d')
})

test('history: before + limit', async () => {
  const h = await (await fetch(base + '/api/chat/history?user=u-ana&channel=plani&limit=2')).json()
  assert.equal(h.messages.length, 2)
  assert.equal(h.more, true)
  const older = await (await fetch(base + `/api/chat/history?user=u-ana&channel=plani&limit=50&before=${h.messages[0].seq}`)).json()
  assert.ok(older.messages.every((m) => m.seq < h.messages[0].seq))
})

test('notify/poll: brez since samo seq; potem samo nova tuja sporočila', async () => {
  const first = await (await fetch(base + '/api/notify/poll?user=u-bor')).json()
  assert.deepEqual(first.items, [])
  assert.equal(first.seq, chat.seq)
  await post(base, '/api/chat/messages', { user: 'u-ana', channel: 'nujno', text: 'Stroj stoji' })
  await post(base, '/api/chat/messages', { user: 'u-bor', channel: 'nujno', text: 'lastno' })
  await post(base, '/api/chat/messages', { user: 'u-ana', to: 'u-cene', text: 'tvoj DM' })
  const p = await (await fetch(base + `/api/notify/poll?user=u-bor&since=${first.seq}`)).json()
  assert.equal(p.items.length, 1)
  assert.equal(p.items[0].title, 'Nujno · Ana')
  assert.equal(p.items[0].nujno, true)
  assert.equal(p.items[0].body, 'Stroj stoji')
  assert.match(p.items[0].url, /^\/#\/klepet\/nujno$/)
  const pc = await (await fetch(base + `/api/notify/poll?user=u-cene&since=${first.seq}`)).json()
  assert.ok(pc.items.some((i) => i.title === 'Ana' && i.body === 'tvoj DM'))
  const none = await (await fetch(base + `/api/notify/poll?user=u-bor&since=${p.seq}`)).json()
  assert.equal(none.items.length, 0)
})

test('GET /api/users', async () => {
  const u = await (await fetch(base + '/api/users')).json()
  assert.equal(u.length, 3)
  assert.equal(u[0].passwordHash, undefined)
})

test('omejitev hitrosti: 429 po preveč sporočilih', async () => {
  let last = 0
  for (let i = 0; i < RATE_LIMIT.max + 2; i++) {
    last = (await post(base, '/api/chat/messages', { user: 'u-cene', channel: 'razno', text: 'spam ' + i })).status
    if (last === 429) break
  }
  assert.equal(last, 429)
})

test('db.json ostane bajt-za-bajt nedotaknjen, obstoječi API dela', async () => {
  assert.ok(dbBefore.equals(fs.readFileSync(path.join(dir, 'db.json'))))
  const d = await (await fetch(base + '/api/data')).json()
  assert.equal(d.requests[0].id, 'r1')
  assert.ok(!fs.readdirSync(dir).some((f) => f.startsWith('db.corrupt-') || f === 'db.prev.json'))
})

test('PUT /api/data ne vpliva na klepet (in obratno)', async () => {
  const n0 = chat.seq
  const r = await fetch(base + '/api/data', { method: 'PUT', body: JSON.stringify({ ...DB, requests: [] }) })
  assert.equal(r.status, 200)
  assert.equal(chat.seq, n0)
  // uporabniki se osvežijo po spremembi db.json
  const newDb = { ...DB, users: [...USERS, { id: 'u-dana', name: 'Dana', role: 'delavec', createdAt: 'x' }] }
  await fetch(base + '/api/data', { method: 'PUT', body: JSON.stringify(newDb) })
  const b = await (await fetch(base + '/api/chat/bootstrap?user=u-dana')).json()
  assert.equal(b.me.name, 'Dana')
})

test('ponovni zagon: sporočila, kljukice in seq se obnovijo iz jsonl; pokvarjena/nedokončana vrstica ne podre', () => {
  const d = setup()
  const c1 = createChat(d, quiet)
  const m = c1.postMessage({ user: 'u-ana', channel: 'splosno', text: 'ena' })
  c1.setDone({ user: 'u-bor', id: m.id, on: true })
  c1.close()
  const file = path.join(d, 'chat', 'messages.jsonl')
  fs.appendFileSync(file, '{"t":"msg","seq":99,"id":"zz') // odrezan zapis brez \n
  const c2 = createChat(d, quiet)
  const b = c2.bootstrap('u-ana')
  assert.equal(b.messages.splosno.length, 1)
  assert.equal(b.messages.splosno[0].done.name, 'Borut')
  const m2 = c2.postMessage({ user: 'u-ana', channel: 'splosno', text: 'dva' })
  assert.ok(m2.seq > m.seq)
  c2.close()
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 4) // msg, done, odrezana, msg
  assert.equal(JSON.parse(lines[3]).text, 'dva')
  const c3 = createChat(d, quiet)
  assert.equal(c3.bootstrap('u-ana').messages.splosno.length, 2)
  c3.close()
})

test('brez db.json ali s pokvarjenim: klepet ne uniči ničesar (ne preimenuje, ne piše)', async () => {
  const d = setup(null)
  fs.writeFileSync(path.join(d, 'db.json'), '{pokvarjeno')
  const c = createChat(d, quiet)
  assert.throws(() => c.postMessage({ user: 'u-ana', channel: 'splosno', text: 'a' }), /Neznan uporabnik/)
  assert.equal(fs.readFileSync(path.join(d, 'db.json'), 'utf8'), '{pokvarjeno')
  assert.deepEqual(fs.readdirSync(d).sort(), ['chat', 'db.json'])
  c.close()
})
