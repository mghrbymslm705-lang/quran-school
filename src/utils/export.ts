// أداة تصدير خفيفة بلا مكتبات خارجية.
// CSV متوافق مع Excel (فاصلة منقوطة + BOM لدعم العربية).

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const lines = [headers.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))]
  const csv = '﻿' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
