export type Role = 'vodja' | 'delavec'

export type RequestStatus = 'odprto' | 'naroceno' | 'prejeto' | 'zavrnjeno'

export type Urgency = 'nizka' | 'normalna' | 'visoka'

export type Category =
  | 'Material'
  | 'Svedri'
  | 'Navojni svedri'
  | 'Rezkarji'
  | 'Oprema'
  | 'Papir za brisače'
  | 'Kava'
  | 'Drugo'

export type MainTab = 'nabava' | 'servisi' | 'zgodovina'

export interface WorkstationSlot {
  id: string
  label: string
}

export interface Workstation {
  id: string
  name: string
  slots: WorkstationSlot[]
}

export interface UserAccount {
  id: string
  name: string
  role: Role
  workstationId?: string
  createdAt: string
}

export interface Session {
  userId: string
  role: Role
  displayName: string
  workstationId?: string
  slotId?: string
}

export interface StatusEvent {
  at: string
  status: RequestStatus
  by: string
  note?: string
}

export interface ProcurementRequest {
  id: string
  createdAt: string
  createdBy: string
  workstationId: string
  workstationName: string
  slotId: string
  slotLabel: string
  category: Category
  title: string
  note: string
  urgency: Urgency
  photoDataUrl?: string
  qrValue?: string
  status: RequestStatus
  supplierNote: string
  history: StatusEvent[]
}

export interface Task {
  id: string
  text: string
  dueDate: string
  done: boolean
  createdAt: string
  createdBy: string
}

export interface OkumaService {
  id: string
  date: string
  machine: string
  note: string
  done: boolean
  createdAt: string
  createdBy: string
}

export interface SupplierRecord {
  name: string
  category?: string
  itemHint?: string
  lastUsed: string
  count: number
}

export interface AppData {
  version: number
  requests: ProcurementRequest[]
  tasks: Task[]
  stock: unknown[]
  faults: unknown[]
  services: OkumaService[]
  suppliers: SupplierRecord[]
  users: UserAccount[]
  lastUserId?: string
}
