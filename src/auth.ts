import type { Role, UserAccount } from './types.ts'
import { uid } from './storage.ts'

/** Lightweight PIN/password hash (Web Crypto SHA-256). Not for real security — local demo only. */
export async function hashPin(pin: string, salt = 'nabava-orodjarna-v1'): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const h = await hashPin(pin)
  return h === hash
}

export async function createUser(opts: {
  name: string
  pin: string
  role: Role
  workstationId?: string
}): Promise<UserAccount> {
  return {
    id: uid('user'),
    name: opts.name.trim(),
    pinHash: await hashPin(opts.pin),
    role: opts.role,
    workstationId: opts.workstationId,
    createdAt: new Date().toISOString(),
  }
}

export function findUserByName(users: UserAccount[], name: string): UserAccount | undefined {
  const n = name.trim().toLowerCase()
  return users.find((u) => u.name.trim().toLowerCase() === n)
}
