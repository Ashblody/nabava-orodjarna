import './style.css'
import {
  ALL_STATUSES,
  ALL_URGENCIES,
  CATEGORIES,
  OKUMA_MACHINES,
  STATUS_LABELS,
  URGENCY_LABELS,
  URGENCY_RANK,
  WORKSTATIONS,
  findSlot,
  findWorkstation,
} from './data.ts'
import { createUser, findUserByName } from './auth.ts'
import { downloadExcelCsv, downloadWordDoc, stamp } from './export.ts'
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
  MainTab,
  OkumaService,
  ProcurementRequest,
  RequestStatus,
  Session,
  SupplierRecord,
  Task,
  Urgency,
} from './types.ts'

type NabavaSub = 'seznam' | 'nova' | 'opravila' | 'moje'

const HOWTO_KEY = 'nabava-orodjarna-howto-dismissed'

const app = document.querySelector<HTMLDivElement>('#app')!
let data: AppData = loadData()
let session: Session | null = loadSession()
let tab: MainTab = 'nabava'
let nabavaSub: NabavaSub = 'seznam'
let statusFilter: RequestStatus | 'vse' = 'odprto'
let urgencyFilter: Urgency | 'vse' = 'vse'
let detailRequestId: string | null = null
let toastTimer: number | undefined
let cameraStream: MediaStream | null = null
let scanLoop = 0
let authView: 'pick' | 'register' = 'pick'
let howtoOpen = !localStorage.getItem(HOWTO_KEY)

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
  detailRequestId = null
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
  urgencyFilter = 'vse'
  detailRequestId = null
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
  if (!data.users.find((u) => u.id === session!.userId) && data.users.length > 0) {
    logout()
    return
  }
  renderApp()
}

function howtoPanel(): string {
  if (!howtoOpen) {
    return `<button class="howto-link" type="button" data-action="howto-open">Kako deluje?</button>`
  }
  return `
    <section class="howto card">
      <div class="howto-head">
        <h2>Kako deluje</h2>
        <button class="btn btn-ghost btn-sm" type="button" data-action="howto-dismiss">Skrij</button>
      </div>
      <ol class="howto-list">
        <li><strong>Nabava</strong> — oddaj zahtevo (z nujnostjo), vodja naroči in označi prejeto.</li>
        <li><strong>Odpri kartico</strong> — tapni zahtevo za podrobnosti in spremembo statusa (tudi nazaj).</li>
        <li><strong>Izvoz</strong> — Excel (CSV) ali Word s seznama / zgodovine.</li>
        <li><strong>Servisi</strong> — načrtovanje servisov Okuma.</li>
      </ol>
      <p class="muted small tip-line">Podatki ostanejo v tem brskalniku (ni sinhronizacije med telefoni).</p>
    </section>`
}

