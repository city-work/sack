'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import './dog-show.css'

type Show = { id: number; title: string; status: string; created_at: string }
type Episode = { id: number; show_title: string; air_date: string | null; episode_number: string | null; status: number }
type Message = { id: string; text: string; kind: 'info' | 'success' | 'error' | 'warning' }
type EditTarget =
  | { kind: 'episode'; id: number; field: 'air_date' | 'episode_number' }
  | null

function makeLocalDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  const d = new Date(year, month - 1, day)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) return null
  return d
}

function parseAirDate(s: string | null | undefined): Date | null {
  if (!s || s === '—') return null
  const str = String(s).trim()
  if (!str) return null

  // ISO: YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if (m) return makeLocalDate(+m[1], +m[2], +m[3])

  // Excel/CSV-style numeric dates: M/D/YYYY, MM/DD/YY, M-D-YYYY, etc.
  m = str.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/)
  if (m) {
    let year = +m[3]
    if (year < 100) year += 2000
    return makeLocalDate(year, +m[1], +m[2])
  }

  // Text month dates: September 13, 2027 / Sep 13 2027 / 13-Sep-2027
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4,
    may: 5, jun: 6, jul: 7, aug: 8,
    sep: 9, oct: 10, nov: 11, dec: 12
  }

  m = str.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})$/)
  if (m) {
    const month = months[m[1].slice(0, 3).toLowerCase()]
    return month ? makeLocalDate(+m[3], month, +m[2]) : null
  }

  m = str.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2,4})$/)
  if (m) {
    let year = +m[3]
    if (year < 100) year += 2000
    const month = months[m[2].slice(0, 3).toLowerCase()]
    return month ? makeLocalDate(year, month, +m[1]) : null
  }

  return null
}

function normalizeImportDate(s: string): string | null {
  const value = s.trim()
  if (!value) return null

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if (iso) {
    const d = makeLocalDate(+iso[1], +iso[2], +iso[3])
    return d ? toISODate(d) : null
  }

  const d = parseAirDate(value)
  return d ? toISODate(d) : null
}

