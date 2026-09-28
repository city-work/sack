'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import './masterlist.css'

type MasterlistItem = {
  id: string
  name: string
  description: string | null
  url: string | null
  icon: string | null
  table_name?: string | null
  position?: number
  created_at?: string
}

type Column = {
  id: number
  dashboard_item_id: string
  table_name: string
  name: string
  field_key: string
  data_type: 'text' | 'number' | 'date'
  position: number
  created_at?: string
}

type RecordRow = {
  id: string
  position?: number
  created_at?: string
  updated_at?: string
  [key: string]: any
}

type DateNote = { DATE: string; NOTES: string }

type Status = 'ok' | 'error' | 'waiting'

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

function parseDateFlexible(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null

  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) return d
    return null
  }

  m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = Number(m[3])
    const d = a > 12 ? new Date(y, b - 1, a) : new Date(y, a - 1, b)
    return Number.isNaN(d.getTime()) ? null : d
  }

  m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }

  m = raw.match(/^(\w+)\s+(\d{1,2}),?\s*(\d{4})$/)
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()]
    if (month !== undefined) return new Date(Number(m[3]), month, Number(m[2]))
  }

  m = raw.match(/^(\w+)\s+(\d{4})$/)
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()]
    if (month !== undefined) return new Date(Number(m[2]), month, 1)
  }

  m = raw.match(/^(\d{4})$/)
  if (m) return new Date(Number(m[1]), 0, 1)

  m = raw.match(/^(\w+)\s+(\d{1,2})$/)
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()]
    if (month !== undefined) return new Date(new Date().getFullYear(), month, Number(m[2]))
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  }
  return null
}

