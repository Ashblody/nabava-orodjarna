import type { AppData, Role, Session, UserAccount } from './types.ts'

const DATA_KEY = 'nabava-orodjarna-data-v2'
const LEGACY_DATA_KEY = 'nabava-orodjarna-data-v1'
const SESSION_KEY = 'nabava-orodjarna-session-v2'
const LEGACY_SESSION_KEY = 'nabava-orodjarna-session-v1'

export const emptyData = (): AppData => ({
  version: 2,
  requests: [],
  tasks: [],
  stock: [],
  faults: [],
  services: [],
  suppliers: [],
  users: [],
})

function normalizeUser(raw: unknown): UserAccount | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (typeof u.id !== 'string' || typeof u.name !== 'string') return null
  const role: Role = u.role === 'vodja' ? 'vodja' : 'delavec'
  return {
    id: u.id,
    name: u.name,
    role,
    workstationId: typeof u.workstationId === 'string' ? u.workstationId : undefined,
    createdAt: typeof u.createdAt === 'string' ? u.createdAt : new Date().toISOString(),
  }
}

function migrateLegacy(raw: unknown): AppData {
  const base = emptyData()
  if (!raw || typeof raw !== 'object') return base
  const parsed = raw as Partial<AppData> & { requests?: unknown[]; tasks?: unknown[] }
  const users = Array.isArray(parsed.users)
    ? parsed.users.map(normalizeUser).filter((u): u is UserAccount => !!u)
    : []
  return {
    ...base,
    requests: Array.isArray(parsed.requests) ? (parsed.requests as AppData['requests']) : [],
    tasks: Array.isArray(parsed.tasks) ? (parsed.tasks as AppData['tasks']) : [],
    stock: Array.isArray(parsed.stock) ? parsed.stock : [],
    faults: Array.isArray(parsed.faults) ? parsed.faults : [],
    services: Array.isArray(parsed.services) ? parsed.services : [],
    suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
    users,
    lastUserId: typeof parsed.lastUserId === 'string' ? parsed.lastUserId : undefined,
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(DATA_KEY) ?? localStorage.getItem(LEGACY_DATA_KEY)
    if (!raw) return emptyData()
    const data = migrateLegacy(JSON.parse(raw))
    if (!localStorage.getItem(DATA_KEY)) {
      localStorage.setItem(DATA_KEY, JSON.stringify(data))
    }
    return data
  } catch {
    return emptyData()
  }
}

export function saveData(data: AppData): void {
  data.version = 2
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? localStorage.getItem(LEGACY_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    if (!s.userId || !s.displayName || !s.role) return null
    return s
  } catch {
    return null
  }
}

export function saveSession(session: Session | null): void {
  if (!session) {
    localStorage.removeItem(SESSION_KEY)
    return
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('sl-SI', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('sl-SI', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
