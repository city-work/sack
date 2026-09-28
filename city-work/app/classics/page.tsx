'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import './classics.css'

type Show = { id: number; title: string; status: string; folder_path: string | null; created_at: string }
type Episode = { id: number; show_title: string; air_date: string | null; episode_name: string | null; status: number }
type ScheduleItem = { id: number; title: string; day: string; time_slot: string }
type Turnover = { id: number; title: string | null; start_date: string | null; end_date: string | null; notes: string | null }
type Message = { id: string; text: string; kind: 'info' | 'success' | 'error' | 'warning' }
type EditTarget =
  | { kind: 'episode'; id: number; field: 'air_date' | 'episode_name' }
  | { kind: 'schedule'; id: number; field: 'day' | 'time_slot' }
  | { kind: 'turnover'; id: number; field: 'title' | 'start_date' | 'end_date' | 'notes' }
  | null

const MONTH_ABBR: Record<string, number> = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 }

function makeLocalDate(year: number, monthIndex: number, day: number): Date | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  const d = new Date(2000, 0, 1)
  d.setHours(0, 0, 0, 0)
  d.setFullYear(year, monthIndex, day)

  // Reject impossible dates instead of letting JS roll them into another month.
  if (d.getFullYear() !== year || d.getMonth() !== monthIndex || d.getDate() !== day) return null
  return d
}

function normalizeImportedDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  if (!s || s === '—') return null

  // ISO date: keep the exact year/month/day from the CSV.
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:$|[T\s])/)
  if (m) {
    const d = makeLocalDate(+m[1], +m[2] - 1, +m[3])
    return d ? `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}` : null
  }

  // US numeric dates: 01/15/2027, 1-15-2027, 1/15/27.
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:$|[\sT])/) 
  if (m) {
    let year = +m[3]
    if (year < 100) year += 2000
    const d = makeLocalDate(year, +m[1] - 1, +m[2])
    return d ? `${year}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : null
  }

  // Day-month-name-year: 15 Jan 2027 / 15-Jan-2027.
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2,4})$/)
  if (m) {
    const mon = MONTH_ABBR[m[2].slice(0, 3).toLowerCase()]
    let year = +m[3]
    if (year < 100) year += 2000
    if (mon !== undefined) {
      const d = makeLocalDate(year, mon, +m[1])
      return d ? `${year}-${String(mon + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}` : null
    }
  }

  // Month-name-day-year: Jan 15, 2027 / January 15 2027.
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})$/)
  if (m) {
    const mon = MONTH_ABBR[m[1].slice(0, 3).toLowerCase()]
    if (mon !== undefined) {
      const d = makeLocalDate(+m[3], mon, +m[2])
      return d ? `${m[3]}-${String(mon + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}` : null
    }
  }

  // Excel/Sheets date serials. 2027 dates are around 46,000+.
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (Number.isFinite(serial)) {
      const excelEpoch = Date.UTC(1899, 11, 30)
      const utc = new Date(excelEpoch + Math.floor(serial) * 86400000)
      return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`
    }
  }

  return null
}

function parseAirDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr === '—') return null
  const s = String(dateStr).trim()
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/)
  if (m) return makeLocalDate(+m[1], +m[2] - 1, +m[3])

  // US numeric dates, e.g. 01/15/2027 or 1-15-2027.
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (m) {
    let year = +m[3]
    if (year < 100) year += 2000
    return makeLocalDate(year, +m[1] - 1, +m[2])
  }

  // Text dates, e.g. 15 Jan 2027 or 15-Jan-27.
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})(?:[\s-]+(\d{2,4}))?$/)
  if (m) {
    const day = +m[1]
    const mon = MONTH_ABBR[m[2].slice(0, 3).toLowerCase()]
    let year = m[3] ? +m[3] : new Date().getFullYear()
    if (year < 100) year += 2000
    if (mon !== undefined) return makeLocalDate(year, mon, day)
  }

  // Text dates, e.g. Jan 15, 2027 or January 15 2027.
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})$/)
  if (m) {
    const mon = MONTH_ABBR[m[1].slice(0, 3).toLowerCase()]
    if (mon !== undefined) return makeLocalDate(+m[3], mon, +m[2])
  }

  return null
}

