'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import './tgirj.css'

type MasterRow = {
  id: number
  TITLE: string | null
  ARTIST: string | null
  DATE: string | null
  NOTES: string | null
}
type PriorityRow = {
  id: number
  TITLE: string | null
  ARTIST: string | null
  DATE: string | null
  NOTES: string | null
  CATEGORIZATION: string | null
}
type DateNote = { DATE: string; NOTES: string }

const MASTERLIST_TABLE = 'tgirj_masterlist'
const PRIORITIZATION_TABLE = 'tgirj_prioritization'
const DATE_NOTES_TABLE = 'tgirj_date_notes'

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

function parseDateFlexible(s: string | null | undefined): Date | null {
  if (!s) return null
  const c = String(s).trim()
  let m = c.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  m = c.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/)
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()]
    if (mo !== undefined) return new Date(+m[3], mo, +m[2])
  }
  m = c.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3]
    return a > 12 ? new Date(y, b - 1, a) : new Date(y, a - 1, b)
  }
  m = c.match(/(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  m = c.match(/(\w+)\s+(\d{4})/)
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()]
    if (mo !== undefined) return new Date(+m[2], mo, 1)
  }
  m = c.match(/^(\d{4})$/)
  if (m) return new Date(+m[1], 0, 1)
  m = c.match(/(\w+)\s+(\d{1,2})/)
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()]
    if (mo !== undefined) return new Date(new Date().getFullYear(), mo, +m[2])
  }
  return null
}