function shell(content: string) {
  const tabs: Array<[MainTab, string, string, string]> = [
    ['nabava', '▣', 'Nabava', 'Zahteve'],
    ['servisi', '⚙', 'Servisi', 'Okuma'],
    ['zgodovina', '▤', 'Zgodovina', 'Arhiv'],
  ]
  const tabsHtml = tabs
    .map(
      ([id, icon, label, hint]) =>
        `<button class="tab tab-${id} ${tab === id ? 'active' : ''}" type="button" data-tab="${id}">
          <span class="tab-icon">${icon}</span>
          <span class="tab-label">${label}</span>
          <span class="tab-hint">${hint}</span>
        </button>`,
    )
    .join('')

  app.innerHTML = `
    <header class="app-header">
      <div>
        <h1>Orodjarna</h1>
        <div class="sub">${escapeHtml(session!.displayName)} · lokalno</div>
      </div>
      <div class="row">
        <span class="badge">${session!.role === 'vodja' ? 'Vodja' : 'Delavec'}</span>
        <button class="btn btn-ghost" type="button" data-action="logout">Odjava</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Glavni meni">${tabsHtml}</nav>
    ${howtoPanel()}
    <main>${content}</main>
  `
  app.querySelector('[data-action="logout"]')?.addEventListener('click', logout)
  app.querySelector('[data-action="howto-dismiss"]')?.addEventListener('click', () => {
    howtoOpen = false
    localStorage.setItem(HOWTO_KEY, '1')
    render()
  })
  app.querySelector('[data-action="howto-open"]')?.addEventListener('click', () => {
    howtoOpen = true
    localStorage.removeItem(HOWTO_KEY)
    render()
  })
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab as MainTab
      detailRequestId = null
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
      <p class="muted small section-hint">Ustvari račun, nato se prijaviš s tapom na ime (brez PIN-a).</p>
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
      <p class="muted small section-hint">Tapni svoje ime za vstop.</p>
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
        <button class="btn btn-secondary" type="button" data-open-scan="${id}" title="Skeniraj QR" aria-label="Skeniraj QR">⬚</button>
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

function urgencyFieldHtml(selected: Urgency = 'normalna', name = 'urgency'): string {
  const opts = ALL_URGENCIES.map(
    (u) =>
      `<option value="${u}" ${u === selected ? 'selected' : ''}>${URGENCY_LABELS[u]}</option>`,
  ).join('')
  return `
    <label class="field">Nujnost
      <select name="${name}" required>${opts}</select>
    </label>`
}

function urgencyBadge(u: Urgency): string {
  return `<span class="urgency urgency-${u}">${URGENCY_LABELS[u]}</span>`
}

/* ===================== Nabava ===================== */
function sortedRequests(
  filter?: RequestStatus | 'vse',
  urg?: Urgency | 'vse',
): ProcurementRequest[] {
  let list = [...data.requests]
  if (filter && filter !== 'vse') list = list.filter((r) => r.status === filter)
  if (urg && urg !== 'vse') list = list.filter((r) => r.urgency === urg)
  list.sort((a, b) => {
    const ua = URGENCY_RANK[a.urgency] ?? 1
    const ub = URGENCY_RANK[b.urgency] ?? 1
    if (ua !== ub) return ua - ub
    return b.createdAt.localeCompare(a.createdAt)
  })
  return list
}

function openToOrder(): ProcurementRequest[] {
  return sortedRequests('vse').filter((r) => r.status === 'odprto' || r.status === 'naroceno')
}

function nabavljeno(): ProcurementRequest[] {
  return sortedRequests('vse').filter((r) => r.status === 'prejeto')
}

function exportBar(scope: 'open' | 'history' | 'all'): string {
  const scopeLabel =
    scope === 'open'
      ? 'Odprto / za naročilo'
      : scope === 'history'
        ? 'Samo nabavljeno (prejeto)'
        : 'Vse zahteve'
  return `
    <div class="export-bar card">
      <div>
        <h3 class="export-title">Izvoz</h3>
        <p class="muted small">${scopeLabel}</p>
      </div>
      <div class="actions export-actions">
        <button class="btn btn-export-excel" type="button" data-export="excel" data-scope="${scope}">Excel (CSV)</button>
        <button class="btn btn-export-word" type="button" data-export="word" data-scope="${scope}">Word</button>
      </div>
    </div>`
}

function bindExportButtons() {
  app.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.export
      const scope = btn.dataset.scope || 'open'
      let list: ProcurementRequest[]
      let title: string
      let fileBase: string
      if (scope === 'open') {
        list = openToOrder()
        title = 'Nabava — odprto / za naročilo'
        fileBase = `nabava-za-narocilo_${stamp()}`
      } else if (scope === 'history') {
        list = nabavljeno()
        title = 'Nabava — nabavljeno (prejeto)'
        fileBase = `nabava-nabavljeno_${stamp()}`
      } else {
        list = sortedRequests('vse')
        title = 'Nabava — vse zahteve'
        fileBase = `nabava-vse_${stamp()}`
      }
      if (kind === 'excel') {
        downloadExcelCsv(`${fileBase}.csv`, list)
        showToast('CSV shranjen (Excel)')
      } else {
        downloadWordDoc(`${fileBase}.doc`, title, list)
        showToast('Word datoteka shranjena')
      }
    })
  })
}

function requestCard(r: ProcurementRequest, mode: 'manage' | 'view'): string {
  const supplier = r.supplierNote
    ? `<p><strong>Dobavitelj:</strong> ${escapeHtml(r.supplierNote)}</p>`
    : ''
  const photo = r.photoDataUrl
    ? `<img class="photo-thumb" src="${r.photoDataUrl}" alt="Fotografija zahteve" />`
    : ''
  const qr = r.qrValue ? `<p><strong>QR:</strong> <code>${escapeHtml(r.qrValue)}</code></p>` : ''

  return `
    <article class="card request-card urgency-card-${r.urgency}" data-open-request="${r.id}" role="button" tabindex="0">
      <div class="request-meta">
        <span class="status ${r.status}">${STATUS_LABELS[r.status]}</span>
        ${urgencyBadge(r.urgency)}
        <span>${escapeHtml(r.category)}</span>
        <span>${formatDateTime(r.createdAt)}</span>
      </div>
      <h3 class="request-title">${escapeHtml(r.title)}</h3>
      <div class="request-meta">
        <span>${escapeHtml(r.createdBy)}</span>
        <span>${escapeHtml(r.workstationName)}${r.slotLabel ? ' · ' + escapeHtml(r.slotLabel) : ''}</span>
      </div>
      ${r.note ? `<p class="clamp-2">${escapeHtml(r.note)}</p>` : ''}
      ${qr}
      ${supplier}
      ${photo}
      <p class="muted small tap-hint">${mode === 'manage' ? 'Odpri →' : 'Podrobnosti →'}</p>
    </article>`
}

