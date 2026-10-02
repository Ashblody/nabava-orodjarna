/**
 * "Kaj se mudi" - nujna opravila delavnice (brez odvisnosti).
 *
 * Shramba: data/board.json  { rev, items: [...] }   (loceno od db.json, ki ga tu ne beremo ne pisemo)
 *   - atomarni zapis (tmp + rename), pred vsakim zapisom board.prev.json
 *   - kopije data/backups/board-YYYY-MM-DD_HHMMSS.json ob zagonu + dnevno (zadnjih 14)
 *   - pokvarjen board.json se preimenuje v board.corrupt-<cas>.json (nikoli prepisan)
 * Postavka: { id, wo (delovni nalog), customer (stranka), date (YYYY-MM-DD), text, machine?, by, name, at, cr (rev ob nastanku), done: null|{by,name,at} }
 * Realtime: ob vsaki spremembi se prek SSE (chat.broadcast) vsem odjemalcem poslje dogodek "board" s celotnim seznamom.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { stamp } from './store.js'

const KEEP = 14
const DAY_MS = 24 * 60 * 60 * 1000
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
const LIMITS = { wo: 40, customer: 80, text: 300, machine: 40 }
export const DONE_KEEP_DAYS = 14

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const clean = (v, max) =>
  typeof v === 'string'
    ? // eslint-disable-next-line no-control-regex
      v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : ''

/** lokalni datum YYYY-MM-DD */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** @param {{ userById: (id:string)=>({id:string,name:string}|undefined), broadcast?: (name:string, payload:any)=>void, now?: ()=>Date }} deps */
export function createBoard(dataDir, log = console, deps) {
  const dir = path.resolve(dataDir)
  const file = path.join(dir, 'board.json')
  const prevFile = path.join(dir, 'board.prev.json')
  const backupDir = path.join(dir, 'backups')
  const now = deps.now || (() => new Date())
  let state = { rev: 0, items: [] }

  function load() {
    if (!fs.existsSync(file)) return
    try {
      let raw = fs.readFileSync(file, 'utf8')
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
      const j = JSON.parse(raw)
      if (!j || !Array.isArray(j.items)) throw new Error('neveljavna oblika')
      state = { rev: Number(j.rev) || 0, items: j.items.filter((i) => i && typeof i.id === 'string') }
    } catch (err) {
      let target = path.join(dir, `board.corrupt-${stamp()}.json`)
      for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `board.corrupt-${stamp()}-${i}.json`)
      try {
        fs.renameSync(file, target)
        log.error(`[mudi] board.json je pokvarjen (${err.message}) -> ${path.basename(target)}`)
      } catch (e2) {
        log.error(`[mudi] board.json je pokvarjen in ga ni mogoce preimenovati: ${e2.message}`)
      }
    }
  }
  load()

  function listBackups() {
    try {
      return fs.readdirSync(backupDir).filter((f) => /^board-\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(f)).sort()
    } catch {
      return []
    }
  }
  /** kopija, ce je najnovejsa starejsa od 24 h (ali je ni); samo ce board.json obstaja */
  function backupIfDue() {
    try {
      if (!fs.existsSync(file)) return null
      const last = listBackups().pop()
      if (last && now().getTime() - fs.statSync(path.join(backupDir, last)).mtimeMs < DAY_MS) return null
      fs.mkdirSync(backupDir, { recursive: true })
      const name = `board-${stamp(now())}.json`
      if (fs.existsSync(path.join(backupDir, name))) return null
      fs.copyFileSync(file, path.join(backupDir, name + '.tmp'))
      fs.renameSync(path.join(backupDir, name + '.tmp'), path.join(backupDir, name))
      const all = listBackups()
      for (const f of all.slice(0, Math.max(0, all.length - KEEP))) fs.unlinkSync(path.join(backupDir, f))
      return name
    } catch (err) {
      log.error(`[mudi] kopija ni uspela: ${err.message}`)
      return null
    }
  }

  function save() {
    fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, prevFile)
      } catch (err) {
        log.error(`[mudi] board.prev.json ni uspel: ${err.message}`)
      }
    }
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8')
    fs.renameSync(tmp, file)
    backupIfDue()
  }

  function startBackups(intervalMs = 60 * 60 * 1000) {
    backupIfDue()
    const t = setInterval(backupIfDue, intervalMs)
    t.unref?.()
    return t
  }

  /** postavke za prikaz: odprte + narejene zadnjih 14 dni */
  function view() {
    const cutoff = now().getTime() - DONE_KEEP_DAYS * DAY_MS
    return {
      rev: state.rev,
      items: state.items.filter((i) => !i.done || new Date(i.done.at).getTime() >= cutoff),
    }
  }

  function changed() {
    state.rev += 1
    save()
    deps.broadcast?.('board', view())
  }

  function requireUser(id) {
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'Manjka uporabnik')
    const u = deps.userById(id)
    if (!u) throw new HttpError(403, 'Neznan uporabnik')
    return u
  }

  function add(body) {
    const me = requireUser(body.user)
    const wo = clean(body.wo, LIMITS.wo)
    const customer = clean(body.customer, LIMITS.customer)
    const text = clean(body.text, LIMITS.text)
    const machine = clean(body.machine, LIMITS.machine)
    let date = typeof body.date === 'string' ? body.date.trim() : ''
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Neveljaven datum')
    if (date && Number.isNaN(new Date(date + 'T12:00:00').getTime())) throw new HttpError(400, 'Neveljaven datum')
    if (!wo && !customer && !text) throw new HttpError(400, 'Vpiši delovni nalog, stranko ali opis')
    // enak vnos v zadnjih 10 s (dvojni klik) ne naredi dvojnika
    const t = now().getTime()
    const dup = state.items.find(
      (i) => !i.done && i.by === me.id && i.wo === wo && i.customer === customer && i.text === text && i.date === date && t - new Date(i.at).getTime() < 10_000,
    )
    if (dup) return dup
    const item = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      wo,
      customer,
      date,
      text,
      ...(machine ? { machine } : {}),
      by: me.id,
      name: me.name,
      at: now().toISOString(),
      cr: state.rev + 1,
      done: null,
    }
    state.items.push(item)
    changed()
    return item
  }

  function setDone(body) {
    const me = requireUser(body.user)
    const it = state.items.find((i) => i.id === body.id)
    if (!it) throw new HttpError(404, 'Postavka ne obstaja')
    const on = body.on === undefined ? !it.done : !!body.on
    if (!!it.done === on) return it
    it.done = on ? { by: me.id, name: me.name, at: now().toISOString() } : null
    changed()
    return it
  }

  function remove(body) {
    requireUser(body.user)
    const i = state.items.findIndex((x) => x.id === body.id)
    if (i < 0) throw new HttpError(404, 'Postavka ne obstaja')
    state.items.splice(i, 1)
    changed()
    return { ok: true }
  }

  /** za notifier: nove (odprte, tuje) postavke od bsince naprej; brez bsince samo trenutni rev */
  function notify(userId, bsince) {
    const out = { bseq: state.rev, items: [] }
    if (bsince === undefined || bsince === null || bsince === '' || !Number.isFinite(Number(bsince))) return out
    const s = Number(bsince)
    const today = localDate(now())
    for (const it of state.items) {
      if (it.cr <= s || it.by === userId || it.done) continue
      const parts = []
      if (it.wo) parts.push('DN ' + it.wo)
      if (it.customer) parts.push(it.customer)
      if (it.date) parts.push('rok ' + it.date.slice(8, 10).replace(/^0/, '') + '. ' + it.date.slice(5, 7).replace(/^0/, '') + '.')
      const head = parts.join(' · ')
      const body = [head, it.text].filter(Boolean).join(' — ')
      out.items.push({
        kind: 'board',
        seq: it.cr,
        channel: 'mudi',
        title: 'Kaj se mudi · ' + it.name,
        body: body.length > 140 ? body.slice(0, 137) + '…' : body,
        machine: it.machine || '',
        nujno: !!it.date && it.date <= today,
        at: it.at,
        url: '/#/mudi',
      })
    }
    out.items.sort((a, b) => a.seq - b.seq)
    if (out.items.length > 20) out.items = out.items.slice(-20)
    return out
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > 32 * 1024) {
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

  async function handle(req, res, url) {
    const p = url.pathname
    if (!p.startsWith('/api/board')) return false
    const method = req.method || 'GET'
    try {
      if (method === 'GET' && p === '/api/board') {
        requireUser(url.searchParams.get('user'))
        return json(res, 200, view()), true
      }
      if (method === 'POST' && p === '/api/board/items') return json(res, 201, add(await readJson(req))), true
      if (method === 'POST' && p === '/api/board/done') return json(res, 200, setDone(await readJson(req))), true
      if (method === 'POST' && p === '/api/board/remove') return json(res, 200, remove(await readJson(req))), true
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

  return { handle, add, setDone, remove, view, notify, startBackups, backupIfDue, listBackups, paths: { file, prevFile, backupDir }, get rev() { return state.rev } }
}
