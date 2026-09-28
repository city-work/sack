'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import './concert.css'

type Concert = { id: number; title: string; status: string; created_at: string }
type Airing = { id: number; concert_title: string; air_date: string | null; episode_title: string | null; notes: string | null; status: number }
type Message = { id: string; text: string; kind: 'info' | 'success' | 'error' | 'warning' }

function parseDate(s: string | null | undefined): Date | null {
  if (!s || s === '—') return null
  const parts = String(s).split('-')
  if (parts.length === 3) {
    const d = new Date(+parts[0], +parts[1] - 1, +parts[2])
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(s))
  return isNaN(d.getTime()) ? null : d
}
function toISODate(d: Date | null) {
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatDate(s: string | null | undefined): string {
  if (!s || s === '—') return '—'
  const d = parseDate(s)
  return d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : s
}
function formatDateShort(d: Date | null) {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}
function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }
function esc(s: unknown) {
  if (s == null || s === '') return '—'
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function ConcertPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const db = useMemo(() => supabase.schema('weekly'), [supabase])

  const [booted, setBooted] = useState(false)
  const [status, setStatus] = useState<'ok' | 'error' | 'waiting'>('waiting')
  const [messages, setMessages] = useState<Message[]>([])

  const [concerts, setConcerts] = useState<Concert[]>([])
  const [airings, setAirings] = useState<Airing[]>([])
  const [currentTitle, setCurrentTitle] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [hideEmptyDays, setHideEmptyDays] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [showEntryModal, setShowEntryModal] = useState(false)
  const [entryDate, setEntryDate] = useState('')
  const [entryTitle, setEntryTitle] = useState('')
  const [entryNotes, setEntryNotes] = useState('')

  const [confirmMsg, setConfirmMsg] = useState<string | null>(null)
  const confirmCbRef = useRef<null | (() => void)>(null)

  const redirectingRef = useRef(false)
  const realtimeRef = useRef<any>(null)

  const showMessage = useCallback((text: string, kind: Message['kind'] = 'info') => {
    const id = generateId()
    setMessages(prev => [...prev, { id, text, kind }])
    setTimeout(() => setMessages(prev => prev.filter(m => m.id !== id)), 3500)
  }, [])

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    router.replace('/login')
  }, [router])

  const loadAllData = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([
        db.from('choice_concert_titles').select('*').order('title', { ascending: true }),
        db.from('choice_concert_airings').select('*').order('air_date', { ascending: true }),
      ])
      if (c.error) throw c.error
      if (a.error) throw a.error
      const cs = (c.data || []) as Concert[]
      setConcerts(cs)
      setAirings((a.data || []) as Airing[])
      setCurrentTitle(prev => {
        if (prev && cs.some(x => x.title === prev)) return prev
        return cs[0]?.title ?? null
      })
    } catch (err: any) {
      console.error('Load failed:', err)
      setStatus('error')
      showMessage('Failed to load: ' + (err?.message || err), 'error')
    }
  }, [db, showMessage])

  useEffect(() => {
    let cancelled = false
    let sub: any = null
    ;(async () => {
      try {
        const authSub = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT' || (!session && event === 'TOKEN_REFRESHED')) redirectToLogin()
        })
        sub = authSub.data?.subscription

        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session) { redirectToLogin(); return }

        const { error: userErr } = await supabase.auth.getUser()
        if (userErr) {
          const st = (userErr as any).status || 0
          const isAuthErr = st === 401 || st === 403 || /jwt|token|invalid|expired|not authenticated/i.test(userErr.message || '')
          if (isAuthErr) { try { await supabase.auth.signOut() } catch {}; redirectToLogin(); return }
        }

        await loadAllData()
        if (cancelled) return

        if (realtimeRef.current) { try { supabase.removeChannel(realtimeRef.current) } catch {} }
        realtimeRef.current = supabase.channel('concert-sync')
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'choice_concert_titles' }, () => loadAllData())
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'choice_concert_airings' }, () => loadAllData())
          .subscribe()

        setStatus('ok')
        setBooted(true)
      } catch (err) {
        console.error('Boot failed:', err)
        if (!cancelled) { setStatus('error'); redirectToLogin() }
      }
    })()
    return () => {
      cancelled = true
      try { sub?.unsubscribe?.() } catch {}
      try { if (realtimeRef.current) supabase.removeChannel(realtimeRef.current) } catch {}
    }
  }, [supabase, loadAllData, redirectToLogin])

  useEffect(() => {
    try { if (localStorage.getItem('citywork_concert_hide_empty') === '1') setHideEmptyDays(true) } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('citywork_concert_hide_empty', hideEmptyDays ? '1' : '0') } catch {}
  }, [hideEmptyDays])

  const scopedAirings = useMemo(() => {
    if (!currentTitle) return []
    return airings.filter(a => a.concert_title === currentTitle)
  }, [airings, currentTitle])

  const calendarData = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dow = today.getDay()
    const start = new Date(today)
    start.setDate(today.getDate() - dow + (dow === 0 ? -6 : 1) + weekOffset * 7)
    const end = new Date(start); end.setDate(start.getDate() + 6)

    const cells = SHORT_DAYS.map((_, i) => {
      const date = new Date(start); date.setDate(start.getDate() + i)
      const iso = toISODate(date)
      const isToday = date.getTime() === today.getTime()
      const dayAirings = scopedAirings.filter(a => a.air_date === iso)
      return { idx: i, date, iso, isToday, airings: dayAirings }
    })
    return {
      cells,
      label: `${formatDateShort(start)} – ${formatDateShort(end)}, ${end.getFullYear()}`,
    }
  }, [scopedAirings, weekOffset])

  const filteredAirings = useMemo(() => {
    let list = scopedAirings
    if (searchTerm) {
      const t = searchTerm.toLowerCase()
      list = list.filter(a =>
        (a.episode_title || '').toLowerCase().includes(t) ||
        (a.air_date || '').toLowerCase().includes(t) ||
        (a.notes || '').toLowerCase().includes(t)
      )
    }
    return list.slice().sort((a, b) => {
      const da = parseDate(a.air_date), dbv = parseDate(b.air_date)
      const ta = da ? da.getTime() : 0
      const tb = dbv ? dbv.getTime() : 0
      return sortDir === 'desc' ? tb - ta : ta - tb
    })
  }, [scopedAirings, searchTerm, sortDir])

  async function addNewConcert() {
    const name = prompt('Enter Concert name (e.g., "ELVIS NIGHT"):')
    if (!name || !name.trim()) return
    const clean = name.trim()
    if (concerts.some(c => c.title.toLowerCase() === clean.toLowerCase())) {
      showMessage('Concert already exists', 'warning'); return
    }
    const { data, error } = await db.from('choice_concert_titles').insert({ title: clean, status: 'Active' }).select().single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setConcerts(prev => [...prev, data as Concert].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })))
    setCurrentTitle(clean)
    setWeekOffset(0)
    setSearchTerm('')
    showMessage('Concert created', 'success')
  }

  function openEntryModal() {
    if (!currentTitle) return
    setShowEntryModal(true)
    const t = new Date()
    setEntryDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`)
    setEntryTitle('')
    setEntryNotes('')
  }
  function closeEntryModal() {
    setShowEntryModal(false)
  }

  async function saveEntry() {
    if (!currentTitle) return
    if (!entryDate || !entryTitle.trim()) { showMessage('Enter both date and title', 'warning'); return }
    const { data, error } = await db.from('choice_concert_airings')
      .insert({
        concert_title: currentTitle,
        air_date: entryDate,
        episode_title: entryTitle.trim(),
        notes: entryNotes.trim() || null,
        status: 0,
      })
      .select().single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setAirings(prev => [...prev, data as Airing])
    closeEntryModal()
    showMessage('Entry added', 'success')
  }

  async function deleteEntry(id: number) {
    const { error } = await db.from('choice_concert_airings').delete().eq('id', id)
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setAirings(prev => prev.filter(a => a.id !== id))
    showMessage('Entry deleted', 'success')
  }

  function askConfirm(msg: string, cb: () => void) {
    setConfirmMsg(msg)
    confirmCbRef.current = cb
  }

  function deleteConcert() {
    if (!currentTitle) return
    const title = currentTitle
    const count = airings.filter(a => a.concert_title === title).length
    askConfirm(
      `Delete "${title}" and all ${count} entr${count === 1 ? 'y' : 'ies'}? This cannot be undone.`,
      async () => {
        const [e1, e2] = await Promise.all([
          db.from('choice_concert_airings').delete().eq('concert_title', title),
          db.from('choice_concert_titles').delete().eq('title', title),
        ])
        if (e1.error) { showMessage('Delete failed: ' + e1.error.message, 'error'); return }
        if (e2.error) { showMessage('Delete failed: ' + e2.error.message, 'error'); return }
        setAirings(prev => prev.filter(a => a.concert_title !== title))
        setConcerts(prev => {
          const next = prev.filter(c => c.title !== title)
          setCurrentTitle(next[0]?.title ?? null)
          return next
        })
        showMessage(`Deleted "${title}"`, 'warning')
      }
    )
  }

  function exportCSV() {
    if (!currentTitle) return
    if (!scopedAirings.length) { showMessage('No entries to export', 'warning'); return }
    const headers = ['Date', 'Title', 'Notes']
    const rows = scopedAirings.slice().sort((a, b) => {
      const da = parseDate(a.air_date), dbv = parseDate(b.air_date)
      return (da ? da.getTime() : 0) - (dbv ? dbv.getTime() : 0)
    }).map(a => [a.air_date || '', a.episode_title || '', a.notes || ''])
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentTitle.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-concert-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showMessage(`Exported ${scopedAirings.length} entries`, 'success')
  }

  function parseCSV(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++ } else inQ = false
        } else cur += c
      } else {
        if (c === '"') inQ = true
        else if (c === ',') { row.push(cur); cur = '' }
        else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = [] }
        else if (c !== '\r') cur += c
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row) }
    return rows.filter(r => r.some(c => (c || '').trim() !== ''))
  }

  function importCSV() {
    if (!currentTitle) return
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = '.csv,text/csv'
    inp.onchange = () => {
      const file = inp.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const rows = parseCSV(reader.result as string)
          if (!rows.length) throw new Error('CSV is empty')
          const first = rows[0].map(c => (c || '').trim().toLowerCase())
          const hasHeader = first.some(h =>
            ['date', 'air date', 'aired', 'title', 'episode', 'episode title', 'name', 'notes', 'note', 'description'].includes(h)
          )
          const start = hasHeader ? 1 : 0
          let colDate = -1, colTitle = -1, colNotes = -1
          if (hasHeader) {
            first.forEach((h, i) => {
              if (h === 'date' || h === 'air date' || h === 'aired') colDate = i
              else if (h === 'title' || h === 'episode' || h === 'episode title' || h === 'name') colTitle = i
              else if (h === 'notes' || h === 'note' || h === 'description') colNotes = i
            })
          } else { colDate = 0; colTitle = 1; colNotes = 2 }
          if (colDate === -1) throw new Error('No "Date" column found')
          if (colTitle === -1) throw new Error('No "Title" column found')

          const payload: any[] = []
          rows.slice(start).forEach(cols => {
            const rawDate = (colDate >= 0 ? (cols[colDate] || '') : '').trim()
            const title = (colTitle >= 0 ? (cols[colTitle] || '') : '').trim()
            const notes = (colNotes >= 0 ? (cols[colNotes] || '') : '').trim()
            if (!title) return
            let storedDate = rawDate
            const d = parseDate(rawDate)
            if (d) storedDate = toISODate(d)
            payload.push({
              concert_title: currentTitle,
              air_date: storedDate || null,
              episode_title: title,
              notes: notes || null,
              status: 0,
            })
          })
          if (!payload.length) throw new Error('No valid rows')

          const { error } = await db.from('choice_concert_airings').insert(payload)
          if (error) throw error
          await loadAllData()
          showMessage(`Imported ${payload.length} entries`, 'success')
        } catch (err: any) {
          showMessage('Import failed: ' + (err?.message || err), 'error')
        }
      }
      reader.readAsText(file)
    }
    inp.click()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showEntryModal) closeEntryModal()
        if (confirmMsg) { setConfirmMsg(null); confirmCbRef.current = null }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('#concertSearch')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showEntryModal, confirmMsg])

  const statusClass = status === 'ok' ? 'status-ok' : status === 'error' ? 'status-error' : 'status-waiting'
  const statusDot = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'amber'

  if (!booted) {
    return (
      <div className="concert-root">
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: '#18202F',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#FAF7F2',
        }}>
          <div style={{ textAlign: 'center' }}>
            <i className="ph ph-music-notes" style={{ fontSize: '2.5rem', color: '#B8734F' }} />
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', letterSpacing: '0.5px', opacity: 0.75 }}>
              LOADING CHOICE CONCERT…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="concert-root">
      <div className="app-container">
        <header className="app-header">
          <div className="header-left">
            <span className="brand-icon"><i className="ph-fill ph-buildings" /></span>
            <span className="brand-text"><span className="city">City</span><span className="work">Work</span></span>

            <div className="concert-select-wrapper">
              <select
                className="concert-select"
                value={currentTitle ?? ''}
                onChange={e => {
                  setCurrentTitle(e.target.value || null)
                  setSearchTerm('')
                  setWeekOffset(0)
                }}
                disabled={!concerts.length}
                aria-label="Select concert"
              >
                {concerts.length === 0
                  ? <option value="">No concerts</option>
                  : concerts.map(c => <option key={c.id} value={c.title}>{c.title}</option>)}
              </select>
              <i className="ph-bold ph-caret-down concert-select-arrow" />
            </div>

            <button className="btn-new-concert" onClick={addNewConcert} title="Add new concert">
              <i className="ph-bold ph-plus" />
            </button>

            <button
              className="btn-csv danger"
              onClick={deleteConcert}
              title={currentTitle ? `Delete ${currentTitle}` : 'Delete concert'}
              disabled={!currentTitle}
              aria-label={currentTitle ? `Delete ${currentTitle}` : 'Delete concert'}
            >
              <i className="ph ph-trash" />
            </button>

            <span className={`status-badge-top ${statusClass}`}>
              <span className={`status-dot ${statusDot}`} />
            </span>
          </div>

          <div className="header-right">
            <a href="/dashboard" className="rail-btn" data-tip="Apps"><i className="ph ph-squares-four" /></a>
            <a href="/classics" className="rail-btn" data-tip="Classics"><i className="ph ph-film-strip" /></a>
            <a href="/dog-show" className="rail-btn" data-tip="Dog Show"><i className="ph ph-dog" /></a>

            <div className="rail-divider" />

            <button className="btn-icon reload" onClick={() => loadAllData()} title="Reload">
              <i className="ph ph-arrow-clockwise" />
            </button>
          </div>
        </header>

        <div className="main-content">
          <div className="scrollable-content">
            {messages.map(m => (
              <div key={m.id} className="fade-in" style={{
                borderRadius: '0.75rem', border: '1px solid rgba(24,32,47,0.08)',
                padding: '0.6rem 1rem', fontSize: '0.8rem',
                background: m.kind === 'error' ? '#f5e6e6' : m.kind === 'success' ? '#e5f3ec' : '#FAF7F2',
                color: '#18202F', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '0.75rem',
              }}>
                <span>{m.text}</span>
                <button onClick={() => setMessages(p => p.filter(x => x.id !== m.id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: '#68748A' }}>
                  <i className="ph-bold ph-x" />
                </button>
              </div>
            ))}

            {concerts.length === 0 ? (
              <div className="empty-hero">
                <div className="hero-icon"><i className="ph ph-music-notes" /></div>
                <h2>No concerts yet</h2>
                <p>Create your first concert to start tracking airings, notes, and schedules.</p>
                <button onClick={addNewConcert}><i className="ph-bold ph-plus" /> Create Concert</button>
              </div>
            ) : (
              <>
                {/* Weekly Calendar */}
                <div className="section-card">
                  <div className="section-header">
                    <i className="ph ph-calendar-blank header-icon" />
                    <h3>Weekly Schedule</h3>
                    <label className={`hide-empty-wrapper ${hideEmptyDays ? 'active' : ''}`}>
                      <input type="checkbox" checked={hideEmptyDays} onChange={e => setHideEmptyDays(e.target.checked)} />
                      <span>Hide empty days</span>
                    </label>
                  </div>
                  <div className="calendar-nav">
                    <button onClick={() => setWeekOffset(o => o - 1)}><i className="ph ph-caret-left" /></button>
                    <span>{calendarData.label}</span>
                    <button onClick={() => setWeekOffset(o => o + 1)}><i className="ph ph-caret-right" /></button>
                  </div>
                  {(() => {
                    const visible = hideEmptyDays ? calendarData.cells.filter(c => c.airings.length > 0) : calendarData.cells
                    if (hideEmptyDays && visible.length === 0) {
                      return (
                        <div className="calendar-grid compact-empty">
                          <div className="calendar-empty">✨ Nothing scheduled this week</div>
                        </div>
                      )
                    }
                    return (
                      <div className={`calendar-grid ${hideEmptyDays ? 'compact-empty' : ''}`}>
                        {visible.map(cell => (
                          <div key={cell.idx} className={`calendar-day ${cell.isToday ? 'today' : ''}`}>
                            <div className="day-header">
                              <span className="day-name">{SHORT_DAYS[cell.idx]}</span>
                              <span className="day-date">{cell.date.getDate()}</span>
                            </div>
                            <div className="day-body">
                              {cell.airings.length === 0
                                ? <div className="no-events">No entries</div>
                                : cell.airings.map(a => (
                                    <div key={a.id} className="cal-event">
                                      <div className="cal-event-title">{a.episode_title || 'Concert'}</div>
                                      {a.notes && (
                                        <div className="cal-event-show">
                                          <i className="ph ph-note" /> {a.notes}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                {/* Entries table */}
                <div className="section-card">
                  <div className="section-header">
                    <i className="ph ph-list header-icon" />
                    <h3>Entries</h3>
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.6rem', background: '#e2e8f0', padding: '0.15rem 0.6rem', borderRadius: '999px', color: '#68748A' }}>
                      {scopedAirings.length} entr{scopedAirings.length === 1 ? 'y' : 'ies'}
                    </span>
                  </div>

                  <div className="entries-toolbar">
                    <div className="search-bar">
                      <i className="ph ph-magnifying-glass" />
                      <input
                        id="concertSearch"
                        type="text"
                        placeholder="Search entries..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <button className="btn-csv import" onClick={importCSV} title="Import entries from CSV">
                      <i className="ph ph-upload-simple" />
                    </button>
                    <button className="btn-csv export" onClick={exportCSV} title="Export entries to CSV">
                      <i className="ph ph-download-simple" />
                    </button>
                    <button className="btn-add-episode" onClick={openEntryModal}>
                      <i className="ph-bold ph-plus" /> Add Entry
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ cursor: 'pointer', width: '20%' }} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
                            Date Aired <i className={`ph ${sortDir === 'desc' ? 'ph-sort-descending' : 'ph-sort-ascending'}`} />
                          </th>
                          <th style={{ width: '35%' }}>Title</th>
                          <th style={{ width: '35%' }}>Notes</th>
                          <th style={{ width: '10%', textAlign: 'center' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAirings.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                              {searchTerm ? 'No entries match your search.' : 'No entries yet. Click Add Entry to start.'}
                            </td>
                          </tr>
                        ) : filteredAirings.map(a => (
                          <tr key={a.id} className="fade-in">
                            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(a.air_date)}</td>
                            <td style={{ fontWeight: 600 }}>{a.episode_title || '—'}</td>
                            <td style={{ color: '#68748A' }}>{a.notes || '—'}</td>
                            <td style={{ textAlign: 'center' }}>
                              <button className="btn-delete-episode" onClick={() => deleteEntry(a.id)} title="Delete entry">
                                <i className="ph ph-trash" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Add Entry Modal */}
      {showEntryModal && (
        <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) closeEntryModal() }}>
          <div className="modal-card">
            <h3><i className="ph ph-music-notes" style={{ color: '#B8734F' }} /> Add Concert Entry</h3>
            <label className="modal-label">DATE AIRED</label>
            <input type="date" className="modal-input" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
            <label className="modal-label">TITLE</label>
            <input type="text" className="modal-input" placeholder="e.g., ELVIS NIGHT" value={entryTitle}
              onChange={e => setEntryTitle(e.target.value)} autoFocus />
            <label className="modal-label">NOTES (optional)</label>
            <textarea className="modal-input" rows={3} placeholder="Add any notes..." value={entryNotes}
              onChange={e => setEntryNotes(e.target.value)} style={{ resize: 'vertical' }} />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={closeEntryModal}>Cancel</button>
              <button className="btn-add" onClick={saveEntry}><i className="ph-bold ph-floppy-disk" /> Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmMsg && (
        <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) { setConfirmMsg(null); confirmCbRef.current = null } }}>
          <div className="modal-card" style={{ maxWidth: 380, textAlign: 'center' }}>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#18202F', marginBottom: '1.25rem', whiteSpace: 'pre-line' }}>{confirmMsg}</p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn-cancel" onClick={() => { setConfirmMsg(null); confirmCbRef.current = null }}>Cancel</button>
              <button className="btn-danger" onClick={() => { const cb = confirmCbRef.current; setConfirmMsg(null); confirmCbRef.current = null; cb?.() }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}