/**
 * "Kaj se mudi" - tabla nujnih opravil. Lasten, trajen DOM (kot klepet): render() v main.ts ga samo ponovno vstavi.
 * API: GET /api/board, POST /api/board/items|done|remove; živo prek SSE dogodka "board" (povezavo upravlja chat.ts).
 */
import { OKUMA_MACHINES } from './data.ts'
import { chatBeep } from './chat.ts'
import { escapeHtml } from './storage.ts'

export interface BoardItem {
  id: string
  wo: string
  customer: string
  date: string
  text: string
  machine?: string
  by: string
  name: string
  at: string
  done: { by: string; name: string; at: string } | null
}
interface BoardView {
  rev: number
  items: BoardItem[]
}

let me: { id: string; name: string } | null = null
let items: BoardItem[] = []
let loaded = false
let machine = ''
let machineOpen = false
let showDone = false
let busy = false
let msg = ''
let retry: number | undefined
const known = new Set<string>()

let onChange: () => void = () => {}
let onIncoming: (text: string) => void = () => {}
export function setBoardHooks(h: { change: () => void; incoming: (text: string) => void }) {
  onChange = h.change
  onIncoming = h.incoming
}

/* ---------- datum ---------- */
const p2 = (n: number) => String(n).padStart(2, '0')
export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
function dayDiff(date: string): number {
  const a = new Date(date + 'T12:00:00').getTime()
  const b = new Date(todayStr() + 'T12:00:00').getTime()
  return Math.round((a - b) / 86400000)
}
function shortDate(date: string, weekday = true): string {
  const d = new Date(date + 'T12:00:00')
  const wd = weekday ? d.toLocaleDateString('sl-SI', { weekday: 'short' }) + ' ' : ''
  return `${wd}${d.getDate()}. ${d.getMonth() + 1}.`
}
export function dateLabel(date: string): { text: string; cls: string } {
  if (!date) return { text: 'Brez roka', cls: 'none' }
  const n = dayDiff(date)
  if (n < 0) return { text: `ZAPADLO ${shortDate(date, false)}`, cls: 'overdue' }
  if (n === 0) return { text: 'DANES', cls: 'today' }
  if (n === 1) return { text: 'JUTRI', cls: 'soon' }
  return { text: shortDate(date), cls: 'later' }
}
/** odprte postavke po datumu (brez datuma na koncu), nato po času vnosa */
export function sortOpen(list: BoardItem[]): BoardItem[] {
  return list
    .filter((i) => !i.done)
    .sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99') || a.at.localeCompare(b.at))
}

export function boardSummary(): { open: number; overdue: number; today: number; next: BoardItem | null } {
  const open = sortOpen(items)
  const t = todayStr()
  return {
    open: open.length,
    overdue: open.filter((i) => i.date && i.date < t).length,
    today: open.filter((i) => i.date === t).length,
    next: open[0] || null,
  }
}
export function itemTitle(i: BoardItem): string {
  return [i.wo ? `DN ${i.wo}` : '', i.customer, i.text].filter(Boolean).join(' · ')
}

/* ---------- DOM ---------- */
const root = document.createElement('div')
root.className = 'mudi'
root.innerHTML = `
  <form class="mudi-form card" data-ref="form" autocomplete="off">
    <div class="mudi-grid">
      <label class="field">Delovni nalog<input name="wo" maxlength="40" enterkeyhint="next" /></label>
      <label class="field">Stranka<input name="customer" maxlength="80" enterkeyhint="next" /></label>
      <label class="field">Datum (rok)<input name="date" type="date" /></label>
    </div>
    <label class="field">Kaj je nujno<input name="text" maxlength="300" enterkeyhint="done" placeholder="Kratek opis" /></label>
    <div class="mudi-tag" data-ref="tag"></div>
    <div class="mudi-actions">
      <button class="btn btn-secondary mudi-machine-btn" type="button" data-ref="machineBtn">Stroj</button>
      <button class="btn btn-primary mudi-add" type="submit" data-ref="add">Dodaj</button>
    </div>
    <div class="mudi-msg" data-ref="msg" hidden></div>
  </form>
  <div class="mudi-list" data-ref="list"></div>`
