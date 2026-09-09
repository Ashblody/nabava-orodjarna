import type { Category, Workstation } from './types.ts'

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
]

export const STATUS_LABELS: Record<string, string> = {
  odprto: 'Odprto',
  naroceno: 'Naročeno',
  prejeto: 'Prejeto',
  zavrnjeno: 'Zavrnjeno',
}

export const VODJA_NAME = 'Vodja nabave'

export function findWorkstation(id: string) {
  return WORKSTATIONS.find((w) => w.id === id)
}

export function findSlot(workstationId: string, slotId: string) {
  const ws = findWorkstation(workstationId)
  return ws?.slots.find((s) => s.id === slotId)
}
