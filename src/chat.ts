/**
 * Klepet (zavihek »Klepet«). Lasten, trajen DOM: render() v main.ts ga NE zgradi znova,
 * ampak ga samo ponovno vstavi (mountChat) in obnovi fokus + drsenje.
 * Povezava: GET /api/chat/bootstrap, SSE /api/chat/events, POST /api/chat/messages|done|read.
 */
import { OKUMA_MACHINES } from './data.ts'
import { escapeHtml } from './storage.ts'

interface Msg {
  id: string
  seq: number
  channel: string
  from: string
  name: string
  at: string
  text: string
  machine?: string
  done: { by: string; name: string; at: string } | null
}
interface Chan {
  id: string
  name: string
  kind: 'group' | 'dm'
  last: number
}
interface SearchHit extends Msg {
  channelName: string
}

const LAST_CH_KEY = 'nabava-orodjarna-chat-last'
const PAGE = 60

let me: { id: string; name: string } | null = null
let groups: Chan[] = []
let people: Chan[] = []
let unread: Record<string, number> = {}
const msgs = new Map<string, Msg[]>()
const hasMore = new Map<string, boolean>()
const drafts = new Map<string, string>()
let current = localStorage.getItem(LAST_CH_KEY) || 'splosno'
let machine = ''
let machineOpen = false
let searchOpen = false
let searchQ = ''
let hits: SearchHit[] | null = null
let searchTimer: number | undefined
let es: EventSource | null = null
let connected = false
let hadError = false
let error = ''
let sending = false
let retryTimer: number | undefined
let ready = false
let visible = false // zavihek Klepet je prikazan
let readTimer: number | undefined
let highlightId = ''
let audioCtx: AudioContext | null = null

let onBadge: (n: number) => void = () => {}
let onIncoming: (m: Msg, chName: string) => void = () => {}

export function setChatHooks(h: { badge: (n: number) => void; incoming: (title: string, text: string, nujno: boolean) => void }) {
  onBadge = h.badge
  onIncoming = (m, chName) => h.incoming(m.channel.startsWith('dm:') ? m.name : `${chName} · ${m.name}`, m.text, m.channel === 'nujno')
}

/* ---------- pomozne ---------- */
const root = document.createElement('div')
root.className = 'chat'
root.innerHTML = `
  <div class="chat-nav" data-ref="nav"></div>
  <div class="chat-main">
    <div class="chat-head">
      <div class="chat-title" data-ref="title"></div>
      <button class="btn btn-ghost btn-sm" type="button" data-ref="searchBtn">Išči</button>
    </div>
    <div class="chat-search" data-ref="search" hidden>
      <input type="search" data-ref="searchInput" placeholder="Išči sporočila, osebe, stroj…" autocomplete="off" />
    </div>
    <div class="chat-status" data-ref="status" hidden></div>
    <div class="chat-msgs" data-ref="list"></div>
    <div class="chat-tag" data-ref="tag"></div>
    <form class="chat-composer" data-ref="form">
      <textarea data-ref="input" rows="1" maxlength="2000" placeholder="Napiši sporočilo…" enterkeyhint="send"></textarea>
      <button class="btn btn-secondary chat-machine-btn" type="button" data-ref="machineBtn">Stroj</button>
      <button class="btn btn-primary chat-send" type="submit" data-ref="send">Pošlji</button>
    </form>
  </div>`
const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!
const navEl = ref('nav')
const titleEl = ref('title')
const searchBtn = ref('searchBtn') as HTMLButtonElement
const searchEl = ref('search')
const searchInput = ref('searchInput') as HTMLInputElement
const statusEl = ref('status')
const listEl = ref('list')
const tagEl = ref('tag')
const formEl = ref('form') as HTMLFormElement
const inputEl = ref('input') as HTMLTextAreaElement
const machineBtn = ref('machineBtn') as HTMLButtonElement
const sendBtn = ref('send') as HTMLButtonElement

function allChans(): Chan[] {
  return [...groups, ...people]
}
function chanName(id: string): string {
  return allChans().find((c) => c.id === id)?.name || (id.startsWith('dm:') ? 'Zasebno' : id)
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })
}
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const t = new Date()
  const y = new Date()
  y.setDate(t.getDate() - 1)
  if (d.toDateString() === t.toDateString()) return 'Danes'
  if (d.toDateString() === y.toDateString()) return 'Včeraj'
  return d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' })
}
function fmtDateTime(iso: string): string {
  return `${new Date(iso).toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric' })} ${fmtTime(iso)}`
}

