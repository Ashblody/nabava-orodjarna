/**
 * Varno shranjevanje db.json (brez odvisnosti).
 *
 *  - db.json se NIKOLI ne prepise, ce je pokvarjen: preimenuje se v
 *    db.corrupt-<cas>.json (ostane za vedno), aplikacija dobi prazno bazo.
 *  - pred vsakim zapisom (PUT) se prejsnja veljavna razlicica kopira v db.prev.json
 *  - varnostne kopije v data/backups/db-YYYY-MM-DD_HHMMSS.json
 *    (ob zagonu + dnevno, hrani zadnjih 14)
 *  - neobvezno: kopije se zrcalijo se v omrezno mapo (NABAVA_BACKUP_SHARE), ce je nastavljena
 *
 * Oblika db.json se ne spreminja.
 */
import fs from 'node:fs'
import path from 'node:path'

export const KEEP_BACKUPS = 14
const DAY_MS = 24 * 60 * 60 * 1000

export const emptyDb = () => ({
  version: 2,
  requests: [],
  tasks: [],
  stock: [],
  faults: [],
  services: [],
  suppliers: [],
  users: [],
})

const pad = (n) => String(n).padStart(2, '0')

/** Cas za imena datotek (lokalni cas streznika): 2026-10-02_093015 */
export function stamp(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

export function createStore(dataDir, log = console, offsiteDir = '') {
  const dir = path.resolve(dataDir)
  const dbPath = path.join(dir, 'db.json')
  const prevPath = path.join(dir, 'db.prev.json')
  const backupDir = path.join(dir, 'backups')
  // true, ko vemo, da je db.json na disku veljaven (po preverjanju ali po nasem zapisu)
  let verified = false

  function ensureDirs() {
    fs.mkdirSync(dir, { recursive: true })
  }

  function uniqueCorruptPath() {
    let p = path.join(dir, `db.corrupt-${stamp()}.json`)
    let i = 1
    while (fs.existsSync(p)) p = path.join(dir, `db.corrupt-${stamp()}-${i++}.json`)
    return p
  }

  /** Vrne {ok:true, data} | {ok:true, data:null} (ni datoteke) | {ok:false}; pokvarjeno preimenuje. */
  function check() {
    if (!fs.existsSync(dbPath)) return { ok: true, data: null }
    let raw
    try {
      raw = fs.readFileSync(dbPath, 'utf8')
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('db.json ni objekt')
      return { ok: true, data: parsed }
    } catch (err) {
      const target = uniqueCorruptPath()
      try {
        fs.renameSync(dbPath, target)
        log.error(`[db] db.json je pokvarjen (${err.message}) -> preimenovan v ${path.basename(target)}`)
      } catch (e2) {
        log.error(`[db] db.json je pokvarjen in ga ni mogoce preimenovati: ${e2.message}`)
      }
      return { ok: false }
    }
  }

  function readDb() {
    ensureDirs()
    const r = check()
    if (r.ok && r.data) {
      verified = true
      return r.data
    }
    if (r.ok) verified = true // ni datoteke = prazna baza
    return emptyDb()
  }

  function writeDb(obj) {
    ensureDirs()
    if (!verified) {
      check() // ce je na disku pokvarjen db.json, ga najprej preimenuje (nikoli prepisan)
      verified = true
    }
    if (fs.existsSync(dbPath)) {
      try {
        fs.copyFileSync(dbPath, prevPath)
      } catch (err) {
        log.error(`[db] db.prev.json ni uspel: ${err.message}`)
      }
    }
    const tmp = dbPath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8')
    fs.renameSync(tmp, dbPath)
  }

  function listBackups() {
    if (!fs.existsSync(backupDir)) return []
    return fs
      .readdirSync(backupDir)
      .filter((f) => /^db-\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(f))
      .sort()
  }

  function pruneBackups(keep = KEEP_BACKUPS) {
    const all = listBackups()
    for (const f of all.slice(0, Math.max(0, all.length - keep))) {
      try {
        fs.unlinkSync(path.join(backupDir, f))
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Naredi varnostno kopijo db.json. Preskoci, ce ni veljavnega db.json ali ce je
   * najnovejsa kopija identicna (npr. veckratni zagon brez sprememb).
   * @returns {string|null} ime nove kopije ali null
   */
  function backup(now = new Date()) {
    ensureDirs()
    const r = check()
    if (!r.ok || !r.data) return null
    verified = true
    fs.mkdirSync(backupDir, { recursive: true })
    const last = listBackups().pop()
    if (last) {
      try {
        const a = fs.readFileSync(dbPath)
        const b = fs.readFileSync(path.join(backupDir, last))
        if (a.equals(b)) return null
      } catch {
        /* nadaljuj z novo kopijo */
      }
    }
    let name = `db-${stamp(now)}.json`
    if (fs.existsSync(path.join(backupDir, name))) return null
    const tmp = path.join(backupDir, name + '.tmp')
    fs.copyFileSync(dbPath, tmp)
    fs.renameSync(tmp, path.join(backupDir, name))
    pruneBackups()
    return name
  }

  /** Dnevna kopija: ce je najnovejsa starejsa od 24 h (preveri se vsako uro). */
  function backupIfDue(now = new Date()) {
    const last = listBackups().pop()
    if (last) {
      try {
        const age = now.getTime() - fs.statSync(path.join(backupDir, last)).mtimeMs
        if (age < DAY_MS) return null
      } catch {
        /* nadaljuj */
      }
    }
    return backup(now)
  }

  // ---- kopija izven racunalnika (omrezna mapa), neobvezno; prazno = izklopljeno.
  // Nikoli ne ustavi streznika: ce mapa ni dosegljiva, samo opozori v log (enkrat).
  const offsite = (offsiteDir || '').trim()
  let offsiteWarned = false
  let offsiteBusy = false

  /** Prekopira lokalne kopije, ki jih v omrezni mapi se ni, in obdrzi zadnjih 14. Asinhrono. */
  async function mirrorOffsite() {
    if (!offsite || offsiteBusy) return { copied: [], error: null }
    offsiteBusy = true
    const copied = []
    try {
      await fs.promises.mkdir(offsite, { recursive: true })
      const have = new Set((await fs.promises.readdir(offsite)).filter((f) => /^db-\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(f)))
      for (const f of listBackups()) {
        if (have.has(f)) continue
        const tmp = path.join(offsite, f + '.tmp')
        await fs.promises.copyFile(path.join(backupDir, f), tmp)
        await fs.promises.rename(tmp, path.join(offsite, f))
        have.add(f)
        copied.push(f)
      }
      const all = [...have].sort()
      for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) {
        await fs.promises.unlink(path.join(offsite, f)).catch(() => {})
      }
      if (offsiteWarned) log.log('[db] omrezna mapa spet dosegljiva')
      offsiteWarned = false
      if (copied.length) log.log(`[db] kopija v omrezno mapo (${offsite}): ${copied.join(', ')}`)
      return { copied, error: null }
    } catch (err) {
      if (!offsiteWarned) log.error(`[db] OPOZORILO: omrezna mapa ni dosegljiva (${offsite}): ${err.message}. Streznik dela naprej.`)
      offsiteWarned = true
      return { copied, error: err }
    } finally {
      offsiteBusy = false
    }
  }

  function startBackups(intervalMs = 60 * 60 * 1000) {
    try {
      const n = backup()
      if (n) log.log(`[db] varnostna kopija: backups/${n}`)
    } catch (err) {
      log.error(`[db] varnostna kopija ni uspela: ${err.message}`)
    }
    mirrorOffsite().catch(() => {})
    const t = setInterval(() => {
      try {
        const n = backupIfDue()
        if (n) log.log(`[db] dnevna kopija: backups/${n}`)
      } catch (err) {
        log.error(`[db] dnevna kopija ni uspela: ${err.message}`)
      }
      mirrorOffsite().catch(() => {})
    }, intervalMs)
    t.unref()
    return t
  }

  return { dir, dbPath, prevPath, backupDir, readDb, writeDb, backup, backupIfDue, listBackups, pruneBackups, startBackups, mirrorOffsite, offsiteDir: offsite }
}