const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!
const formEl = ref('form') as HTMLFormElement
const tagEl = ref('tag')
const machineBtn = ref('machineBtn') as HTMLButtonElement
const addBtn = ref('add') as HTMLButtonElement
const msgEl = ref('msg')
const listEl = ref('list')
const field = (n: string) => formEl.elements.namedItem(n) as HTMLInputElement
field('date').value = todayStr()

function cardHtml(i: BoardItem): string {
  const dl = dateLabel(i.date)
  return `<div class="mudi-item d-${dl.cls}" data-id="${i.id}">
    <div class="mudi-date">${escapeHtml(dl.text)}</div>
    <div class="mudi-body">
      <div class="mudi-head">${i.wo ? `<span class="mudi-wo">DN ${escapeHtml(i.wo)}</span>` : ''}${i.customer ? `<span class="mudi-cust">${escapeHtml(i.customer)}</span>` : ''}${i.machine ? `<span class="chat-machine">${escapeHtml(i.machine)}</span>` : ''}</div>
      ${i.text ? `<div class="mudi-text">${escapeHtml(i.text)}</div>` : ''}
      <div class="mudi-by">${escapeHtml(i.name)}${me && i.by === me.id ? ' · <button type="button" class="mudi-del" data-del="' + i.id + '">odstrani</button>' : ''}</div>
    </div>
    <button type="button" class="mudi-done" data-done="${i.id}" aria-label="Narejeno"><span>✓</span>Narejeno</button>
  </div>`
}
function doneHtml(i: BoardItem): string {
  return `<div class="mudi-item d-finished" data-id="${i.id}">
    <div class="mudi-body"><div class="mudi-head">${i.wo ? `<span class="mudi-wo">DN ${escapeHtml(i.wo)}</span>` : ''}${i.customer ? `<span class="mudi-cust">${escapeHtml(i.customer)}</span>` : ''}</div>
      ${i.text ? `<div class="mudi-text">${escapeHtml(i.text)}</div>` : ''}
      <div class="mudi-by">✓ ${escapeHtml(i.done?.name || '')}</div></div>
    <button type="button" class="btn btn-ghost btn-sm" data-undo="${i.id}">Razveljavi</button>
  </div>`
}

