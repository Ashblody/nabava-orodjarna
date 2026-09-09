import './style.css'
import {
  CATEGORIES,
  STATUS_LABELS,
  VODJA_NAME,
  WORKSTATIONS,
  findSlot,
  findWorkstation,
} from './data.ts'
import { fileToDataUrl } from './image.ts'
import {
  formatDate,
  formatDateTime,
  loadData,
  loadSession,
  saveData,
  saveSession,
  uid,
} from './storage.ts'
import type {
  AppData,
  Category,
  ProcurementRequest,
  RequestStatus,
  Session,
  Task,
} from './types.ts'

type Tab = 'zahteve' | 'nova' | 'zgodovina' | 'opravila'

const app = document.querySelector<HTMLDivElement>('#app')!
let data: AppData = loadData()
let session: Session | null = loadSession()
let tab: Tab = 'zahteve'
let statusFilter: RequestStatus | 'vse' = 'odprto'
let toastTimer: number | undefined

function persist() {
  saveData(data)
}

function showToast(msg: string) {
  const existing = document.querySelector('.toast')
  existing?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  document.body.appendChild(el)
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.remove(), 2600)
}

function logout() {
  session = null
  saveSession(null)
  tab = 'zahteve'
  render()
}

function setSession(s: Session) {
  session = s
  saveSession(s)
  tab = s.role === 'delavec' ? 'nova' : 'zahteve'
  statusFilter = s.role === 'vodja' ? 'odprto' : 'vse'
  render()
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function render() {
  if (!session) {
    renderLogin()
    return
  }
  if (session.role === 'vodja') renderVodja()
  else renderDelavec()
}

function shell(content: string, tabsHtml: string) {
  app.innerHTML = `
    <header class="app-header">
      <div>
        <h1>Nabava — Orodjarna</h1>
        <div class="sub">${escapeHtml(session!.displayName)}</div>
      </div>
      <div class="row">
        <span class="badge">${session!.role === 'vodja' ? 'Vodja' : 'Delavec'}</span>
        <button class="btn btn-ghost" type="button" data-action="logout">Odjava</button>
      </div>
    </header>
    <nav class="tabs">${tabsHtml}</nav>
    <main>${content}</main>
  `
  bindCommon()
}

function bindCommon() {
  app.querySelector('[data-action="logout"]')?.addEventListener('click', logout)
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab as Tab
      render()
    })
  })
}

function tabBtn(id: Tab, label: string) {
  return `<button class="tab ${tab === id ? 'active' : ''}" type="button" data-tab="${id}">${label}</button>`
}

/* ---------- Login ---------- */
function renderLogin() {
  const wsBlocks = WORKSTATIONS.map((ws) => {
    const slots = ws.slots
      .map(
        (slot) => `
        <button class="choice" type="button" data-login-ws="${ws.id}" data-login-slot="${slot.id}">
          ${escapeHtml(slot.label)}
          <small>${escapeHtml(ws.name)}</small>
        </button>`,
      )
      .join('')
    return `<div class="ws-group"><h3>${escapeHtml(ws.name)}</h3><div class="choice-grid">${slots}</div></div>`
  }).join('')

  app.innerHTML = `
    <div class="login-hero">
      <div class="logo">NO</div>
      <h1>Nabava orodjarne</h1>
      <p class="muted">Notranji prototip — izberi vlogo (brez gesla)</p>
    </div>
    <section class="card stack">
      <h2>Vodja nabave</h2>
      <button class="choice" type="button" data-login-vodja>
        ${escapeHtml(VODJA_NAME)}
        <small>Pregled zahtev, naročila, opravila</small>
      </button>
    </section>
    <section class="card">
      <h2>Delavec — delovna postaja</h2>
      ${wsBlocks}
    </section>
  `

  app.querySelector('[data-login-vodja]')?.addEventListener('click', () => {
    setSession({ role: 'vodja', displayName: VODJA_NAME })
  })
  app.querySelectorAll<HTMLButtonElement>('[data-login-ws]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const workstationId = btn.dataset.loginWs!
      const slotId = btn.dataset.loginSlot!
      const ws = findWorkstation(workstationId)!
      const slot = findSlot(workstationId, slotId)!
      setSession({
        role: 'delavec',
        displayName: `${slot.label} · ${ws.name}`,
        workstationId,
        slotId,
      })
    })
  })
}

