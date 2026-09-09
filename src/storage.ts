import type { AppData, Session } from './types.ts'

const DATA_KEY = 'nabava-orodjarna-data-v1'
const SESSION_KEY = 'nabava-orodjarna-session-v1'

const emptyData = (): AppData => ({ requests: [], tasks: [] })

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(DATA_KEY)
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as AppData
    return {
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    }
  } catch {
    return emptyData()
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Session
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