function paintList() {
  if (!loaded) {
    listEl.innerHTML = `<div class="chat-empty">Nalagam…</div>`
    return
  }
  const open = sortOpen(items)
  const done = items.filter((i) => i.done).sort((a, b) => (b.done!.at).localeCompare(a.done!.at))
  let html = ''
  html += open.length ? open.map(cardHtml).join('') : `<div class="mudi-empty">Vse mirno — nič ne mudi. ✓</div>`
  if (done.length) {
    html += `<button type="button" class="btn btn-ghost btn-sm mudi-toggle" data-toggle-done>${showDone ? 'Skrij' : 'Pokaži'} narejeno (${done.length})</button>`
    if (showDone) html += done.map(doneHtml).join('')
  }
  listEl.innerHTML = html
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
function paintMsg() {
  msgEl.hidden = !msg
  msgEl.textContent = msg
}
function flash(m: string) {
  msg = m
  paintMsg()
  window.setTimeout(() => {
    if (msg === m) {
      msg = ''
      paintMsg()
    }
  }, 4000)
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

function apply(v: BoardView, announce: boolean) {
  const fresh = v.items.filter((i) => !known.has(i.id))
  for (const i of v.items) known.add(i.id)
  items = v.items
  if (announce && me) {
    const mineless = fresh.filter((i) => i.by !== me!.id && !i.done)
    if (mineless.length) {
      const first = mineless[0]
      const urgent = !!first.date && first.date <= todayStr()
      chatBeep(urgent)
      onIncoming(`Kaj se mudi · ${first.name}: ${itemTitle(first)}${mineless.length > 1 ? ` (+${mineless.length - 1})` : ''}`)
    }
  }
  loaded = true
  paintList()
  onChange()
}

async function reload(announce: boolean) {
  if (!me) return
  apply(await api<BoardView>(`/api/board?user=${encodeURIComponent(me.id)}`), announce)
}

/** SSE dogodek "board" (iz chat.ts) */
export function boardEvent(payload: unknown) {
  const v = payload as BoardView
  if (v && Array.isArray(v.items)) apply(v, true)
}
export function boardReopen() {
  void reload(true).catch(() => {})
}

export function startBoard(user: { id: string; name: string }) {
  if (me && me.id === user.id) return
  stopBoard()
  me = user
  reload(false).catch(() => {
    retry = window.setTimeout(() => {
      const u = me
      me = null
      if (u) startBoard(u)
    }, 5000)
  })
}
export function stopBoard() {
  window.clearTimeout(retry)
  me = null
  items = []
  loaded = false
  known.clear()
  onChange()
}

/* ---------- dogodki ---------- */
formEl.addEventListener('submit', (e) => {
  e.preventDefault()
  if (!me || busy) return
  const wo = field('wo').value.trim()
  const customer = field('customer').value.trim()
  const text = field('text').value.trim()
  if (!wo && !customer && !text) {
    flash('Vpiši delovni nalog, stranko ali opis.')
    field('wo').focus()
    return
  }
  busy = true
  addBtn.disabled = true
  void post<BoardItem>('/api/board/items', { user: me.id, wo, customer, text, date: field('date').value, ...(machine ? { machine } : {}) })
    .then((it) => {
      known.add(it.id)
      field('wo').value = ''
      field('customer').value = ''
      field('text').value = ''
      field('date').value = todayStr()
      machine = ''
      machineOpen = false
      paintTag()
      flash('Dodano ✓')
      return reload(false)
    })
    .catch((err) => flash(err instanceof Error ? err.message : 'Dodajanje ni uspelo'))
    .finally(() => {
      busy = false
      addBtn.disabled = false
      field('wo').focus()
    })
})
machineBtn.addEventListener('click', () => {
  machineOpen = !machineOpen
  paintTag()
})
tagEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-machine]')
  if (!b) return
  machine = b.dataset.machine!
  machineOpen = false
  paintTag()
})
listEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (!me) return
  const d = t.closest<HTMLElement>('[data-done]')
  const u = t.closest<HTMLElement>('[data-undo]')
  const x = t.closest<HTMLElement>('[data-del]')
  if (d || u) {
    const id = (d || u)!.dataset.done || (u as HTMLElement).dataset.undo
    void post('/api/board/done', { user: me.id, id, on: !!d }).then(() => reload(false)).catch((err) => flash(err instanceof Error ? err.message : 'Napaka'))
  } else if (x) {
    if (window.confirm('Odstranim to postavko?')) {
      void post('/api/board/remove', { user: me.id, id: x.dataset.del }).then(() => reload(false)).catch((err) => flash(err instanceof Error ? err.message : 'Napaka'))
    }
  } else if (t.closest('[data-toggle-done]')) {
    showDone = !showDone
    paintList()
  }
})

/* ---------- vstavljanje (preživi render()) ---------- */
let saved: { name: string; start: number; end: number } | null = null
export function boardSaveUi() {
  saved = null
  if (!root.isConnected) return
  const a = document.activeElement as HTMLInputElement | null
  if (a && root.contains(a) && a.name) saved = { name: a.name, start: a.selectionStart ?? 0, end: a.selectionEnd ?? 0 }
}
export function mountBoard(slot: HTMLElement) {
  slot.replaceWith(root)
  paintList()
  paintTag()
  paintMsg()
  if (saved) {
    const el = field(saved.name)
    el?.focus({ preventScroll: true })
    try {
      el?.setSelectionRange(saved.start, saved.end)
    } catch {
      /* type=date nima izbora */
    }
  }
  saved = null
}
