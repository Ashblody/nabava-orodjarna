/**
 * HTTP aplikacija za Nabava Orodjarna (brez odvisnosti).
 * API: GET/PUT /api/data (oblika se ne spreminja) + statika iz dist/.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createStore } from './store.js'

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

function serveStatic(DIST, req, res, urlPath) {
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

export function createApp({ dataDir, distDir, log = console }) {
  const DIST = path.resolve(distDir)
  const store = createStore(dataDir, log)
  store.readDb() // preveri db.json ob zagonu (pokvarjen -> db.corrupt-*.json)

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET'
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    try {
      if (pathname === '/api/data' && method === 'GET') {
        send(res, 200, store.readDb(), {
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
        store.writeDb(parsed)
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
      serveStatic(DIST, req, res, pathname)
    } catch (err) {
      log.error(err)
      send(res, 500, { error: 'Server error' }, { 'Content-Type': 'application/json; charset=utf-8' })
    }
  })

  return { server, store }
}