/* ---------- Shared request cards ---------- */
function sortedRequests(filter?: RequestStatus | 'vse'): ProcurementRequest[] {
  let list = [...data.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (filter && filter !== 'vse') list = list.filter((r) => r.status === filter)
  return list
}

function requestCard(r: ProcurementRequest, mode: 'manage' | 'view'): string {
  const supplier = r.supplierNote
    ? `<p><strong>Dobavitelj / opomba:</strong> ${escapeHtml(r.supplierNote)}</p>`
    : ''
  const photo = r.photoDataUrl
    ? `<img class="photo-thumb" src="${r.photoDataUrl}" alt="Fotografija zahteve" />`
    : ''
  const history = r.history
    .map(
      (h) => `
      <div class="history-item">
        <span class="status ${h.status}">${STATUS_LABELS[h.status]}</span>
        <span class="muted"> · ${formatDateTime(h.at)} · ${escapeHtml(h.by)}</span>
        ${h.note ? `<div>${escapeHtml(h.note)}</div>` : ''}
      </div>`,
    )
    .join('')

  let actions = ''
  if (mode === 'manage' && r.status !== 'prejeto' && r.status !== 'zavrnjeno') {
    actions = `
      <div class="stack" style="margin-top:12px">
        <label class="field">Opomba dobavitelja (kdo/kje prodaja)
          <input type="text" data-supplier="${r.id}" value="${escapeHtml(r.supplierNote)}" placeholder="npr. Merkur Celje, Art. 123" />
        </label>
        <div class="actions">
          ${r.status === 'odprto' ? `<button class="btn btn-secondary" type="button" data-status="${r.id}" data-to="naroceno">Označi naročeno</button>` : ''}
          <button class="btn btn-primary" type="button" data-status="${r.id}" data-to="prejeto">Označi prejeto</button>
          <button class="btn btn-danger" type="button" data-status="${r.id}" data-to="zavrnjeno">Zavrni</button>
        </div>
      </div>`
  }

  return `
    <article class="card" data-request="${r.id}">
      <div class="request-meta">
        <span class="status ${r.status}">${STATUS_LABELS[r.status]}</span>
        <span>${escapeHtml(r.category)}</span>
        <span>${formatDateTime(r.createdAt)}</span>
      </div>
      <h3 class="request-title">${escapeHtml(r.title)}</h3>
      <div class="request-meta">
        <span>${escapeHtml(r.createdBy)}</span>
        <span>${escapeHtml(r.workstationName)} · ${escapeHtml(r.slotLabel)}</span>
      </div>
      ${r.note ? `<p>${escapeHtml(r.note)}</p>` : ''}
      ${supplier}
      ${photo}
      ${actions}
      <details style="margin-top:10px">
        <summary class="muted">Zgodovina statusov</summary>
        ${history || '<p class="muted">Ni dogodkov.</p>'}
      </details>
    </article>`
}

function bindManageActions() {
  app.querySelectorAll<HTMLInputElement>('[data-supplier]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.supplier!
      const req = data.requests.find((r) => r.id === id)
      if (!req) return
      req.supplierNote = input.value.trim()
      persist()
      showToast('Opomba shranjena')
    })
  })
  app.querySelectorAll<HTMLButtonElement>('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.status!
      const to = btn.dataset.to as RequestStatus
      const req = data.requests.find((r) => r.id === id)
      if (!req || !session) return
      const supplierInput = app.querySelector<HTMLInputElement>(`[data-supplier="${id}"]`)
      if (supplierInput) req.supplierNote = supplierInput.value.trim()
      req.status = to
      req.history.push({
        at: new Date().toISOString(),
        status: to,
        by: session.displayName,
        note: req.supplierNote || undefined,
      })
      persist()
      showToast(`Status: ${STATUS_LABELS[to]}`)
      render()
    })
  })
}

