'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import './dashboard.css'

type User = { id: string; email: string; role: string }
type DynamicPanel = { name: string; icon: string }
type MasterlistItem = { id: string; name: string; description: string; url: string; icon: string }
type CalendarEvent = Record<string, any>

const TABLES = {
  classicEpisodes: 'classic_episodes',
  dogEpisodes: 'dog_show_episodes',
  concertAirings: 'choice_concert_airings',
  profiles: 'profiles',
}

const PANEL_NAMES: Record<string, string> = {
  dashboard: 'Apps',
  masterlist: 'Masterlist',
  commercial: 'Commercial',
  cps: 'CPS',
  weekly: 'Weekly Schedule',
}

const DEFAULT_MASTERLIST: MasterlistItem[] = [
  { id: 'default-1', name: 'LG Masterlist', description: 'Complete database and operational roster for LG.', url: '/lg-masterlist', icon: 'ph-list-checks' },
  { id: 'default-2', name: 'Bravo Masterlist', description: 'Roster, logs, and tracking for Bravo operations.', url: '/bravo-masterlist', icon: 'ph-clipboard-text' },
  { id: 'default-3', name: 'TGIRJ Masterlist', description: 'Master database records for TGIRJ.', url: '/tgirj-masterlist', icon: 'ph-database' },
  { id: 'default-4', name: "Let's Groove", description: 'Music and entertainment records and schedules.', url: '/lets-groove', icon: 'ph-music-notes' },
]

const PANEL_ICONS = ['ph-star','ph-folder','ph-file','ph-chart-bar','ph-users','ph-gear','ph-package','ph-tag','ph-clock','ph-flag','ph-heart','ph-camera']
const MASTERLIST_ICONS = ['ph-folder-open','ph-list-checks','ph-clipboard-text','ph-database','ph-music-notes','ph-users','ph-package','ph-file','ph-chart-bar','ph-gear','ph-tag','ph-star']

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatDateShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function isDone(v: any) {
  return v === true || v === 1 || v === '1' || v === 'true'
}

function DashboardPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const dbMl = useMemo(() => supabase.schema('masterlist'), [supabase])

  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const [currentPanel, setCurrentPanel] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [status, setStatus] = useState<{ text: string; kind: 'waiting' | 'ok' | 'error' }>({ text: 'Connecting', kind: 'waiting' })
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [messages, setMessages] = useState<{ id: string; text: string; kind: 'info' | 'success' | 'error' | 'warning' }[]>([])

  const [dynamicPanels, setDynamicPanels] = useState<DynamicPanel[]>([])
  const [masterlist, setMasterlist] = useState<MasterlistItem[]>([])
  const [classicEvents, setClassicEvents] = useState<CalendarEvent[]>([])
  const [dogEvents, setDogEvents] = useState<CalendarEvent[]>([])
  const [concertEvents, setConcertEvents] = useState<CalendarEvent[]>([])
  const [weekOffset, setWeekOffset] = useState(0)

  const [searchQuery, setSearchQuery] = useState('')

  const [showPanelModal, setShowPanelModal] = useState(false)
  const [panelName, setPanelName] = useState('')
  const [panelIcon, setPanelIcon] = useState('ph-star')

  const [showItemModal, setShowItemModal] = useState(false)
  const [itemName, setItemName] = useState('')
  const [itemDesc, setItemDesc] = useState('')
  const [itemIcon, setItemIcon] = useState('ph-folder-open')

  const redirectingRef = useRef(false)
  const realtimeRef = useRef<any>(null)
  const realtimeTimerRef = useRef<any>(null)

  const showMessage = useCallback((text: string, kind: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const id = generateId()
    setMessages(prev => [...prev, { id, text, kind }])
    setTimeout(() => setMessages(prev => prev.filter(m => m.id !== id)), 6000)
  }, [])

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return
    redirectingRef.current = true
    try { localStorage.removeItem('citywork_user') } catch {}
    router.replace('/login')
  }, [router])

  const loadAllCalendarSources = useCallback(async () => {
    try {
      const [c, d, k] = await Promise.all([
        supabase.schema('weekly').from(TABLES.classicEpisodes).select('show_title, air_date, episode_name, status'),
        supabase.schema('weekly').from(TABLES.dogEpisodes).select('show_title, air_date, episode_number, status'),
        supabase.schema('weekly').from(TABLES.concertAirings).select('concert_title, air_date, episode_title, notes, status'),
      ])
      setClassicEvents(c.data || [])
      setDogEvents(d.data || [])
      setConcertEvents(k.data || [])
      setLastSync(new Date())
    } catch (err) {
      console.warn('Calendar load failed:', err)
    }
  }, [supabase])

  function scheduleRefresh() {
    clearTimeout(realtimeTimerRef.current)
    realtimeTimerRef.current = setTimeout(() => loadAllCalendarSources(), 400)
  }

  function subscribeRealtime() {
    if (realtimeRef.current) {
      try { supabase.removeChannel(realtimeRef.current) } catch {}
    }
    realtimeRef.current = supabase
      .channel('citywork-sync')
      .on('postgres_changes', { event: '*', schema: 'weekly', table: TABLES.classicEpisodes }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'weekly', table: TABLES.dogEpisodes }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'weekly', table: TABLES.concertAirings }, scheduleRefresh)
      .subscribe()
  }

  useEffect(() => {
    let cancelled = false
    let sub: any = null

    ;(async () => {
      try {
        const authSub = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT' || (!session && event === 'TOKEN_REFRESHED')) {
            redirectToLogin()
          }
        })
        sub = authSub.data?.subscription

        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session) { redirectToLogin(); return }

        let authUser = session.user
        const { data: userData, error: userErr } = await supabase.auth.getUser()
        if (userErr) {
          const st = (userErr as any).status || 0
          const isAuthErr = st === 401 || st === 403 || /jwt|token|invalid|expired|not authenticated/i.test(userErr.message || '')
          if (isAuthErr) {
            try { await supabase.auth.signOut() } catch {}
            redirectToLogin(); return
          }
        } else if (userData?.user) {
          authUser = userData.user
        }

        let role = 'user'
        try {
          const { data: profile } = await supabase
            .from(TABLES.profiles)
            .select('role')
            .eq('id', authUser.id)
            .maybeSingle()
          if (profile?.role) role = profile.role
        } catch {}

        if (cancelled) return
        setUser({ id: authUser.id, email: authUser.email ?? '', role })

        try {
          const raw = localStorage.getItem('citywork_dynamic_panels')
          if (raw) setDynamicPanels(JSON.parse(raw))
        } catch {}

        try {
          const { data: rows } = await dbMl
            .from('dashboard_items')
            .select('*')
            .order('position', { ascending: true })
            .order('created_at', { ascending: true })

          if (rows && rows.length > 0) {
            setMasterlist(rows.map((r: any) => ({
              id: r.id,
              name: r.name,
              description: r.description || '',
              url: r.url,
              icon: r.icon || 'ph-folder-open',
            })))
          } else {
            const seeded: any[] = []
            for (let i = 0; i < DEFAULT_MASTERLIST.length; i++) {
              const it = DEFAULT_MASTERLIST[i]
              const { data: ins } = await dbMl.from('dashboard_items').insert({
                name: it.name, description: it.description, url: it.url, icon: it.icon, position: i,
              }).select().single()
              if (ins) seeded.push({
                id: ins.id, name: ins.name, description: ins.description || '',
                url: ins.url, icon: ins.icon || 'ph-folder-open',
              })
            }
            setMasterlist(seeded)
          }
        } catch {
          setMasterlist(DEFAULT_MASTERLIST)
        }

        setStatus({ text: 'Connecting', kind: 'waiting' })
        const { error: probeErr } = await supabase
          .schema('weekly')
          .from(TABLES.classicEpisodes)
          .select('id', { count: 'exact', head: true })

        if (probeErr && !/does not exist|schema cache/i.test(probeErr.message)) {
          setStatus({ text: 'Offline', kind: 'error' })
          showMessage('Supabase connection failed: ' + probeErr.message, 'error')
        } else {
          setStatus({ text: 'Online', kind: 'ok' })
          setLastSync(new Date())
          if (probeErr) showMessage('Connected, but some tables are missing.', 'warning')
          await loadAllCalendarSources()
          subscribeRealtime()
        }

        setBooting(false)
      } catch (err: any) {
        console.error('Boot error:', err)
        if (!cancelled) redirectToLogin()
      }
    })()

    return () => {
      cancelled = true
      try { sub?.unsubscribe?.() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const panel = searchParams.get('panel')
    if (panel && ['dashboard', 'masterlist', 'commercial', 'cps', 'weekly'].includes(panel)) {
      setCurrentPanel(panel)
    }
  }, [searchParams])

  useEffect(() => {
    return () => {
      try { if (realtimeRef.current) supabase.removeChannel(realtimeRef.current) } catch {}
    }
  }, [supabase])

  useEffect(() => {
    try { localStorage.setItem('citywork_dynamic_panels', JSON.stringify(dynamicPanels)) } catch {}
  }, [dynamicPanels])

  async function handleSignOut() {
    if (!confirm('Sign out of City Work?')) return
    try {
      try { if (realtimeRef.current) supabase.removeChannel(realtimeRef.current) } catch {}
      await supabase.auth.signOut()
    } catch {}
    redirectToLogin()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const el = document.getElementById('globalSearchInput') as HTMLInputElement | null
        el?.focus()
      }
      if (e.key === 'Escape') {
        setShowPanelModal(false)
        setShowItemModal(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function handleAddPanel() {
    const n = panelName.trim()
    if (!n) { showMessage('Please enter a panel name', 'error'); return }
    if (dynamicPanels.some(p => p.name.toLowerCase() === n.toLowerCase())) {
      showMessage('A panel with this name already exists', 'error'); return
    }
    const newIndex = dynamicPanels.length
    setDynamicPanels(prev => [...prev, { name: n, icon: panelIcon }])
    setShowPanelModal(false)
    setPanelName('')
    setPanelIcon('ph-star')
    setCurrentPanel(`dynamic_${newIndex}`)
    showMessage(`Panel "${n}" added`, 'success')
  }

  function handleRemovePanel(index: number) {
    const p = dynamicPanels[index]
    if (!p) return
    if (!confirm(`Remove "${p.name}" panel?`)) return
    setDynamicPanels(prev => prev.filter((_, i) => i !== index))
    if (currentPanel === `dynamic_${index}`) setCurrentPanel('dashboard')
    showMessage(`Panel "${p.name}" removed`, 'warning')
  }

  async function handleAddItem() {
    const n = itemName.trim()
    if (!n) { showMessage('Please enter an item name', 'error'); return }

    const { data, error } = await dbMl.rpc('create_masterlist', {
      p_name: n,
      p_description: itemDesc.trim() || 'No description provided.',
      p_icon: itemIcon,
    })

    if (error) {
      showMessage('Failed to create masterlist: ' + error.message, 'error')
      return
    }

    const item = data as {
      id: string
      name: string
      description: string
      url: string
      icon: string
      table_name: string
    }

    const newItem: MasterlistItem = {
      id: item.id,
      name: item.name,
      description: item.description || '',
      url: item.url,
      icon: item.icon || 'ph-folder-open',
    }

    setMasterlist(prev => [...prev, newItem])
    setShowItemModal(false)
    setItemName('')
    setItemDesc('')
    setItemIcon('ph-folder-open')
    showMessage(`"${n}" created`, 'success')
    router.push(item.url)
  }

  async function handleRemoveItem(id: string) {
    const item = masterlist.find(i => i.id === id)
    if (!item) return
    if (!confirm(`Remove "${item.name}"? This will also delete its separate Supabase table and all records.`)) return

    const isDynamic = item.url.startsWith('/masterlist/')

    const result = isDynamic
      ? await dbMl.rpc('delete_masterlist', { p_item_id: id })
      : await dbMl.from('dashboard_items').delete().eq('id', id)

    if (result.error) {
      showMessage('Failed: ' + result.error.message, 'error')
      return
    }

    setMasterlist(prev => prev.filter(i => i.id !== id))
    showMessage(`"${item.name}" removed`, 'warning')
  }

  function getStartOfWeek(offset: number) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dow = today.getDay()
    const start = new Date(today)
    start.setDate(today.getDate() - dow + (dow === 0 ? -6 : 1) + offset * 7)
    return start
  }

  function renderCalendar() {
    const shortDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = getStartOfWeek(weekOffset)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)

    const days: React.ReactElement[] = []

    for (let i = 0; i < 7; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      const iso = toISODate(date)
      const isToday = date.getTime() === today.getTime()

      const classics = classicEvents.filter(e => e.air_date && String(e.air_date).slice(0, 10) === iso)
      const dogs = dogEvents.filter(e => e.air_date && String(e.air_date).slice(0, 10) === iso)
      const concerts = concertEvents.filter(a => a.air_date && String(a.air_date).slice(0, 10) === iso)

      const events: React.ReactElement[] = []

      classics.forEach((ep, idx) => {
        events.push(
          <div key={`c${idx}`} className="cal-event classic" title={`Classic: ${ep.show_title}`}>
            <div className="cal-event-title">{isDone(ep.status) ? '✓ ' : ''}{ep.episode_name || 'Untitled'}</div>
            <div className="cal-event-time">🎬 {ep.show_title}</div>
          </div>
        )
      })

      dogs.forEach((e, idx) => {
        const isReplay = (e.show_title || '').toUpperCase().includes('REPLAY')
        const cls = isReplay ? 'cal-event dog-replay' : 'cal-event dog-live'
        const badge = isReplay ? 'REPLAY' : 'LIVE'
        events.push(
          <div key={`d${idx}`} className={cls} title={`Dog Show: ${e.show_title}`}>
            <div className="cal-event-title">{isDone(e.status) ? '✓ ' : ''}{e.episode_number ? `Ep ${e.episode_number}` : badge}</div>
            <div className="cal-event-time">🐕 {e.show_title || 'Dog Show'} ({badge})</div>
          </div>
        )
      })

      concerts.forEach((a, idx) => {
        events.push(
          <div key={`k${idx}`} className="cal-event concert" title={`Concert: ${a.concert_title}`}>
            <div className="cal-event-title">{a.episode_title || 'Concert'}</div>
            <div className="cal-event-time">🎵 {a.concert_title}</div>
          </div>
        )
      })

      days.push(
        <div key={i} className={`calendar-day ${isToday ? 'today' : ''}`}>
          <div className="day-header">
            <span className="day-name">{shortDays[i]}</span>
            <span className="day-date">{date.getDate()}</span>
          </div>
          <div className="day-body">
            {events.length > 0 ? events : <div className="no-events">No events</div>}
          </div>
        </div>
      )
    }

    return {
      days,
      label: `${formatDateShort(start)} – ${formatDateShort(end)}`,
    }
  }

  const { days: calendarDays, label: weekLabel } = renderCalendar()

  const q = searchQuery.trim().toLowerCase()
  const filteredMasterlist = q
    ? masterlist.filter(i => `${i.name} ${i.description} ${i.url}`.toLowerCase().includes(q))
    : masterlist

  const allPanels = [
    { id: 'dashboard', name: 'Apps', icon: 'ph-squares-four' },
    { id: 'masterlist', name: 'Masterlist', icon: 'ph-folder-open' },
    { id: 'commercial', name: 'Commercial', icon: 'ph-megaphone' },
    { id: 'cps', name: 'CPS', icon: 'ph-shield-check' },
    { id: 'weekly', name: 'Weekly Schedule', icon: 'ph-calendar-dots' },
    ...dynamicPanels.map((p, i) => ({ id: `dynamic_${i}`, name: p.name, icon: p.icon })),
  ]

  const panelTitle = currentPanel.startsWith('dynamic_')
    ? dynamicPanels[parseInt(currentPanel.split('_')[1], 10)]?.name || 'Panel'
    : PANEL_NAMES[currentPanel] || currentPanel

  if (booting) {
    return (
      <div className="dash-loading">
        <span className="brand-icon"><i className="ph-fill ph-buildings" /></span>
        <span className="brand-text">
          <span className="city">City</span>
          <span className="work">Work</span>
        </span>
        <span className="spinner">
          <i className="ph ph-circle-notch" /> Verifying session…
        </span>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="dash-root">
      <div className="app-container">

        <aside className={`sidebar ${sidebarOpen ? 'expanded' : ''}`} role="navigation">
          <div className="sidebar-header">
            <span className="brand-icon"><i className="ph-fill ph-buildings" /></span>
            <span className="brand-text">
              <span className="city">City</span>
              <span className="work">Work</span>
            </span>
          </div>

          <nav className="sidebar-scroll">
            {allPanels.map((p, i) => (
              <React.Fragment key={p.id}>
                <button
                  className={`nav-item ${currentPanel === p.id ? 'active' : ''}`}
                  onClick={() => setCurrentPanel(p.id)}
                  aria-label={p.name}
                >
                  <span className="icon"><i className={`ph ${p.icon}`} /></span>
                  <span className="label">{p.name}</span>
                  <span className="tooltip">{p.name}</span>
                </button>
                {(i === 0 || i === 4) && <div className="sidebar-divider" />}
              </React.Fragment>
            ))}

            <div className="sidebar-divider" />

            <button className="add-panel-btn" onClick={() => setShowPanelModal(true)} aria-label="Add panel">
              <span className="icon"><i className="ph-bold ph-plus" /></span>
              <span className="label">Add Panel</span>
              <span className="tooltip">Add New Panel</span>
            </button>
          </nav>

          <div className="sidebar-footer">
            <div className="user-info">
              <div className="row">
                <i className="ph-fill ph-user-circle" />
                <span className="email">{user.email}</span>
              </div>
              <span className="role">{user.role}</span>
            </div>
            <button className="signout-btn" onClick={handleSignOut} aria-label="Sign out">
              <span className="icon"><i className="ph ph-sign-out" /></span>
              <span className="label">Sign Out</span>
              <span className="tooltip">Sign Out</span>
            </button>
          </div>
        </aside>

        <div className="main-content">
          <header className="app-header">
            <div className="header-left">
              <button className="btn-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">
                <i className="ph ph-list" />
              </button>
              <span className="panel-title">{panelTitle}</span>
              <span className={`status-badge ${status.kind}`}>
                {status.kind === 'waiting' && (
                  <i className="ph ph-circle-notch" style={{ animation: 'ph-spin 1s linear infinite', display: 'inline-block' }} />
                )}
                {status.kind === 'ok' && <i className="ph-fill ph-check-circle" />}
                {status.kind === 'error' && <i className="ph-fill ph-warning-circle" />}
                {' '}{status.text}
              </span>
              <button className="btn-retry" onClick={() => location.reload()} aria-label="Retry">
                <i className="ph ph-arrow-clockwise" />
              </button>
            </div>

            <div className="header-right">
              {currentPanel === 'masterlist' && (
                <button className="btn-add" onClick={() => setShowItemModal(true)} title="Create masterlist">
                  <i className="ph-bold ph-plus" />
                  <span style={{ marginLeft: 6, fontWeight: 200 }}></span>
                </button>
              )}
              <span className="sync-indicator">
                <i className="ph ph-cloud-arrow-up" style={{ marginRight: 4 }} />
                {lastSync
                  ? `Synced ${lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Connecting…'}
              </span>
              <div className="search-wrapper">
                <i className="ph ph-magnifying-glass search-icon" />
                <input
                  id="globalSearchInput"
                  type="text"
                  className="search-input"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  autoComplete="off"
                />
                {searchQuery && (
                  <span className="search-clear visible" onClick={() => setSearchQuery('')}>
                    <i className="ph-bold ph-x" />
                  </span>
                )}
                {q && <span className="search-results-count">{filteredMasterlist.length} results</span>}
                <span className="kbd-hint">⌘K</span>
              </div>
            </div>
          </header>

          <div className="scrollable-content">
            <div className="message-area">
              {messages.map(m => {
                const icon =
                  m.kind === 'success' ? <i className="ph-fill ph-check-circle" style={{ color: '#16a34a' }} />
                  : m.kind === 'error' ? <i className="ph-fill ph-warning-circle" style={{ color: '#dc2626' }} />
                  : m.kind === 'warning' ? <i className="ph-fill ph-warning" style={{ color: '#d97706' }} />
                  : <i className="ph ph-info" />
                return (
                  <div key={m.id} className="message-toast">
                    <span>{icon} {m.text}</span>
                    <button onClick={() => setMessages(prev => prev.filter(x => x.id !== m.id))}>
                      <i className="ph-bold ph-x" />
                    </button>
                  </div>
                )
              })}
            </div>

            {currentPanel === 'dashboard' && (
              <div className="grid-2-3-4">
                {[
                  { id: 'masterlist', label: 'Masterlist', icon: 'ph-clipboard-text' },
                  { id: 'commercial', label: 'Commercial', icon: 'ph-megaphone' },
                  { id: 'cps', label: 'CPS', icon: 'ph-shield-check' },
                  { id: 'weekly', label: 'Weekly', icon: 'ph-calendar-dots' },
                ].map(x => (
                  <button key={x.id} className="quick-link-card" onClick={() => setCurrentPanel(x.id)}>
                    <div className="quick-icon"><i className={`ph ${x.icon}`} /></div>
                    <div className="quick-label">{x.label}</div>
                  </button>
                ))}
              </div>
            )}

            {currentPanel === 'masterlist' && (
              <>
                <div className="grid-masterlist">
                  {filteredMasterlist.map(item => (
                    <a key={item.id} href={item.url} className="masterlist-card">
                      <div className="icon-wrap"><i className={`ph ${item.icon}`} /></div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                      <div className="card-footer">
                        <span>Open <i className="ph ph-arrow-right arrow" /></span>
                        <button
                          className="remove-btn"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); handleRemoveItem(item.id) }}
                          title="Remove"
                        >
                          <i className="ph ph-trash" />
                        </button>
                      </div>
                    </a>
                  ))}
                </div>
                {filteredMasterlist.length === 0 && (
                  <div className="empty-state">
                    <div className="icon"><i className="ph ph-folder-open" /></div>
                    <h3>{q ? 'No matches' : 'No items yet'}</h3>
                    <p>{q ? 'Try a different search.' : 'Click New Masterlist to create your first one.'}</p>
                  </div>
                )}
              </>
            )}

            {currentPanel === 'commercial' && (
              <div className="empty-state">
                <div className="icon"><i className="ph ph-megaphone" /></div>
                <h3>No commercial content</h3>
                <p>Media and advertisements will be listed here.</p>
              </div>
            )}

            {currentPanel === 'cps' && (
              <div className="empty-state">
                <div className="icon"><i className="ph ph-shield-check" /></div>
                <h3>No CPS records</h3>
                <p>Compliance documents will appear here.</p>
              </div>
            )}

            {currentPanel === 'weekly' && (
              <>
                <div className="section-card">
                  <div className="section-header">
                    <i className="ph ph-calendar" style={{ color: '#B8734F', fontSize: '1rem' }} />
                    <h3>Weekly Schedule</h3>
                    <button className="btn-link" onClick={loadAllCalendarSources}>
                      <i className="ph ph-arrows-clockwise" /> Refresh
                    </button>
                  </div>
                  <div className="calendar-nav">
                    <button onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous">
                      <i className="ph ph-caret-left" />
                    </button>
                    <span>{weekLabel}</span>
                    <button onClick={() => setWeekOffset(w => w + 1)} aria-label="Next">
                      <i className="ph ph-caret-right" />
                    </button>
                  </div>
                  <div className="calendar-grid">{calendarDays}</div>
                </div>

                <div className="grid-masterlist" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '1.5rem' }}>
                  <a href="/classics" className="quick-link-card">
                    <div className="quick-icon"><i className="ph ph-film-strip" /></div>
                    <div className="quick-label">Classics</div>
                    <div className="quick-sub">Classic Movies</div>
                  </a>
                  <a href="/dog-show" className="quick-link-card">
                    <div className="quick-icon"><i className="ph ph-dog" /></div>
                    <div className="quick-label">Dog Show</div>
                    <div className="quick-sub">Weekly lineup</div>
                  </a>
                  <a href="/concert" className="quick-link-card">
                    <div className="quick-icon"><i className="ph ph-music-notes" /></div>
                    <div className="quick-label">Choice Concert</div>
                    <div className="quick-sub">Live events</div>
                  </a>
                </div>
              </>
            )}

            {currentPanel.startsWith('dynamic_') && (() => {
              const idx = parseInt(currentPanel.split('_')[1], 10)
              const p = dynamicPanels[idx]
              if (!p) return null
              return (
                <div className="empty-state">
                  <div className="icon"><i className={`ph ${p.icon}`} /></div>
                  <h3>{p.name}</h3>
                  <p>This panel is coming soon.</p>
                  <button
                    onClick={() => handleRemovePanel(idx)}
                    style={{
                      marginTop: '1rem', padding: '0.4rem 1rem',
                      background: '#ef4444', color: 'white', border: 'none',
                      borderRadius: '9999px', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600,
                    }}
                  >
                    <i className="ph ph-trash" /> Remove Panel
                  </button>
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Add Panel Modal */}
      <div className={`modal-overlay ${showPanelModal ? 'open' : ''}`}
        onClick={e => { if (e.target === e.currentTarget) setShowPanelModal(false) }}>
        <div className="modal-card">
          <h3><i className="ph-fill ph-plus-circle" style={{ color: '#B8734F' }} /> Add New Panel</h3>
          <label className="modal-label">PANEL NAME</label>
          <input className="modal-input" value={panelName}
            onChange={e => setPanelName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddPanel(); if (e.key === 'Escape') setShowPanelModal(false) }}
            placeholder="e.g., Inventory, Reports" autoFocus />
          <label className="modal-label">ICON</label>
          <div className="modal-icon-grid">
            {PANEL_ICONS.map(ic => (
              <div key={ic} className={`modal-icon-option ${panelIcon === ic ? 'selected' : ''}`}
                onClick={() => setPanelIcon(ic)}>
                <i className={`ph ${ic}`} />
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn-cancel" onClick={() => setShowPanelModal(false)}>Cancel</button>
            <button className="btn-add" onClick={handleAddPanel}><i className="ph-bold ph-plus" /> Add Panel</button>
          </div>
        </div>
      </div>

      {/* Dynamic Masterlist Builder Modal */}
      <div className={`modal-overlay ${showItemModal ? 'open' : ''}`}
        onClick={e => { if (e.target === e.currentTarget) setShowItemModal(false) }}>
        <div className="modal-card">
          <h3><i className="ph-fill ph-folder-plus" style={{ color: '#B8734F' }} /> Create Masterlist</h3>

          <div style={{
            padding: '0.65rem 0.75rem',
            marginBottom: '1rem',
            borderRadius: '0.65rem',
            background: 'rgba(184,115,79,0.08)',
            border: '1px solid rgba(184,115,79,0.18)',
            color: '#475569',
            fontSize: '0.75rem',
            lineHeight: 1.5
          }}>
            A separate Supabase table will be created automatically. You will add columns and records on the next screen. No URL or new TSX page is needed.
          </div>

          <label className="modal-label">MASTERLIST NAME</label>
          <input className="modal-input" value={itemName}
            onChange={e => setItemName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') setShowItemModal(false) }}
            placeholder="e.g., HR Masterlist" autoFocus />

          <label className="modal-label">DESCRIPTION</label>
          <input className="modal-input" value={itemDesc}
            onChange={e => setItemDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddItem() }}
            placeholder="e.g., Employee records and contacts" />

          <label className="modal-label">ICON</label>
          <div className="modal-icon-grid">
            {MASTERLIST_ICONS.map(ic => (
              <div key={ic} className={`modal-icon-option ${itemIcon === ic ? 'selected' : ''}`}
                onClick={() => setItemIcon(ic)}>
                <i className={`ph ${ic}`} />
              </div>
            ))}
          </div>

          <div className="modal-actions">
            <button className="btn-cancel" onClick={() => setShowItemModal(false)}>Cancel</button>
            <button className="btn-add" onClick={handleAddItem}>
              <i className="ph-bold ph-plus" /> Create Masterlist
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <React.Suspense fallback={null}>
      <DashboardPageInner />
    </React.Suspense>
  )
}
