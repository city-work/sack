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
}

type Column = {
  id: number
  dashboard_item_id: string
  name: string
  field_key: string
  data_type: 'text' | 'number' | 'date'
  position: number
}

type RecordRow = {
  id: string
  position: number
  created_at: string
  updated_at: string
  [key: string]: any
}

type Message = { id: string; text: string; kind: 'success' | 'error' | 'warning' }

const ICONS = ['ph-folder-open','ph-list-checks','ph-clipboard-text','ph-database','ph-music-notes','ph-users','ph-package','ph-file','ph-chart-bar','ph-gear','ph-tag','ph-star']

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}


function normalizeValue(v: any, type: Column['data_type']) {
  if (v === null || v === undefined) return ''
  if (type === 'number') return String(v)
  return String(v)
}

export default function DynamicMasterlistPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const db = useMemo(() => supabase.schema('masterlist'), [supabase])

  const itemId = String(params.id || '')

  const [item, setItem] = useState<MasterlistItem | null>(null)
  const [columns, setColumns] = useState<Column[]>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [booting, setBooting] = useState(true)
  const [messages, setMessages] = useState<Message[]>([])
  const [showFieldModal, setShowFieldModal] = useState(false)
  const [fieldName, setFieldName] = useState('')
  const [fieldType, setFieldType] = useState<Column['data_type']>('text')
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [recordValues, setRecordValues] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [userEmail, setUserEmail] = useState('')

  const redirectingRef = useRef(false)

  const showMessage = useCallback((text: string, kind: Message['kind']) => {
    const id = generateId()
    setMessages(prev => [...prev, { id, text, kind }])
    setTimeout(() => setMessages(prev => prev.filter(m => m.id !== id)), 5000)
  }, [])

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    router.replace('/login')
  }, [router])

  const loadData = useCallback(async () => {
    try {
      const sessionResult = await supabase.auth.getSession()
      if (!sessionResult.data.session) {
        redirectToLogin()
        return
      }

      const { data, error } = await db.rpc('get_masterlist', { p_item_id: itemId })
      if (error) throw error

      if (!data?.item) {
        showMessage('Masterlist not found.', 'error')
        return
      }

      setItem(data.item as MasterlistItem)
      setColumns((data.columns || []) as Column[])
      setRecords((data.records || []) as RecordRow[])
    } catch (err: any) {
      console.error('Masterlist load failed:', err)
      showMessage('Failed to load: ' + (err?.message || err), 'error')
    } finally {
      setBooting(false)
    }
  }, [db, itemId, redirectToLogin, showMessage, supabase])

  useEffect(() => { loadData() }, [loadData])

  function openRecordModal() {
    const initial: Record<string, string> = {}
    columns.forEach(c => { initial[c.field_key] = '' })
    setRecordValues(initial)
    setShowRecordModal(true)
  }

  async function addColumn() {
    const name = fieldName.trim()
    if (!name) {
      showMessage('Enter a column name.', 'warning')
      return
    }

    const { data, error } = await db.rpc('add_masterlist_column', {
      p_item_id: itemId,
      p_name: name,
      p_data_type: fieldType,
    })

    if (error) {
      showMessage('Could not add column: ' + error.message, 'error')
      return
    }

    setColumns(prev => [...prev, data as Column])
    setFieldName('')
    setFieldType('text')
    setShowFieldModal(false)
    showMessage(`Column "${name}" added.`, 'success')
  }

  async function removeColumn(column: Column) {
    if (!confirm(`Remove the "${column.name}" column? Existing values in this column will be deleted.`)) return

    const { error } = await db.rpc('delete_masterlist_column', {
      p_item_id: itemId,
      p_column_id: column.id,
    })

    if (error) {
      showMessage('Could not remove column: ' + error.message, 'error')
      return
    }

    setColumns(prev => prev.filter(c => c.id !== column.id))
    showMessage(`Column "${column.name}" removed.`, 'warning')
  }

  async function addRecord() {
    const cleaned: Record<string, any> = {}

    for (const c of columns) {
      const raw = (recordValues[c.field_key] ?? '').trim()

      if (!raw) {
        cleaned[c.field_key] = null
      } else if (c.data_type === 'number') {
        const num = Number(raw)
        if (!Number.isFinite(num)) {
          showMessage(`"${c.name}" must be a number.`, 'warning')
          return
        }
        cleaned[c.field_key] = num
      } else {
        cleaned[c.field_key] = raw
      }
    }

    const { data, error } = await db.rpc('add_masterlist_record', {
      p_item_id: itemId,
      p_values: cleaned,
    })

    if (error) {
      showMessage('Could not add record: ' + error.message, 'error')
      return
    }

    setRecords(prev => [...prev, data as RecordRow])
    setShowRecordModal(false)
    setRecordValues({})
    showMessage('Record added.', 'success')
  }

  async function removeRecord(id: string) {
    if (!confirm('Delete this record?')) return

    const { error } = await db.rpc('delete_masterlist_record', {
      p_item_id: itemId,
      p_record_id: id,
    })

    if (error) {
      showMessage('Could not delete record: ' + error.message, 'error')
      return
    }

    setRecords(prev => prev.filter(r => r.id !== id))
    showMessage('Record deleted.', 'warning')
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return records

    return records.filter(r =>
      columns.some(c => String(r?.[c.field_key] ?? '').toLowerCase().includes(q))
    )
  }, [records, columns, search])

  if (booting) {
    return (
      <div className="ml-page">
        <div className="ml-loading">
          <i className="ph ph-circle-notch" />
          Loading masterlist…
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="ml-page">
        <div className="ml-empty">
          <i className="ph ph-folder-open" />
          <h2>Masterlist not found</h2>
          <button className="ml-btn primary" onClick={() => router.push('/dashboard?panel=masterlist')}>
            Back to Masterlist
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ml-page">
      <header className="ml-header">
        <div className="ml-header-left">
          <button className="ml-icon-btn" onClick={() => router.push('/dashboard?panel=masterlist')} title="Back">
            <i className="ph ph-arrow-left" />
          </button>
          <div className="ml-title-wrap">
            <div className="ml-icon"><i className={`ph ${item.icon || 'ph-folder-open'}`} /></div>
            <div>
              <h1>{item.name}</h1>
              <p>{item.description || 'Dynamic masterlist'}</p>
            </div>
          </div>
        </div>

        <div className="ml-header-actions">
          <div className="ml-search">
            <i className="ph ph-magnifying-glass" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search records..." />
          </div>
          <button className="ml-btn secondary" onClick={() => setShowFieldModal(true)}>
            <i className="ph ph-columns-plus-left" /> Add Column
          </button>
          <button className="ml-btn primary" onClick={openRecordModal} disabled={!columns.length}>
            <i className="ph-bold ph-plus" /> Add Record
          </button>
        </div>
      </header>

      <main className="ml-main">
        <div className="ml-status-row">
          <span>{columns.length} {columns.length === 1 ? 'column' : 'columns'}</span>
          <span>{filteredRecords.length} {filteredRecords.length === 1 ? 'record' : 'records'}</span>
          {userEmail && <span className="ml-user"><i className="ph ph-user-circle" /> {userEmail}</span>}
        </div>

        {messages.length > 0 && (
          <div className="ml-messages">
            {messages.map(m => (
              <div key={m.id} className={`ml-message ${m.kind}`}>
                <span>{m.text}</span>
                <button onClick={() => setMessages(prev => prev.filter(x => x.id !== m.id))}>
                  <i className="ph-bold ph-x" />
                </button>
              </div>
            ))}
          </div>
        )}

        {!columns.length ? (
          <div className="ml-empty-panel">
            <div className="ml-empty-icon"><i className="ph ph-columns-plus-left" /></div>
            <h2>Build your masterlist</h2>
            <p>Add your first column. After that, you can add records without creating another Supabase table or TSX page.</p>
            <button className="ml-btn primary" onClick={() => setShowFieldModal(true)}>
              <i className="ph-bold ph-plus" /> Add First Column
            </button>
          </div>
        ) : (
          <div className="ml-table-card">
            <div className="ml-table-wrap">
              <table>
                <thead>
                  <tr>
                    {columns.map(c => (
                      <th key={c.id}>
                        <span>{c.name}</span>
                        <small>{c.data_type}</small>
                        <button onClick={() => removeColumn(c)} title={`Remove ${c.name}`}>
                          <i className="ph ph-x" />
                        </button>
                      </th>
                    ))}
                    <th className="ml-actions-head">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {!filteredRecords.length ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="ml-no-records">
                        {search ? 'No matching records.' : 'No records yet. Click Add Record.'}
                      </td>
                    </tr>
                  ) : filteredRecords.map(r => (
                    <tr key={r.id}>
                      {columns.map(c => (
                        <td key={c.id}>
                          {c.data_type === 'date' && r?.[c.field_key]
                            ? new Date(`${String(r[c.field_key]).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            : String(r?.[c.field_key] ?? '—')}
                        </td>
                      ))}
                      <td className="ml-row-action">
                        <button className="ml-delete-btn" onClick={() => removeRecord(r.id)} title="Delete record">
                          <i className="ph ph-trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Add Column Modal */}
      <div className={`ml-modal-overlay ${showFieldModal ? 'open' : ''}`}
        onClick={e => { if (e.target === e.currentTarget) setShowFieldModal(false) }}>
        <div className="ml-modal">
          <h3><i className="ph-fill ph-columns" /> Add Column</h3>
          <label>Column Name</label>
          <input
            value={fieldName}
            onChange={e => setFieldName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') setShowFieldModal(false) }}
            placeholder="e.g., Employee Name"
            autoFocus
          />
          <label>Field Type</label>
          <select value={fieldType} onChange={e => setFieldType(e.target.value as Column['data_type'])}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
          <div className="ml-modal-actions">
            <button className="ml-btn secondary" onClick={() => setShowFieldModal(false)}>Cancel</button>
            <button className="ml-btn primary" onClick={addColumn}><i className="ph-bold ph-plus" /> Add Column</button>
          </div>
        </div>
      </div>

      {/* Add Record Modal */}
      <div className={`ml-modal-overlay ${showRecordModal ? 'open' : ''}`}
        onClick={e => { if (e.target === e.currentTarget) setShowRecordModal(false) }}>
        <div className="ml-modal ml-record-modal">
          <h3><i className="ph-fill ph-database" /> Add Record</h3>
          {columns.map(c => (
            <React.Fragment key={c.id}>
              <label>{c.name}</label>
              <input
                type={c.data_type === 'date' ? 'date' : c.data_type === 'number' ? 'number' : 'text'}
                value={recordValues[c.field_key] ?? ''}
                onChange={e => setRecordValues(prev => ({ ...prev, [c.field_key]: e.target.value }))}
                placeholder={c.data_type === 'text' ? `Enter ${c.name.toLowerCase()}` : ''}
              />
            </React.Fragment>
          ))}
          <div className="ml-modal-actions">
            <button className="ml-btn secondary" onClick={() => setShowRecordModal(false)}>Cancel</button>
            <button className="ml-btn primary" onClick={addRecord}><i className="ph-bold ph-plus" /> Add Record</button>
          </div>
        </div>
      </div>
    </div>
  )
}