/* ---------- Opravila ---------- */
function renderTasks(editable: boolean): string {
  const tasks = [...data.tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return a.dueDate.localeCompare(b.dueDate)
  })
  const today = new Date().toISOString().slice(0, 10)
  const list =
    tasks.length === 0
      ? `<div class="empty">Ni opravil.</div>`
      : tasks
          .map((t) => {
            const overdue = !t.done && t.dueDate < today
            return `
            <div class="task-item ${t.done ? 'done' : ''}" data-task="${t.id}">
              <input type="checkbox" ${t.done ? 'checked' : ''} data-toggle-task="${t.id}" ${editable ? '' : 'disabled'} />
              <div>
                <div class="task-text">${escapeHtml(t.text)}</div>
                <div class="muted ${overdue ? 'overdue' : ''}">Rok: ${formatDate(t.dueDate)}${overdue ? ' · zapadlo' : ''}</div>
              </div>
              ${editable ? `<button class="btn btn-ghost" type="button" data-del-task="${t.id}" aria-label="Izbriši">✕</button>` : '<span></span>'}
            </div>`
          })
          .join('')

  const form = editable
    ? `
    <form class="stack" id="task-form">
      <label class="field">Opravilo
        <input name="text" required maxlength="200" placeholder="npr. Pokliči dobavitelja za svedre" />
      </label>
      <label class="field">Rok
        <input name="due" type="date" required />
      </label>
      <button class="btn btn-primary btn-block" type="submit">Dodaj opravilo</button>
    </form>`
    : `<p class="muted">Opravila lahko ureja samo vodja nabave.</p>`

  return `
    <section class="card">
      <h2>Opravila</h2>
      ${form}
    </section>
    <section class="card">
      <h3>Seznam</h3>
      ${list}
    </section>`
}

function bindTasks(editable: boolean) {
  if (editable) {
    const form = app.querySelector<HTMLFormElement>('#task-form')
    form?.addEventListener('submit', (e) => {
      e.preventDefault()
      const fd = new FormData(form)
      const text = String(fd.get('text') || '').trim()
      const dueDate = String(fd.get('due') || '')
      if (!text || !dueDate || !session) return
      const task: Task = {
        id: uid('task'),
        text,
        dueDate,
        done: false,
        createdAt: new Date().toISOString(),
        createdBy: session.displayName,
      }
      data.tasks.push(task)
      persist()
      showToast('Opravilo dodano')
      render()
    })
    app.querySelectorAll<HTMLButtonElement>('[data-del-task]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.delTask!
        data.tasks = data.tasks.filter((t) => t.id !== id)
        persist()
        showToast('Opravilo izbrisano')
        render()
      })
    })
  }
  app.querySelectorAll<HTMLInputElement>('[data-toggle-task]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (!editable) return
      const id = cb.dataset.toggleTask!
      const task = data.tasks.find((t) => t.id === id)
      if (!task) return
      task.done = cb.checked
      persist()
      render()
    })
  })
}

/* ---------- Vodja ---------- */
function renderVodja() {
  const tabs = [
    tabBtn('zahteve', 'Odprte'),
    tabBtn('zgodovina', 'Zgodovina'),
    tabBtn('opravila', 'Opravila'),
  ].join('')

  let content = ''
  if (tab === 'opravila') {
    content = renderTasks(true)
  } else if (tab === 'zgodovina') {
    const list = sortedRequests('vse')
    content =
      list.length === 0
        ? `<div class="card empty">Ni zahtev.</div>`
        : list.map((r) => requestCard(r, 'view')).join('')
  } else {
    const filters: Array<RequestStatus | 'vse'> = ['odprto', 'naroceno', 'prejeto', 'zavrnjeno', 'vse']
    const chips = filters
      .map((f) => {
        const label = f === 'vse' ? 'Vse' : STATUS_LABELS[f]
        return `<button class="chip ${statusFilter === f ? 'active' : ''}" type="button" data-filter="${f}">${label}</button>`
      })
      .join('')
    const list = sortedRequests(statusFilter)
    content = `
      <div class="filters">${chips}</div>
      ${
        list.length === 0
          ? `<div class="card empty">Ni zahtev za ta filter.</div>`
          : list.map((r) => requestCard(r, 'manage')).join('')
      }`
  }

  shell(content, tabs)
  if (tab === 'opravila') bindTasks(true)
  else if (tab === 'zahteve') {
    bindManageActions()
    app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        statusFilter = btn.dataset.filter as RequestStatus | 'vse'
        render()
      })
    })
  }
}

