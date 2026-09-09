import { STATUS_LABELS } from './data.ts'
import { formatDateTime } from './storage.ts'
import type { ProcurementRequest } from './types.ts'
import { URGENCY_LABELS } from './data.ts'

function csvEscape(value: string): string {
  const v = value.replaceAll('"', '""')
  return /[",\n\r;]/.test(v) ? `"${v}"` : v
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function requestsToCsv(requests: ProcurementRequest[]): string {
  const header = [
    'Datum',
    'Status',
    'Nujnost',
    'Kategorija',
    'Naslov',
    'Opomba',
    'Avtor',
    'Postaja',
    'Mesto',
    'Dobavitelj',
    'QR',
  ]
  const lines = [header.join(';')]
  for (const r of requests) {
    lines.push(
      [
        formatDateTime(r.createdAt),
        STATUS_LABELS[r.status] || r.status,
        URGENCY_LABELS[r.urgency] || r.urgency,
        r.category,
        r.title,
        r.note,
        r.createdBy,
        r.workstationName,
        r.slotLabel,
        r.supplierNote,
        r.qrValue || '',
      ]
        .map((x) => csvEscape(String(x ?? '')))
        .join(';'),
    )
  }
  // Excel-friendly UTF-8 with BOM; semicolon separator (SI locale)
  return '\uFEFF' + lines.join('\r\n')
}

export function downloadExcelCsv(filename: string, requests: ProcurementRequest[]) {
  const csv = requestsToCsv(requests)
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
}

export function downloadWordDoc(filename: string, title: string, requests: ProcurementRequest[]) {
  const rows = requests
    .map((r) => {
      return `<tr>
        <td>${esc(formatDateTime(r.createdAt))}</td>
        <td>${esc(STATUS_LABELS[r.status] || r.status)}</td>
        <td>${esc(URGENCY_LABELS[r.urgency] || r.urgency)}</td>
        <td>${esc(r.category)}</td>
        <td><strong>${esc(r.title)}</strong>${r.note ? `<br/><span style="color:#555">${esc(r.note)}</span>` : ''}</td>
        <td>${esc(r.createdBy)}<br/><span style="color:#555">${esc(r.workstationName)}</span></td>
        <td>${esc(r.supplierNote || '—')}</td>
      </tr>`
    })
    .join('')

  const html = `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #14241e; }
  h1 { font-size: 16pt; color: #1a5f4a; }
  p.meta { color: #555; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #c5d4cc; padding: 6px 8px; vertical-align: top; text-align: left; }
  th { background: #e6f3ee; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p class="meta">Izvoz: ${esc(formatDateTime(new Date().toISOString()))} · ${requests.length} postavk</p>
  <table>
    <thead>
      <tr>
        <th>Datum</th><th>Status</th><th>Nujnost</th><th>Kategorija</th>
        <th>Artikel / opomba</th><th>Avtor / postaja</th><th>Dobavitelj</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="7">Ni postavk.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`

  // Word opens HTML saved as .doc reliably without heavy deps
  downloadBlob(filename, new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8' }))
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
