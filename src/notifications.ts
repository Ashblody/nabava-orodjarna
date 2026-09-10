import type { AppData, ProcurementRequest, Session } from './types.ts'
import { STATUS_LABELS, URGENCY_LABELS } from './data.ts'

const LASTSEEN_KEY = 'nabava-orodjarna-lastseen-v1'
const NOTIFIED_KEY = 'nabava-orodjarna-notified-v1'
const MAX_NOTIFIED = 200

export type NotifEvent = {
  id: string
  requestId: string
  kind: 'new_request' | 'status_change'
  title: string
  body: string
  urgency?: ProcurementRequest['urgency']
  at: string
  status?: ProcurementRequest['status']
}

type LastSeenMap = Record<string, string>

function readLastSeenMap(): LastSeenMap {
  try {
    const raw = localStorage.getItem(LASTSEEN_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as LastSeenMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLastSeenMap(map: LastSeenMap): void {
  localStorage.setItem(LASTSEEN_KEY, JSON.stringify(map))
}

export function getLastSeenAt(userId: string): string | null {
  const v = readLastSeenMap()[userId]
  return typeof v === 'string' && v ? v : null
}

export function setLastSeenAt(userId: string, iso = new Date().toISOString()): void {
  const map = readLastSeenMap()
  map[userId] = iso
  writeLastSeenMap(map)
}

export function markSeenNow(userId: string): void {
  setLastSeenAt(userId, new Date().toISOString())
}

function readNotified(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeNotified(ids: string[]): void {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(ids.slice(-MAX_NOTIFIED)))
}

export function wasNotified(id: string): boolean {
  return readNotified().includes(id)
}

export function rememberNotified(ids: string[]): void {
  if (ids.length === 0) return
  const set = new Set(readNotified())
  for (const id of ids) set.add(id)
  writeNotified([...set])
}

function ownRequest(r: ProcurementRequest, session: Session): boolean {
  if (r.createdBy === session.displayName) return true
  if (session.workstationId && r.workstationId === session.workstationId) return true
  return false
}

function latestStatusAt(r: ProcurementRequest, status: ProcurementRequest['status']): string | null {
  let latest: string | null = null
  for (const h of r.history || []) {
    if (h.status === status && (!latest || h.at > latest)) latest = h.at
  }
  return latest
}

/** Relevant “new” events since lastSeen (or epoch if never seen). */
export function collectRelevantEvents(
  requests: ProcurementRequest[],
  session: Session,
  sinceIso: string | null,
): NotifEvent[] {
  const since = sinceIso || '1970-01-01T00:00:00.000Z'
  const out: NotifEvent[] = []

  if (session.role === 'vodja') {
    for (const r of requests) {
      if (r.createdAt > since && (r.status === 'odprto' || r.status === 'naroceno')) {
        const nujno = r.urgency === 'visoka' ? ' · NUJNO' : ''
        out.push({
          id: `new:${r.id}:${r.createdAt}`,
          requestId: r.id,
          kind: 'new_request',
          title: `Nova zahteva${nujno}`,
          body: `${r.title} · ${r.createdBy}`,
          urgency: r.urgency,
          at: r.createdAt,
          status: r.status,
        })
      }
    }
  } else {
    for (const r of requests) {
      if (!ownRequest(r, session)) continue
      for (const st of ['naroceno', 'prejeto'] as const) {
        const at = latestStatusAt(r, st)
        if (at && at > since && r.status === st) {
          out.push({
            id: `status:${r.id}:${st}:${at}`,
            requestId: r.id,
            kind: 'status_change',
            title: `Status: ${STATUS_LABELS[st]}`,
            body: `${r.title}`,
            urgency: r.urgency,
            at,
            status: st,
          })
        }
      }
    }
  }

  out.sort((a, b) => b.at.localeCompare(a.at))
  return out
}

export type BadgeInfo = {
  /** Unread / new-since-lastSeen count */
  newCount: number
  /** Open odprto (vodja) or pending own status updates */
  openCount: number
  nujnoOpen: number
  /** Request ids considered “novo” for list highlight */
  newIds: Set<string>
}

export function computeBadge(
  requests: ProcurementRequest[],
  session: Session,
  lastSeen: string | null,
): BadgeInfo {
  const events = collectRelevantEvents(requests, session, lastSeen)
  const newIds = new Set(events.map((e) => e.requestId))
  let openCount = 0
  let nujnoOpen = 0

  if (session.role === 'vodja') {
    for (const r of requests) {
      if (r.status === 'odprto') {
        openCount += 1
        if (r.urgency === 'visoka') nujnoOpen += 1
        // Always treat currently open as worth badge attention if never seen
        if (!lastSeen || r.createdAt > lastSeen) newIds.add(r.id)
      }
    }
  } else {
    openCount = events.length
  }

  return {
    newCount: events.length,
    openCount,
    nujnoOpen,
    newIds,
  }
}

/** Display count on tab: prefer new-since-seen, else open odprto for vodja. */
export function badgeDisplayCount(info: BadgeInfo, role: Session['role']): number {
  if (role === 'vodja') {
    if (info.newCount > 0) return info.newCount
    return info.openCount
  }
  return info.newCount
}

export function notificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationSupported()) return 'unsupported'
  try {
    const p = await Notification.requestPermission()
    return p
  } catch {
    return Notification.permission
  }
}

export async function fireBrowserNotification(ev: NotifEvent): Promise<void> {
  if (!notificationSupported()) return
  if (Notification.permission !== 'granted') return
  if (wasNotified(ev.id)) return

  const opts: NotificationOptions = {
    body: ev.body,
    tag: ev.id,
    data: { requestId: ev.requestId, eventId: ev.id },
  }

  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg?.showNotification) {
      await reg.showNotification(ev.title, opts)
    } else {
      const n = new Notification(ev.title, opts)
      n.onclick = () => {
        window.focus()
        n.close()
      }
    }
    rememberNotified([ev.id])
  } catch (err) {
    console.warn('Notification failed', err)
  }
}