/* ---------- Delavec ---------- */
function renderDelavec() {
  const tabs = [
    tabBtn('nova', 'Nova'),
    tabBtn('zahteve', 'Moje'),
    tabBtn('zgodovina', 'Vse'),
    tabBtn('opravila', 'Opravila'),
  ].join('')

  let content = ''
  if (tab === 'nova') {
    const cats = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')
    content = `
      <section class="card">
        <h2>Nova zahteva</h2>
        <form class="stack" id="req-form">
          <label class="field">Kategorija
            <select name="category" required>${cats}</select>
          </label>
          <label class="field">Naslov
            <input name="title" required maxlength="120" placeholder="npr. Sveder Ø8 HSS" />
          </label>
          <label class="field">Opomba
            <textarea name="note" maxlength="500" placeholder="Količina, merila, nujnost…"></textarea>
          </label>
          <label class="field">Fotografija (neobvezno)
            <input name="photo" type="file" accept="image/*" capture="environment" />
          </label>
          <div id="photo-preview"></div>
          <button class="btn btn-primary btn-block" type="submit">Oddaj zahtevo</button>
        </form>
      </section>`
  } else if (tab === 'opravila') {
    content = renderTasks(false)
  } else if (tab === 'zahteve') {
    const mine = sortedRequests('vse').filter(
      (r) => r.slotId === session!.slotId && r.workstationId === session!.workstationId,
    )
    content =
      mine.length === 0
        ? `<div class="card empty">Nimate še zahtev.</div>`
        : mine.map((r) => requestCard(r, 'view')).join('')
  } else {
    const list = sortedRequests('vse')
    content =
      list.length === 0
        ? `<div class="card empty">Ni zahtev.</div>`
        : list.map((r) => requestCard(r, 'view')).join('')
  }

  shell(content, tabs)

  if (tab === 'opravila') bindTasks(false)
  if (tab === 'nova') bindNewRequestForm()
}

function bindNewRequestForm() {
  const form = app.querySelector<HTMLFormElement>('#req-form')
  const preview = app.querySelector<HTMLDivElement>('#photo-preview')!
  let photoDataUrl: string | undefined
  const photoInput = form?.querySelector<HTMLInputElement>('input[name="photo"]')

  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    photoDataUrl = undefined
    preview.innerHTML = ''
    if (!file) return
    try {
      preview.innerHTML = `<p class="muted">Obdelujem fotografijo…</p>`
      photoDataUrl = await fileToDataUrl(file)
      preview.innerHTML = `<img class="photo-thumb" src="${photoDataUrl}" alt="Predogled" />`
    } catch {
      preview.innerHTML = `<p class="muted">Fotografije ni bilo mogoče obdelati.</p>`
      photoDataUrl = undefined
    }
  })

  form?.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!session?.workstationId || !session.slotId) return
    const fd = new FormData(form)
    const category = String(fd.get('category')) as Category
    const title = String(fd.get('title') || '').trim()
    const note = String(fd.get('note') || '').trim()
    if (!title) return
    const ws = findWorkstation(session.workstationId)!
    const slot = findSlot(session.workstationId, session.slotId)!
    const now = new Date().toISOString()
    const req: ProcurementRequest = {
      id: uid('req'),
      createdAt: now,
      createdBy: session.displayName,
      workstationId: ws.id,
      workstationName: ws.name,
      slotId: slot.id,
      slotLabel: slot.label,
      category,
      title,
      note,
      photoDataUrl,
      status: 'odprto',
      supplierNote: '',
      history: [{ at: now, status: 'odprto', by: session.displayName }],
    }
    data.requests.unshift(req)
    persist()
    showToast('Zahteva oddana')
    tab = 'zahteve'
    render()
  })
}

render()