function normalizeDate(s: string | null): string | null {
  if (!s) return null
  const d = parseDateFlexible(s)
  if (!d || isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatLong(s: string | null): string {
  if (!s) return '—'
  const d = parseDateFlexible(s)
  if (d && !isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return s
}
function formatShort(s: string | null): string {
  if (!s) return '—'
  const d = parseDateFlexible(s)
  if (d && !isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return s
}
function esc(s: unknown): string {
  if (s == null || s === '') return '—'
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function isRealRow(row: { TITLE: string | null; DATE: string | null }) {
  if (!row.TITLE || row.TITLE === '' || row.TITLE.toUpperCase() === 'EMPTY') return false
  if (!row.DATE || row.DATE === '') return false
  return true
}

export default function BrandMasterlistPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const db = useMemo(() => supabase.schema('masterlist'), [supabase])

  const [booted, setBooted] = useState(false)
  const [status, setStatus] = useState<'ok' | 'error' | 'waiting'>('waiting')
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('user')

  const [masterlist, setMasterlist] = useState<MasterRow[]>([])
  const [priorityData, setPriorityData] = useState<PriorityRow[]>([])
  const [dateNotes, setDateNotes] = useState<Record<string, string>>({})

  const [currentView, setCurrentView] = useState<'masterlist' | 'priority'>('masterlist')
  const [currentYear, setCurrentYear] = useState<string>('all')
  const [currentPriority, setCurrentPriority] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set())
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())

  const [modalDate, setModalDate] = useState<string | null>(null)
  const [noteDate, setNoteDate] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const redirectingRef = useRef(false)

  const setBrandDot = useCallback((kind: 'ok' | 'error' | 'waiting') => {
    setStatus(kind)
  }, [])

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    router.replace('/login')
  }, [router])

  const fetchAllRows = useCallback(async <T,>(table: string): Promise<T[]> => {
    const PAGE = 1000
    let all: T[] = []
    let page = 0
    while (true) {
      const { data, error } = await db
        .from(table)
        .select('*')
        .order('DATE', { ascending: true })
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all = all.concat(data as T[])
      if (data.length < PAGE) break
      page++
    }
    return all
  }, [supabase])

  const fetchAllData = useCallback(async () => {
    const [master, priority, notes] = await Promise.all([
      fetchAllRows<MasterRow>(MASTERLIST_TABLE),
      fetchAllRows<PriorityRow>(PRIORITIZATION_TABLE),
      fetchAllRows<DateNote>(DATE_NOTES_TABLE),
    ])
    setMasterlist(master)
    setPriorityData(priority)
    const map: Record<string, string> = {}
    notes.forEach(n => { map[n.DATE] = n.NOTES })
    setDateNotes(map)
  }, [fetchAllRows])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setBrandDot('waiting')
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session?.user) { redirectToLogin(); return }

        setUserEmail(session.user.email ?? '')
        let role = 'user'
        try {
          const { data: profile } = await supabase
            .from('profiles').select('role').eq('id', session.user.id).maybeSingle()
          if (!profile) {
            await supabase.from('profiles').insert({
              id: session.user.id, email: session.user.email, role: 'user',
            })
          } else if (profile.role) role = profile.role
        } catch {}
        setUserRole(role)
        await fetchAllData()
        if (cancelled) return
        setBrandDot('ok')
        setBooted(true)
      } catch (err: any) {
        const detail = err?.message || err?.details || err?.hint || err?.error_description || JSON.stringify(err) || String(err)
        console.error('Boot failed:', detail, err)
        if (!cancelled) setBrandDot('error')
      }
    })()
    return () => { cancelled = true }
  }, [supabase, fetchAllData, redirectToLogin, setBrandDot])

  /* ── Derived ── */
  const validMasterlist = useMemo(
    () => masterlist.filter(isRealRow),
    [masterlist]
  )

  const availableYears = useMemo(() => {
    const set = new Set<number>()
    validMasterlist.forEach(r => {
      const d = parseDateFlexible(r.DATE)
      if (d && !isNaN(d.getTime())) set.add(d.getFullYear())
    })
    return Array.from(set).sort((a, b) => b - a)
  }, [validMasterlist])

  const yearCounts = useMemo(() => {
    const m: Record<number, number> = {}
    availableYears.forEach(y => {
      m[y] = validMasterlist.filter(r => {
        const d = parseDateFlexible(r.DATE)
        return d && !isNaN(d.getTime()) && d.getFullYear() === y
      }).length
    })
    return m
  }, [validMasterlist, availableYears])

  const filteredForMasterlist = useMemo(() => {
    let list = validMasterlist
    if (currentYear !== 'all') {
      const y = +currentYear
      list = list.filter(r => {
        const d = parseDateFlexible(r.DATE)
        return d && !isNaN(d.getTime()) && d.getFullYear() === y
      })
    }
    return list
  }, [validMasterlist, currentYear])

  const searchResults = useMemo(() => {
    const term = searchTerm.toLowerCase()
    if (!term) return []
    return filteredForMasterlist.filter(r => {
      const t = (r.TITLE || '').toLowerCase()
      const a = (r.ARTIST || '').toLowerCase()
      return t.includes(term) || a.includes(term)
    })
  }, [filteredForMasterlist, searchTerm])

  const yearMap = useMemo(() => {
    const ym: Record<number, Record<number, Record<number, MasterRow[]>>> = {}
    filteredForMasterlist.forEach(r => {
      const d = parseDateFlexible(r.DATE)
      if (!d || isNaN(d.getTime())) return
      const y = d.getFullYear(), m = d.getMonth(), day = d.getDate()
      if (!ym[y]) ym[y] = {}
      if (!ym[y][m]) ym[y][m] = {}
      if (!ym[y][m][day]) ym[y][m][day] = []
      ym[y][m][day].push(r)
    })
    return ym
  }, [filteredForMasterlist])

  const sortedYears = useMemo(
    () => Object.keys(yearMap).map(Number).sort((a, b) => b - a),
    [yearMap]
  )

  /* ── Modal actions ── */
  const modalEntries = useMemo(() => {
    if (!modalDate) return []
    return validMasterlist.filter(r => normalizeDate(r.DATE) === modalDate)
  }, [validMasterlist, modalDate])

  function openDateModal(dateKey: string) { setModalDate(dateKey) }
  function closeModal() { setModalDate(null) }

  function openNoteEditor(dateKey: string, e: React.MouseEvent) {
    e.stopPropagation()
    setNoteDate(dateKey)
    setNoteText(dateNotes[dateKey] || '')
  }
  function closeNoteModal() { setNoteDate(null); setNoteText('') }

  async function saveNote() {
    if (!noteDate) return
    const note = noteText.trim()
    try {
      const { data: existing } = await db
        .from(DATE_NOTES_TABLE)
        .select('id')
        .eq('DATE', noteDate)
        .maybeSingle()

      if (!note) {
        if (existing) {
          const { error } = await db.from(DATE_NOTES_TABLE).delete().eq('DATE', noteDate)
          if (error) throw error
        }
        setDateNotes(prev => { const n = { ...prev }; delete n[noteDate]; return n })
      } else if (existing) {
        const { error } = await db.from(DATE_NOTES_TABLE)
          .update({ NOTES: note, updated_at: new Date().toISOString() })
          .eq('DATE', noteDate)
        if (error) throw error
        setDateNotes(prev => ({ ...prev, [noteDate]: note }))
      } else {
        const { error } = await db.from(DATE_NOTES_TABLE)
          .insert({ DATE: noteDate, NOTES: note })
        if (error) throw error
        setDateNotes(prev => ({ ...prev, [noteDate]: note }))
      }
    } catch (err: any) {
      const detail = err?.message || err?.details || err?.hint || JSON.stringify(err) || String(err)
      console.error('Save note failed:', detail)
      alert('Save note failed: ' + detail)
      return
    }
    closeNoteModal()
  }

  function toggleYear(year: number) {
    setCollapsedYears(prev => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year); else next.add(year)
      return next
    })
  }

  function toggleMonth(year: number, month: number) {
    const key = `${year}-${month}`
    setCollapsedMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function exportCSV() {
    if (!validMasterlist.length) return
    const headers = ['Title', 'Artist', 'Date', 'Notes']
    const rows = validMasterlist.map(r => [
      r.TITLE || '', r.ARTIST || '', r.DATE || '',
      dateNotes[normalizeDate(r.DATE) || ''] || '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tgirj_masterlist.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportDateCSV(dateKey: string) {
    const entries = validMasterlist.filter(r => normalizeDate(r.DATE) === dateKey)
    if (!entries.length) return

    const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

    const headers = ['Title', 'Artist', 'Date', 'Notes']
    const note = dateNotes[dateKey] || ''
    const rows = entries.map(r => [
      r.TITLE || '',
      r.ARTIST || '',
      formatLong(r.DATE),
      note,
    ])

    const csv = [headers, ...rows]
      .map(r => r.map(quote).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bravo-${dateKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeModal(); closeNoteModal() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const statusClass = status === 'ok' ? 'status-ok' : status === 'error' ? 'status-error' : 'status-waiting'
  const statusDot = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'amber'

  const priorityGroups = useMemo(() => {
    let list = priorityData
    if (currentPriority !== 'all') {
      list = list.filter(r => (r.CATEGORIZATION || '').toUpperCase() === currentPriority)
    }
    const groups: Record<string, PriorityRow[]> = { A: [], B: [], C: [] }
    list.forEach(r => {
      const p = (r.CATEGORIZATION || 'C').toUpperCase()
      if (groups[p]) groups[p].push(r)
      else groups[p] = [r]
    })
    return groups
  }, [priorityData, currentPriority])

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
              LOADING TGIRJ MASTERLIST…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ml-root">
      <div className="app-container">

        {/* Sidebar */}
        <aside className={`sidebar ${sidebarOpen ? 'expanded' : ''}`}>
          <div className="brand-container">
            <div className="brand-group">
              <span className="brand-text" style={{ display: sidebarOpen ? 'block' : 'none' }}>TGIRJ</span>
              <span className="brand-sub" style={{ display: sidebarOpen ? 'block' : 'none' }}>TGIRJ Masterlist</span>
            </div>
            <span className={`brand-dot ${statusDot}`} style={{ display: sidebarOpen ? 'block' : 'none' }} />
          </div>

          <nav className="sidebar-scroll">
            <button
              className={`sidebar-item ${currentView === 'masterlist' ? 'active' : ''}`}
              onClick={() => setCurrentView('masterlist')}
            >
              <span className="icon"><i className="ph ph-list-checks" /></span>
              <span className="label">Masterlist</span>
              <span className="tooltip">Masterlist</span>
            </button>
            <button
              className={`sidebar-item ${currentView === 'priority' ? 'active' : ''}`}
              onClick={() => setCurrentView('priority')}
            >
              <span className="icon"><i className="ph ph-flag" /></span>
              <span className="label">Priority</span>
              <span className="tooltip">Priority</span>
            </button>

            <div className="sidebar-divider" />

            {currentView === 'masterlist' && (
              <>
                <div className="sidebar-label"><i className="ph ph-calendar" /> Years</div>
                <button
                  className={`sidebar-item ${currentYear === 'all' ? 'active' : ''}`}
                  onClick={() => setCurrentYear('all')}
                >
                  <span className="icon"><i className="ph ph-calendar-blank" /></span>
                  <span className="label">All Years</span>
                  <span className="tooltip">All Years</span>
                </button>
                {availableYears.map(y => (
                  <button
                    key={y}
                    className={`sidebar-item ${currentYear === String(y) ? 'active' : ''}`}
                    onClick={() => setCurrentYear(String(y))}
                  >
                    <span className="icon"><i className="ph ph-folder" style={{ color: '#B8734F' }} /></span>
                    <span className="label">{y} ({yearCounts[y]})</span>
                    <span className="tooltip">{y}</span>
                  </button>
                ))}
              </>
            )}

            {currentView === 'priority' && (
              <>
                <div className="sidebar-label"><i className="ph ph-flag" /> Priority</div>
                {[
                  { key: 'all', label: 'All', color: '#68748A' },
                  { key: 'A', label: 'A – Top Priority', color: '#7a3b3b' },
                  { key: 'B', label: 'B – Mid Priority', color: '#6b5d4d' },
                  { key: 'C', label: 'C – Lower Priority', color: '#1e40af' },
                ].map(p => (
                  <button
                    key={p.key}
                    className={`sidebar-item ${currentPriority === p.key ? 'active' : ''}`}
                    onClick={() => setCurrentPriority(p.key)}
                  >
                    <span className="icon"><i className="ph ph-circle" style={{ color: p.color }} /></span>
                    <span className="label">{p.label}</span>
                    <span className="tooltip">{p.label}</span>
                  </button>
                ))}
              </>
            )}
          </nav>

          <div className="sidebar-back-bottom">
            <a className="sidebar-back" href="/dashboard">
              <span className="icon"><i className="ph ph-arrow-left" /></span>
              <span className="label">Back to Dashboard</span>
              <span className="tooltip">Back</span>
            </a>
          </div>
        </aside>

        {/* Main */}
        <div className="main-content">
          <header>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={() => setSidebarOpen(v => !v)}
                style={{
                  width: 32, height: 32, borderRadius: 999,
                  background: '#DCE1E6', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#68748A', fontFamily: 'inherit',
                }}
                title="Toggle sidebar"
              >
                <i className="ph ph-list" />
              </button>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#18202F', whiteSpace: 'nowrap' }}>
                {currentView === 'masterlist' ? 'Masterlist' : 'Priority Groups'}
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
            {currentView === 'masterlist' && (
              <div className="fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#18202F', letterSpacing: '-0.02em' }}>
                      <i className="ph ph-list-checks" /> TGIRJ Masterlist Masterlist
                    </h2>
                    <p style={{ fontSize: '0.75rem', color: '#68748A', marginTop: '0.15rem' }}>
                      {searchTerm ? `Searching "${searchTerm}"` : 'All entries organized by date.'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="search-bar">
                      <i className="ph ph-magnifying-glass" />
                      <input
                        type="text"
                        placeholder="Search title or artist..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <button className="btn-export" onClick={exportCSV} title="Export all CSV">
                      <i className="ph ph-download-simple" />
                    </button>
                  </div>
                </div>

                {/* Search results */}
                {searchTerm && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#18202F' }}>
                        <i className="ph ph-magnifying-glass" style={{ color: '#B8734F' }} /> "{searchTerm}"
                      </span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#68748A', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>
                        {searchResults.length} results
                      </span>
                      <button
                        onClick={() => setSearchTerm('')}
                        style={{ fontSize: '0.7rem', color: '#B8734F', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
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
                            <th style={{ width: '30%' }}>Date</th>
                            <th style={{ width: '50%' }}>Title</th>
                            <th style={{ width: '20%' }}>Artist</th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchResults.map(r => (
                            <tr key={r.id} onClick={() => openDateModal(normalizeDate(r.DATE) || '')}>
                              <td>{formatShort(r.DATE)}</td>
                              <td style={{ fontWeight: 500 }}>{r.TITLE}</td>
                              <td style={{ color: '#68748A' }}>{r.ARTIST || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}

                {/* Grouped view */}
                {!searchTerm && (
                  sortedYears.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#68748A', fontSize: '0.8rem', padding: '2rem' }}>
                      <i className="ph ph-folder-open" style={{ fontSize: '1.5rem', display: 'block', marginBottom: 8 }} />
                      No entries found{currentYear !== 'all' ? ` in ${currentYear}` : ''}
                    </div>
                  ) : (
                    sortedYears.map(year => {
                      const months = yearMap[year]
                      const sortedMonths = Object.keys(months).map(Number).sort((a, b) => b - a)
                      const totalInYear = Object.values(months).reduce(
                        (sum, days) => sum + Object.values(days).reduce((s, entries) => s + entries.length, 0), 0
                      )
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
                                const totalInMonth = Object.values(days).reduce((s, entries) => s + entries.length, 0)
                                const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' })
                                return (
                                  <div key={month}>
                                    <button
                                      onClick={() => toggleMonth(year, month)}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        marginBottom: 8, width: '100%',
                                        background: 'transparent', border: 'none',
                                        cursor: 'pointer', padding: '4px 0',
                                        fontFamily: 'inherit', textAlign: 'left',
                                      }}
                                      title={collapsedMonths.has(`${year}-${month}`) ? 'Expand month' : 'Collapse month'}
                                    >
                                      <i className={`ph-bold ${collapsedMonths.has(`${year}-${month}`) ? 'ph-caret-right' : 'ph-caret-down'}`} style={{ color: '#68748A', fontSize: '0.8rem' }} />
                                      <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#18202F', margin: 0 }}>
                                        <i className="ph ph-folder-open" /> {monthName}
                                      </h4>
                                      <span style={{ fontSize: '0.6rem', color: '#68748A', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>
                                        {totalInMonth} entries
                                      </span>
                                    </button>
                                    <div style={{
                                      display: collapsedMonths.has(`${year}-${month}`) ? 'none' : 'flex',
                                      flexDirection: 'column', gap: 8, marginLeft: 12,
                                    }}>
                                      {sortedDays.map(day => {
                                        const entries = days[day]
                                        const dateObj = new Date(year, month, day)
                                        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                                        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                                        const note = dateNotes[dateKey] || ''
                                        return (
                                          <div
                                            key={day}
                                            className="date-card-compact"
                                            onClick={() => openDateModal(dateKey)}
                                          >
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#18202F' }}>
                                                <i className="ph ph-calendar-day" /> {dateStr}
                                              </span>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#68748A', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>
                                                  {entries.length}
                                                </span>
                                                <button
                                                  className="note-edit-btn"
                                                  onClick={e => openNoteEditor(dateKey, e)}
                                                  title="Edit note"
                                                >
                                                  <i className="ph ph-pencil-simple" />
                                                </button>
                                                <button
                                                  className="note-edit-btn"
                                                  onClick={e => { e.stopPropagation(); exportDateCSV(dateKey) }}
                                                  title="Export this date"
                                                >
                                                  <i className="ph ph-download-simple" />
                                                </button>
                                              </div>
                                            </div>
                                            {note && <div className="note-text">📝 {note}</div>}
                                          </div>
                                        )
                                      })}
                                    </div>
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
              </div>
            )}

            {currentView === 'priority' && (
              <div className="fade-in">
                <div style={{ marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#18202F', letterSpacing: '-0.02em' }}>
                    <i className="ph ph-flag" /> Priority Groups
                  </h2>
                  <p style={{ fontSize: '0.75rem', color: '#68748A', marginTop: '0.15rem' }}>
                    Entries grouped by priority level.
                  </p>
                </div>
                {(['A', 'B', 'C'] as const).map(p => {
                  const entries = priorityGroups[p] || []
                  if (currentPriority !== 'all' && currentPriority !== p) return null
                  if (!entries.length) return null
                  const label = p === 'A' ? 'A – Top Priority' : p === 'B' ? 'B – Mid Priority' : 'C – Lower Priority'
                  return (
                    <div key={p} style={{
                      background: '#FAF7F2', borderRadius: 12,
                      border: '1px solid rgba(24,32,47,0.08)',
                      marginBottom: '1rem', overflow: 'hidden',
                    }}>
                      <div style={{
                        padding: '0.6rem 1rem', background: '#DCE1E6',
                        borderBottom: '1px solid rgba(24,32,47,0.06)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`priority-${p.toLowerCase()}`} style={{
                            fontSize: '0.75rem', fontWeight: 700,
                            padding: '2px 12px', borderRadius: 999,
                          }}>{label}</span>
                          <span style={{ fontSize: '0.7rem', color: '#68748A' }}>{entries.length} entries</span>
                        </div>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="priority-groups-table">
                          <thead>
                            <tr>
                              <th>Title</th>
                              <th>Artist</th>
                              <th>Date</th>
                              <th>Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map(row => (
                              <tr key={row.id}>
                                <td style={{ fontWeight: 500 }}>{row.TITLE}</td>
                                <td style={{ color: '#68748A' }}>{row.ARTIST || '—'}</td>
                                <td style={{ color: '#68748A', fontSize: '0.7rem' }}>{row.DATE ? formatLong(row.DATE) : '—'}</td>
                                <td style={{ textAlign: 'center' }}>
                                  {row.NOTES
                                    ? <span style={{ fontSize: '0.65rem', fontWeight: 500, color: '#B8734F', background: '#DCE1E6', padding: '2px 8px', borderRadius: 999 }}>{row.NOTES}</span>
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
                {currentPriority === 'all' && Object.values(priorityGroups).every(g => g.length === 0) && (
                  <div style={{ textAlign: 'center', color: '#68748A', fontSize: '0.8rem', padding: '2rem' }}>
                    <i className="ph ph-flag" style={{ fontSize: '1.5rem', display: 'block', marginBottom: 8 }} />
                    No priority entries found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Date Modal */}
      {modalDate !== null && (
        <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title-group">
                <h3>{formatLong(modalDate)}</h3>
                <span className="entry-count">{modalEntries.length} entries</span>
              </div>
              <button className="modal-close-btn" onClick={closeModal} title="Close">
                <i className="ph-bold ph-x" />
              </button>
            </div>
            <div className="modal-body">
              {modalEntries.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#68748A', fontSize: '0.8rem', padding: '2rem' }}>
                  No entries for this date.
                </div>
              ) : (() => {
                const grouped: Record<string, MasterRow[]> = {}
                modalEntries.forEach(r => {
                  const a = r.ARTIST || 'Unknown Artist'
                  if (!grouped[a]) grouped[a] = []
                  grouped[a].push(r)
                })
                let n = 0
                return Object.keys(grouped).map(artist => {
                  const items = grouped[artist]
                  return (
                    <div key={artist} className="modal-artist-group">
                      <div className="artist-header">
                        {artist}
                        <span className="artist-dash" />
                        <span style={{ fontWeight: 400, fontSize: '0.6rem', color: '#94a3b8' }}>{items.length}</span>
                      </div>
                      {items.map(item => {
                        n++
                        return (
                          <div key={item.id} className="entry-item">
                            <span className="entry-number">{n}.</span>
                            <span className="entry-title">{item.TITLE}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Note Modal */}
      {noteDate !== null && (
        <div className="modal-overlay note-modal open" onClick={e => { if (e.target === e.currentTarget) closeNoteModal() }}>
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title-group">
                <h3><i className="ph ph-note-pencil" style={{ color: '#B8734F' }} /> Edit Note</h3>
                <span className="entry-count">{formatLong(noteDate)}</span>
              </div>
              <button className="modal-close-btn" onClick={closeNoteModal} title="Close">
                <i className="ph-bold ph-x" />
              </button>
            </div>
            <div className="modal-body">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add a note for this date..."
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={closeNoteModal}>Cancel</button>
              <button className="btn-save" onClick={saveNote}>
                <i className="ph ph-floppy-disk" /> Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}