function setRequestStatus(req: ProcurementRequest, to: RequestStatus, note?: string) {
  if (!session) return
  req.status = to
  req.history.push({
    at: new Date().toISOString(),
    status: to,
    by: session.displayName,
    note: note || req.supplierNote || undefined,
  })
  persist()
  showToast(`Status: ${STATUS_LABELS[to]}`)
}

function renderRequestDetail(r: ProcurementRequest): string {
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
      ? `<datalist id="sup-detail">${suggestions.map((s) => `<option value="${escapeHtml(s.name)}"></option>`).join('')}</datalist>`
      : ''

  const statusBtns = ALL_STATUSES.map((s) => {
    const active = r.status === s ? 'active' : ''
    return `<button class="status-pick ${active} status-${s}" type="button" data-set-status="${s}">${STATUS_LABELS[s]}</button>`
  }).join('')

  const urgencyOpts = ALL_URGENCIES.map(
    (u) =>
      `<option value="${u}" ${u === r.urgency ? 'selected' : ''}>${URGENCY_LABELS[u]}</option>`,
  ).join('')

  const canEdit = isVodja() || r.createdBy === session!.displayName

  return `
    <section class="card detail-card urgency-card-${r.urgency}">
      <div class="row detail-top">
        <button class="btn btn-ghost" type="button" data-action="detail-back">← Nazaj</button>
        <span class="muted small">Podrobnosti zahteve</span>
      </div>
      <div class="request-meta">
        <span class="status ${r.status}">${STATUS_LABELS[r.status]}</span>
        ${urgencyBadge(r.urgency)}
        <span>${escapeHtml(r.category)}</span>
      </div>
      <h2 class="request-title">${escapeHtml(r.title)}</h2>
      <div class="request-meta">
        <span>${escapeHtml(r.createdBy)}</span>
        <span>${escapeHtml(r.workstationName)}${r.slotLabel ? ' · ' + escapeHtml(r.slotLabel) : ''}</span>
        <span>${formatDateTime(r.createdAt)}</span>
      </div>
      ${r.note ? `<p>${escapeHtml(r.note)}</p>` : ''}
      ${r.qrValue ? `<p><strong>QR:</strong> <code>${escapeHtml(r.qrValue)}</code></p>` : ''}
      ${r.photoDataUrl ? `<img class="photo-thumb" src="${r.photoDataUrl}" alt="Fotografija" />` : ''}
    </section>

    <section class="card stack">
      <h3>Status</h3>
      <div class="status-picks">${statusBtns}</div>
    </section>

    <section class="card stack">
      <h3>Nujnost</h3>
      <label class="field">
        <select id="detail-urgency" ${canEdit || isVodja() ? '' : 'disabled'}>${urgencyOpts}</select>
      </label>
    </section>

    <section class="card stack">
      <h3>Dobavitelj</h3>
      <label class="field">Kdo / kje
        <input type="text" id="detail-supplier" list="sup-detail" value="${escapeHtml(r.supplierNote)}" placeholder="npr. Merkur Celje" autocomplete="off" ${isVodja() ? '' : 'readonly'} />
      </label>
      ${datalist}
      ${
        isVodja()
          ? `<button class="btn btn-secondary btn-block" type="button" data-action="save-supplier">Shrani dobavitelja</button>`
          : ''
      }
    </section>

    <section class="card">
      <h3>Zgodovina statusov</h3>
      ${history || '<p class="muted">Ni dogodkov.</p>'}
    </section>`
}

function bindRequestDetail(r: ProcurementRequest) {
  app.querySelector('[data-action="detail-back"]')?.addEventListener('click', () => {
    detailRequestId = null
    render()
  })

  app.querySelectorAll<HTMLButtonElement>('[data-set-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!isVodja()) {
        showToast('Status lahko spremeni vodja')
        return
      }
      const to = btn.dataset.setStatus as RequestStatus
      const supplierInput = app.querySelector<HTMLInputElement>('#detail-supplier')
      if (supplierInput) {
        r.supplierNote = supplierInput.value.trim()
        if (r.supplierNote) rememberSupplier(r.supplierNote, r.category, r.title)
      }
      setRequestStatus(r, to)
      render()
    })
  })

  app.querySelector('#detail-urgency')?.addEventListener('change', (e) => {
    if (!isVodja() && r.createdBy !== session!.displayName) return
    const val = (e.target as HTMLSelectElement).value as Urgency
    r.urgency = val
    persist()
    showToast(`Nujnost: ${URGENCY_LABELS[val]}`)
    render()
  })

  app.querySelector('[data-action="save-supplier"]')?.addEventListener('click', () => {
    const input = app.querySelector<HTMLInputElement>('#detail-supplier')
    if (!input) return
    r.supplierNote = input.value.trim()
    if (r.supplierNote) rememberSupplier(r.supplierNote, r.category, r.title)
    persist()
    showToast('Dobavitelj shranjen')
  })
}

