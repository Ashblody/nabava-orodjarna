import './style.css'
import {
  CATEGORIES,
  FAULT_STATUS_LABELS,
  MACHINES,
  OKUMA_MACHINES,
  STATUS_LABELS,
  WORKSTATIONS,
  findSlot,
  findWorkstation,
} from './data.ts'
import { createUser, findUserByName } from './auth.ts'
import { fileToDataUrl } from './image.ts'
import {
  decodeQrFromFile,
  decodeQrFromVideo,
  startCamera,
  stopCamera,
} from './qr.ts'
import {
  escapeHtml,
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
  FaultStatus,
  MainTab,
  MachineFault,
  OkumaService,
  ProcurementRequest,
  RequestStatus,
  Session,
  StockItem,
  SupplierRecord,
  Task,
} from './types.ts'

type NabavaSub = 'seznam' | 'nova' | 'opravila' | 'moje'

const app = document.querySelector<HTMLDivElement>('#app')!
let data: AppData = loadData()
let session: Session | null = loadSession()
let tab: MainTab = 'nabava'
let nabavaSub: NabavaSub = 'seznam'
let statusFilter: RequestStatus | 'vse' = 'odprto'
let faultFilter: FaultStatus | 'vse' = 'novo'
let toastTimer: number | undefined
let cameraStream: MediaStream | null = null
let scanLoop = 0
let authView: 'pick' | 'register' = 'pick'

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

function stopScan() {
  window.cancelAnimationFrame(scanLoop)
  stopCamera(cameraStream)
  cameraStream = null
}

function logout() {
  stopScan()
  session = null
  saveSession(null)
  authView = 'pick'
  tab = 'nabava'
  nabavaSub = 'seznam'
  render()
}

function setSession(s: Session) {
  session = s
  saveSession(s)
  data.lastUserId = s.userId
  persist()
  tab = 'nabava'
  nabavaSub = s.role === 'delavec' ? 'nova' : 'seznam'
  statusFilter = s.role === 'vodja' ? 'odprto' : 'vse'
  render()
}

function isVodja() {
  return session?.role === 'vodja'
}

function rememberSupplier(name: string, category?: string, itemHint?: string) {
  const n = name.trim()
  if (!n) return
  const existing = data.suppliers.find((s) => s.name.toLowerCase() === n.toLowerCase())
  if (existing) {
    existing.lastUsed = new Date().toISOString()
    existing.count += 1
    if (category) existing.category = category
    if (itemHint) existing.itemHint = itemHint
  } else {
    data.suppliers.push({
      name: n,
      category,
      itemHint,
      lastUsed: new Date().toISOString(),
      count: 1,
    })
  }
}

function suggestSuppliers(category?: string, title?: string): SupplierRecord[] {
  const t = (title || '').toLowerCase()
  const c = (category || '').toLowerCase()
  return [...data.suppliers]
    .sort((a, b) => {
      const score = (s: SupplierRecord) => {
        let sc = s.count
        if (c && s.category?.toLowerCase() === c) sc += 50
        if (t && s.itemHint && t.includes(s.itemHint.toLowerCase())) sc += 30
        if (t && s.name.toLowerCase().includes(t)) sc += 10
        return sc
      }
      return score(b) - score(a) || b.lastUsed.localeCompare(a.lastUsed)
    })
    .slice(0, 8)
}

function render() {
  stopScan()
  if (!session) {
    renderAuth()
    return
  }
  // Validate session user still exists
  if (!data.users.find((u) => u.id === session!.userId) && data.users.length > 0) {
    logout()
    return
  }
  renderApp()
}

