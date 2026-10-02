import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore, emptyDb } from '../store.js'

const quiet = { log() {}, error() {} }
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nabava-test-'))
const sample = (n = 1) => ({ ...emptyDb(), users: [{ id: 'u' + n, name: 'Test ' + n, role: 'delavec', createdAt: 'x' }] })

test('manjkajoca db.json -> prazna baza, nic se ne ustvari na disku', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  assert.deepEqual(s.readDb(), emptyDb())
  assert.equal(fs.existsSync(s.dbPath), false)
})

test('writeDb/readDb: oblika ostane enaka, ni .tmp ostanka', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  const data = sample(1)
  s.writeDb(data)
  assert.deepEqual(s.readDb(), data)
  assert.equal(fs.readFileSync(s.dbPath, 'utf8'), JSON.stringify(data))
  assert.equal(fs.existsSync(s.dbPath + '.tmp'), false)
})

test('db.prev.json = predhodna razlicica pred PUT', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  s.writeDb(sample(1))
  assert.equal(fs.existsSync(s.prevPath), false)
  s.writeDb(sample(2))
  assert.deepEqual(JSON.parse(fs.readFileSync(s.prevPath, 'utf8')), sample(1))
  assert.deepEqual(s.readDb(), sample(2))
})

test('pokvarjen db.json se preimenuje v db.corrupt-*, vrne se prazna baza', () => {
  const d = tmpDir()
  fs.writeFileSync(path.join(d, 'db.json'), '{"version":2,"requests":[{')
  const s = createStore(d, quiet)
  assert.deepEqual(s.readDb(), emptyDb())
  assert.equal(fs.existsSync(s.dbPath), false)
  const corrupt = fs.readdirSync(d).filter((f) => /^db\.corrupt-.*\.json$/.test(f))
  assert.equal(corrupt.length, 1)
  assert.equal(fs.readFileSync(path.join(d, corrupt[0]), 'utf8'), '{"version":2,"requests":[{')
})

test('prazna datoteka db.json velja za pokvarjeno', () => {
  const d = tmpDir()
  fs.writeFileSync(path.join(d, 'db.json'), '')
  const s = createStore(d, quiet)
  s.readDb()
  assert.equal(fs.readdirSync(d).filter((f) => f.startsWith('db.corrupt-')).length, 1)
})

test('PUT nikoli ne prepise pokvarjene datoteke (tudi brez predhodnega branja)', () => {
  const d = tmpDir()
  fs.writeFileSync(path.join(d, 'db.json'), 'NI JSON')
  const s = createStore(d, quiet)
  s.writeDb(sample(3)) // brez readDb pred tem
  assert.deepEqual(JSON.parse(fs.readFileSync(s.dbPath, 'utf8')), sample(3))
  const corrupt = fs.readdirSync(d).filter((f) => f.startsWith('db.corrupt-'))
  assert.equal(corrupt.length, 1)
  assert.equal(fs.readFileSync(path.join(d, corrupt[0]), 'utf8'), 'NI JSON')
  // pokvarjena vsebina ni prisla v db.prev.json
  assert.equal(fs.existsSync(s.prevPath), false)
})

test('vec pokvarjenih datotek v isti sekundi se ne prepisujejo', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(s.dbPath, 'x' + i)
    s.readDb()
  }
  assert.equal(fs.readdirSync(d).filter((f) => f.startsWith('db.corrupt-')).length, 3)
})

test('backup: ustvari kopijo, identicne ne podvaja, pokvarjene ne kopira', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  assert.equal(s.backup(), null) // ni db.json
  s.writeDb(sample(1))
  const n1 = s.backup(new Date(2026, 0, 1, 8, 0, 0))
  assert.equal(n1, 'db-2026-01-01_080000.json')
  assert.equal(s.backup(new Date(2026, 0, 1, 9, 0, 0)), null) // enako
  s.writeDb(sample(2))
  assert.equal(s.backup(new Date(2026, 0, 1, 10, 0, 0)), 'db-2026-01-01_100000.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.backupDir, n1), 'utf8')), sample(1))
})

test('backup: hrani samo zadnjih 14', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  for (let i = 1; i <= 20; i++) {
    s.writeDb(sample(i))
    assert.ok(s.backup(new Date(2026, 0, i, 8, 0, 0)))
  }
  const files = s.listBackups()
  assert.equal(files.length, 14)
  assert.equal(files[0], 'db-2026-01-07_080000.json')
  assert.equal(files[13], 'db-2026-01-20_080000.json')
})

test('backupIfDue: dnevno (po 24 h), ne prej', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  s.writeDb(sample(1))
  const now = new Date()
  assert.ok(s.backup(new Date(now.getTime() - 1000)))
  s.writeDb(sample(2))
  assert.equal(s.backupIfDue(now), null) // mlajse od 24 h
  const later = new Date(now.getTime() + 25 * 3600 * 1000)
  assert.ok(s.backupIfDue(later))
})

test('startBackups: kopija ob zagonu', () => {
  const d = tmpDir()
  const s = createStore(d, quiet)
  s.writeDb(sample(1))
  const t = s.startBackups(1e9)
  clearInterval(t)
  assert.equal(s.listBackups().length, 1)
})