function normalizeDate(value: unknown): string | null {
  const d = parseDateFlexible(value)
  if (!d || Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatLong(value: unknown): string {
  const d = parseDateFlexible(value)
  if (!d || Number.isNaN(d.getTime())) return value ? String(value) : '—'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatShort(value: unknown): string {
  const d = parseDateFlexible(value)
  if (!d || Number.isNaN(d.getTime())) return value ? String(value) : '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function monthName(month: number) {
  return new Date(2000, month, 1).toLocaleString('en-US', { month: 'long' })
}

function slugify(value: string) {
  return value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'masterlist'
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function looksLike(column: Column, patterns: RegExp[]) {
  const text = `${column.name} ${column.field_key}`.toLowerCase()
  return patterns.some(pattern => pattern.test(text))
}

export default function DynamicMasterlistPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const itemId = String(params?.id || '')
  const supabase = useMemo(() => createClient(), [])
  const db = useMemo(() => supabase.schema('masterlist'), [supabase])

  const [booted, setBooted] = useState(false)
  const [status, setStatus] = useState<Status>('waiting')
  const [userEmail, setUserEmail] = useState('')
  const [item, setItem] = useState<MasterlistItem | null>(null)
  const [columns, setColumns] = useState<Column[]>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [currentView, setCurrentView] = useState<'masterlist' | 'priority' | 'columns'>('masterlist')
  const [currentYear, setCurrentYear] = useState<string>('all')
  const [currentPriority, setCurrentPriority] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set())
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [messages, setMessages] = useState<Array<{ id: string; text: string; kind: 'success' | 'warning' | 'error' | 'info' }>>([])
  const [showColumnModal, setShowColumnModal] = useState(false)
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [columnName, setColumnName] = useState('')
  const [columnType, setColumnType] = useState<Column['data_type']>('text')
  const [recordValues, setRecordValues] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<{ recordId: string; column: Column } | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const redirectingRef = useRef(false)

  const showMessage = useCallback((text: string, kind: 'success' | 'warning' | 'error' | 'info' = 'info') => {
    const id = generateId()
    setMessages(prev => [...prev, { id, text, kind }])
    window.setTimeout(() => setMessages(prev => prev.filter(message => message.id !== id)), 4500)
  }, [])

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    router.replace('/login')
  }, [router])

  const loadAll = useCallback(async () => {
    setStatus('waiting')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        redirectToLogin()
        return
      }
      setUserEmail(session.user.email ?? '')

      const { data, error } = await db.rpc('get_masterlist', { p_item_id: itemId })
      if (error) throw error
      if (!data?.item) {
        setStatus('error')
        setBooted(true)
        return
      }

      setItem(data.item as MasterlistItem)
      setColumns((data.columns || []) as Column[])
      setRecords((data.records || []) as RecordRow[])
      setStatus('ok')
    } catch (error: any) {
      console.error('Dynamic masterlist boot failed:', error)
      setStatus('error')
      showMessage('Load failed: ' + (error?.message || String(error)), 'error')
    } finally {
      setBooted(true)
    }
  }, [db, itemId, redirectToLogin, showMessage, supabase])

  useEffect(() => { void loadAll() }, [loadAll])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModalDate(null)
        setShowColumnModal(false)
        setShowRecordModal(false)
        setEditing(null)
        setEditingValue('')
        setMenuOpen(false)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.ml-root .search-bar input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const dateColumn = useMemo(() => (
    columns.find(column => column.data_type === 'date') ||
    columns.find(column => /(^|_)(date|airing|airdate|event_date|show_date)($|_)/i.test(column.field_key)) ||
    columns.find(column => /date|airing|event/i.test(`${column.name} ${column.field_key}`)) ||
    null
  ), [columns])

  const titleColumn = useMemo(() => (
    columns.find(column => /^(title|name|program|episode|item|subject)$/i.test(column.name.trim())) ||
    columns.find(column => /title|program|episode|item|subject/i.test(`${column.name} ${column.field_key}`)) ||
    columns[0] || null
  ), [columns])

  const artistColumn = useMemo(() => (
    columns.find(column => /artist|performer|guest|talent|speaker/i.test(`${column.name} ${column.field_key}`)) ||
    null
  ), [columns])

  const notesColumn = useMemo(() => (
    columns.find(column => /note|notes|remark|remarks|comment/i.test(`${column.name} ${column.field_key}`)) || null
  ), [columns])

  const priorityColumn = useMemo(() => (
    columns.find(column => /categor|priorit|priority/i.test(`${column.name} ${column.field_key}`)) || null
  ), [columns])

  const validRecords = useMemo(() => records.filter(record => Object.values(record).some(value => value !== null && value !== undefined && String(value).trim() !== '')), [records])

  const availableYears = useMemo(() => {
    const values = new Set<number>()
    validRecords.forEach(record => {
      const date = dateColumn ? parseDateFlexible(record[dateColumn.field_key]) : null
      if (date) values.add(date.getFullYear())
    })
    return Array.from(values).sort((a, b) => b - a)
  }, [dateColumn, validRecords])

  const filteredRecords = useMemo(() => {
    let list = validRecords
    if (currentYear !== 'all' && dateColumn) {
      const year = Number(currentYear)
      list = list.filter(record => {
        const d = parseDateFlexible(record[dateColumn.field_key])
        return d?.getFullYear() === year
      })
    }

    const term = searchTerm.trim().toLowerCase()
    if (term) {
      list = list.filter(record => columns.some(column => String(record[column.field_key] ?? '').toLowerCase().includes(term)))
    }
    return list
  }, [columns, currentYear, dateColumn, searchTerm, validRecords])

  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return []
    return filteredRecords
  }, [filteredRecords, searchTerm])

  const yearCounts = useMemo(() => {
    const output: Record<number, number> = {}
    availableYears.forEach(year => {
      output[year] = validRecords.filter(record => {
        const d = dateColumn ? parseDateFlexible(record[dateColumn.field_key]) : null
        return d?.getFullYear() === year
      }).length
    })
    return output
  }, [availableYears, dateColumn, validRecords])

  const yearMap = useMemo(() => {
    const byYear: Record<number, Record<number, Record<number, RecordRow[]>>> = {}
    if (!dateColumn) return byYear

    filteredRecords.forEach(record => {
      const d = parseDateFlexible(record[dateColumn.field_key])
      if (!d) return
      const year = d.getFullYear()
      const month = d.getMonth()
      const day = d.getDate()
      if (!byYear[year]) byYear[year] = {}
      if (!byYear[year][month]) byYear[year][month] = {}
      if (!byYear[year][month][day]) byYear[year][month][day] = []
      byYear[year][month][day].push(record)
    })
    return byYear
  }, [dateColumn, filteredRecords])

  const sortedYears = useMemo(() => Object.keys(yearMap).map(Number).sort((a, b) => b - a), [yearMap])

  const modalEntries = useMemo(() => {
    if (!modalDate || !dateColumn) return []
    return validRecords.filter(record => normalizeDate(record[dateColumn.field_key]) === modalDate)
  }, [dateColumn, modalDate, validRecords])

  const priorityGroups = useMemo(() => {
    const groups: Record<'A' | 'B' | 'C', RecordRow[]> = { A: [], B: [], C: [] }
    if (!priorityColumn) return groups
    const filtered = filteredRecords.filter(record => {
      if (currentPriority === 'all') return true
      return String(record[priorityColumn.field_key] ?? '').trim().toUpperCase() === currentPriority
    })
    filtered.forEach(record => {
      const value = String(record[priorityColumn.field_key] ?? 'C').trim().toUpperCase()
      const key = (value === 'A' || value === 'B' || value === 'C') ? value : 'C'
      groups[key].push(record)
    })
    return groups
  }, [currentPriority, filteredRecords, priorityColumn])

  const priorityLabels = [
    { key: 'all', label: 'All', color: '#68748A' },
    { key: 'A', label: 'A – Top Priority', color: '#7a3b3b' },
    { key: 'B', label: 'B – Mid Priority', color: '#6b5d4d' },
    { key: 'C', label: 'C – Lower Priority', color: '#1e40af' },
  ]

  function toggleYear(year: number) {
    setCollapsedYears(prev => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  function toggleMonth(year: number, month: number) {
    const key = `${year}-${month}`
    setCollapsedMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openRecordModal() {
    if (!columns.length) return showMessage('Add at least one column first.', 'warning')
    const values: Record<string, string> = {}
    columns.forEach(column => { values[column.field_key] = '' })
    setRecordValues(values)
    setShowRecordModal(true)
  }

  async function addColumn() {
    const name = normalizeLabel(columnName)
    if (!name) return showMessage('Please enter a column name.', 'warning')
    const { data, error } = await db.rpc('add_masterlist_column', {
      p_item_id: itemId,
      p_name: name,
      p_data_type: columnType,
    })
    if (error) return showMessage('Could not add column: ' + error.message, 'error')
    setColumns(prev => [...prev, data as Column].sort((a, b) => a.position - b.position))
    setColumnName('')
    setColumnType('text')
    setShowColumnModal(false)
    showMessage(`"${name}" added.`, 'success')
  }

  async function deleteColumn(column: Column) {
    if (!window.confirm(`Delete "${column.name}"?\n\nAll values in this column will be permanently deleted from this masterlist table.`)) return
    const { error } = await db.rpc('delete_masterlist_column', { p_item_id: itemId, p_column_id: column.id })
    if (error) return showMessage('Could not delete column: ' + error.message, 'error')
    setColumns(prev => prev.filter(existing => existing.id !== column.id))
    setRecords(prev => prev.map(record => {
      const copy = { ...record }
      delete copy[column.field_key]
      return copy
    }))
    showMessage(`"${column.name}" deleted.`, 'warning')
  }

  async function addRecord() {
    if (!columns.length) return
    const values: Record<string, any> = {}
    for (const column of columns) {
      const raw = String(recordValues[column.field_key] ?? '').trim()
      if (!raw) values[column.field_key] = null
      else if (column.data_type === 'number') {
        const numberValue = Number(raw)
        if (!Number.isFinite(numberValue)) return showMessage(`"${column.name}" must be a number.`, 'warning')
        values[column.field_key] = numberValue
      } else {
        values[column.field_key] = raw
      }
    }

    const { data, error } = await db.rpc('add_masterlist_record', { p_item_id: itemId, p_values: values })
    if (error) return showMessage('Could not add record: ' + error.message, 'error')
    setRecords(prev => [...prev, data as RecordRow])
    setRecordValues({})
    setShowRecordModal(false)
    showMessage('Record added.', 'success')
  }

  function startEdit(record: RecordRow, column: Column) {
    setEditing({ recordId: record.id, column })
    setEditingValue(record[column.field_key] === null || record[column.field_key] === undefined ? '' : String(record[column.field_key]))
  }

  async function saveEdit(record: RecordRow, column: Column) {
    let value: any = editingValue.trim()
    if (!value) value = null
    else if (column.data_type === 'number') {
      const numberValue = Number(value)
      if (!Number.isFinite(numberValue)) return showMessage(`"${column.name}" must be a number.`, 'warning')
      value = numberValue
    }

    const { data, error } = await db.rpc('update_masterlist_record', {
      p_item_id: itemId,
      p_record_id: record.id,
      p_values: { [column.field_key]: value },
    })
    if (error) return showMessage('Could not save: ' + error.message, 'error')

    const updated = data as RecordRow
    setRecords(prev => prev.map(existing => existing.id === record.id ? { ...existing, ...updated } : existing))
    setEditing(null)
    setEditingValue('')
  }

  async function deleteRecord(record: RecordRow) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    const { error } = await db.rpc('delete_masterlist_record', { p_item_id: itemId, p_record_id: record.id })
    if (error) return showMessage('Could not delete record: ' + error.message, 'error')
    setRecords(prev => prev.filter(existing => existing.id !== record.id))
    showMessage('Record deleted.', 'warning')
  }

  async function deleteMasterlist() {
    if (!item) return
    if (!window.confirm(`Delete "${item.name}"?\n\nThis permanently removes the masterlist, its physical Supabase table, columns, and records.`)) return
    const { error } = await db.rpc('delete_masterlist', { p_item_id: item.id })
    if (error) return showMessage('Could not delete masterlist: ' + error.message, 'error')
    router.push('/dashboard?panel=masterlist')
  }

  function exportCSV(rows: RecordRow[], label = item?.name || 'masterlist') {
    if (!columns.length || !rows.length) return showMessage('There are no rows to export.', 'warning')
    const headers = columns.map(column => column.name)
    const body = rows.map(record => columns.map(column => record[column.field_key] ?? ''))
    const csv = [headers, ...body]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${slugify(label)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    showMessage(`Exported ${rows.length} entries.`, 'success')
  }

  function setRecordField(fieldKey: string, value: string) {
    setRecordValues(prev => ({ ...prev, [fieldKey]: value }))
  }

  const statusClass = status === 'ok' ? 'status-ok' : status === 'error' ? 'status-error' : 'status-waiting'
  const statusDot = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'amber'

  if (!booted) {
    return (
      <div className="ml-root">
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: '#18202F',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#FAF7F2',
        }}>
          <div style={{ textAlign: 'center' }}>
            <i className="ph ph-list-checks" style={{ fontSize: '2.5rem', color: '#B8734F' }} />
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', letterSpacing: '0.5px', opacity: 0.75 }}>
              LOADING MASTERLIST…
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="ml-root">
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
          <i className="ph ph-folder-open" style={{ fontSize: '2rem', color: '#B8734F' }} />
          <h2 style={{ fontSize: '1rem' }}>Masterlist not found</h2>
          <p style={{ fontSize: '0.75rem', color: '#68748A' }}>This masterlist may have been removed.</p>
          <button className="btn-export" onClick={() => router.push('/dashboard?panel=masterlist')}><i className="ph ph-arrow-left" /> Back to Masterlist</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ml-root">
      <div className="app-container">
        <aside className={`sidebar ${sidebarOpen ? 'expanded' : ''}`}>
          <div className="brand-container">
            <div className="brand-group">
              <span className="brand-text" style={{ display: sidebarOpen ? 'block' : 'none' }}>{item.name}</span>
              <span className="brand-sub" style={{ display: sidebarOpen ? 'block' : 'none' }}>Masterlist</span>
            </div>
            <span className={`brand-dot ${statusDot}`} style={{ display: sidebarOpen ? 'block' : 'none' }} />
          </div>

          <nav className="sidebar-scroll">
            <button className={`sidebar-item ${currentView === 'masterlist' ? 'active' : ''}`} onClick={() => setCurrentView('masterlist')}>
              <span className="icon"><i className="ph ph-list-checks" /></span>
              <span className="label">Masterlist</span>
              <span className="tooltip">Masterlist</span>
            </button>
            <button className={`sidebar-item ${currentView === 'priority' ? 'active' : ''}`} onClick={() => setCurrentView('priority')}>
              <span className="icon"><i className="ph ph-flag" /></span>
              <span className="label">Priority</span>
              <span className="tooltip">Priority</span>
            </button>
            <div className="sidebar-divider" />

            {currentView === 'masterlist' && (
              <>
                <div className="sidebar-label"><i className="ph ph-calendar" /> Years</div>
                <button className={`sidebar-item ${currentYear === 'all' ? 'active' : ''}`} onClick={() => setCurrentYear('all')}>
                  <span className="icon"><i className="ph ph-calendar-blank" /></span>
                  <span className="label">All Years</span>
                  <span className="tooltip">All Years</span>
                </button>
                {availableYears.map(year => (
                  <button key={year} className={`sidebar-item ${currentYear === String(year) ? 'active' : ''}`} onClick={() => setCurrentYear(String(year))}>
                    <span className="icon"><i className="ph ph-folder" style={{ color: '#B8734F' }} /></span>
                    <span className="label">{year} ({yearCounts[year]})</span>
                    <span className="tooltip">{year}</span>
                  </button>
                ))}
              </>
            )}

            {currentView === 'priority' && (
              <>
                <div className="sidebar-label"><i className="ph ph-flag" /> Priority</div>
                {priorityLabels.map(p => (
                  <button key={p.key} className={`sidebar-item ${currentPriority === p.key ? 'active' : ''}`} onClick={() => setCurrentPriority(p.key)}>
                    <span className="icon"><i className="ph ph-circle" style={{ color: p.color }} /></span>
                    <span className="label">{p.label}</span>
                    <span className="tooltip">{p.label}</span>
                  </button>
                ))}
              </>
            )}

            <div className="sidebar-divider" />
            <button className="sidebar-item" onClick={() => setCurrentView('columns')}>
              <span className="icon"><i className="ph ph-columns" /></span>
              <span className="label">Columns</span>
              <span className="tooltip">Columns</span>
            </button>
            <button className="sidebar-item" onClick={openRecordModal}>
              <span className="icon"><i className="ph ph-plus" /></span>
              <span className="label">Add Record</span>
              <span className="tooltip">Add Record</span>
            </button>
          </nav>

          <div className="sidebar-back-bottom">
            <a className="sidebar-back" href="/dashboard?panel=masterlist">
              <span className="icon"><i className="ph ph-arrow-left" /></span>
              <span className="label">Back to Dashboard</span>
              <span className="tooltip">Back</span>
            </a>
          </div>
        </aside>

        <div className="main-content">
          <header>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={() => setSidebarOpen(value => !value)}
                style={{ width: 32, height: 32, borderRadius: 999, background: '#DCE1E6', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#68748A', fontFamily: 'inherit' }}
                title="Toggle sidebar"
              >
                <i className="ph ph-list" />
              </button>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#18202F', whiteSpace: 'nowrap' }}>
                {currentView === 'masterlist' ? 'Masterlist' : currentView === 'priority' ? 'Priority Groups' : 'Columns'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className={`status-badge-top ${statusClass}`}>
                <span className={`status-dot ${statusDot}`} />
                {status === 'ok' ? (userEmail.split('@')[0] || 'user') : status === 'error' ? 'Offline' : 'Connecting...'}
              </span>
            </div>
          </header>

          <div className="scrollable-content">
            {messages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '1rem' }}>
                {messages.map(message => (
                  <div key={message.id} style={{ padding: '0.5rem 0.7rem', borderRadius: 8, background: message.kind === 'error' ? '#f5e6e6' : message.kind === 'warning' ? '#f0ebe6' : '#FAF7F2', border: '1px solid rgba(24,32,47,0.06)', color: '#68748A', fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span>{message.text}</span>
                    <button style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer' }} onClick={() => setMessages(prev => prev.filter(existing => existing.id !== message.id))}><i className="ph-bold ph-x" /></button>
                  </div>
                ))}
              </div>
            )}

            {currentView === 'masterlist' && (
              <div className="fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#18202F', letterSpacing: '-0.02em' }}>
                      <i className={`ph ${item.icon || 'ph-list-checks'}`} /> {item.name}
                    </h2>
                    <p style={{ fontSize: '0.75rem', color: '#68748A', marginTop: '0.15rem' }}>
                      {searchTerm ? `Searching "${searchTerm}"` : item.description || 'All entries organized by date.'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="search-bar">
                      <i className="ph ph-magnifying-glass" />
                      <input type="text" placeholder="Search title or artist..." value={searchTerm} onChange={event => setSearchTerm(event.target.value)} />
                    </div>
                    <button className="btn-export" onClick={() => exportCSV(filteredRecords)} title="Export all CSV"><i className="ph ph-download-simple" /></button>
                    <div className="masterlist-actions">
                      <button className="dynamic-btn" onClick={openRecordModal}><i className="ph ph-plus" /> Add Record</button>
                      <button className="dynamic-btn" onClick={() => setShowColumnModal(true)}><i className="ph ph-columns" /> Add Column</button>
                      <button className="dynamic-btn danger" onClick={deleteMasterlist}><i className="ph ph-trash" /> Delete</button>
                    </div>
                  </div>
                </div>

                {searchTerm && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#18202F' }}>
                        <i className="ph ph-magnifying-glass" style={{ color: '#B8734F' }} /> "{searchTerm}"
                      </span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#68748A', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>
                        {searchResults.length} results
                      </span>
                      <button onClick={() => setSearchTerm('')} style={{ fontSize: '0.7rem', color: '#B8734F', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <i className="ph ph-x-circle" /> Clear
                      </button>
                    </div>
                    {searchResults.length === 0 ? (
                      <div style={{ textAlign: 'center', color: '#68748A', fontSize: '0.8rem', padding: '2rem' }}>
                        <i className="ph ph-magnifying-glass" style={{ fontSize: '1.5rem', display: 'block', marginBottom: 8 }} />
                        No results found
                      </div>
                    ) : (
                      <table className="search-results-table">
                        <thead>
                          <tr>
                            <th style={{ width: '28%' }}>{dateColumn?.name || 'Date'}</th>
                            <th style={{ width: '42%' }}>{titleColumn?.name || 'Title'}</th>
                            <th style={{ width: '30%' }}>{artistColumn?.name || 'Artist'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchResults.map(record => (
                            <tr key={record.id} onClick={() => {
                              const date = dateColumn ? normalizeDate(record[dateColumn.field_key]) : null
                              if (date) setModalDate(date)
                            }}>
                              <td>{dateColumn ? formatShort(record[dateColumn.field_key]) : '—'}</td>
                              <td style={{ fontWeight: 500 }}>{titleColumn ? String(record[titleColumn.field_key] ?? '—') : '—'}</td>
                              <td style={{ color: '#68748A' }}>{artistColumn ? String(record[artistColumn.field_key] ?? '—') : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}

                {!searchTerm && (
                  !dateColumn ? (
                    <div>
                      <div className="year-header">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#18202F' }}><i className="ph ph-folder" /> Masterlist</span>
                        <span style={{ fontSize: '0.7rem', color: '#68748A' }}>{filteredRecords.length} entries</span>
                      </div>
                      <div className="empty-copy">
                        <i className="ph ph-calendar-plus" />
                        <div style={{ marginBottom: 8 }}>Add a Date column to use the Bravo year/month/date layout.</div>
                        <button className="btn-export" onClick={() => { setColumnType('date'); setColumnName('Date'); setShowColumnModal(true) }}><i className="ph ph-plus" /> Add Date column</button>
                      </div>
                    </div>
                  ) : sortedYears.length === 0 ? (
                    <div className="empty-copy">
                      <i className="ph ph-folder-open" />
                      No entries found{currentYear !== 'all' ? ` in ${currentYear}` : ''}.
                    </div>
                  ) : (
                    sortedYears.map(year => {
                      const months = yearMap[year]
                      const sortedMonths = Object.keys(months).map(Number).sort((a, b) => b - a)
                      const totalInYear = Object.values(months).reduce((sum, days) => sum + Object.values(days).reduce((s, entries) => s + entries.length, 0), 0)
                      const collapsed = collapsedYears.has(year)
                      return (
                        <div key={year} style={{ marginBottom: '1rem' }}>
                          <button className="year-header" onClick={() => toggleYear(year)}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#18202F' }}>
                              <i className="ph ph-folder" /> {year}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem', color: '#68748A' }}>
                              {totalInYear} entries
                              <i className={`ph-bold ${collapsed ? 'ph-caret-down' : 'ph-caret-up'}`} />
                            </span>
                          </button>

                          {!collapsed && (
                            <div className="grid-cards">
                              {sortedMonths.map(month => {
                                const days = months[month]
                                const sortedDays = Object.keys(days).map(Number).sort((a, b) => b - a)
                                const totalInMonth = Object.values(days).reduce((sum, entries) => sum + entries.length, 0)
                                const monthKey = `${year}-${month}`
                                const collapsedMonth = collapsedMonths.has(monthKey)
                                return (
                                  <div key={month}>
                                    <button
                                      onClick={() => toggleMonth(year, month)}
                                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', textAlign: 'left' }}
                                      title={collapsedMonth ? 'Expand month' : 'Collapse month'}
                                    >
                                      <i className={`ph-bold ${collapsedMonth ? 'ph-caret-right' : 'ph-caret-down'}`} style={{ color: '#68748A', fontSize: '0.8rem' }} />
                                      <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#18202F', margin: 0 }}>
                                        <i className="ph ph-folder-open" /> {monthName(month)}
                                      </h4>
                                      <span style={{ fontSize: '0.6rem', color: '#68748A', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>
                                        {totalInMonth} entries
                                      </span>
                                    </button>
                                    {!collapsedMonth && (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 12 }}>
                                        {sortedDays.map(day => {
                                          const entries = days[day]
                                          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                                          const dateText = formatLong(dateKey)
                                          return (
                                            <div key={day} className="date-card-compact" onClick={() => setModalDate(dateKey)}>
                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#18202F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                  <i className="ph ph-calendar-day" /> {dateText}
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                                  <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#68748A', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>
                                                    {entries.length}
                                                  </span>
                                                  <button className="note-edit-btn" onClick={event => { event.stopPropagation(); setModalDate(dateKey) }} title="Open entries"><i className="ph ph-pencil-simple" /></button>
                                                  <button className="note-edit-btn" onClick={event => { event.stopPropagation(); exportCSV(entries, `${item.name}_${dateKey}`) }} title="Export this date"><i className="ph ph-download-simple" /></button>
                                                </div>
                                              </div>
                                              {notesColumn && entries.some(record => String(record[notesColumn.field_key] ?? '').trim() !== '') && (
                                                <div className="note-text">📝 {String(entries.find(record => String(record[notesColumn.field_key] ?? '').trim() !== '')?.[notesColumn.field_key] ?? '')}</div>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )
                )}

                <div className="meta-strip">
                  <span>Separate table: <strong>{item.table_name || '—'}</strong></span>
                  <span>{dateColumn ? `Grouped by ${dateColumn.name}` : 'Date grouping disabled'}</span>
                </div>
              </div>
            )}

            {currentView === 'priority' && (
              <div className="fade-in">
                <div style={{ marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#18202F', letterSpacing: '-0.02em' }}><i className="ph ph-flag" /> Priority Groups</h2>
                  <p style={{ fontSize: '0.75rem', color: '#68748A', marginTop: '0.15rem' }}>
                    Entries grouped by priority level{priorityColumn ? ` using ${priorityColumn.name}.` : '.'}
                  </p>
                </div>

                {!priorityColumn ? (
                  <div className="empty-copy">
                    <i className="ph ph-flag" />
                    <div style={{ marginBottom: 8 }}>No Priority/Categorization column was found.</div>
                    <button className="btn-export" onClick={() => { setColumnName('CATEGORIZATION'); setColumnType('text'); setShowColumnModal(true) }}><i className="ph ph-plus" /> Add categorization column</button>
                  </div>
                ) : (
                  (['A', 'B', 'C'] as const).map(priority => {
                    const entries = priorityGroups[priority] || []
                    if (currentPriority !== 'all' && currentPriority !== priority) return null
                    if (!entries.length) return null
                    const label = priority === 'A' ? 'A – Top Priority' : priority === 'B' ? 'B – Mid Priority' : 'C – Lower Priority'
                    return (
                      <div key={priority} style={{ background: '#FAF7F2', borderRadius: 12, border: '1px solid rgba(24,32,47,0.08)', marginBottom: '1rem', overflow: 'hidden' }}>
                        <div style={{ padding: '0.6rem 1rem', background: '#DCE1E6', borderBottom: '1px solid rgba(24,32,47,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={`priority-${priority.toLowerCase()}`} style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 12px', borderRadius: 999 }}>{label}</span>
                            <span style={{ fontSize: '0.7rem', color: '#68748A' }}>{entries.length} entries</span>
                          </div>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table className="priority-groups-table">
                            <thead>
                              <tr>
                                <th>{titleColumn?.name || 'Title'}</th>
                                <th>{artistColumn?.name || 'Artist'}</th>
                                <th>{dateColumn?.name || 'Date'}</th>
                                <th>{notesColumn?.name || 'Notes'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map(record => (
                                <tr key={record.id}>
                                  <td style={{ fontWeight: 500 }}>{titleColumn ? String(record[titleColumn.field_key] ?? '—') : '—'}</td>
                                  <td style={{ color: '#68748A' }}>{artistColumn ? String(record[artistColumn.field_key] ?? '—') : '—'}</td>
                                  <td style={{ color: '#68748A', fontSize: '0.7rem' }}>{dateColumn ? formatLong(record[dateColumn.field_key]) : '—'}</td>
                                  <td style={{ textAlign: 'center' }}>{notesColumn ? (record[notesColumn.field_key] ? <span style={{ fontSize: '0.65rem', fontWeight: 500, color: '#B8734F', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>{String(record[notesColumn.field_key])}</span> : '—') : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {currentView === 'columns' && (
              <div className="fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#18202F', letterSpacing: '-0.02em' }}><i className="ph ph-columns" /> Columns</h2>
                    <p style={{ fontSize: '0.75rem', color: '#68748A', marginTop: '0.15rem' }}>{item.name} · real fields in the physical Supabase table.</p>
                  </div>
                  <div className="masterlist-actions">
                    <button className="dynamic-btn" onClick={() => setShowColumnModal(true)}><i className="ph ph-plus" /> Add Column</button>
                    <button className="dynamic-btn primary" onClick={openRecordModal}><i className="ph ph-plus" /> Add Record</button>
                  </div>
                </div>

                <div className="manage-columns-panel">
                  {columns.length === 0 ? (
                    <div className="empty-copy"><i className="ph ph-columns" />No columns yet. Add your first field.</div>
                  ) : columns.map((column, index) => (
                    <div className="manage-columns-row" key={column.id}>
                      <div>
                        <strong>{index + 1}. {column.name}</strong>
                        <div><small>{column.field_key}</small></div>
                      </div>
                      <span className="column-chip"><i className={`ph ${column.data_type === 'date' ? 'ph-calendar' : column.data_type === 'number' ? 'ph-hash' : 'ph-text-aa'}`} /> {column.data_type}</span>
                      <div className="manage-columns-actions">
                        <button className="note-edit-btn" title="Delete column" onClick={() => deleteColumn(column)}><i className="ph ph-trash" /></button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="meta-strip">
                  <span>Physical table: <strong>{item.table_name || '—'}</strong></span>
                  <span>{columns.length} columns · {records.length} records</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {modalDate !== null && (
        <div className="modal-overlay open" onClick={event => { if (event.target === event.currentTarget) setModalDate(null) }}>
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title-group">
                <h3>{formatLong(modalDate)}</h3>
                <span className="entry-count">{modalEntries.length} entries</span>
              </div>
              <button className="modal-close-btn" onClick={() => setModalDate(null)} title="Close"><i className="ph-bold ph-x" /></button>
            </div>
            <div className="modal-body">
              {modalEntries.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#68748A', fontSize: '0.8rem', padding: '2rem' }}>No entries for this date.</div>
              ) : (
                (() => {
                  const grouped: Record<string, RecordRow[]> = {}
                  modalEntries.forEach(record => {
                    const groupName = artistColumn ? String(record[artistColumn.field_key] || 'Unknown Artist') : 'Entries'
                    if (!grouped[groupName]) grouped[groupName] = []
                    grouped[groupName].push(record)
                  })
                  let number = 0
                  return Object.keys(grouped).map(groupName => (
                    <div key={groupName} className="modal-artist-group">
                      <div className="artist-header">
                        {groupName}
                        <span className="artist-dash" />
                        <span style={{ fontWeight: 400, fontSize: '0.6rem', color: '#94a3b8' }}>{grouped[groupName].length}</span>
                      </div>
                      {grouped[groupName].map(record => {
                        number += 1
                        const recordTitle = titleColumn ? String(record[titleColumn.field_key] ?? '—') : '—'
                        return (
                          <div key={record.id} className="entry-item" style={{ alignItems: 'flex-start' }}>
                            <span className="entry-number">{number}.</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="entry-title">{recordTitle}</div>
                              {notesColumn && String(record[notesColumn.field_key] ?? '').trim() && <div className="note-text">📝 {String(record[notesColumn.field_key])}</div>}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {columns.slice(0, 3).map(column => (
                                <button key={column.id} className="note-edit-btn" title={`Edit ${column.name}`} onClick={() => startEdit(record, column)}><i className="ph ph-pencil-simple" /></button>
                              ))}
                              <button className="note-edit-btn" title="Delete entry" onClick={() => deleteRecord(record)}><i className="ph ph-trash" /></button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))
                })()
              )}
            </div>
            <div className="modal-footer" style={{ gap: '0.5rem' }}>
              <button className="btn-close-modal" style={{ background: 'transparent', color: '#68748A', border: '1px solid rgba(24,32,47,0.1)' }} onClick={() => setModalDate(null)}>Close</button>
              <button className="btn-close-modal" onClick={() => exportCSV(modalEntries, `${item.name}_${modalDate}`)}><i className="ph ph-download-simple" /> Export Date</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-overlay open" onClick={event => { if (event.target === event.currentTarget) setEditing(null) }}>
          <div className="modal-card" style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <div className="modal-title-group"><h3>Edit {editing.column.name}</h3><span className="entry-count">Field update</span></div>
              <button className="modal-close-btn" onClick={() => setEditing(null)} title="Close"><i className="ph-bold ph-x" /></button>
            </div>
            <div className="modal-body">
              <div className="dynamic-modal-field">
                <label>{editing.column.name}</label>
                <input
                  autoFocus
                  type={editing.column.data_type === 'date' ? 'date' : editing.column.data_type === 'number' ? 'number' : 'text'}
                  value={editingValue}
                  onChange={event => setEditingValue(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      const record = records.find(row => row.id === editing.recordId)
                      if (record) void saveEdit(record, editing.column)
                    }
                  }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-close-modal" style={{ background: 'transparent', color: '#68748A', border: '1px solid rgba(24,32,47,0.1)' }} onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-close-modal" onClick={() => { const record = records.find(row => row.id === editing.recordId); if (record) void saveEdit(record, editing.column) }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showColumnModal && (
        <div className="modal-overlay open" onClick={event => { if (event.target === event.currentTarget) setShowColumnModal(false) }}>
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title-group"><h3><i className="ph ph-columns" style={{ color: '#B8734F' }} /> Add Column</h3><span className="entry-count">Real field · {item.name}</span></div>
              <button className="modal-close-btn" onClick={() => setShowColumnModal(false)} title="Close"><i className="ph-bold ph-x" /></button>
            </div>
            <div className="modal-body">
              <div className="dynamic-modal-field">
                <label>Column name</label>
                <input value={columnName} onChange={event => setColumnName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addColumn() }} placeholder="e.g. Title" autoFocus />
              </div>
              <div className="dynamic-modal-field">
                <label>Field type</label>
                <select value={columnType} onChange={event => setColumnType(event.target.value as Column['data_type'])}>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                </select>
              </div>
              <p className="column-hint">Tip: Add a Date field to activate the year → month → day Bravo layout. Add a CATEGORIZATION/Priority field to activate Priority Groups.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-close-modal" style={{ background: 'transparent', color: '#68748A', border: '1px solid rgba(24,32,47,0.1)' }} onClick={() => setShowColumnModal(false)}>Cancel</button>
              <button className="btn-close-modal" onClick={() => void addColumn()}><i className="ph ph-plus" /> Add Column</button>
            </div>
          </div>
        </div>
      )}

      {showRecordModal && (
        <div className="modal-overlay open" onClick={event => { if (event.target === event.currentTarget) setShowRecordModal(false) }}>
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title-group"><h3><i className="ph ph-plus" style={{ color: '#B8734F' }} /> Add Record</h3><span className="entry-count">{item.name}</span></div>
              <button className="modal-close-btn" onClick={() => setShowRecordModal(false)} title="Close"><i className="ph-bold ph-x" /></button>
            </div>
            <div className="modal-body">
              {columns.length === 0 ? (
                <div className="empty-copy"><i className="ph ph-columns" />Add a column first.</div>
              ) : columns.map(column => (
                <div className="dynamic-modal-field" key={column.id}>
                  <label>{column.name}</label>
                  <input
                    type={column.data_type === 'date' ? 'date' : column.data_type === 'number' ? 'number' : 'text'}
                    value={recordValues[column.field_key] ?? ''}
                    onChange={event => setRecordField(column.field_key, event.target.value)}
                    placeholder={`Enter ${column.name.toLowerCase()}`}
                  />
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn-close-modal" style={{ background: 'transparent', color: '#68748A', border: '1px solid rgba(24,32,47,0.1)' }} onClick={() => setShowRecordModal(false)}>Cancel</button>
              <button className="btn-close-modal" onClick={() => void addRecord()}><i className="ph ph-plus" /> Add Record</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