function shell(content: string) {
  const tabs: Array<[MainTab, string]> = [
    ['nabava', 'Nabava'],
    ['zaloge', 'Zaloge'],
    ['okvare', 'Okvare'],
    ['servisi', 'Servisi'],
    ['zgodovina', 'Zgodovina'],
  ]
  const tabsHtml = tabs
    .map(
      ([id, label]) =>
        `<button class="tab ${tab === id ? 'active' : ''}" type="button" data-tab="${id}">${label}</button>`,
    )
    .join('')

  app.innerHTML = `
    <header class="app-header">
      <div>
        <h1>Orodjarna</h1>
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
  app.querySelector('[data-action="logout"]')?.addEventListener('click', logout)
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab as MainTab
      if (tab === 'nabava' && session!.role === 'delavec') nabavaSub = 'nova'
      if (tab === 'nabava' && session!.role === 'vodja') nabavaSub = 'seznam'
      render()
    })
  })
}

/* ===================== Auth ===================== */
function loginAsUser(userId: string) {
  const user = data.users.find((u) => u.id === userId)
  if (!user) return
  const ws = user.workstationId ? findWorkstation(user.workstationId) : undefined
  const slot = ws?.slots[0]
  setSession({
    userId: user.id,
    role: user.role,
    displayName: user.name,
    workstationId: user.workstationId,
    slotId: slot?.id,
  })
  showToast(`Pozdravljeni, ${user.name}`)
}

function renderAuth() {
  const last = data.lastUserId ? data.users.find((u) => u.id === data.lastUserId) : undefined
  const wsOpts = WORKSTATIONS.map(
    (w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`,
  ).join('')

  if (authView === 'register') {
    app.innerHTML = `
    <div class="login-hero">
      <div class="logo">NO</div>
      <h1>Nabava orodjarne</h1>
      <p class="muted">Lokalni računi — podatki ostanejo v tem brskalniku. Sinhronizacija med napravami zahteva strežnik (kasneje).</p>
    </div>

    <section class="card stack">
      <h2>Registracija</h2>
      <form class="stack" id="reg-form">
        <label class="field">Ime
          <input name="name" required maxlength="60" placeholder="npr. Janez Novak" />
        </label>
        <label class="field">Vloga
          <select name="role" id="reg-role">
            <option value="delavec">Delavec</option>
            <option value="vodja">Vodja</option>
          </select>
        </label>
        <label class="field" id="reg-ws-wrap">Delovna postaja
          <select name="workstationId">${wsOpts}</select>
        </label>
        <button class="btn btn-primary btn-block" type="submit">Ustvari račun</button>
        <button class="btn btn-ghost btn-block" type="button" id="reg-back">Nazaj na izbiro</button>
      </form>
    </section>
  `

    const roleSelect = app.querySelector<HTMLSelectElement>('#reg-role')
    const wsWrap = app.querySelector<HTMLElement>('#reg-ws-wrap')
    const syncWs = () => {
      if (wsWrap) wsWrap.style.display = roleSelect?.value === 'vodja' ? 'none' : ''
    }
    roleSelect?.addEventListener('change', syncWs)
    syncWs()

    app.querySelector('#reg-back')?.addEventListener('click', () => {
      authView = 'pick'
      render()
    })

    app.querySelector<HTMLFormElement>('#reg-form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      const fd = new FormData(e.target as HTMLFormElement)
      const name = String(fd.get('name') || '').trim()
      const role = String(fd.get('role') || 'delavec') as 'vodja' | 'delavec'
      const workstationId = role === 'delavec' ? String(fd.get('workstationId') || '') : undefined
      if (!name) return
      if (findUserByName(data.users, name)) {
        showToast('Uporabnik s tem imenom že obstaja')
        return
      }
      const user = createUser({ name, role, workstationId })
      data.users.push(user)
      persist()
      authView = 'pick'
      const ws = workstationId ? findWorkstation(workstationId) : undefined
      setSession({
        userId: user.id,
        role: user.role,
        displayName: user.name,
        workstationId,
        slotId: ws?.slots[0]?.id,
      })
      showToast('Račun ustvarjen')
    })
    return
  }

  const sortedUsers = [...data.users].sort((a, b) => {
    if (last && a.id === last.id) return -1
    if (last && b.id === last.id) return 1
    return a.name.localeCompare(b.name, 'sl')
  })

  const userList =
    sortedUsers.length === 0
      ? `<p class="muted">Še ni uporabnikov — najprej se registrirajte.</p>`
      : `<div class="user-pick-list">
        ${sortedUsers
          .map((u) => {
            const isLast = last?.id === u.id
            const roleLabel = u.role === 'vodja' ? 'Vodja' : 'Delavec'
            return `<button class="user-pick ${isLast ? 'last' : ''}" type="button" data-user-id="${escapeHtml(u.id)}">
              <span class="user-pick-name">${escapeHtml(u.name)}</span>
              <span class="user-pick-meta">${roleLabel}${isLast ? ' · zadnji' : ''}</span>
            </button>`
          })
          .join('')}
      </div>`

  app.innerHTML = `
    <div class="login-hero">
      <div class="logo">NO</div>
      <h1>Nabava orodjarne</h1>
      <p class="muted">Izberi uporabnika — brez PIN-a. Podatki ostanejo v tem brskalniku.</p>
    </div>

    <section class="card stack">
      <h2>Kdo si?</h2>
      ${userList}
    </section>

    <div class="auth-bottom">
      <button class="btn btn-secondary btn-block" type="button" id="open-register">Registracija</button>
    </div>
  `

  app.querySelectorAll<HTMLButtonElement>('[data-user-id]').forEach((btn) => {
    btn.addEventListener('click', () => loginAsUser(btn.dataset.userId || ''))
  })

  app.querySelector('#open-register')?.addEventListener('click', () => {
    authView = 'register'
    render()
  })
}