export function chatUnreadTotal(): number {
  return Object.values(unread).reduce((a, b) => a + b, 0)
}
function badge() {
  const n = chatUnreadTotal()
  onBadge(n)
  document.title = n > 0 ? `(${n}) Nabava — Orodjarna` : 'Nabava — Orodjarna'
}

/* ---------- API ---------- */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `Napaka ${res.status}`)
  return body as T
}
const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function mergeMsgs(channel: string, list: Msg[]) {
  const cur = msgs.get(channel) || []
  const byId = new Map(cur.map((m) => [m.id, m]))
  for (const m of list) byId.set(m.id, m)
  msgs.set(channel, [...byId.values()].sort((a, b) => a.seq - b.seq))
}

interface Boot {
  me: { id: string; name: string }
  groups: Chan[]
  people: Chan[]
  unread: Record<string, number>
  messages: Record<string, Msg[]>
  lastSeq: number
}

async function loadBootstrap() {
  if (!me) return
  const b = await api<Boot>(`/api/chat/bootstrap?user=${encodeURIComponent(me.id)}`)
  groups = b.groups
  people = b.people
  unread = b.unread
  for (const [ch, list] of Object.entries(b.messages)) {
    mergeMsgs(ch, list)
    if (!hasMore.has(ch)) hasMore.set(ch, list.length >= PAGE)
  }
  if (!allChans().some((c) => c.id === current)) current = 'splosno'
  error = ''
  ready = true
}

function connect() {
  if (!me) return
  es?.close()
  window.clearTimeout(retryTimer)
  const src = new EventSource(`/api/chat/events?user=${encodeURIComponent(me.id)}`)
  es = src
  src.addEventListener('open', () => {
    connected = true
    if (hadError) {
      hadError = false
      void loadBootstrap().then(afterChange).catch(() => {})
    }
    paintStatus()
  })
  src.addEventListener('error', () => {
    connected = false
    hadError = true
    paintStatus()
    if (src.readyState === EventSource.CLOSED) {
      retryTimer = window.setTimeout(connect, 4000)
    }
  })
  src.addEventListener('message', (e) => onMessage(JSON.parse((e as MessageEvent).data) as Msg))
  src.addEventListener('done', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { id: string; on: boolean; by: string; name: string; at: string }
    for (const list of msgs.values()) {
      const m = list.find((x) => x.id === d.id)
      if (m) {
        m.done = d.on ? { by: d.by, name: d.name, at: d.at } : null
        paintList(true)
        return
      }
    }
  })
  src.addEventListener('read', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { channel: string }
    if (d.channel && unread[d.channel]) {
      delete unread[d.channel]
      paintNav()
      badge()
    }
  })
}

function onMessage(m: Msg) {
  if (!me) return
  const list = msgs.get(m.channel) || []
  if (list.some((x) => x.id === m.id)) return
  mergeMsgs(m.channel, [m])
  if (m.channel.startsWith('dm:') && !allChans().some((c) => c.id === m.channel)) void loadBootstrap().then(afterChange)
  const ch = allChans().find((c) => c.id === m.channel)
  if (ch) ch.last = m.seq
  const mine = m.from === me.id
  const watching = visible && current === m.channel && document.visibilityState === 'visible'
  if (!mine) {
    if (watching) scheduleRead()
    else {
      unread[m.channel] = (unread[m.channel] || 0) + 1
      beep(m.channel === 'nujno')
      onIncoming(m, chanName(m.channel))
    }
  }
  if (!people.length || m.channel.startsWith('dm:')) people.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name, 'sl'))
  paintNav()
  if (m.channel === current && !hits) paintList(true, mine)
  badge()
}

function afterChange() {
  paintNav()
  paintList(false)
  paintStatus()
  badge()
}

function scheduleRead() {
  window.clearTimeout(readTimer)
  readTimer = window.setTimeout(() => {
    if (!me) return
    const list = msgs.get(current) || []
    const last = list[list.length - 1]
    if (!last) return
    if (unread[current]) {
      delete unread[current]
      paintNav()
      badge()
    }
    void post('/api/chat/read', { user: me.id, channel: current, seq: last.seq }).catch(() => {})
  }, 300)
}

