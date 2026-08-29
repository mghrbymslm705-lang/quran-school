import { useMemo, useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  label: string
  align?: 'start' | 'center' | 'end'
  width?: string
  render?: (row: T) => ReactNode
  sortValue?: (row: T) => string | number
  filter?: { value: string; label: string }[]
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  rowSearchText: (row: T) => string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
}

export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  rowSearchText,
  searchPlaceholder = 'بحث...',
  emptyText = 'لا توجد بيانات',
  className = ''
}: Props<T>) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !rowSearchText(r).toLowerCase().includes(q)) return false
      for (const col of columns) {
        const fv = filters[col.key]
        if (fv && fv !== 'all') {
          const raw = col.render ? col.render(r) : (r as any)[col.key]
          const val = typeof raw === 'string' ? raw : String(raw ?? '')
          if (val !== fv) return false
        }
      }
      return true
    })
  }, [rows, query, filters, columns, rowSearchText])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find((c) => c.key === sortKey)
    const getVal = col?.sortValue ?? ((r: T) => (r as any)[sortKey])
    const copy = [...filtered]
    copy.sort((a, b) => {
      const va = getVal(a)
      const vb = getVal(b)
      let cmp = 0
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
      else cmp = String(va).localeCompare(String(vb), 'ar')
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir, columns])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div className={'report-table-wrap ' + className}>
      <div className="report-toolbar no-print">
        <input
          className="input"
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="report-count">عدد الصفوف: {sorted.length}</span>
      </div>
      <div className="table-scroll">
        <table className="report-table">
          <thead>
            <tr>
              <th className="col-num">#</th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={'sortable' + (sortKey === col.key ? ' active' : '')}
                  style={{ textAlign: col.align || 'start', width: col.width }}
                  onClick={() => toggleSort(col.key)}
                >
                  <div className="th-inner">
                    <span>{col.label}</span>
                    <span className="sort-ind">{sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                  </div>
                  {col.filter && (
                    <select
                      className="col-filter"
                      value={filters[col.key] || 'all'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                    >
                      <option value="all">الكل</option>
                      {col.filter.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td className="empty" colSpan={columns.length + 1}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr key={rowKey(row)}>
                  <td className="col-num">{i + 1}</td>
                  {columns.map((col) => (
                    <td key={col.key} data-label={col.label} style={{ textAlign: col.align || 'start' }}>
                      {col.render ? col.render(row) : (row as any)[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