/* ===================== Shared helpers ===================== */
function qrFieldHtml(id: string, value = '') {
  return `
    <label class="field">QR koda (neobvezno)
      <div class="qr-row">
        <input type="text" id="${id}" value="${escapeHtml(value)}" placeholder="Vnesi ali skeniraj QR" />
        <button class="btn btn-secondary" type="button" data-open-scan="${id}">📷</button>
      </div>
    </label>
    <div class="scan-panel hidden" data-scan-panel="${id}">
      <video class="scan-video" playsinline muted data-scan-video="${id}"></video>
      <div class="actions">
        <label class="btn btn-ghost file-btn">Fotografiraj / izberi
          <input type="file" accept="image/*" capture="environment" hidden data-scan-file="${id}" />
        </label>
        <button class="btn btn-ghost" type="button" data-stop-scan="${id}">Zapri kamero</button>
      </div>
      <p class="muted small">Če kamera ni na voljo, vnesite QR ročno ali naložite fotografijo.</p>
    </div>`
}

function bindQrField(inputId: string) {
  const input = app.querySelector<HTMLInputElement>(`#${inputId}`)
  const panel = app.querySelector<HTMLElement>(`[data-scan-panel="${inputId}"]`)
  const video = app.querySelector<HTMLVideoElement>(`[data-scan-video="${inputId}"]`)
  const openBtn = app.querySelector(`[data-open-scan="${inputId}"]`)
  const stopBtn = app.querySelector(`[data-stop-scan="${inputId}"]`)
  const fileInput = app.querySelector<HTMLInputElement>(`[data-scan-file="${inputId}"]`)

  const onFound = (val: string) => {
    if (input) input.value = val
    showToast('QR prebran')
    stopScan()
    panel?.classList.add('hidden')
  }

  openBtn?.addEventListener('click', async () => {
    stopScan()
    panel?.classList.remove('hidden')
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      showToast('Kamera ni na voljo — uporabite fotografijo ali vnos')
      return
    }
    try {
      cameraStream = await startCamera(video)
      const tick = () => {
        const code = decodeQrFromVideo(video)
        if (code) {
          onFound(code)
          return
        }
        scanLoop = requestAnimationFrame(tick)
      }
      scanLoop = requestAnimationFrame(tick)
    } catch {
      showToast('Dostop do kamere zavrnjen — uporabite fotografijo')
    }
  })

  stopBtn?.addEventListener('click', () => {
    stopScan()
    panel?.classList.add('hidden')
  })

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    try {
      const code = await decodeQrFromFile(file)
      if (code) onFound(code)
      else showToast('QR ni bil zaznan — vnesite ročno')
    } catch {
      showToast('Branje fotografije ni uspelo')
    }
  })
}

function stockOptions(selected?: string) {
  return [
    `<option value="">— brez povezave —</option>`,
    ...data.stock.map(
      (s) =>
        `<option value="${s.id}" ${selected === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${s.qty})</option>`,
    ),
  ].join('')
}

