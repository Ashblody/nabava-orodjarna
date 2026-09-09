export type Role = 'vodja' | 'delavec'

export type RequestStatus = 'odprto' | 'naroceno' | 'prejeto' | 'zavrnjeno'

export type Category =
  | 'Material'
  | 'Svedri'
  | 'Rezkarji'
  | 'Oprema'
  | 'Papir za brisače'
  | 'Kava'

export interface WorkstationSlot {
  id: string
  label: string
}

export interface Workstation {
  id: string
  name: string
  slots: WorkstationSlot[]
}

export interface Session {
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
  photoDataUrl?: string
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

export interface AppData {
  requests: ProcurementRequest[]
  tasks: Task[]
}