function bindOpenRequestCards() {
  app.querySelectorAll<HTMLElement>('[data-open-request]').forEach((el) => {
    const open = () => {
      detailRequestId = el.dataset.openRequest || null
      render()
    }
    el.addEventListener('click', open)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
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
  if (detailRequestId) {
    const req = data.requests.find((r) => r.id === detailRequestId)
    if (!req) {
      detailRequestId = null
    } else {
      return renderRequestDetail(req)
    }
  }

  const subs: Array<[NabavaSub, string, string]> = isVodja()
    ? [
        ['seznam', '☰', 'Zahteve'],
        ['nova', '+', 'Nova'],
        ['opravila', '☑', 'Opravila'],
      ]
    : [
        ['nova', '+', 'Nova'],
        ['moje', '▣', 'Moje'],
        ['seznam', '☰', 'Vse'],
        ['opravila', '☑', 'Opravila'],
      ]

  const subNav = `<div class="subtabs">${subs
    .map(
      ([id, icon, label]) =>
        `<button class="chip subchip sub-${id} ${nabavaSub === id ? 'active' : ''}" type="button" data-sub="${id}"><span class="sub-icon">${icon}</span><span>${label}</span></button>`,
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
          ${urgencyFieldHtml('normalna')}
          <label class="field">Opomba
            <textarea name="note" maxlength="500" placeholder="Količina, mere, dodatne informacije…"></textarea>
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

  const urgChips = (['vse', ...ALL_URGENCIES] as const)
    .map((u) => {
      const label = u === 'vse' ? 'Vse nujnosti' : URGENCY_LABELS[u]
      return `<button class="chip chip-urgency ${urgencyFilter === u ? 'active' : ''} ${u !== 'vse' ? 'u-' + u : ''}" type="button" data-urgency-filter="${u}">${label}</button>`
    })
    .join('')

  const list = sortedRequests(statusFilter, urgencyFilter)
  const mode = isVodja() ? 'manage' : 'view'
  return (
    subNav +
    `
    <section class="section-block">
      <div class="filters">${chips}</div>
      <div class="filters">${urgChips}</div>
    </section>
    ${exportBar('open')}
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
    const urgency = (String(fd.get('urgency') || 'normalna') as Urgency) || 'normalna'
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
      urgency: ALL_URGENCIES.includes(urgency) ? urgency : 'normalna',
      photoDataUrl,
      qrValue,
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
    : ''

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
  if (detailRequestId) {
    const req = data.requests.find((r) => r.id === detailRequestId)
    if (req) return renderRequestDetail(req)
    detailRequestId = null
  }

  const reqs = sortedRequests('vse')
  const services = [...data.services].sort((a, b) => b.date.localeCompare(a.date))

  return `
    <section class="card">
      <h2>Zgodovina nabave</h2>
      <p class="muted">${reqs.length} zahtev</p>
    </section>
    ${exportBar('all')}
    ${exportBar('history')}
    ${reqs.length === 0 ? '<div class="card empty">Ni zahtev.</div>' : reqs.map((r) => requestCard(r, 'view')).join('')}
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
  else if (tab === 'servisi') content = renderServisi()
  else content = renderZgodovina()

  shell(content)

  if (tab === 'nabava') {
    if (detailRequestId) {
      const req = data.requests.find((r) => r.id === detailRequestId)
      if (req) bindRequestDetail(req)
      return
    }
    app.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        nabavaSub = btn.dataset.sub as NabavaSub
        detailRequestId = null
        render()
      })
    })
    if (nabavaSub === 'opravila') bindTasks(isVodja())
    else if (nabavaSub === 'nova') bindNewRequestForm()
    else {
      bindOpenRequestCards()
      bindExportButtons()
      app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          statusFilter = btn.dataset.filter as RequestStatus | 'vse'
          render()
        })
      })
      app.querySelectorAll<HTMLButtonElement>('[data-urgency-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          urgencyFilter = btn.dataset.urgencyFilter as Urgency | 'vse'
          render()
        })
      })
    }
  } else if (tab === 'servisi') bindServisi()
  else if (tab === 'zgodovina') {
    if (detailRequestId) {
      const req = data.requests.find((r) => r.id === detailRequestId)
      if (req) bindRequestDetail(req)
    } else {
      bindOpenRequestCards()
      bindExportButtons()
    }
  }
}

render()