function toISODate(d: Date | null) {
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatDate(s: string | null | undefined): string {
  if (!s || s === '—') return '—'
  const d = parseAirDate(s)
  return d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : s
}
function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }
function isDone(ep: Episode) { return ep.status === 1 }
function isOverdue(ep: Episode): boolean {
  if (isDone(ep)) return false
  if (!ep.air_date) return false
  const d = parseAirDate(ep.air_date)
  if (!d) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return d < today
}
function isReplay(title: string) { return title.includes('REPLAY') || title.includes('Second Run') }
function isLive(title: string) { return !isReplay(title) && (title.includes('LIVE') || title.includes('First Run')) }
function showStatus(title: string) {
  if (isLive(title)) return 'live'
  if (isReplay(title)) return 'replay'
  return 'other'
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function DogShowPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const db = useMemo(() => supabase.schema('weekly'), [supabase])

  const [booted, setBooted] = useState(false)
  const [status, setStatus] = useState<'ok' | 'error' | 'waiting'>('waiting')
  const [messages, setMessages] = useState<Message[]>([])
  const [syncTime, setSyncTime] = useState('')

  const [shows, setShows] = useState<Show[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [currentShowTitle, setCurrentShowTitle] = useState<string | null>(null)
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0)
  const [hideEmptyDays, setHideEmptyDays] = useState(false)
  const [episodeFilter, setEpisodeFilter] = useState<'all' | 'done' | 'toair' | 'overdue'>('all')
  const [episodeSearchTerm, setEpisodeSearchTerm] = useState('')
  const [sortField, setSortField] = useState<'air_date' | 'episode_number' | 'status'>('air_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [globalSearch, setGlobalSearch] = useState('')
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null)
  const confirmCbRef = useRef<null | (() => void)>(null)

  const redirectingRef = useRef(false)
  const realtimeRef = useRef<any>(null)

  const showMessage = useCallback((text: string, kind: Message['kind'] = 'info') => {
    const id = generateId()
    setMessages(prev => [...prev, { id, text, kind }])
    setTimeout(() => setMessages(prev => prev.filter(m => m.id !== id)), 3500)
  }, [])

  const markSynced = useCallback(() => {
    setSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
  }, [])

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    router.replace('/login')
  }, [router])

  const loadAllData = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        db.from('dog_show_titles').select('*').order('title', { ascending: true }),
        db.from('dog_show_episodes').select('*').order('air_date', { ascending: true }),
      ])
      if (s.error) throw s.error
      if (e.error) throw e.error
      const showsList = (s.data || []) as Show[]
      setShows(showsList)
      setEpisodes((e.data || []) as Episode[])
      setCurrentShowTitle(prev => {
        if (prev && showsList.some(x => x.title === prev)) return prev
        return showsList[0]?.title ?? null
      })
      markSynced()
    } catch (err: any) {
      console.error('Load failed:', err)
      setStatus('error')
      showMessage('Failed to load: ' + (err?.message || err), 'error')
    }
  }, [db, showMessage, markSynced])

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
        realtimeRef.current = supabase.channel('dog-sync')
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'dog_show_titles' }, () => loadAllData())
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'dog_show_episodes' }, () => loadAllData())
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
    try {
      if (localStorage.getItem('citywork_dog_hide_empty') === '1') setHideEmptyDays(true)
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('citywork_dog_hide_empty', hideEmptyDays ? '1' : '0') } catch {}
  }, [hideEmptyDays])

  const getShowProgress = useCallback((title: string) => {
    const eps = episodes.filter(e => e.show_title === title)
    return { done: eps.filter(isDone).length, total: eps.length }
  }, [episodes])

  const calculateNextAiring = useCallback((title: string): string | null => {
    const eps = episodes.filter(e => e.show_title === title)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const future = eps.filter(e => {
      if (isDone(e)) return false
      const d = parseAirDate(e.air_date)
      if (!d) return false
      d.setHours(0, 0, 0, 0)
      return d >= today
    })
    if (!future.length) return null
    return future.map(e => toISODate(parseAirDate(e.air_date))).sort()[0] || null
  }, [episodes])

  const currentShow = useMemo(
    () => (currentShowTitle ? shows.find(s => s.title === currentShowTitle) || null : null),
    [shows, currentShowTitle]
  )

  const sidebarTabs = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return shows
    return shows.filter(s => s.title.toLowerCase().includes(q) || s.title === currentShowTitle)
  }, [shows, globalSearch, currentShowTitle])

  const currentShowEpisodes = useMemo(() => {
    if (!currentShowTitle) return []
    let list = episodes.filter(e => e.show_title === currentShowTitle)
    if (episodeFilter === 'done') list = list.filter(isDone)
    else if (episodeFilter === 'toair') list = list.filter(e => !isDone(e) && !isOverdue(e))
    else if (episodeFilter === 'overdue') list = list.filter(isOverdue)
    if (episodeSearchTerm) {
      const t = episodeSearchTerm.toLowerCase()
      list = list.filter(e =>
        (e.episode_number || '').toLowerCase().includes(t) ||
        (e.air_date || '').toLowerCase().includes(t)
      )
    }
    list = list.slice().sort((a, b) => {
      let va: any, vb: any
      if (sortField === 'air_date') {
        const da = parseAirDate(a.air_date), dbv = parseAirDate(b.air_date)
        va = da ? da.getTime() : Infinity
        vb = dbv ? dbv.getTime() : Infinity
        if (va !== vb) return sortDir === 'asc' ? va - vb : vb - va
        return 0
      } else if (sortField === 'episode_number') {
        va = a.episode_number || ''; vb = b.episode_number || ''
      } else {
        va = isDone(a) ? 'done' : (isOverdue(a) ? 'overdue' : 'toair')
        vb = isDone(b) ? 'done' : (isOverdue(b) ? 'overdue' : 'toair')
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [episodes, currentShowTitle, episodeFilter, episodeSearchTerm, sortField, sortDir])

  const episodeCounts = useMemo(() => {
    if (!currentShowTitle) return { all: 0, done: 0, toair: 0, overdue: 0 }
    const all = episodes.filter(e => e.show_title === currentShowTitle)
    const done = all.filter(isDone).length
    const overdue = all.filter(isOverdue).length
    return { all: all.length, done, overdue, toair: all.length - done - overdue }
  }, [episodes, currentShowTitle])

  const calendarData = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dow = today.getDay()
    const start = new Date(today)
    start.setDate(today.getDate() - dow + (dow === 0 ? -6 : 1) + calendarWeekOffset * 7)
    const end = new Date(start); end.setDate(start.getDate() + 6)

    const cells = DAYS.map((_, i) => {
      const date = new Date(start); date.setDate(start.getDate() + i)
      const iso = toISODate(date)
      const isToday = date.getTime() === today.getTime()
      const dayEps = episodes.filter(ep => {
        if (!ep.air_date) return false
        const d = parseAirDate(ep.air_date)
        return d && toISODate(d) === iso
      })
      return { idx: i, date, iso, isToday, episodes: dayEps }
    })
    return {
      cells,
      label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    }
  }, [episodes, calendarWeekOffset])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editTarget) { setEditTarget(null); setEditValue('') }
        if (confirmMsg) { setConfirmMsg(null); confirmCbRef.current = null }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search-in-show')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editTarget, confirmMsg])

  async function addNewShow() {
    const name = prompt('Enter Dog Show name (e.g., "All About Dogs (LIVE)"):')
    if (!name || !name.trim()) return
    const clean = name.trim()
    if (shows.some(s => s.title.toLowerCase() === clean.toLowerCase())) {
      showMessage('Show already exists', 'warning'); return
    }
    const { data, error } = await db.from('dog_show_titles').insert({ title: clean }).select().single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setShows(prev => [...prev, data as Show].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })))
    setCurrentShowTitle(clean)
    showMessage('Show created', 'success')
  }

  async function addEpisode() {
    if (!currentShowTitle) return
    const { data, error } = await db.from('dog_show_episodes')
      .insert({ show_title: currentShowTitle, air_date: null, episode_number: null, status: 0 })
      .select().single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setEpisodes(prev => [...prev, data as Episode])
    showMessage('Episode added', 'success')
  }

  async function deleteEpisode(id: number) {
    if (!confirm('Delete this episode?')) return
    const { error } = await db.from('dog_show_episodes').delete().eq('id', id)
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setEpisodes(prev => prev.filter(e => e.id !== id))
  }

  async function toggleStatus(ep: Episode) {
    const next = ep.status === 1 ? 0 : 1
    const { error } = await db.from('dog_show_episodes').update({ status: next }).eq('id', ep.id)
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setEpisodes(prev => prev.map(e => e.id === ep.id ? { ...e, status: next } : e))
  }

  function askConfirm(msg: string, cb: () => void) {
    setConfirmMsg(msg)
    confirmCbRef.current = cb
  }

  async function deleteShow() {
    if (!currentShowTitle) return
    const title = currentShowTitle
    const count = episodes.filter(e => e.show_title === title).length
    askConfirm(
      `Delete "${title}" and all ${count} episode${count === 1 ? '' : 's'}? This cannot be undone.`,
      async () => {
        const [e1, e2] = await Promise.all([
          db.from('dog_show_episodes').delete().eq('show_title', title),
          db.from('dog_show_titles').delete().eq('title', title),
        ])
        if (e1.error) { showMessage('Delete failed: ' + e1.error.message, 'error'); return }
        if (e2.error) { showMessage('Delete failed: ' + e2.error.message, 'error'); return }
        setEpisodes(prev => prev.filter(e => e.show_title !== title))
        setShows(prev => {
          const next = prev.filter(s => s.title !== title)
          setCurrentShowTitle(next[0]?.title ?? null)
          return next
        })
        showMessage(`Deleted "${title}"`, 'warning')
      }
    )
  }

  async function commitEdit() {
    if (!editTarget) return
    const value = editValue.trim()
    try {
      const update: any = { [editTarget.field]: value === '' ? null : value }
      const { error } = await db.from('dog_show_episodes').update(update).eq('id', editTarget.id)
      if (error) throw error
      setEpisodes(prev => prev.map(e => e.id === editTarget.id ? { ...e, [editTarget.field]: update[editTarget.field] } : e))
      showMessage('Saved', 'success')
    } catch (err: any) {
      showMessage('Save failed: ' + (err?.message || err), 'error')
    } finally {
      setEditTarget(null); setEditValue('')
    }
  }

  function exportCSVForShow() {
    if (!currentShowTitle) return
    const eps = episodes.filter(e => e.show_title === currentShowTitle)
    if (!eps.length) { showMessage('No episodes to export', 'warning'); return }
    const headers = ['Air Date', 'Episode Number', 'Status']
    const rows = eps.map(e => {
      const d = parseAirDate(e.air_date)
      return [
        d ? toISODate(d) : (e.air_date || ''),
        e.episode_number || '',
        isDone(e) ? 'Done' : (isOverdue(e) ? 'Overdue' : 'To Air'),
      ]
    })
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentShowTitle.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-episodes-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showMessage(`Exported ${eps.length} episodes`, 'success')
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

  function importCSVForShow() {
    if (!currentShowTitle) return
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
          const hasHeader = first.some(h => ['air date', 'date', 'episode', 'episode number', 'number', 'status'].includes(h))
          const start = hasHeader ? 1 : 0
          let colDate = -1, colNum = -1, colStatus = -1
          if (hasHeader) {
            first.forEach((h, i) => {
              if (h === 'air date' || h === 'date') colDate = i
              else if (h === 'episode' || h === 'episode number' || h === 'number' || h === 'episode #') colNum = i
              else if (h === 'status') colStatus = i
            })
          } else { colDate = 0; colNum = 1; colStatus = 2 }
          if (colDate === -1) throw new Error('No "Date" column')
          if (colNum === -1) throw new Error('No "Episode Number" column')

          const payload: any[] = []
          rows.slice(start).forEach(cols => {
            const rawDate = (colDate >= 0 ? (cols[colDate] || '') : '').trim()
            const num = (colNum >= 0 ? (cols[colNum] || '') : '').trim()
            const statusRaw = (colStatus >= 0 ? (cols[colStatus] || '') : '').trim().toLowerCase()
            if (!rawDate && !num) return

            let storedDate: string | null = null
            if (rawDate) {
              storedDate = normalizeImportDate(rawDate)
              if (!storedDate) throw new Error(`Invalid date: "${rawDate}"`)
            }

            const statusInt = ['done', '1', 'yes', 'true', '✓'].includes(statusRaw) ? 1 : 0
            payload.push({ show_title: currentShowTitle, air_date: storedDate, episode_number: num || null, status: statusInt })
          })
          if (!payload.length) throw new Error('No valid rows')
          const { error } = await db.from('dog_show_episodes').insert(payload)
          if (error) throw error
          await loadAllData()
          showMessage(`Imported ${payload.length} episodes`, 'success')
        } catch (err: any) {
          showMessage('Import failed: ' + (err?.message || err), 'error')
        }
      }
      reader.readAsText(file)
    }
    inp.click()
  }

  const statusClass = status === 'ok' ? 'status-ok' : status === 'error' ? 'status-error' : 'status-waiting'
  const statusDot = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'amber'

  if (!booted) {
    return (
      <div className="dog-root">
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: '#18202F',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#FAF7F2',
        }}>
          <div style={{ textAlign: 'center' }}>
            <i className="ph ph-dog" style={{ fontSize: '2.5rem', color: '#B8734F' }} />
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', letterSpacing: '0.5px', opacity: 0.75 }}>
              LOADING DOG SHOW…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dog-root">
      <div className="app-container">
        <header className="app-header">
          <div className="header-left">
            <span className="brand-icon"><i className="ph-fill ph-buildings" /></span>
            <span className="brand-text"><span className="city">City</span><span className="work">Work</span></span>
            <div className="header-sep" />

            <div className="show-tabs-wrap">
              {sidebarTabs.map(show => (
                <button
                  key={show.id}
                  className={`show-tab ${show.title === currentShowTitle ? 'active' : ''}`}
                  data-status={showStatus(show.title)}
                  data-tip={show.title}
                  onClick={() => setCurrentShowTitle(show.title)}
                  aria-label={`Open ${show.title}`}
                >
                  <i className="ph ph-dog" />
                </button>
              ))}
            </div>

            <div className="show-actions">
              <button className="top-action-btn add-show-btn" onClick={addNewShow}>
                <i className="ph-bold ph-plus" />
                <span>Add?</span>
              </button>

              {currentShowTitle && (
                <button className="top-action-btn delete-show-btn" onClick={deleteShow}>
                  <i className="ph ph-trash" />
                  <span>Delete?</span>
                </button>
              )}
            </div>

            <span className={`status-badge-top ${statusClass}`} style={{ flexShrink: 0 }}>
              <span className={`status-dot ${statusDot}`} />
            </span>
          </div>

          <div className="header-right">
            <span style={{ fontSize: '0.7rem', color: '#68748A', whiteSpace: 'nowrap' }}>
              {syncTime ? `Synced ${syncTime}` : 'Connecting…'}
            </span>
            <a href="/dashboard" className="rail-btn" data-tip="Apps"><i className="ph ph-squares-four" /></a>
            <a href="/classics" className="rail-btn" data-tip="Classics"><i className="ph ph-film-strip" /></a>
            <a href="/concert" className="rail-btn" data-tip="Choice Concert"><i className="ph ph-music-notes" /></a>

            <div className="rail-divider" />

            <div className="search-wrapper">
              <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.9rem', color: '#94a3b8', pointerEvents: 'none' }} />
              <input
                type="text" placeholder="Search shows..." className="search-input"
                value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} autoComplete="off"
              />
              {globalSearch && (
                <span className="search-clear visible" onClick={() => setGlobalSearch('')}>
                  <i className="ph-bold ph-x" />
                </span>
              )}
            </div>
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

            {shows.length === 0 ? (
              <div className="empty-hero">
                <div className="hero-icon"><i className="ph ph-dog" /></div>
                <h2>No dog shows yet</h2>
                <p>Create your first show to start tracking episodes, status, and schedules.</p>
                <button onClick={addNewShow}><i className="ph-bold ph-plus" /> Create Show</button>
              </div>
            ) : (
              <>
                {/* Weekly calendar */}
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
                    <button onClick={() => setCalendarWeekOffset(o => o - 1)}><i className="ph ph-caret-left" /></button>
                    <span>{calendarData.label}</span>
                    <button onClick={() => setCalendarWeekOffset(o => o + 1)}><i className="ph ph-caret-right" /></button>
                  </div>
                  {(() => {
                    const visible = hideEmptyDays ? calendarData.cells.filter(c => c.episodes.length > 0) : calendarData.cells
                    if (hideEmptyDays && visible.length === 0) {
                      return (
                        <div className="calendar-grid compact-empty">
                          <div className="calendar-empty">✨ No episodes scheduled this week</div>
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
                              {cell.episodes.length === 0
                                ? <div className="no-events">No episodes</div>
                                : cell.episodes.map(ep => {
                                    const replay = isReplay(ep.show_title)
                                    const sameShow = ep.show_title === currentShowTitle
                                    return (
                                      <div key={ep.id} className={`cal-event ${replay ? 'replay' : 'live'}`}
                                           onClick={() => setCurrentShowTitle(ep.show_title)}
                                           title={ep.show_title}>
                                        <div className="cal-event-title" style={sameShow ? { textDecoration: 'underline', textDecorationColor: 'rgba(184,115,79,0.4)', textUnderlineOffset: 2 } : undefined}>
                                          {isDone(ep) ? '✓ ' : ''}{ep.episode_number ? `Ep ${ep.episode_number}` : 'Episode'}
                                        </div>
                                        <div className="cal-event-show">🐕 {ep.show_title}</div>
                                      </div>
                                    )
                                  })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                {/* Selected show */}
                {currentShow && (
                  <>
                    <div className="show-view-head">
                      <div>
                        <h2><i className="ph ph-dog" /> {currentShow.title}</h2>
                        <div className="show-view-meta">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <i className="ph ph-calendar-blank" style={{ color: '#B8734F' }} />
                            Next Air: <strong>{calculateNextAiring(currentShow.title) ? formatDate(calculateNextAiring(currentShow.title)) : 'No upcoming'}</strong>
                          </span>
                        </div>
                      </div>
                      <div className="show-view-progress">
                        <span className="progress-count">
                          {getShowProgress(currentShow.title).done}/{getShowProgress(currentShow.title).total}
                        </span>
                        <div className="progress-bar">
                          <div className="progress-fill" style={{
                            width: `${getShowProgress(currentShow.title).total > 0 ? (getShowProgress(currentShow.title).done / getShowProgress(currentShow.title).total) * 100 : 0}%`
                          }} />
                        </div>
                      </div>
                    </div>

                    <div className="section-card">
                      <div className="section-header">
                        <i className="ph ph-list header-icon" />
                        <h3>Episodes</h3>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.6rem', background: '#e2e8f0', padding: '0.15rem 0.6rem', borderRadius: '999px', color: '#68748A' }}>
                          {getShowProgress(currentShow.title).total} total
                        </span>

                        <div className="episode-actions">
                          <button className="btn-csv import" onClick={importCSVForShow} title="Import episodes from CSV">
                            <i className="ph ph-upload-simple" />
                            <span>Import CSV</span>
                          </button>
                          <button className="btn-csv export" onClick={exportCSVForShow} title="Export episodes to CSV">
                            <i className="ph ph-download-simple" />
                            <span>Export CSV</span>
                          </button>
                          <button className="btn-add-episode" onClick={addEpisode}>
                            <i className="ph-bold ph-plus" />
                            <span>Add Episode</span>
                          </button>
                        </div>
                      </div>

                      <div className="episode-filter-bar">
                        <button className={`filter-pill ${episodeFilter === 'all' ? 'active' : ''}`} onClick={() => setEpisodeFilter('all')}>All <span>{episodeCounts.all}</span></button>
                        <button className={`filter-pill ${episodeFilter === 'done' ? 'active' : ''}`} onClick={() => setEpisodeFilter('done')}>Done <span>{episodeCounts.done}</span></button>
                        <button className={`filter-pill ${episodeFilter === 'toair' ? 'active' : ''}`} onClick={() => setEpisodeFilter('toair')}>To Air <span>{episodeCounts.toair}</span></button>
                        <button className={`filter-pill ${episodeFilter === 'overdue' ? 'active' : ''}`} onClick={() => setEpisodeFilter('overdue')}>Overdue <span>{episodeCounts.overdue}</span></button>
                        <input type="text" className="search-in-show" placeholder="Search episodes..."
                          value={episodeSearchTerm} onChange={e => setEpisodeSearchTerm(e.target.value)} />
                      </div>

                      <div className="table-wrap table-scroll-container">
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: '25%', cursor: 'pointer' }}
                                  onClick={() => { if (sortField === 'air_date') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('air_date'); setSortDir('asc') } }}>
                                Air Date <i className={`ph ${sortField === 'air_date' ? (sortDir === 'asc' ? 'ph-sort-ascending' : 'ph-sort-descending') : 'ph-arrows-down-up'}`} />
                              </th>
                              <th style={{ width: '35%', cursor: 'pointer' }}
                                  onClick={() => { if (sortField === 'episode_number') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('episode_number'); setSortDir('asc') } }}>
                                Episode Number <i className={`ph ${sortField === 'episode_number' ? (sortDir === 'asc' ? 'ph-sort-ascending' : 'ph-sort-descending') : 'ph-arrows-down-up'}`} />
                              </th>
                              <th style={{ width: '20%', textAlign: 'center', cursor: 'pointer' }}
                                  onClick={() => { if (sortField === 'status') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('status'); setSortDir('asc') } }}>
                                Status <i className={`ph ${sortField === 'status' ? (sortDir === 'asc' ? 'ph-sort-ascending' : 'ph-sort-descending') : 'ph-arrows-down-up'}`} />
                              </th>
                              <th style={{ width: '20%', textAlign: 'center' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentShowEpisodes.length === 0 ? (
                              <tr><td colSpan={4} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>No episodes match.</td></tr>
                            ) : currentShowEpisodes.map(ep => {
                              const overdue = isOverdue(ep)
                              const done = isDone(ep)
                              const badge = done ? 'badge-done' : (overdue ? 'badge-overdue' : 'badge-toair')
                              const label = done ? 'Done' : (overdue ? 'Overdue' : 'To Air')
                              const editingDate = editTarget?.kind === 'episode' && editTarget.id === ep.id && editTarget.field === 'air_date'
                              const editingNum = editTarget?.kind === 'episode' && editTarget.id === ep.id && editTarget.field === 'episode_number'
                              return (
                                <tr key={ep.id}>
                                  <td className="editable-cell"
                                      onClick={() => {
                                        if (editingDate) return
                                        const d = parseAirDate(ep.air_date)
                                        setEditTarget({ kind: 'episode', id: ep.id, field: 'air_date' })
                                        setEditValue(d ? toISODate(d) : '')
                                      }}>
                                    {editingDate ? (
                                      <input type="date" className="edit-input" value={editValue} autoFocus
                                        onChange={e => setEditValue(e.target.value)}
                                        onBlur={commitEdit}
                                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditTarget(null); setEditValue('') } }} />
                                    ) : (
                                      <>{formatDate(ep.air_date)} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                                    )}
                                  </td>
                                  <td className="editable-cell"
                                      onClick={() => {
                                        if (editingNum) return
                                        setEditTarget({ kind: 'episode', id: ep.id, field: 'episode_number' })
                                        setEditValue(ep.episode_number || '')
                                      }}>
                                    {editingNum ? (
                                      <input type="text" className="edit-input" value={editValue} autoFocus
                                        onChange={e => setEditValue(e.target.value)}
                                        onBlur={commitEdit}
                                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditTarget(null); setEditValue('') } }} />
                                    ) : (
                                      <>{ep.episode_number || '—'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => toggleStatus(ep)}>
                                    <span className={badge}>{label}</span>
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <button className="btn-delete-episode" onClick={() => deleteEpisode(ep.id)} title="Delete episode">
                                      <i className="ph ph-trash" />
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="episode-cards">
                        {currentShowEpisodes.length === 0 ? (
                          <div style={{ padding: '0.75rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>No episodes match.</div>
                        ) : currentShowEpisodes.map(ep => {
                          const overdue = isOverdue(ep)
                          const done = isDone(ep)
                          const badge = done ? 'badge-done' : (overdue ? 'badge-overdue' : 'badge-toair')
                          const label = done ? 'Done' : (overdue ? 'Overdue' : 'To Air')
                          return (
                            <div key={ep.id} className="episode-card">
                              <div className="card-header">
                                <div>
                                  <h4>{ep.episode_number ? `Episode ${ep.episode_number}` : 'Untitled'}</h4>
                                  <div className="date"><i className="ph ph-calendar-blank" /> {formatDate(ep.air_date)}</div>
                                </div>
                                <span className={badge} onClick={() => toggleStatus(ep)} style={{ cursor: 'pointer' }}>{label}</span>
                              </div>
                              <div className="card-actions">
                                <button style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '0.8rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                        onClick={() => deleteEpisode(ep.id)}>
                                  <i className="ph ph-trash" /> Delete
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Confirm modal */}
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