/* ===================== Nabava ===================== */
function sortedRequests(filter?: RequestStatus | 'vse'): ProcurementRequest[] {
  let list = [...data.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (filter && filter !== 'vse') list = list.filter((r) => r.status === filter)
  return list
}

function requestCard(r: ProcurementRequest, mode: 'manage' | 'view'): string {
  const stock = r.stockItemId ? data.stock.find((s) => s.id === r.stockItemId) : undefined
  const supplier = r.supplierNote
    ? `<p><strong>Dobavitelj:</strong> ${escapeHtml(r.supplierNote)}</p>`
    : ''
  const photo = r.photoDataUrl
    ? `<img class="photo-thumb" src="${r.photoDataUrl}" alt="Fotografija zahteve" />`
    : ''
  const qr = r.qrValue ? `<p><strong>QR:</strong> <code>${escapeHtml(r.qrValue)}</code></p>` : ''
  const stockLink = stock
    ? `<p><strong>Zaloga:</strong> ${escapeHtml(stock.name)} (${stock.qty} / min ${stock.minQty})</p>`
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

  const suggestions = suggestSuppliers(r.category, r.title)
  const datalist =
    suggestions.length > 0
      ? `<datalist id="sup-${r.id}">${suggestions.map((s) => `<option value="${escapeHtml(s.name)}"></option>`).join('')}</datalist>`
      : ''

  let actions = ''
  if (mode === 'manage' && r.status !== 'prejeto' && r.status !== 'zavrnjeno') {
    actions = `
      <div class="stack" style="margin-top:12px">
        <label class="field">Dobavitelj (kdo/kje)
          <input type="text" list="sup-${r.id}" data-supplier="${r.id}" value="${escapeHtml(r.supplierNote)}" placeholder="npr. Merkur Celje" autocomplete="off" />
        </label>
        ${datalist}
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
        <span>${escapeHtml(r.workstationName)}${r.slotLabel ? ' · ' + escapeHtml(r.slotLabel) : ''}</span>
      </div>
      ${r.note ? `<p>${escapeHtml(r.note)}</p>` : ''}
      ${qr}
      ${stockLink}
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
      if (req.supplierNote) rememberSupplier(req.supplierNote, req.category, req.title)
      persist()
      showToast('Dobavitelj shranjen')
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
      if (req.supplierNote) rememberSupplier(req.supplierNote, req.category, req.title)
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
    : `<p class="muted">Opravila lahko ureja samo vodja.</p>`

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
        data.tasks = data.tasks.filter((t) => t.id !== btn.dataset.delTask)
        persist()
        showToast('Opravilo izbrisano')
        render()
      })
    })
  }
  app.querySelectorAll<HTMLInputElement>('[data-toggle-task]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (!editable) return
      const task = data.tasks.find((t) => t.id === cb.dataset.toggleTask)
      if (!task) return
      task.done = cb.checked
      persist()
      render()
    })
  })
}

function renderNabava(): string {
  const subs: Array<[NabavaSub, string]> = isVodja()
    ? [
        ['seznam', 'Zahteve'],
        ['opravila', 'Opravila'],
      ]
    : [
        ['nova', 'Nova'],
        ['moje', 'Moje'],
        ['seznam', 'Vse'],
        ['opravila', 'Opravila'],
      ]

  const subNav = `<div class="subtabs">${subs
    .map(
      ([id, label]) =>
        `<button class="chip ${nabavaSub === id ? 'active' : ''}" type="button" data-sub="${id}">${label}</button>`,
    )
    .join('')}</div>`

  if (nabavaSub === 'opravila') return subNav + renderTasks(isVodja())

  if (nabavaSub === 'nova') {
    const cats = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')
    return (
      subNav +
      `
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
          <label class="field">Poveži z zalogo (neobvezno)
            <select name="stockItemId">${stockOptions()}</select>
          </label>
          ${qrFieldHtml('req-qr')}
          <label class="field">Fotografija (neobvezno)
            <input name="photo" type="file" accept="image/*" capture="environment" />
          </label>
          <div id="photo-preview"></div>
          <button class="btn btn-primary btn-block" type="submit">Oddaj zahtevo</button>
        </form>
      </section>`
    )
  }

  if (nabavaSub === 'moje') {
    const mine = sortedRequests('vse').filter(
      (r) =>
        r.createdBy === session!.displayName ||
        (session!.workstationId && r.workstationId === session!.workstationId),
    )
    return (
      subNav +
      (mine.length === 0
        ? `<div class="card empty">Nimate še zahtev.</div>`
        : mine.map((r) => requestCard(r, 'view')).join(''))
    )
  }

  // seznam
  const filters: Array<RequestStatus | 'vse'> = ['odprto', 'naroceno', 'prejeto', 'zavrnjeno', 'vse']
  const chips = filters
    .map((f) => {
      const label = f === 'vse' ? 'Vse' : STATUS_LABELS[f]
      return `<button class="chip ${statusFilter === f ? 'active' : ''}" type="button" data-filter="${f}">${label}</button>`
    })
    .join('')
  const list = sortedRequests(statusFilter)
  const mode = isVodja() ? 'manage' : 'view'
  return (
    subNav +
    `
    <div class="filters">${chips}</div>
    ${
      list.length === 0
        ? `<div class="card empty">Ni zahtev za ta filter.</div>`
        : list.map((r) => requestCard(r, mode)).join('')
    }`
  )
}

function bindNewRequestForm() {
  const form = app.querySelector<HTMLFormElement>('#req-form')
  const preview = app.querySelector<HTMLDivElement>('#photo-preview')
  let photoDataUrl: string | undefined
  const photoInput = form?.querySelector<HTMLInputElement>('input[name="photo"]')
  bindQrField('req-qr')

  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    photoDataUrl = undefined
    if (preview) preview.innerHTML = ''
    if (!file || !preview) return
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
    if (!session) return
    const fd = new FormData(form)
    const category = String(fd.get('category')) as Category
    const title = String(fd.get('title') || '').trim()
    const note = String(fd.get('note') || '').trim()
    const stockItemId = String(fd.get('stockItemId') || '') || undefined
    const qrValue = app.querySelector<HTMLInputElement>('#req-qr')?.value.trim() || undefined
    if (!title) return

    let workstationId = session.workstationId || 'rocna-delavnica'
    let slotId = session.slotId
    const ws = findWorkstation(workstationId) || WORKSTATIONS[0]
    const slot = (slotId && findSlot(ws.id, slotId)) || ws.slots[0]
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
      qrValue,
      stockItemId,
      status: 'odprto',
      supplierNote: '',
      history: [{ at: now, status: 'odprto', by: session.displayName }],
    }
    data.requests.unshift(req)
    persist()
    showToast('Zahteva oddana')
    nabavaSub = isVodja() ? 'seznam' : 'moje'
    render()
  })
}

/* ===================== Zaloge ===================== */
function renderZaloge(): string {
  const sorted = [...data.stock].sort((a, b) => a.name.localeCompare(b.name, 'sl'))
  const list =
    sorted.length === 0
      ? `<div class="empty">Ni artiklov na zalogi.</div>`
      : sorted
          .map((s) => {
            const low = s.qty <= s.minQty
            return `
            <article class="card ${low ? 'low-stock' : ''}" data-stock="${s.id}">
              <div class="request-meta">
                <span>${escapeHtml(s.category)}</span>
                ${low ? '<span class="status zavrnjeno">Nizka zaloga</span>' : ''}
                ${s.qrValue ? `<code class="qr-tag">${escapeHtml(s.qrValue)}</code>` : ''}
              </div>
              <h3 class="request-title">${escapeHtml(s.name)}</h3>
              <div class="request-meta">
                <span><strong>${s.qty}</strong> kos (min ${s.minQty})</span>
                <span>${escapeHtml(s.location || '—')}</span>
              </div>
              ${
                isVodja()
                  ? `<div class="actions">
                      <button class="btn btn-secondary" type="button" data-edit-stock="${s.id}">Uredi</button>
                      <button class="btn btn-danger" type="button" data-del-stock="${s.id}">Izbriši</button>
                    </div>`
                  : ''
              }
            </article>`
          })
          .join('')

  const form = isVodja()
    ? `
    <section class="card">
      <h2>Nova zaloga</h2>
      <form class="stack" id="stock-form">
        <label class="field">Naziv
          <input name="name" required maxlength="120" />
        </label>
        <label class="field">Kategorija
          <input name="category" list="cat-list" required maxlength="60" />
          <datalist id="cat-list">${CATEGORIES.map((c) => `<option value="${c}"></option>`).join('')}</datalist>
        </label>
        <div class="row-2">
          <label class="field">Količina
            <input name="qty" type="number" min="0" step="1" value="0" required />
          </label>
          <label class="field">Min. količina
            <input name="minQty" type="number" min="0" step="1" value="1" required />
          </label>
        </div>
        <label class="field">Lokacija
          <input name="location" maxlength="80" placeholder="npr. Polica A3" />
        </label>
        ${qrFieldHtml('stock-qr')}
        <button class="btn btn-primary btn-block" type="submit">Dodaj</button>
      </form>
    </section>`
    : `<p class="muted card">Zaloge si lahko ogledate. Urejanje je za vodjo.</p>`

  return form + `<section class="card"><h2>Seznam zalog</h2>${list}</section>`
}

function bindZaloge() {
  if (isVodja()) {
    bindQrField('stock-qr')
    app.querySelector<HTMLFormElement>('#stock-form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      const form = e.target as HTMLFormElement
      const fd = new FormData(form)
      const item: StockItem = {
        id: uid('stock'),
        name: String(fd.get('name') || '').trim(),
        category: String(fd.get('category') || '').trim(),
        qty: Number(fd.get('qty') || 0),
        minQty: Number(fd.get('minQty') || 0),
        location: String(fd.get('location') || '').trim(),
        qrValue: app.querySelector<HTMLInputElement>('#stock-qr')?.value.trim() || undefined,
        updatedAt: new Date().toISOString(),
      }
      if (!item.name) return
      data.stock.push(item)
      persist()
      showToast('Artikel dodan')
      render()
    })

    app.querySelectorAll<HTMLButtonElement>('[data-del-stock]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm('Izbrisati artikel?')) return
        data.stock = data.stock.filter((s) => s.id !== btn.dataset.delStock)
        persist()
        render()
      })
    })

    app.querySelectorAll<HTMLButtonElement>('[data-edit-stock]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = data.stock.find((s) => s.id === btn.dataset.editStock)
        if (!item) return
        const qty = prompt('Nova količina', String(item.qty))
        if (qty === null) return
        const n = Number(qty)
        if (Number.isNaN(n) || n < 0) {
          showToast('Neveljavna količina')
          return
        }
        item.qty = n
        item.updatedAt = new Date().toISOString()
        persist()
        showToast('Zaloga posodobljena')
        render()
      })
    })
  }
}

/* ===================== Okvare ===================== */
function renderOkvare(): string {
  const filters: Array<FaultStatus | 'vse'> = ['novo', 'v_delu', 'reseno', 'vse']
  const chips = filters
    .map((f) => {
      const label = f === 'vse' ? 'Vse' : FAULT_STATUS_LABELS[f]
      return `<button class="chip ${faultFilter === f ? 'active' : ''}" type="button" data-fault-filter="${f}">${label}</button>`
    })
    .join('')

  const machines = MACHINES.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')

  const form = `
    <section class="card">
      <h2>Prijava okvare</h2>
      <form class="stack" id="fault-form">
        <label class="field">Stroj
          <select name="machine" required>${machines}</select>
        </label>
        <label class="field">Opis
          <textarea name="description" required maxlength="800" placeholder="Kaj se je zgodilo?"></textarea>
        </label>
        <label class="field">Fotografija (neobvezno)
          <input name="photo" type="file" accept="image/*" capture="environment" />
        </label>
        <div id="fault-preview"></div>
        <button class="btn btn-primary btn-block" type="submit">Prijavi okvaro</button>
      </form>
    </section>`

  let list = [...data.faults].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (faultFilter !== 'vse') list = list.filter((f) => f.status === faultFilter)

  const cards =
    list.length === 0
      ? `<div class="card empty">Ni okvar.</div>`
      : list
          .map((f) => {
            const hist = f.history
              .map(
                (h) => `
              <div class="history-item">
                <span class="status fault-${h.status}">${FAULT_STATUS_LABELS[h.status]}</span>
                <span class="muted"> · ${formatDateTime(h.at)} · ${escapeHtml(h.by)}</span>
              </div>`,
              )
              .join('')
            const actions = isVodja()
              ? `<div class="actions">
                  ${f.status === 'novo' ? `<button class="btn btn-secondary" type="button" data-fault-status="${f.id}" data-to="v_delu">V delo</button>` : ''}
                  ${f.status !== 'reseno' ? `<button class="btn btn-primary" type="button" data-fault-status="${f.id}" data-to="reseno">Rešeno</button>` : ''}
                </div>`
              : ''
            return `
              <article class="card">
                <div class="request-meta">
                  <span class="status fault-${f.status}">${FAULT_STATUS_LABELS[f.status]}</span>
                  <span>${formatDateTime(f.createdAt)}</span>
                </div>
                <h3 class="request-title">${escapeHtml(f.machine)}</h3>
                <p>${escapeHtml(f.description)}</p>
                <div class="muted">${escapeHtml(f.createdBy)}</div>
                ${f.photoDataUrl ? `<img class="photo-thumb" src="${f.photoDataUrl}" alt="Okvara" />` : ''}
                ${actions}
                <details style="margin-top:10px"><summary class="muted">Zgodovina</summary>${hist}</details>
              </article>`
          })
          .join('')

  return form + `<div class="filters">${chips}</div>` + cards
}

function bindOkvare() {
  let photoDataUrl: string | undefined
  const preview = app.querySelector('#fault-preview')
  const photoInput = app.querySelector<HTMLInputElement>('#fault-form input[name="photo"]')
  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    photoDataUrl = undefined
    if (preview) preview.innerHTML = ''
    if (!file || !preview) return
    try {
      photoDataUrl = await fileToDataUrl(file)
      preview.innerHTML = `<img class="photo-thumb" src="${photoDataUrl}" alt="Predogled" />`
    } catch {
      showToast('Fotografije ni bilo mogoče obdelati')
    }
  })

  app.querySelector('#fault-form')?.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!session) return
    const fd = new FormData(e.target as HTMLFormElement)
    const now = new Date().toISOString()
    const fault: MachineFault = {
      id: uid('fault'),
      machine: String(fd.get('machine') || ''),
      description: String(fd.get('description') || '').trim(),
      photoDataUrl,
      status: 'novo',
      createdAt: now,
      createdBy: session.displayName,
      history: [{ at: now, status: 'novo', by: session.displayName }],
    }
    if (!fault.description) return
    data.faults.unshift(fault)
    persist()
    showToast('Okvara prijavljena')
    render()
  })

  app.querySelectorAll<HTMLButtonElement>('[data-fault-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      faultFilter = btn.dataset.faultFilter as FaultStatus | 'vse'
      render()
    })
  })

  app.querySelectorAll<HTMLButtonElement>('[data-fault-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!session) return
      const f = data.faults.find((x) => x.id === btn.dataset.faultStatus)
      if (!f) return
      const to = btn.dataset.to as FaultStatus
      f.status = to
      f.history.push({ at: new Date().toISOString(), status: to, by: session.displayName })
      persist()
      showToast(FAULT_STATUS_LABELS[to])
      render()
    })
  })
}

/* ===================== Servisi Okuma ===================== */
function renderServisi(): string {
  const machines = OKUMA_MACHINES.map(
    (m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`,
  ).join('')

  const form = isVodja()
    ? `
    <section class="card">
      <h2>Nov servis</h2>
      <form class="stack" id="service-form">
        <label class="field">Datum
          <input name="date" type="date" required />
        </label>
        <label class="field">Stroj
          <select name="machine" required>${machines}</select>
        </label>
        <label class="field">Opomba
          <textarea name="note" maxlength="400" placeholder="Vrsta servisa, deli…"></textarea>
        </label>
        <label class="check-row">
          <input name="done" type="checkbox" /> Že opravljeno
        </label>
        <button class="btn btn-primary btn-block" type="submit">Dodaj</button>
      </form>
    </section>`
    : `<p class="muted card">Servise ureja vodja. Spodaj je pregled.</p>`

  const sorted = [...data.services].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return a.date.localeCompare(b.date)
  })

  const list =
    sorted.length === 0
      ? `<div class="card empty">Ni načrtovanih servisov.</div>`
      : sorted
          .map((s) => {
            const past = !s.done && s.date < new Date().toISOString().slice(0, 10)
            return `
            <article class="card ${s.done ? 'done-soft' : ''}">
              <div class="request-meta">
                <span class="status ${s.done ? 'prejeto' : past ? 'zavrnjeno' : 'naroceno'}">${s.done ? 'Opravljeno' : past ? 'Zamujeno' : 'Načrtovano'}</span>
                <span>${formatDate(s.date)}</span>
              </div>
              <h3 class="request-title">${escapeHtml(s.machine)}</h3>
              ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ''}
              <div class="muted">${escapeHtml(s.createdBy)}</div>
              ${
                isVodja()
                  ? `<div class="actions">
                      <label class="check-row">
                        <input type="checkbox" data-toggle-service="${s.id}" ${s.done ? 'checked' : ''} /> Opravljeno
                      </label>
                      <button class="btn btn-danger" type="button" data-del-service="${s.id}">Izbriši</button>
                    </div>`
                  : ''
              }
            </article>`
          })
          .join('')

  return form + list
}

