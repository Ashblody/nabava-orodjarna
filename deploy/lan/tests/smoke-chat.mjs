// Brskalniški preizkus klepeta (ročno, ni del 'node --test'). Potrebuje: npm i puppeteer-core, Chrome (CHROME=/pot), strežnik na :8787
// z db.json z uporabnikoma u-ana (vodja) in u-bor (delavec) ter praznim data/chat. Poženi: node deploy/lan/tests/smoke-chat.mjs
import puppeteer from 'puppeteer-core'
const BASE = 'http://localhost:8787'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] })
let fails = 0
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++ }
async function userPage(id, name, role, hash) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1100, height: 800 })
  page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++ })
  await page.evaluateOnNewDocument((s) => localStorage.setItem('nabava-orodjarna-session-v2', JSON.stringify(s)), { userId: id, role, displayName: name })
  await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle2' })
  return page
}
const A = await userPage('u-ana', 'Ana', 'vodja', '#/klepet/plani')
const B = await userPage('u-bor', 'Borut', 'delavec', '#/klepet/plani')
await A.waitForSelector('.chat textarea'); await B.waitForSelector('.chat textarea')
const names = await A.$$eval('.chat-ch-name', (e) => e.map((x) => x.textContent))
ok(JSON.stringify(names) === JSON.stringify(['Splošno', 'Plani', 'Nujno', 'Razno', 'Borut']), 'kanali v UI: ' + names.join(','))
// Ana sends with machine tag
await A.click('.chat-machine-btn'); await A.click('[data-machine="Okuma Genos"]')
await A.type('.chat textarea', 'Pozdrav iz brskalnika')
await A.keyboard.press('Enter')
await B.waitForFunction(() => document.querySelector('.chat-msgs')?.textContent.includes('Pozdrav iz brskalnika'), { timeout: 4000 })
ok(true, 'Borut je prejel sporočilo v živo (SSE)')
const chip = await B.$eval('.chat-msgs .chat-machine', (e) => e.textContent)
ok(chip === 'Okuma Genos', 'oznaka stroja prikazana: ' + chip)
// Borut: kljukica
await B.click('.chat-msg [data-done]')
await A.waitForFunction(() => document.querySelector('.chat-msg.is-done'), { timeout: 4000 })
ok(true, 'kljukica se prenese k Ani')
// Borut: fokus + osnutek ohranjen ob render()
await B.click('.chat textarea'); await B.type('.chat textarea', 'osnutek')
await B.evaluate(() => { location.hash = '#/klepet/plani?x'; })
await B.evaluate(() => { location.hash = '#/klepet/plani' })
await sleep(300)
const st = await B.evaluate(() => ({ f: document.activeElement?.tagName, v: document.querySelector('.chat textarea').value }))
ok(st.f === 'TEXTAREA' && st.v === 'osnutek', 'fokus in osnutek ohranjena po render(): ' + JSON.stringify(st))
// neprebrano v Nujno: Ana pošlje v nujno, Borut je v Plani
await A.click('[data-ch="nujno"]'); await A.type('.chat textarea', 'NUJNO test'); await A.keyboard.press('Enter')
await B.waitForFunction(() => document.querySelector('[data-ch="nujno"] .chat-unread')?.textContent === '1', { timeout: 4000 })
ok(true, 'števec neprebranega pri Nujno = 1')
const tabBadge = await B.$eval('[data-chat-badge]', (e) => e.textContent + (e.hidden ? ' hidden' : ''))
ok(tabBadge === '1', 'značka na zavihku: ' + tabBadge)
await B.click('[data-ch="nujno"]')
await B.waitForFunction(() => !document.querySelector('[data-ch="nujno"] .chat-unread'), { timeout: 4000 })
ok(true, 'neprebrano izgine ob odprtju kanala')
// iskanje
await B.click('.chat-head button'); await B.type('.chat-search input', 'brskalnika')
await B.waitForSelector('.chat-hit', { timeout: 4000 })
await B.click('.chat-hit')
await B.waitForFunction(() => document.querySelector('.chat-title').textContent.includes('Plani'), { timeout: 4000 })
ok(true, 'iskanje + skok na sporočilo')
// obstoječe zavihke
await B.click('[data-tab="nabava"]'); await sleep(200)
ok(!!(await B.$('main .card, main form, main section')), 'zavihek Nabava še dela')
await B.click('[data-tab="klepet"]'); await sleep(200)
ok(!!(await B.$('.chat textarea')), 'nazaj v Klepet')
await browser.close()
console.log(fails ? `FAILED ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0)