export async function notifyNewEvents(events: NotifEvent[], onlyIfHidden = true): Promise<void> {
  if (events.length === 0) return
  const fresh = events.filter((e) => !wasNotified(e.id))
  if (fresh.length === 0) return
  if (onlyIfHidden && typeof document !== 'undefined' && document.visibilityState === 'visible') {
    // In-app badges cover the foreground — mark seen-as-notified to avoid toast spam later
    rememberNotified(fresh.map((e) => e.id))
    return
  }
  if (getNotificationPermission() !== 'granted') {
    rememberNotified(fresh.map((e) => e.id))
    return
  }
  for (const ev of fresh.slice(0, 5)) {
    await fireBrowserNotification(ev)
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const base = import.meta.env.BASE_URL || '/'
    const swUrl = (base.endsWith('/') ? base : `${base}/`) + 'sw.js'
    await navigator.serviceWorker.register(swUrl, { scope: base })
  } catch (err) {
    console.warn('SW register failed', err)
  }
}

export function requestsFingerprint(data: AppData): string {
  // Cheap change detection without huge JSON (photos)
  const parts = data.requests.map(
    (r) => `${r.id}:${r.status}:${r.urgency}:${r.createdAt}:${r.history?.length || 0}:${r.supplierNote?.length || 0}`,
  )
  return `${data.requests.length}|${parts.join(';')}|u:${data.users.length}|t:${data.tasks.length}`
}

export function formatNotifHint(info: BadgeInfo, role: Session['role']): string {
  if (role === 'vodja') {
    if (info.newCount > 0) {
      const nuj = info.nujnoOpen > 0 ? ` (${info.nujnoOpen} nujno odprto)` : ''
      return `${info.newCount} novo${nuj}`
    }
    if (info.openCount > 0) {
      const nuj = info.nujnoOpen > 0 ? ` · ${info.nujnoOpen} nujno` : ''
      return `${info.openCount} odprto${nuj}`
    }
    return ''
  }
  if (info.newCount > 0) return `${info.newCount} posodobitev`
  return ''
}

export function eventLabelShort(ev: NotifEvent): string {
  if (ev.kind === 'new_request') {
    const u = ev.urgency === 'visoka' ? ` [${URGENCY_LABELS.visoka}]` : ''
    return `Nova:${u} ${ev.body}`
  }
  return `${ev.title}: ${ev.body}`
}
