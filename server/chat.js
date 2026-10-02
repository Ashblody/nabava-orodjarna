/**
 * Klepet za delavnico (brez odvisnosti).
 *
 * Shramba (v NABAVA_DATA_DIR, loceno od db.json - db.json se tu samo BERE, nikoli ne pise):
 *   chat/messages.jsonl   dodajalni dnevnik dogodkov (ena vrstica = en dogodek), se nikoli ne prepisuje
 *   chat/reads.json       preberi-stanje po uporabnikih (majhna datoteka, atomarni zapis tmp+rename)
 *
 * Kanali: splosno, plani, nujno, razno (stalni) + zasebni 1:1: dm:<idA>|<idB> (ustvari se ob prvem sporocilu).
 * Realtime: SSE (GET /api/chat/events). Strezniski seq je enolicen in narascajoc za vse dogodke.
 * Identiteta: userId mora obstajati v db.json users[] (ime vzame streznik); gesla ni (kot v celotni aplikaciji).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const CHANNELS = [
  { id: 'splosno', name: 'Splošno', kind: 'group' },
  { id: 'plani', name: 'Plani', kind: 'group' },
  { id: 'nujno', name: 'Nujno', kind: 'group' },
  { id: 'razno', name: 'Razno', kind: 'group' },
]
export const MAX_TEXT = 2000
export const RATE_LIMIT = { max: 20, windowMs: 10_000 }
const BOOT_PER_CHANNEL = 60
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

const GROUP_IDS = new Set(CHANNELS.map((c) => c.id))

export function dmId(a, b) {
  return 'dm:' + [a, b].sort().join('|')
}
export function dmMembers(id) {
  if (typeof id !== 'string' || !id.startsWith('dm:')) return null
  const parts = id.slice(3).split('|')
  return parts.length === 2 && parts[0] && parts[1] ? parts : null
}

/** mala crka brez strešic: "Splošno" -> "splosno" (iskanje) */
export function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
}