/* ---------- zvok ---------- */
function beep(urgent: boolean) {
  try {
    if (!audioCtx) return // brskalnik dovoli zvok šele po prvem kliku
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const tones = urgent ? [880, 660, 880] : [740]
    let t = ctx.currentTime
    for (const f of tones) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = f
      o.type = 'sine'
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(urgent ? 0.35 : 0.18, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.2)
      t += 0.22
    }
  } catch {
    /* zvok ni kritičen */
  }
}
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    /* ignore */
  }
}
document.addEventListener('pointerdown', unlockAudio, { once: true })
document.addEventListener('keydown', unlockAudio, { once: true })

/* ---------- risanje (po delih; vnosno polje se nikoli ne zamenja) ---------- */
function paintNav() {
  const btn = (c: Chan) => {
    const n = unread[c.id] || 0
    return `<button type="button" class="chat-ch ${c.id === current ? 'active' : ''} ${c.id === 'nujno' ? 'ch-nujno' : ''}" data-ch="${escapeHtml(c.id)}">
      <span class="chat-ch-name">${escapeHtml(c.name)}</span>${n ? `<span class="chat-unread">${n > 99 ? '99+' : n}</span>` : ''}</button>`
  }
  navEl.innerHTML = `
    <div class="chat-ch-row">${groups.map(btn).join('')}</div>
    ${people.length ? `<div class="chat-nav-label">Osebe</div><div class="chat-ch-row chat-people">${people.map(btn).join('')}</div>` : ''}`
}

function paintStatus() {
  const msg = error || (!connected && ready ? 'Ni povezave s strežnikom — poskušam znova…' : '')
  statusEl.hidden = !msg
  statusEl.textContent = msg
}

function paintHead() {
  const dm = current.startsWith('dm:')
  titleEl.textContent = (dm ? '' : '# ') + chanName(current)
  searchBtn.textContent = searchOpen ? 'Zapri' : 'Išči'
  searchEl.hidden = !searchOpen
}

function msgHtml(m: Msg): string {
  const mine = me && m.from === me.id
  const dm = current.startsWith('dm:')
  const done = m.done
  const tick = `<button type="button" class="chat-tick ${done ? 'on' : ''}" data-done="${m.id}" aria-label="Kljukica opravljeno" title="${
    done ? `Opravil/a: ${escapeHtml(done.name)} (${fmtDateTime(done.at)})` : 'Označi kot opravljeno'
  }">✓</button>`
  return `<div class="chat-msg ${mine ? 'mine' : ''} ${done ? 'is-done' : ''} ${m.id === highlightId ? 'flash' : ''}" data-mid="${m.id}">
    <div class="chat-bubble">
      ${!mine && !dm ? `<div class="chat-author">${escapeHtml(m.name)}</div>` : ''}
      ${m.machine ? `<span class="chat-machine">${escapeHtml(m.machine)}</span>` : ''}
      <div class="chat-text">${escapeHtml(m.text)}</div>
      <div class="chat-meta">${fmtTime(m.at)}${done ? ` · ✓ ${escapeHtml(done.name)} ${fmtTime(done.at)}` : ''}</div>
    </div>${tick}</div>`
}

function paintList(stick: boolean, force = false) {
  if (hits) {
    paintHits()
    return
  }
  const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 90
  const prevTop = listEl.scrollTop
  const list = msgs.get(current) || []
  let html = ''
  if (hasMore.get(current)) html += `<button type="button" class="btn btn-ghost btn-sm chat-older" data-older>Starejša sporočila</button>`
  let day = ''
  for (const m of list) {
    const dl = dayLabel(m.at)
    if (dl !== day) {
      day = dl
      html += `<div class="chat-day">${escapeHtml(dl)}</div>`
    }
    html += msgHtml(m)
  }
  if (!list.length) html = `<div class="chat-empty">Še ni sporočil. Napiši prvo.</div>`
  listEl.innerHTML = html
  if (force || (stick && atBottom)) listEl.scrollTop = listEl.scrollHeight
  else listEl.scrollTop = prevTop
}

