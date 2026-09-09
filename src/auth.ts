import type { Role, UserAccount } from './types.ts'
import { uid } from './storage.ts'

export function createUser(opts: {
  name: string
  role: Role
  workstationId?: string
}): UserAccount {
  return {
    id: uid('user'),
    name: opts.name.trim(),
    role: opts.role,
    workstationId: opts.workstationId,
    createdAt: new Date().toISOString(),
  }
}

export function findUserByName(users: UserAccount[], name: string): UserAccount | undefined {
  const n = name.trim().toLowerCase()
  return users.find((u) => u.name.trim().toLowerCase() === n)
}