function bindServisi() {
  if (!isVodja()) return
  app.querySelector('#service-form')?.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!session) return
    const fd = new FormData(e.target as HTMLFormElement)
    const svc: OkumaService = {
      id: uid('svc'),
      date: String(fd.get('date') || ''),
      machine: String(fd.get('machine') || ''),
      note: String(fd.get('note') || '').trim(),
      done: Boolean(fd.get('done')),
      createdAt: new Date().toISOString(),
      createdBy: session.displayName,
    }
    data.services.push(svc)
    persist()
    showToast('Servis dodan')
    render()
  })
  app.querySelectorAll<HTMLInputElement>('[data-toggle-service]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const s = data.services.find((x) => x.id === cb.dataset.toggleService)
      if (!s) return
      s.done = cb.checked
      persist()
      render()
    })
  })
  app.querySelectorAll<HTMLButtonElement>('[data-del-service]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('Izbrisati servis?')) return
      data.services = data.services.filter((s) => s.id !== btn.dataset.delService)
      persist()
      render()
    })
  })
}

/* ===================== Zgodovina ===================== */
function renderZgodovina(): string {
  const reqs = sortedRequests('vse')
  const faults = [...data.faults].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const services = [...data.services].sort((a, b) => b.date.localeCompare(a.date))

  return `
    <section class="card">
      <h2>Zgodovina nabave</h2>
      <p class="muted">${reqs.length} zahtev</p>
    </section>
    ${reqs.length === 0 ? '<div class="card empty">Ni zahtev.</div>' : reqs.map((r) => requestCard(r, 'view')).join('')}
    <section class="card"><h2>Okvare — arhiv</h2></section>
    ${
      faults.length === 0
        ? '<div class="card empty">Ni okvar.</div>'
        : faults
            .map(
              (f) => `
        <article class="card">
          <div class="request-meta">
            <span class="status fault-${f.status}">${FAULT_STATUS_LABELS[f.status]}</span>
            <span>${formatDateTime(f.createdAt)}</span>
          </div>
          <h3 class="request-title">${escapeHtml(f.machine)}</h3>
          <p>${escapeHtml(f.description)}</p>
        </article>`,
            )
            .join('')
    }
    <section class="card"><h2>Servisi</h2></section>
    ${
      services.length === 0
        ? '<div class="card empty">Ni servisov.</div>'
        : services
            .map(
              (s) => `
        <article class="card">
          <div class="request-meta">
            <span class="status ${s.done ? 'prejeto' : 'naroceno'}">${s.done ? 'Opravljeno' : 'Načrtovano'}</span>
            <span>${formatDate(s.date)}</span>
          </div>
          <h3 class="request-title">${escapeHtml(s.machine)}</h3>
          ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ''}
        </article>`,
            )
            .join('')
    }`
}

/* ===================== App shell bind ===================== */
function renderApp() {
  let content = ''
  if (tab === 'nabava') content = renderNabava()
  else if (tab === 'zaloge') content = renderZaloge()
  else if (tab === 'okvare') content = renderOkvare()
  else if (tab === 'servisi') content = renderServisi()
  else content = renderZgodovina()

  shell(content)

  if (tab === 'nabava') {
    app.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        nabavaSub = btn.dataset.sub as NabavaSub
        render()
      })
    })
    if (nabavaSub === 'opravila') bindTasks(isVodja())
    else if (nabavaSub === 'nova') bindNewRequestForm()
    else if (nabavaSub === 'seznam' && isVodja()) {
      bindManageActions()
      app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          statusFilter = btn.dataset.filter as RequestStatus | 'vse'
          render()
        })
      })
    } else if (nabavaSub === 'seznam') {
      app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          statusFilter = btn.dataset.filter as RequestStatus | 'vse'
          render()
        })
      })
    }
  } else if (tab === 'zaloge') bindZaloge()
  else if (tab === 'okvare') bindOkvare()
  else if (tab === 'servisi') bindServisi()
}

render()