function paintHits() {
  if (!hits) return
  if (!hits.length) {
    listEl.innerHTML = `<div class="chat-empty">Ni zadetkov.</div>`
    return
  }
  listEl.innerHTML = hits
    .map(
      (h) => `<button type="button" class="chat-hit" data-hit="${h.id}" data-hit-ch="${escapeHtml(h.channel)}" data-hit-seq="${h.seq}">
        <span class="chat-hit-top">${escapeHtml(h.channelName)} · ${escapeHtml(h.name)} · ${escapeHtml(fmtDateTime(h.at))}${h.machine ? ` · ${escapeHtml(h.machine)}` : ''}</span>
        <span class="chat-hit-text">${escapeHtml(h.text.length > 160 ? h.text.slice(0, 157) + '…' : h.text)}</span></button>`,
    )
    .join('')
}

function paintTag() {
  machineBtn.classList.toggle('active', !!machine || machineOpen)
  machineBtn.textContent = machine ? 'Stroj ✓' : 'Stroj'
  if (machineOpen) {
    tagEl.innerHTML = `<div class="chat-tag-row">${OKUMA_MACHINES.map(
      (m) => `<button type="button" class="chip ${m === machine ? 'active' : ''}" data-machine="${escapeHtml(m)}">${escapeHtml(m)}</button>`,
    ).join('')}</div>`
  } else if (machine) {
    tagEl.innerHTML = `<div class="chat-tag-row"><span class="chat-machine">${escapeHtml(machine)}</span><button type="button" class="chat-tag-x" data-machine="">× odstrani</button></div>`
  } else tagEl.innerHTML = ''
}

function autosize() {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px'
}

function openChannel(id: string, opts: { keepSearch?: boolean } = {}) {
  drafts.set(current, inputEl.value)
  current = id
  localStorage.setItem(LAST_CH_KEY, id)
  if (!opts.keepSearch) {
    searchOpen = false
    searchQ = ''
    searchInput.value = ''
    hits = null
  }
  inputEl.value = drafts.get(id) || ''
  autosize()
  paintNav()
  paintHead()
  paintList(true, true)
  if (visible) scheduleRead()
}

async function send() {
  if (!me || sending) return
  const text = inputEl.value.trim()
  if (!text) return
  sending = true
  sendBtn.disabled = true
  const dm = current.startsWith('dm:') ? current.slice(3).split('|').find((x) => x !== me!.id) : undefined
  try {
    const m = await post<Msg>('/api/chat/messages', {
      user: me.id,
      ...(dm ? { to: dm } : { channel: current }),
      text,
      ...(machine ? { machine } : {}),
    })
    inputEl.value = ''
    drafts.delete(current)
    machine = ''
    machineOpen = false
    paintTag()
    autosize()
    onMessage(m)
    paintList(true, true)
    error = ''
  } catch (err) {
    error = err instanceof Error ? err.message : 'Pošiljanje ni uspelo'
    window.setTimeout(() => {
      error = ''
      paintStatus()
    }, 4000)
  } finally {
    sending = false
    sendBtn.disabled = false
    paintStatus()
    inputEl.focus()
  }
}

async function loadOlder() {
  if (!me) return
  const list = msgs.get(current) || []
  if (!list.length) return
  const r = await api<{ messages: Msg[]; more: boolean }>(
    `/api/chat/history?user=${encodeURIComponent(me.id)}&channel=${encodeURIComponent(current)}&before=${list[0].seq}&limit=${PAGE}`,
  )
  const h0 = listEl.scrollHeight
  mergeMsgs(current, r.messages)
  hasMore.set(current, r.more)
  paintList(false)
  listEl.scrollTop = listEl.scrollHeight - h0
}

async function jumpTo(channel: string, id: string, seq: number) {
  if (!me) return
  const r = await api<{ messages: Msg[]; more: boolean }>(
    `/api/chat/history?user=${encodeURIComponent(me.id)}&channel=${encodeURIComponent(channel)}&before=${seq + 25}&limit=${PAGE}`,
  )
  mergeMsgs(channel, r.messages)
  const first = (msgs.get(channel) || [])[0]
  hasMore.set(channel, r.more || (!!first && first.seq > 0 && r.messages.length >= PAGE))
  highlightId = id
  searchOpen = false
  hits = null
  searchQ = ''
  searchInput.value = ''
  openChannel(channel)
  const el = listEl.querySelector<HTMLElement>(`[data-mid="${id}"]`)
  el?.scrollIntoView({ block: 'center' })
  window.setTimeout(() => {
    highlightId = ''
    el?.classList.remove('flash')
  }, 2500)
}

