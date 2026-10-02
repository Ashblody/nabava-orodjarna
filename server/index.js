/**
 * Lightweight LAN server for Nabava — Orodjarna.
 * Zero dependencies. Serves dist/ and GET+PUT /api/data.
 *
 * Env:
 *   PORT              default 8787
 *   NABAVA_DATA_DIR   default ./data (relative to process cwd)
 *   NABAVA_BACKUP_SHARE  neobvezno: omrezna mapa za dnevno kopijo (prazno = izklopljeno)
 *
 * Varnost podatkov: glej server/store.js (backups/, db.prev.json, db.corrupt-*.json).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 8787
const HOST = '0.0.0.0'
const DATA_DIR = path.resolve(process.env.NABAVA_DATA_DIR || path.join(process.cwd(), 'data'))
const DIST = path.resolve(__dirname, '..', 'dist')

const { server, store, board } = createApp({ dataDir: DATA_DIR, distDir: DIST, offsiteDir: process.env.NABAVA_BACKUP_SHARE || '' })

server.on('error', (err) => {
  console.error(`Streznik ni mogel zagnati (${err.code || err.message}). Port ${PORT} je morda ze zaseden.`)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`Nabava Orodjarna LAN server`)
  console.log(`  http://${HOST}:${PORT}/`)
  console.log(`  data: ${store.dbPath}`)
  console.log(`  dist: ${DIST}`)
  console.log(`  kopija v omrezno mapo: ${store.offsiteDir || '(izklopljeno)'}`)
  store.startBackups()
  board.startBackups()
})