function cleanText(t) {
  if (typeof t !== 'string') return ''
  // odstrani nadzorne znake razen \n in \t
  // eslint-disable-next-line no-control-regex
  return t.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createChat(dataDir, log = console, opts = {}) {
  const dir = path.resolve(dataDir)
  const chatDir = path.join(dir, 'chat')
  const logPath = path.join(chatDir, 'messages.jsonl')
  const readsPath = path.join(chatDir, 'reads.json')
  const dbPath = path.join(dir, 'db.json')
  const now = opts.now || (() => new Date())
  const pingMs = opts.pingMs ?? 25_000

  fs.mkdirSync(chatDir, { recursive: true })

  // ---------- stanje v pomnilniku ----------
  let seq = 0
  const events = [] // vsi dogodki po vrsti (seq narasca)
  const messages = new Map() // id -> sporocilo (z done)
  const byChannel = new Map() // channelId -> sporocila po vrsti
  let reads = { users: {} } // { users: { [userId]: { base: seq, ch: { [channelId]: seq } } } }

  function applyEvent(ev) {
    if (ev.seq > seq) seq = ev.seq
    if (ev.t === 'msg') {
      const m = { ...ev, done: null }
      delete m.t
      messages.set(m.id, m)
      if (!byChannel.has(m.channel)) byChannel.set(m.channel, [])
      byChannel.get(m.channel).push(m)
    } else if (ev.t === 'done') {
      const m = messages.get(ev.id)
      if (m) m.done = ev.on ? { by: ev.by, name: ev.name, at: ev.at } : null
    }
    events.push(ev)
  }

  function load() {
    let raw = ''
    try {
      raw = fs.readFileSync(logPath, 'utf8')
    } catch {
      raw = ''
    }
    let bad = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev && typeof ev.seq === 'number' && (ev.t === 'msg' || ev.t === 'done')) applyEvent(ev)
        else bad++
      } catch {
        bad++
      }
    }
    if (bad) log.error(`[klepet] preskocenih pokvarjenih vrstic v messages.jsonl: ${bad}`)
    // ce zadnja vrstica nima \n (npr. izpad toka), dodaj, da naslednji zapis ne zlepi vrstic
    if (raw && !raw.endsWith('\n')) fs.appendFileSync(logPath, '\n')
    try {
      const r = JSON.parse(fs.readFileSync(readsPath, 'utf8'))
      if (r && typeof r.users === 'object' && r.users) reads = r
    } catch {
      /* ni datoteke ali pokvarjena: zacnemo prazno (samo stevci neprebranih) */
    }
  }
  load()

  function append(ev) {
    ev.seq = seq + 1
    fs.appendFileSync(logPath, JSON.stringify(ev) + '\n', 'utf8')
    applyEvent(ev)
    return ev
  }

  let readsTimer = null
  function saveReads() {
    if (readsTimer) return
    readsTimer = setTimeout(flushReads, 300)
    readsTimer.unref?.()
  }
  function flushReads() {
    if (readsTimer) clearTimeout(readsTimer)
    readsTimer = null
    try {
      const tmp = readsPath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(reads), 'utf8')
      fs.renameSync(tmp, readsPath)
    } catch (err) {
      log.error(`[klepet] reads.json ni uspel: ${err.message}`)
    }
  }

  // ---------- uporabniki (samo branje db.json, predpomnjeno po mtime+size) ----------
  let usersCache = { sig: '', users: [] }
  function getUsers() {
    try {
      const st = fs.statSync(dbPath)
      const sig = `${st.mtimeMs}:${st.size}`
      if (sig === usersCache.sig) return usersCache.users
      let raw = fs.readFileSync(dbPath, 'utf8')
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
      const db = JSON.parse(raw)
      const users = (Array.isArray(db.users) ? db.users : [])
        .filter((u) => u && typeof u.id === 'string' && typeof u.name === 'string' && u.name.trim())
        .map((u) => ({ id: u.id, name: u.name.trim(), role: u.role === 'vodja' ? 'vodja' : 'delavec' }))
      usersCache = { sig, users }
      return users
    } catch {
      return usersCache.users // db.json manjka/pokvarjen: uporabi zadnje znane
    }
  }
  const userById = (id) => getUsers().find((u) => u.id === id)

  function requireUser(id) {
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'Manjka uporabnik')
    const u = userById(id)
    if (!u) throw new HttpError(403, 'Neznan uporabnik')
    return u
  }

  const canSee = (userId, channelId) => {
    if (GROUP_IDS.has(channelId)) return true
    const m = dmMembers(channelId)
    return !!m && m.includes(userId)
  }

  const channelName = (id, forUser) => {
    const g = CHANNELS.find((c) => c.id === id)
    if (g) return g.name
    const m = dmMembers(id)
    if (m) {
      const other = m.find((x) => x !== forUser) || m[0]
      return userById(other)?.name || 'Zasebno'
    }
    return id
  }

  // ---------- neprebrano ----------
  function userReads(userId) {
    let r = reads.users[userId]
    if (!r) {
      // nov uporabnik: stara zgodovina skupinskih kanalov ni "neprebrana"
      r = reads.users[userId] = { base: seq, ch: {} }
      saveReads()
    }
    return r
  }
  function unreadFor(userId) {
    const r = userReads(userId)
    const out = {}
    for (const [ch, list] of byChannel) {
      if (!canSee(userId, ch)) continue
      const from = Math.max(r.base || 0, r.ch[ch] || 0)
      let n = 0
      for (let i = list.length - 1; i >= 0 && list[i].seq > from; i--) if (list[i].from !== userId) n++
      if (n) out[ch] = n
    }
    return out
  }

  // ---------- SSE ----------
  const clients = new Set() // { res, userId }
  function sendTo(c, ev, name) {
    try {
      c.res.write(`id: ${ev.seq}\nevent: ${name}\ndata: ${JSON.stringify(ev)}\n\n`)
    } catch {
      clients.delete(c)
    }
  }
  function publish(ev, name) {
    const ch = ev.channel || (ev.id && messages.get(ev.id)?.channel)
    for (const c of clients) {
      if (ch && !canSee(c.userId, ch)) continue
      sendTo(c, ev, name)
    }
  }
  const pingTimer = setInterval(() => {
    for (const c of clients) {
      try {
        c.res.write(`event: ping\ndata: ${Date.now()}\n\n`)
      } catch {
        clients.delete(c)
      }
    }
  }, pingMs)
  pingTimer.unref?.()

  function publicMsg(m) {
    return { id: m.id, seq: m.seq, channel: m.channel, from: m.from, name: m.name, at: m.at, text: m.text, machine: m.machine || undefined, done: m.done }
  }
  const eventPayload = (ev) =>
    ev.t === 'msg'
      ? publicMsg({ ...ev, done: null })
      : { seq: ev.seq, id: ev.id, on: ev.on, by: ev.by, name: ev.name, at: ev.at, channel: messages.get(ev.id)?.channel }

  // ---------- operacije ----------
  const sentAt = new Map() // userId -> [casi]
  function rateCheck(userId) {
    const t = now().getTime()
    const arr = (sentAt.get(userId) || []).filter((x) => t - x < RATE_LIMIT.windowMs)
    if (arr.length >= RATE_LIMIT.max) throw new HttpError(429, 'Prehitro pošiljanje, počakaj trenutek')
    arr.push(t)
    sentAt.set(userId, arr)
  }

  function postMessage(body) {
    const me = requireUser(body.user)
    const text = cleanText(body.text)
    if (!text) throw new HttpError(400, 'Prazno sporočilo')
    if (text.length > MAX_TEXT) throw new HttpError(400, `Sporočilo je predolgo (največ ${MAX_TEXT} znakov)`)
    let channel = body.channel
    if (body.to) {
      if (body.to === me.id) throw new HttpError(400, 'Ne moreš pisati sam sebi')
      if (!userById(body.to)) throw new HttpError(404, 'Prejemnik ne obstaja')
      channel = dmId(me.id, body.to)
    }
    if (!(GROUP_IDS.has(channel) || (dmMembers(channel) && canSee(me.id, channel) && dmMembers(channel).every((x) => userById(x))))) {
      throw new HttpError(400, 'Neznan kanal')
    }
    let machine = typeof body.machine === 'string' ? body.machine.trim().slice(0, 40) : ''
    machine = machine.replace(/[\u0000-\u001f]/g, '')
    rateCheck(me.id)
    const ev = append({
      t: 'msg',
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      channel,
      from: me.id,
      name: me.name,
      at: now().toISOString(),
      text,
      ...(machine ? { machine } : {}),
    })
    // posiljatelj je svoje sporocilo ze "prebral"
    userReads(me.id).ch[channel] = ev.seq
    saveReads()
    publish(eventPayload(ev), 'message')
    return publicMsg(messages.get(ev.id))
  }

  function setDone(body) {
    const me = requireUser(body.user)
    const m = messages.get(body.id)
    if (!m || !canSee(me.id, m.channel)) throw new HttpError(404, 'Sporočilo ne obstaja')
    const on = body.on === undefined ? !m.done : !!body.on
    if (!!m.done === on) return publicMsg(m)
    const ev = append({ t: 'done', id: m.id, on, by: me.id, name: me.name, at: now().toISOString() })
    publish(eventPayload(ev), 'done')
    return publicMsg(m)
  }

  function markRead(body) {
    const me = requireUser(body.user)
    if (!canSee(me.id, body.channel)) throw new HttpError(400, 'Neznan kanal')
    const r = userReads(me.id)
    const s = Math.min(Number(body.seq) || 0, seq)
    if (s > (r.ch[body.channel] || 0)) {
      r.ch[body.channel] = s
      saveReads()
    }
    // drugi zavihki istega uporabnika
    for (const c of clients) if (c.userId === me.id) sendTo(c, { seq: 0, channel: body.channel, upTo: s }, 'read')
    return { ok: true }
  }

  function channelsFor(userId) {
    const lastBy = (ch) => {
      const l = byChannel.get(ch)
      return l && l.length ? l[l.length - 1].seq : 0
    }
    const groups = CHANNELS.map((c) => ({ ...c, last: lastBy(c.id) }))
    const people = getUsers()
      .filter((u) => u.id !== userId)
      .map((u) => {
        const id = dmId(userId, u.id)
        return { id, kind: 'dm', name: u.name, with: u.id, role: u.role, last: lastBy(id) }
      })
      .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name, 'sl'))
    return { groups, people }
  }

  function bootstrap(userId) {
    const me = requireUser(userId)
    const { groups, people } = channelsFor(me.id)
    const msgs = {}
    for (const ch of [...groups, ...people]) {
      const list = byChannel.get(ch.id)
      if (list && list.length) msgs[ch.id] = list.slice(-BOOT_PER_CHANNEL).map(publicMsg)
    }
    return { me, groups, people, unread: unreadFor(me.id), messages: msgs, lastSeq: seq }
  }

  function history(userId, channel, before, limit) {
    const me = requireUser(userId)
    if (!canSee(me.id, channel)) throw new HttpError(400, 'Neznan kanal')
    const list = (byChannel.get(channel) || []).filter((m) => !before || m.seq < before)
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200)
    return { messages: list.slice(-n).map(publicMsg), more: list.length > n }
  }

  function search(userId, q, channel, machine) {
    const me = requireUser(userId)
    const needle = fold(q).trim()
    const mach = fold(machine).trim()
    if (!needle && !mach) return { results: [] }
    const out = []
    for (const [ch, list] of byChannel) {
      if (!canSee(me.id, ch)) continue
      if (channel && channel !== ch) continue
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]
        if (mach && fold(m.machine) !== mach) continue
        if (needle && !fold(m.text).includes(needle) && !fold(m.name).includes(needle) && !fold(m.machine).includes(needle)) continue
        out.push({ ...publicMsg(m), channelName: channelName(ch, me.id) })
      }
    }
    out.sort((a, b) => b.seq - a.seq)
    return { results: out.slice(0, 50) }
  }

  /** Kompakten seznam za Windows notifier (toast). since ni podan -> samo trenutni seq (brez poplave). */
  let boardNotify = null
  function notifyPoll(userId, since, bsince) {
    const me = requireUser(userId)
    const b = boardNotify ? boardNotify(me.id, bsince) : { bseq: 0, items: [] }
    if (since === undefined || since === null || since === '' || !Number.isFinite(Number(since))) {
      return { seq, bseq: b.bseq, items: [] }
    }
    const s = Number(since)
    const items = []
    for (let i = events.length - 1; i >= 0 && events[i].seq > s; i--) {
      const ev = events[i]
      if (ev.t !== 'msg' || ev.from === me.id || !canSee(me.id, ev.channel)) continue
      const isDm = ev.channel.startsWith('dm:')
      const where = isDm ? ev.name : `${channelName(ev.channel, me.id)} · ${ev.name}`
      items.push({
        kind: 'chat',
        seq: ev.seq,
        channel: ev.channel,
        title: where,
        body: ev.text.length > 140 ? ev.text.slice(0, 137) + '…' : ev.text,
        machine: ev.machine || '',
        nujno: ev.channel === 'nujno',
        at: ev.at,
        url: `/#/klepet/${encodeURIComponent(ev.channel)}`,
      })
      if (items.length >= 20) break
    }
    items.reverse()
    return { seq, bseq: b.bseq, items: [...items, ...b.items] }
  }

  // ---------- HTTP ----------
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > 64 * 1024) {
          reject(new HttpError(413, 'Preveliko'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        try {
          const o = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          resolve(o && typeof o === 'object' ? o : {})
        } catch {
          reject(new HttpError(400, 'Neveljaven JSON'))
        }
      })
      req.on('error', reject)
    })
  }
  const json = (res, status, body) => {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  }

  function openStream(req, res, userId) {
    const me = requireUser(userId)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    req.socket.setNoDelay?.(true)
    req.socket.setKeepAlive?.(true, 30_000)
    res.write('retry: 3000\n\n')
    const c = { res, userId: me.id }
    // ponovna povezava: ponovi zamujene dogodke
    const last = Number(req.headers['last-event-id'])
    if (Number.isFinite(last) && last > 0) {
      for (const ev of events) {
        if (ev.seq <= last) continue
        const ch = ev.t === 'msg' ? ev.channel : messages.get(ev.id)?.channel
        if (ch && !canSee(me.id, ch)) continue
        sendTo(c, eventPayload(ev), ev.t === 'msg' ? 'message' : 'done')
      }
    } else {
      res.write(`id: ${seq}\nevent: hello\ndata: ${JSON.stringify({ seq })}\n\n`)
    }
    clients.add(c)
    const drop = () => clients.delete(c)
    req.on('close', drop)
    res.on('close', drop)
  }

  /** @returns {Promise<boolean>} true ce je zahtevo obdelal */
  async function handle(req, res, url) {
    const p = url.pathname
    const method = req.method || 'GET'
    if (!(p.startsWith('/api/chat/') || p === '/api/notify/poll' || p === '/api/users')) return false
    try {
      const q = url.searchParams
      if (method === 'GET') {
        if (p === '/api/chat/events') return openStream(req, res, q.get('user')), true
        if (p === '/api/chat/bootstrap') return json(res, 200, bootstrap(q.get('user'))), true
        if (p === '/api/chat/history') return json(res, 200, history(q.get('user'), q.get('channel'), Number(q.get('before')) || 0, q.get('limit'))), true
        if (p === '/api/chat/search') return json(res, 200, search(q.get('user'), q.get('q') || '', q.get('channel') || '', q.get('machine') || '')), true
        if (p === '/api/notify/poll') return json(res, 200, notifyPoll(q.get('user'), q.get('since'), q.get('bsince'))), true
        if (p === '/api/users') return json(res, 200, getUsers()), true
      } else if (method === 'POST') {
        if (p === '/api/chat/messages') return json(res, 201, postMessage(await readJson(req))), true
        if (p === '/api/chat/done') return json(res, 200, setDone(await readJson(req))), true
        if (p === '/api/chat/read') return json(res, 200, markRead(await readJson(req))), true
      }
      json(res, 404, { error: 'Ni najdeno' })
    } catch (err) {
      if (err instanceof HttpError) json(res, err.status, { error: err.message })
      else {
        log.error(err)
        json(res, 500, { error: 'Napaka strežnika' })
      }
    }
    return true
  }

  /** za druge module (tablo): oddaj dogodek vsem odprtim SSE povezavam */
  function broadcast(name, payload) {
    for (const c of clients) {
      try {
        c.res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`)
      } catch {
        clients.delete(c)
      }
    }
  }

  function close() {
    clearInterval(pingTimer)
    flushReads()
    for (const c of clients) {
      try {
        c.res.end()
      } catch {
        /* ignore */
      }
    }
    clients.clear()
  }

  return { broadcast, userById, setBoardNotify: (f) => { boardNotify = f }, handle, close, flushReads, postMessage, setDone, markRead, bootstrap, history, search, notifyPoll, getUsers, get seq() { return seq }, paths: { logPath, readsPath }, clientCount: () => clients.size }
}
