import type { Category, RequestStatus, Urgency, Workstation } from './types.ts'

export const WORKSTATIONS: Workstation[] = [
  {
    id: 'cnc-rezkanje',
    name: 'CNC rezkanje',
    slots: [
      { id: 'cr-1', label: 'Oseba 1' },
      { id: 'cr-2', label: 'Oseba 2' },
      { id: 'cr-3', label: 'Oseba 3' },
      { id: 'cr-4', label: 'Oseba 4' },
    ],
  },
  {
    id: 'cnc-struzenje',
    name: 'CNC struženje',
    slots: [{ id: 'cs-1', label: 'Delavec A' }],
  },
  {
    id: 'rocna-delavnica',
    name: 'Ročna delavnica',
    slots: [
      { id: 'rd-1', label: 'Delavec A' },
      { id: 'rd-2', label: 'Delavec B' },
    ],
  },
  {
    id: 'zicna-erozija',
    name: 'Žična erozija',
    slots: [{ id: 'ze-1', label: 'Delavec A' }],
  },
  {
    id: '3d-modeliranje',
    name: '3D modeliranje',
    slots: [{ id: '3d-1', label: 'Delavec A' }],
  },
]

export const CATEGORIES: Category[] = [
  'Material',
  'Svedri',
  'Rezkarji',
  'Oprema',
  'Papir za brisače',
  'Kava',
  'Drugo',
]

export const MACHINES = [
  'Okuma MU-400V II',
  'Okuma Genos',
  'MB-46VAE',
  'MB-56VA',
  'Stružnica',
  'Žična EDM',
  'Drugi stroj',
] as const

export const OKUMA_MACHINES = [
  'Okuma MU-400V II',
  'Okuma Genos',
  'MB-46VAE',
  'MB-56VA',
] as const

export const STATUS_LABELS: Record<RequestStatus, string> = {
  odprto: 'Odprto',
  naroceno: 'Naročeno',
  prejeto: 'Prejeto',
  zavrnjeno: 'Zavrnjeno',
}

export const ALL_STATUSES: RequestStatus[] = ['odprto', 'naroceno', 'prejeto', 'zavrnjeno']

export const URGENCY_LABELS: Record<Urgency, string> = {
  nizka: 'Ni nujno',
  normalna: 'Normalno',
  visoka: 'Nujno',
}

export const URGENCY_RANK: Record<Urgency, number> = {
  visoka: 0,
  normalna: 1,
  nizka: 2,
}

export const ALL_URGENCIES: Urgency[] = ['nizka', 'normalna', 'visoka']

export const FAULT_STATUS_LABELS: Record<string, string> = {
  novo: 'Novo',
  v_delu: 'V delu',
  reseno: 'Rešeno',
}

export function findWorkstation(id: string) {
  return WORKSTATIONS.find((w) => w.id === id)
}

export function findSlot(workstationId: string, slotId: string) {
  const ws = findWorkstation(workstationId)
  return ws?.slots.find((s) => s.id === slotId)
}

export function normalizeUrgency(raw: unknown): Urgency {
  if (raw === 'nizka' || raw === 'visoka' || raw === 'normalna') return raw
  return 'normalna'
}