function runSearch() {
  if (!me) return
  const q = searchQ.trim()
  if (!q) {
    hits = null
    paintList(true, true)
    return
  }
  void api<{ results: SearchHit[] }>(`/api/chat/search?user=${encodeURIComponent(me.id)}&q=${encodeURIComponent(q)}`)
    .then((r) => {
      if (searchQ.trim() !== q) return
      hits = r.results
      paintHits()
    })
    .catch(() => {})
}

/* ---------- dogodki ---------- */
navEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ch]')
  if (b) openChannel(b.dataset.ch!)
})
listEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const tick = t.closest<HTMLElement>('[data-done]')
  if (tick && me) {
    void post('/api/chat/done', { user: me.id, id: tick.dataset.done }).catch(() => {})
    return
  }
  if (t.closest('[data-older]')) {
    void loadOlder().catch(() => {})
    return
  }
  const hit = t.closest<HTMLElement>('[data-hit]')
  if (hit) void jumpTo(hit.dataset.hitCh!, hit.dataset.hit!, Number(hit.dataset.hitSeq)).catch(() => {})
})
tagEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-machine]')
  if (!b) return
  machine = b.dataset.machine!
  machineOpen = false
  paintTag()
  inputEl.focus()
})
machineBtn.addEventListener('click', () => {
  machineOpen = !machineOpen
  paintTag()
})
searchBtn.addEventListener('click', () => {
  searchOpen = !searchOpen
  if (!searchOpen) {
    hits = null
    searchQ = ''
    searchInput.value = ''
    paintList(true, true)
  }
  paintHead()
  if (searchOpen) searchInput.focus()
})
searchInput.addEventListener('input', () => {
  searchQ = searchInput.value
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(runSearch, 250)
})
formEl.addEventListener('submit', (e) => {
  e.preventDefault()
  void send()
})
inputEl.addEventListener('input', autosize)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && visible) scheduleRead()
})

/* ---------- javni vmesnik ---------- */
export function startChat(user: { id: string; name: string }) {
  if (me && me.id === user.id) return
  stopChat()
  me = user
  void loadBootstrap()
    .then(() => {
      connect()
      paintNav()
      paintHead()
      paintList(true, true)
      paintTag()
      paintStatus()
      badge()
    })
    .catch((err) => {
      error = err instanceof Error ? err.message : 'Klepet ni dosegljiv'
      paintStatus()
      retryTimer = window.setTimeout(() => {
        const u = me
        me = null
        if (u) startChat(u)
      }, 5000)
    })
}

export function stopChat() {
  es?.close()
  es = null
  window.clearTimeout(retryTimer)
  me = null
  ready = false
  connected = false
  groups = []
  people = []
  unread = {}
  msgs.clear()
  hasMore.clear()
  drafts.clear()
  hits = null
  inputEl.value = ''
  badge()
}

export function chatSelect(channelId: string) {
  if (channelId === current) return
  if (ready) openChannel(channelId)
  else {
    current = channelId
    localStorage.setItem(LAST_CH_KEY, channelId)
  }
}

interface UiState {
  focus: boolean
  start: number
  end: number
  top: number
  searchFocus: boolean
}
let saved: UiState | null = null

/** Pokliči PRED render(): zapomni si fokus in drsenje. */
export function chatSaveUi() {
  if (!root.isConnected) {
    saved = null
    return
  }
  const a = document.activeElement
  saved = {
    focus: a === inputEl,
    searchFocus: a === searchInput,
    start: inputEl.selectionStart ?? 0,
    end: inputEl.selectionEnd ?? 0,
    top: listEl.scrollTop,
  }
  drafts.set(current, inputEl.value)
}

/** Vstavi trajni klepet v prazno mesto in obnovi fokus/drsenje. */
export function mountChat(slot: HTMLElement) {
  slot.replaceWith(root)
  visible = true
  paintNav()
  paintHead()
  paintTag()
  paintStatus()
  paintList(true, true)
  autosize()
  if (saved) {
    listEl.scrollTop = saved.top
    if (saved.focus) {
      inputEl.focus({ preventScroll: true })
      inputEl.setSelectionRange(saved.start, saved.end)
    } else if (saved.searchFocus) searchInput.focus({ preventScroll: true })
  }
  saved = null
  scheduleRead()
}

/** Pokliči, ko zavihek Klepet ni več prikazan. */
export function chatHidden() {
  visible = false
}
