/** Injected at build time by Vite; fallback for plain tsc/dev. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.2.0'

export const APP_BUILT_AT: string =
  typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : ''

export interface RemoteVersion {
  version: string
  builtAt?: string
  notes?: string
}

export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((n) => parseInt(n, 10) || 0)
  const a = parse(remote)
  const b = parse(local)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = (a[i] || 0) - (b[i] || 0)
    if (d > 0) return true
    if (d < 0) return false
  }
  return false
}

export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const rel = (base.endsWith('/') ? base : `${base}/`) + 'version.json'
    const res = await fetch(rel, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as RemoteVersion
    if (!json || typeof json.version !== 'string') return null
    return json
  } catch {
    return null
  }
}
