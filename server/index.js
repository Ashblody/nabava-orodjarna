/**
 * Lightweight LAN server for Nabava — Orodjarna.
 * Zero dependencies. Serves dist/ and GET+PUT /api/data.
 *
 * Env:
 *   PORT              default 8787
 *   NABAVA_DATA_DIR   default ./data (relative to process cwd)
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 8787
const HOST = '0.0.0.0'
const DATA_DIR = path.resolve(process.env.NABAVA_DATA_DIR || path.join(process.cwd(), 'data'))
const DB_PATH = path.join(DATA_DIR, 'db.json')
const DIST = path.resolve(__dirname, '..', 'dist')

const EMPTY = {
  version: 2,
  requests: [],
  tasks: [],
  stock: [],
  faults: [],
  services: [],
  suppliers: [],
  users: [],
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return { ...EMPTY }
    const raw = fs.readFileSync(DB_PATH, 'utf8')
    if (!raw.trim()) return { ...EMPTY }
    return JSON.parse(raw)
  } catch {
    return { ...EMPTY }
  }
}

function writeDb(obj) {
  ensureDataDir()
  const tmp = DB_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8')
  fs.renameSync(tmp, DB_PATH)
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, headers)
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const MAX = 50 * 1024 * 1024
    req.on('data', (c) => {
      size += c.length
      if (size > MAX) {
        reject(new Error('Payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const full = path.join(root, cleaned)
  if (!full.startsWith(root)) return null
  return full
}

function serveStatic(req, res, urlPath) {
  let filePath = safeJoin(DIST, urlPath === '/' ? '/index.html' : urlPath)
  if (!filePath) {
    send(res, 403, 'Forbidden')
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(DIST, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    send(res, 404, 'Not found')
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const data = fs.readFileSync(filePath)
  send(res, 200, data, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' || ext === '.json' ? 'no-cache' : 'public, max-age=3600',
  })
}

ensureDataDir()

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET'
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  try {
    if (pathname === '/api/data' && method === 'GET') {
      send(res, 200, readDb(), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      return
    }

    if (pathname === '/api/data' && method === 'PUT') {
      const buf = await readBody(req)
      let parsed
      try {
        parsed = JSON.parse(buf.toString('utf8') || '{}')
      } catch {
        send(res, 400, { error: 'Invalid JSON' }, { 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      writeDb(parsed)
      send(res, 200, { ok: true }, { 'Content-Type': 'application/json; charset=utf-8' })
      return
    }

    if (pathname === '/api/data' && method === 'OPTIONS') {
      send(res, 204, '', {
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      return
    }

    // Static (includes /version.json from dist)
    serveStatic(req, res, pathname)
  } catch (err) {
    console.error(err)
    send(res, 500, { error: 'Server error' }, { 'Content-Type': 'application/json; charset=utf-8' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Nabava Orodjarna LAN server`)
  console.log(`  http://${HOST}:${PORT}/`)
  console.log(`  data: ${DB_PATH}`)
  console.log(`  dist: ${DIST}`)
})