function toISODate(d: Date | null) {
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr === '—') return '—'
  const d = parseAirDate(dateStr)
  if (!d) return dateStr
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatDateShort(dateStr: string | null | undefined): string {
  const d = parseAirDate(dateStr)
  if (!d) return dateStr || ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
function getShowIcon(title: string): string {
  const icons: Record<string, string> = {
    'CHARLIE CHAPLIN': 'ph-magic-wand',
    'I MARRIED JOAN': 'ph-diamond',
    'JOHNNY STACCATO': 'ph-microphone',
    "LI'L HITLER": 'ph-mask-happy',
    'POPEYE CLASSIC': 'ph-anchor',
    "WHAT'S MY LINE GAME SHOW": 'ph-game-controller',
  }
  return icons[title] || 'ph-television'
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function ClassicsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const db = useMemo(() => supabase.schema('weekly'), [supabase])

  const [booted, setBooted] = useState(false)
  const [status, setStatus] = useState<'ok' | 'error' | 'waiting'>('waiting')
  const [messages, setMessages] = useState<Message[]>([])
  const [syncTime, setSyncTime] = useState('')

  const [shows, setShows] = useState<Show[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [schedule, setSchedule] = useState<ScheduleItem[]>([])
  const [turnovers, setTurnovers] = useState<Turnover[]>([])

  const [currentView, setCurrentView] = useState<'overview' | 'show'>('overview')
  const [currentShowTitle, setCurrentShowTitle] = useState<string | null>(null)
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0)
  const [hideFinished, setHideFinished] = useState(false)
  const [hideEmptyDays, setHideEmptyDays] = useState(false)
  const [episodeFilter, setEpisodeFilter] = useState<'all' | 'done' | 'toair' | 'overdue'>('all')
  const [episodeSearchTerm, setEpisodeSearchTerm] = useState('')
  const [sortField, setSortField] = useState<'air_date' | 'episode_name' | 'status'>('air_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [globalSearch, setGlobalSearch] = useState('')

  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [editValue, setEditValue] = useState('')

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
      const [s, e, sc, t] = await Promise.all([
        db.from('classic_titles').select('*').order('title', { ascending: true }),
        db.from('classic_episodes').select('*').order('air_date', { ascending: true }),
        db.from('classic_schedule').select('*').order('day', { ascending: true }),
        db.from('classic_turnovers').select('*').order('start_date', { ascending: true }),
      ])
      if (s.error) throw s.error
      if (e.error) throw e.error
      if (sc.error) throw sc.error
      if (t.error) throw t.error
      setShows((s.data || []) as Show[])
      setEpisodes((e.data || []) as Episode[])
      setSchedule((sc.data || []) as ScheduleItem[])
      setTurnovers((t.data || []) as Turnover[])
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
        realtimeRef.current = supabase.channel('classics-sync')
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'classic_titles' }, () => loadAllData())
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'classic_episodes' }, () => loadAllData())
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'classic_schedule' }, () => loadAllData())
          .on('postgres_changes', { event: '*', schema: 'weekly', table: 'classic_turnovers' }, () => loadAllData())
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
      const saved = localStorage.getItem('citywork_classics_hide_empty')
      if (saved === '1') setHideEmptyDays(true)
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('citywork_classics_hide_empty', hideEmptyDays ? '1' : '0') } catch {}
  }, [hideEmptyDays])

  const currentShow = useMemo(
    () => (currentShowTitle ? shows.find(s => s.title === currentShowTitle) || null : null),
    [shows, currentShowTitle]
  )

  const getShowProgress = useCallback((title: string) => {
    const eps = episodes.filter(e => e.show_title === title)
    const done = eps.filter(isDone).length
    return { done, total: eps.length }
  }, [episodes])

  const isShowFinished = useCallback((title: string) => {
    const { done, total } = getShowProgress(title)
    return total > 0 && done === total
  }, [getShowProgress])

  const calculateAvailableUntil = useCallback((title: string): string | null => {
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
    return future.map(e => toISODate(parseAirDate(e.air_date))).sort().pop() || null
  }, [episodes])

  const filteredShows = useMemo(() => {
    if (!hideFinished) return shows
    return shows.filter(s => !isShowFinished(s.title))
  }, [shows, hideFinished, isShowFinished])

  const sidebarShows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return filteredShows
    return filteredShows.filter(s => s.title.toLowerCase().includes(q))
  }, [filteredShows, globalSearch])

  const currentShowEpisodes = useMemo(() => {
    if (!currentShowTitle) return []
    let list = episodes.filter(e => e.show_title === currentShowTitle)
    if (episodeFilter === 'done') list = list.filter(isDone)
    else if (episodeFilter === 'toair') list = list.filter(e => !isDone(e) && !isOverdue(e))
    else if (episodeFilter === 'overdue') list = list.filter(isOverdue)
    if (episodeSearchTerm) {
      const t = episodeSearchTerm.toLowerCase()
      list = list.filter(e =>
        (e.episode_name || '').toLowerCase().includes(t) ||
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
      } else if (sortField === 'episode_name') {
        va = a.episode_name || ''
        vb = b.episode_name || ''
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

  const overviewStats = useMemo(() => {
    let nextExpire: string | null = null
    let nextShow: string | null = null
    filteredShows.forEach(s => {
      const d = calculateAvailableUntil(s.title)
      if (d && (!nextExpire || d < nextExpire)) { nextExpire = d; nextShow = s.title }
    })
    return { totalShows: filteredShows.length, nextExpire, nextShow }
  }, [filteredShows, calculateAvailableUntil])

  async function addNewShow() {
    const name = prompt('Enter show name:')
    if (!name || !name.trim()) return
    const clean = name.trim()
    if (shows.some(s => s.title.toLowerCase() === clean.toLowerCase())) {
      showMessage('Show already exists', 'warning'); return
    }
    const { data, error } = await db.from('classic_titles')
      .insert({ title: clean, status: 'Active' })
      .select()
      .single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setShows(prev => [...prev, data as Show].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })))
    showMessage('Show added', 'success')
    setCurrentView('show')
    setCurrentShowTitle(clean)
  }

  async function deleteShow(show: Show) {
    const title = show.title
    if (!confirm(`Delete "${title}" and all of its episodes, schedule items, and turnovers?`)) return

    try {
      // Remove dependent rows first so this works even without ON DELETE CASCADE.
      const [episodesResult, scheduleResult, turnoversResult] = await Promise.all([
        db.from('classic_episodes').delete().eq('show_title', title),
        db.from('classic_schedule').delete().eq('title', title),
        db.from('classic_turnovers').delete().eq('title', title),
      ])

      const dependencyError = episodesResult.error || scheduleResult.error || turnoversResult.error
      if (dependencyError) throw dependencyError

      const { error } = await db.from('classic_titles').delete().eq('id', show.id)
      if (error) throw error

      setShows(prev => prev.filter(s => s.id !== show.id))
      setEpisodes(prev => prev.filter(e => e.show_title !== title))
      setSchedule(prev => prev.filter(item => item.title !== title))
      setTurnovers(prev => prev.filter(t => t.title !== title))

      setCurrentShowTitle(null)
      setCurrentView('overview')
      showMessage(`Deleted show: ${title}`, 'success')
    } catch (err: any) {
      showMessage('Delete show failed: ' + (err?.message || err), 'error')
    }
  }

  async function addEpisode() {
    if (!currentShowTitle) return
    const { data, error } = await db.from('classic_episodes')
      .insert({ show_title: currentShowTitle, air_date: null, episode_name: 'New Episode', status: 0 })
      .select()
      .single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setEpisodes(prev => [...prev, data as Episode])
    showMessage('Episode added', 'success')
  }

  async function deleteEpisode(id: number) {
    if (!confirm('Delete this episode?')) return
    const { error } = await db.from('classic_episodes').delete().eq('id', id)
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setEpisodes(prev => prev.filter(e => e.id !== id))
    showMessage('Episode deleted', 'success')
  }

  async function toggleStatus(ep: Episode) {
    const next = ep.status === 1 ? 0 : 1
    const { error } = await db.from('classic_episodes').update({ status: next }).eq('id', ep.id)
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setEpisodes(prev => prev.map(e => e.id === ep.id ? { ...e, status: next } : e))
  }

  async function addScheduleItem() {
    if (!currentShowTitle) return
    const { data, error } = await db.from('classic_schedule')
      .insert({ title: currentShowTitle, day: 'Monday', time_slot: '' })
      .select()
      .single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setSchedule(prev => [...prev, data as ScheduleItem])
    showMessage('Schedule item added', 'success')
  }

  async function deleteScheduleItem(id: number) {
    if (!confirm('Delete this schedule item?')) return
    const { error } = await db.from('classic_schedule').delete().eq('id', id)
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setSchedule(prev => prev.filter(s => s.id !== id))
    showMessage('Deleted', 'success')
  }

  async function addTurnover() {
    if (!currentShowTitle) return
    const { data, error } = await db.from('classic_turnovers')
      .insert({ title: currentShowTitle, start_date: null, end_date: null, notes: '' })
      .select()
      .single()
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setTurnovers(prev => [...prev, data as Turnover])
    showMessage('Turnover added', 'success')
  }

  async function deleteTurnover(id: number) {
    if (!confirm('Delete this turnover?')) return
    const { error } = await db.from('classic_turnovers').delete().eq('id', id)
    if (error) { showMessage('Failed: ' + error.message, 'error'); return }
    setTurnovers(prev => prev.filter(t => t.id !== id))
    showMessage('Deleted', 'success')
  }

  async function commitEdit() {
    if (!editTarget) return
    const value = editValue.trim()
    try {
      if (editTarget.kind === 'episode') {
        const { id, field } = editTarget
        const update: any = { [field]: value === '' ? null : value }
        const { error } = await db.from('classic_episodes').update(update).eq('id', id)
        if (error) throw error
        setEpisodes(prev => prev.map(e => e.id === id ? { ...e, [field]: update[field] } : e))
      } else if (editTarget.kind === 'schedule') {
        const { id, field } = editTarget
        const update: any = { [field]: value === '' ? null : value }
        const { error } = await db.from('classic_schedule').update(update).eq('id', id)
        if (error) throw error
        setSchedule(prev => prev.map(s => s.id === id ? { ...s, [field]: update[field] } : s))
      } else if (editTarget.kind === 'turnover') {
        const { id, field } = editTarget
        const update: any = { [field]: value === '' ? null : value }
        const { error } = await db.from('classic_turnovers').update(update).eq('id', id)
        if (error) throw error
        setTurnovers(prev => prev.map(t => t.id === id ? { ...t, [field]: update[field] } : t))
      }
      showMessage('Saved', 'success')
    } catch (err: any) {
      showMessage('Save failed: ' + (err?.message || err), 'error')
    } finally {
      setEditTarget(null); setEditValue('')
    }
  }

  function cancelEdit() { setEditTarget(null); setEditValue('') }

  function exportCSVForShow() {
    if (!currentShowTitle) return
    const eps = episodes.filter(e => e.show_title === currentShowTitle)
    if (!eps.length) { showMessage('No episodes to export', 'warning'); return }
    const headers = ['Air Date', 'Episode', 'Status']
    const rows = eps.map(e => {
      const d = parseAirDate(e.air_date)
      return [
        d ? toISODate(d) : (e.air_date || ''),
        e.episode_name || '',
        isDone(e) ? 'Done' : (isOverdue(e) ? 'Overdue' : 'To Air'),
      ]
    })
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safe = currentShowTitle.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
    a.download = `${safe}-episodes-${new Date().toISOString().split('T')[0]}.csv`
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
          const hasHeader = first.some(h => ['air date', 'date', 'episode', 'status', 'show'].includes(h))
          const start = hasHeader ? 1 : 0
          let colDate = -1, colEpisode = -1, colStatus = -1
          if (hasHeader) {
            first.forEach((h, i) => {
              if (h === 'air date' || h === 'date') colDate = i
              else if (h === 'episode' || h === 'episode name' || h === 'title') colEpisode = i
              else if (h === 'status') colStatus = i
            })
          } else { colDate = 0; colEpisode = 1; colStatus = 2 }
          if (colEpisode === -1) throw new Error('No "Episode" column found')

          const dataRows = rows.slice(start)
          const payload: any[] = []
          dataRows.forEach(cols => {
            const epName = (colEpisode >= 0 ? (cols[colEpisode] || '') : '').trim()
            if (!epName) return
            const rawDate = (colDate >= 0 ? (cols[colDate] || '') : '').trim()
            const statusRaw = (colStatus >= 0 ? (cols[colStatus] || '') : '').trim().toLowerCase()
            const storedDate = rawDate ? normalizeImportedDate(rawDate) : null
            if (rawDate && !storedDate) {
              throw new Error(`Could not parse air date: "${rawDate}"`)
            }
            const statusInt = (['done', '1', 'yes', 'true'].includes(statusRaw)) ? 1 : 0
            payload.push({ show_title: currentShowTitle, air_date: storedDate || null, episode_name: epName, status: statusInt })
          })
          if (!payload.length) throw new Error('No valid rows')

          const { error } = await db.from('classic_episodes').insert(payload)
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

  function getStartOfWeek(offset: number) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dow = today.getDay()
    const start = new Date(today)
    start.setDate(today.getDate() - dow + (dow === 0 ? -6 : 1) + offset * 7)
    return start
  }

  const calendarData = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const start = getStartOfWeek(calendarWeekOffset)
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
      label: `${formatDateShort(toISODate(start))} – ${formatDateShort(toISODate(end))}`,
    }
  }, [episodes, calendarWeekOffset])

  const showSchedule = useMemo(() => {
    if (!currentShowTitle) return []
    return schedule.filter(s => (s.title || '').toLowerCase() === currentShowTitle.toLowerCase())
  }, [schedule, currentShowTitle])

  const showTurnovers = useMemo(() => {
    if (!currentShowTitle) return []
    return turnovers.filter(t => (t.title || '').toLowerCase() === currentShowTitle.toLowerCase())
  }, [turnovers, currentShowTitle])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && editTarget) cancelEdit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editTarget])

  const statusClass = status === 'ok' ? 'status-ok' : status === 'error' ? 'status-error' : 'status-waiting'
  const statusDot = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'amber'

  if (!booted) {
    return (
      <div className="classics-root">
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: '#18202F',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#FAF7F2',
        }}>
          <div style={{ textAlign: 'center' }}>
            <i className="ph ph-film-strip" style={{ fontSize: '2.5rem', color: '#B8734F' }} />
            <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', letterSpacing: '0.5px', opacity: 0.75 }}>
              LOADING CLASSIC MOVIES…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="classics-root">
      <div className="app-container">
        <aside className="sidebar">
          <div className="brand-container">
            <span className="brand-icon"><i className="ph-fill ph-buildings" /></span>
            <span className="brand-text">
              <span className="city">City</span><span className="work">Work</span>
            </span>
          </div>
          <nav className="sidebar-scroll">
            <button
              className={`sidebar-item ${currentView === 'overview' ? 'active' : ''}`}
              onClick={() => { setCurrentView('overview'); setCurrentShowTitle(null) }}
            >
              <span className="icon"><i className="ph ph-squares-four" /></span>
              <span className="label">Overview</span>
              <span className="tooltip">Overview</span>
            </button>
            <div className="sidebar-divider" />
            {sidebarShows.length === 0 ? (
              <div style={{ color: '#68748A', fontSize: '0.65rem', padding: '0.3rem 0.5rem', textAlign: 'center' }}>—</div>
            ) : sidebarShows.map(show => (
              <button
                key={show.id}
                className={`sidebar-item ${currentView === 'show' && currentShowTitle === show.title ? 'active' : ''}`}
                onClick={() => { setCurrentView('show'); setCurrentShowTitle(show.title) }}
              >
                <span className="icon"><i className={`ph ${getShowIcon(show.title)}`} /></span>
                <span className="label">{show.title}</span>
                <span className="tooltip">{show.title}</span>
              </button>
            ))}
            <div className="sidebar-divider" />
            <button className="sidebar-item" onClick={addNewShow} style={{ color: '#22c55e' }}>
              <span className="icon"><i className="ph-bold ph-plus" /></span>
              <span className="label">Add New Show</span>
              <span className="tooltip">Add New Show</span>
            </button>
          </nav>
        </aside>

        <div className="main-content">
          <header>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', minWidth: 0 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#18202F', whiteSpace: 'nowrap' }}>
                {currentView === 'overview' ? 'Classic Movies' : currentShowTitle}
              </span>
              <span className={`status-badge-top ${statusClass}`}>
                <span className={`status-dot ${statusDot}`} />
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: '#68748A', whiteSpace: 'nowrap' }}>
                <i className="ph ph-cloud-arrow-up" style={{ marginRight: 4 }} />
                {syncTime ? `Synced ${syncTime}` : 'Connecting…'}
              </span>

              <a href="/dashboard" className="rail-btn" data-tip="Apps"><i className="ph ph-squares-four" /></a>
              <a href="/dog-show" className="rail-btn" data-tip="Dog Show"><i className="ph ph-dog" /></a>
              <a href="/concert" className="rail-btn" data-tip="Choice Concert"><i className="ph ph-music-notes" /></a>
              <a href="/dashboard?panel=weekly" className="rail-btn" data-tip="Weekly Schedule"><i className="ph ph-calendar-dots" /></a>

              <div className="rail-divider" />

              <div className="search-wrapper">
                <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.9rem', color: '#94a3b8', pointerEvents: 'none' }} />
                <input
                  type="text"
                  placeholder="Search shows..."
                  className="search-input"
                  value={globalSearch}
                  onChange={e => setGlobalSearch(e.target.value)}
                  autoComplete="off"
                />
                {globalSearch && (
                  <span className="search-clear visible" onClick={() => setGlobalSearch('')}>
                    <i className="ph-bold ph-x" />
                  </span>
                )}
              </div>

              <div className="rail-divider" />

              <button className="btn-icon reload" onClick={() => loadAllData()} title="Reload">
                <i className="ph ph-arrow-clockwise" />
              </button>
            </div>
          </header>

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

            {currentView === 'overview' && (
              <div className="fade-in">
                <div className="stats-stacked">
                  <div className="stat-row">
                    <span className="stat-label"><i className="ph ph-film-strip text-copper" /> Total Shows</span>
                    <span className="stat-value">{overviewStats.totalShows}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label"><i className="ph ph-clock text-copper" /> Next Expiration</span>
                    <span className="stat-value">
                      {overviewStats.nextExpire && overviewStats.nextShow
                        ? `${overviewStats.nextShow} — ${formatDate(overviewStats.nextExpire)}`
                        : '—'}
                    </span>
                  </div>
                </div>

                <div className="section-card">
                  <div className="section-header">
                    <i className="ph ph-calendar-blank header-icon" />
                    <h3>Weekly Schedule</h3>
                    <label className={`hide-empty-wrapper ${hideEmptyDays ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={hideEmptyDays}
                        onChange={e => setHideEmptyDays(e.target.checked)}
                      />
                      <span>Hide empty days</span>
                    </label>
                  </div>
                  <div className="calendar-nav">
                    <button onClick={() => setCalendarWeekOffset(o => o - 1)}><i className="ph ph-caret-left" /></button>
                    <span>{calendarData.label}</span>
                    <button onClick={() => setCalendarWeekOffset(o => o + 1)}><i className="ph ph-caret-right" /></button>
                  </div>
                  {(() => {
                    const visible = hideEmptyDays
                      ? calendarData.cells.filter(c => c.episodes.length > 0)
                      : calendarData.cells
                    if (hideEmptyDays && visible.length === 0) {
                      return (
                        <div className={`calendar-grid compact-empty`}>
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
                                : cell.episodes.map(ep => (
                                    <div key={ep.id} className="cal-event">
                                      <div className="cal-event-title">{ep.episode_name || 'Untitled'}</div>
                                      <div className="cal-event-show">🎬 {ep.show_title}</div>
                                    </div>
                                  ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                <div className="section-card" style={{ overflow: 'hidden' }}>
                  <div className="two-col-grid">
                    <div className="col-titles">
                      <div className="section-header" style={{ borderRadius: 0, borderBottom: '1px solid rgba(24,32,47,0.08)' }}>
                        <i className="ph ph-list header-icon" />
                        <h3>Titles</h3>
                        <div className="hide-finished-wrapper">
                          <label htmlFor="hideFinishedToggle">Hide Finished</label>
                          <input
                            id="hideFinishedToggle"
                            type="checkbox"
                            checked={hideFinished}
                            onChange={e => setHideFinished(e.target.checked)}
                          />
                        </div>
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: '42%' }}>Title</th>
                              <th style={{ width: '33%' }}>Available Until</th>
                              <th style={{ width: '25%', textAlign: 'right' }}>Progress</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredShows.length === 0 ? (
                              <tr><td colSpan={3} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>No titles yet.</td></tr>
                            ) : filteredShows.map(show => {
                              const available = calculateAvailableUntil(show.title)
                              const { done, total } = getShowProgress(show.title)
                              const isComplete = total > 0 && done === total
                              return (
                                <tr key={show.id} onClick={() => { setCurrentView('show'); setCurrentShowTitle(show.title) }}>
                                  <td style={{ fontWeight: 700 }}>{show.title}</td>
                                  <td>{available ? formatDate(available) : '—'}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 600 }}
                                      className={isComplete ? 'progress-complete' : 'progress-incomplete'}>
                                    {done}/{total}{isComplete ? ' ✓' : ''}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="col-schedule">
                      <div className="section-header" style={{ borderRadius: 0, borderBottom: '1px solid rgba(24,32,47,0.08)' }}>
                        <i className="ph ph-calendar-blank header-icon" />
                        <h3>Schedule</h3>
                      </div>
                      <div className="schedule-compact">
                        {schedule.length === 0 ? (
                          <div className="no-schedule">No schedule items</div>
                        ) : schedule.map(item => (
                          <div key={item.id} className="schedule-item">
                            <span className="schedule-day">{item.day || '—'}</span>
                            <span className="schedule-time">{item.time_slot || '—'}</span>
                            <span className="schedule-title" title={item.title || ''}>{item.title || ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="section-card">
                  <div className="section-header">
                    <i className="ph ph-note header-icon" />
                    <h3>Turnovers</h3>
                  </div>
                  {turnovers.length === 0 ? (
                    <div style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>No turnovers</div>
                  ) : turnovers.map((t, i) => (
                    <React.Fragment key={t.id}>
                      {i > 0 && <hr className="turnover-divider" />}
                      <div className="turnover-item">
                        <div className="turnover-title">{t.title || 'Untitled'}</div>
                        <div style={{ fontSize: '0.8rem' }}>
                          {t.start_date ? formatDate(t.start_date) : '—'} — {t.end_date ? formatDate(t.end_date) : '—'}
                          {t.notes && <span style={{ color: '#18202F', marginLeft: '0.5rem' }}>{t.notes}</span>}
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {currentView === 'show' && currentShow && (
              <div className="fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#18202F', letterSpacing: '-0.02em', margin: 0 }}>
                      {currentShow.title}
                    </h1>
                    <p style={{ fontSize: '0.75rem', color: '#68748A', marginTop: '0.15rem' }}>
                      <i className="ph ph-calendar-blank" style={{ color: '#B8734F' }} /> Available Until:{' '}
                      <strong>{calculateAvailableUntil(currentShow.title) ? formatDate(calculateAvailableUntil(currentShow.title)) : 'No upcoming episodes'}</strong>
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={() => deleteShow(currentShow)}
                      title="Delete Show"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        border: '1px solid #fecaca', borderRadius: '0.5rem',
                        background: '#fff7f7', color: '#b91c1c',
                        padding: '0.4rem 0.65rem', cursor: 'pointer',
                        fontSize: '0.7rem', fontWeight: 700,
                      }}
                    >
                      <i className="ph ph-trash" /> Delete Show
                    </button>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#68748A' }}>
                      {getShowProgress(currentShow.title).done}/{getShowProgress(currentShow.title).total}
                    </span>
                    <div style={{ width: '120px', height: '6px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${getShowProgress(currentShow.title).total > 0 ? (getShowProgress(currentShow.title).done / getShowProgress(currentShow.title).total) * 100 : 0}%`,
                        background: 'linear-gradient(90deg, #B8734F, #22c55e)',
                        borderRadius: '999px',
                        transition: 'width 0.6s ease',
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
                    <button className="btn-csv import" onClick={importCSVForShow} style={{ marginLeft: 'auto' }}>
                      <i className="ph ph-upload-simple" /> Import
                    </button>
                    <button className="btn-csv" onClick={exportCSVForShow}>
                      <i className="ph ph-download-simple" /> Export
                    </button>
                    <button className="btn-add-episode" onClick={addEpisode}>
                      <i className="ph-bold ph-plus" /> Add Episode
                    </button>
                  </div>
                  <div className="episode-filter-bar">
                    <button className={`filter-pill ${episodeFilter === 'all' ? 'active' : ''}`} onClick={() => setEpisodeFilter('all')}>
                      All <span>{episodeCounts.all}</span>
                    </button>
                    <button className={`filter-pill ${episodeFilter === 'done' ? 'active' : ''}`} onClick={() => setEpisodeFilter('done')}>
                      Done <span>{episodeCounts.done}</span>
                    </button>
                    <button className={`filter-pill ${episodeFilter === 'toair' ? 'active' : ''}`} onClick={() => setEpisodeFilter('toair')}>
                      To Air <span>{episodeCounts.toair}</span>
                    </button>
                    <button className={`filter-pill ${episodeFilter === 'overdue' ? 'active' : ''}`} onClick={() => setEpisodeFilter('overdue')}>
                      Overdue <span>{episodeCounts.overdue}</span>
                    </button>
                    <input
                      type="text"
                      className="search-in-show"
                      placeholder="Search episodes..."
                      value={episodeSearchTerm}
                      onChange={e => setEpisodeSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="table-wrap table-scroll-container">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '25%', cursor: 'pointer' }}
                              onClick={() => { if (sortField === 'air_date') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('air_date'); setSortDir('asc') } }}>
                            Air Date <i className={`ph ${sortField === 'air_date' ? (sortDir === 'asc' ? 'ph-sort-ascending' : 'ph-sort-descending') : 'ph-arrows-down-up'}`} />
                          </th>
                          <th style={{ width: '50%', cursor: 'pointer' }}
                              onClick={() => { if (sortField === 'episode_name') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('episode_name'); setSortDir('asc') } }}>
                            Episode <i className={`ph ${sortField === 'episode_name' ? (sortDir === 'asc' ? 'ph-sort-ascending' : 'ph-sort-descending') : 'ph-arrows-down-up'}`} />
                          </th>
                          <th style={{ width: '15%', textAlign: 'center', cursor: 'pointer' }}
                              onClick={() => { if (sortField === 'status') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField('status'); setSortDir('asc') } }}>
                            Status <i className={`ph ${sortField === 'status' ? (sortDir === 'asc' ? 'ph-sort-ascending' : 'ph-sort-descending') : 'ph-arrows-down-up'}`} />
                          </th>
                          <th style={{ width: '10%', textAlign: 'center' }}>Action</th>
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
                          const editingName = editTarget?.kind === 'episode' && editTarget.id === ep.id && editTarget.field === 'episode_name'
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
                                  <input
                                    type="date"
                                    className="edit-input"
                                    value={editValue}
                                    autoFocus
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={commitEdit}
                                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                                  />
                                ) : (
                                  <>{formatDate(ep.air_date)} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                                )}
                              </td>
                              <td className="editable-cell episode-title"
                                  title={ep.episode_name || ''}
                                  onClick={() => {
                                    if (editingName) return
                                    setEditTarget({ kind: 'episode', id: ep.id, field: 'episode_name' })
                                    setEditValue(ep.episode_name || '')
                                  }}>
                                {editingName ? (
                                  <input
                                    type="text"
                                    className="edit-input"
                                    value={editValue}
                                    autoFocus
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={commitEdit}
                                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                                  />
                                ) : (
                                  <>{ep.episode_name || '—'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                                )}
                              </td>
                              <td style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => toggleStatus(ep)}>
                                <span className={badge}>{label}</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button className="btn-delete-episode" onClick={() => deleteEpisode(ep.id)} title="Delete">
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
                              <h4 title={ep.episode_name || ''}>{ep.episode_name || 'Untitled'}</h4>
                              <div className="date">📅 {formatDate(ep.air_date)}</div>
                            </div>
                            <span className={badge}>{label}</span>
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

                <div className="section-card">
                  <div className="section-header">
                    <i className="ph ph-calendar-blank header-icon" />
                    <h3>Schedule</h3>
                    <span style={{ fontSize: '0.55rem', fontWeight: 400, color: '#94a3b8', marginLeft: '0.5rem' }}>(click day/time to edit)</span>
                    <button className="btn-add-episode" onClick={addScheduleItem} style={{ marginLeft: 'auto' }}>
                      <i className="ph-bold ph-plus" /> Add Schedule
                    </button>
                  </div>
                  {showSchedule.length === 0 ? (
                    <div style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>No schedule items</div>
                  ) : showSchedule.map(item => {
                    const editingDay = editTarget?.kind === 'schedule' && editTarget.id === item.id && editTarget.field === 'day'
                    const editingTime = editTarget?.kind === 'schedule' && editTarget.id === item.id && editTarget.field === 'time_slot'
                    return (
                      <div key={item.id} style={{ borderBottom: '1px solid rgba(24,32,47,0.06)', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 1rem' }}>
                        <span className="editable-cell" style={{ cursor: 'pointer', minWidth: 90 }}
                              onClick={() => { if (editingDay) return; setEditTarget({ kind: 'schedule', id: item.id, field: 'day' }); setEditValue(item.day || 'Monday') }}>
                          {editingDay ? (
                            <select className="edit-input" value={editValue} autoFocus
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={commitEdit}
                                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}>
                              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          ) : (
                            <>{item.day || '—'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                          )}
                        </span>
                        <span className="editable-cell" style={{ cursor: 'pointer', minWidth: 130 }}
                              onClick={() => { if (editingTime) return; setEditTarget({ kind: 'schedule', id: item.id, field: 'time_slot' }); setEditValue(item.time_slot || '') }}>
                          {editingTime ? (
                            <input type="text" className="edit-input" value={editValue} autoFocus
                                   placeholder="e.g., 4:00PM - 4:30PM"
                                   onChange={e => setEditValue(e.target.value)}
                                   onBlur={commitEdit}
                                   onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }} />
                          ) : (
                            <>{item.time_slot || '—'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                          )}
                        </span>
                        <span style={{ flex: 1, fontSize: '0.7rem', color: '#68748A' }}>{item.title || ''}</span>
                        <button className="btn-delete-episode" onClick={() => deleteScheduleItem(item.id)} style={{ marginLeft: 'auto' }}>
                          <i className="ph ph-trash" />
                        </button>
                      </div>
                    )
                  })}
                </div>

                <div className="section-card">
                  <div className="section-header">
                    <i className="ph ph-note header-icon" />
                    <h3>Turnovers</h3>
                    <span style={{ fontSize: '0.55rem', fontWeight: 400, color: '#94a3b8', marginLeft: '0.5rem' }}>(click to edit)</span>
                    <button className="btn-add-episode" onClick={addTurnover} style={{ marginLeft: 'auto' }}>
                      <i className="ph-bold ph-plus" /> Add Turnover
                    </button>
                  </div>
                  {showTurnovers.length === 0 ? (
                    <div style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>No turnovers</div>
                  ) : showTurnovers.map((t, i) => (
                    <React.Fragment key={t.id}>
                      {i > 0 && <hr className="turnover-divider" />}
                      <div className="turnover-item">
                        <div className="turnover-title editable-cell" style={{ cursor: 'pointer' }}
                             onClick={() => {
                               if (editTarget?.kind === 'turnover' && editTarget.id === t.id && editTarget.field === 'title') return
                               setEditTarget({ kind: 'turnover', id: t.id, field: 'title' })
                               setEditValue(t.title || '')
                             }}>
                          {editTarget?.kind === 'turnover' && editTarget.id === t.id && editTarget.field === 'title' ? (
                            <input type="text" className="edit-input" value={editValue} autoFocus
                                   onChange={e => setEditValue(e.target.value)}
                                   onBlur={commitEdit}
                                   onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }} />
                          ) : (
                            <>{t.title || '—'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                          <span className="editable-cell" style={{ cursor: 'pointer', fontSize: '0.8rem' }}
                                onClick={() => {
                                  const d = parseAirDate(t.start_date)
                                  setEditTarget({ kind: 'turnover', id: t.id, field: 'start_date' })
                                  setEditValue(d ? toISODate(d) : '')
                                }}>
                            {editTarget?.kind === 'turnover' && editTarget.id === t.id && editTarget.field === 'start_date' ? (
                              <input type="date" className="edit-input" value={editValue} autoFocus
                                     onChange={e => setEditValue(e.target.value)}
                                     onBlur={commitEdit}
                                     onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }} />
                            ) : (
                              <>📅 {t.start_date ? formatDate(t.start_date) : '—'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                            )}
                          </span>
                          <span style={{ color: '#94a3b8' }}>—</span>
                          <span className="editable-cell" style={{ cursor: 'pointer', fontSize: '0.8rem' }}
                                onClick={() => {
                                  const d = parseAirDate(t.end_date)
                                  setEditTarget({ kind: 'turnover', id: t.id, field: 'end_date' })
                                  setEditValue(d ? toISODate(d) : '')
                                }}>
                            {editTarget?.kind === 'turnover' && editTarget.id === t.id && editTarget.field === 'end_date' ? (
                              <input type="date" className="edit-input" value={editValue} autoFocus
                                     onChange={e => setEditValue(e.target.value)}
                                     onBlur={commitEdit}
                                     onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }} />
                            ) : (
                              <>📅 {t.end_date ? formatDate(t.end_date) : '—'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                            )}
                          </span>
                          <span className="editable-cell" style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#68748A', marginLeft: 'auto' }}
                                onClick={() => {
                                  setEditTarget({ kind: 'turnover', id: t.id, field: 'notes' })
                                  setEditValue(t.notes || '')
                                }}>
                            {editTarget?.kind === 'turnover' && editTarget.id === t.id && editTarget.field === 'notes' ? (
                              <input type="text" className="edit-input" value={editValue} autoFocus
                                     placeholder="Add note..."
                                     onChange={e => setEditValue(e.target.value)}
                                     onBlur={commitEdit}
                                     onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }} />
                            ) : (
                              <>{t.notes || '+ note'} <span className="edit-icon"><i className="ph ph-pencil-simple" /></span></>
                            )}
                          </span>
                          <button className="btn-delete-episode" onClick={() => deleteTurnover(t.id)} title="Delete">
                            <i className="ph ph-trash" />
                          </button>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}