'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; kind: 'error' | 'success' } | null>(null)
  const [done, setDone] = useState<{ title: string; body: string } | null>(null)

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const passwordOk = password.length >= 6

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setFeedback(null)
    const emailVal = email.trim()
    if (!emailVal || !password) {
      setFeedback({ text: 'Enter your email and password.', kind: 'error' })
      return
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: emailVal, password })
        if (error) throw error
        if (data.session) {
          setDone({ title: 'Account created', body: 'Taking you to your dashboard…' })
          setTimeout(() => { router.push('/dashboard'); router.refresh() }, 1200)
        } else {
          setFeedback({ text: 'Check your email to confirm your account.', kind: 'success' })
          setMode('login')
          setPassword('')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: emailVal, password })
        if (error) throw error
        const handle = emailVal.split('@')[0]
        setDone({ title: `Welcome back, ${handle}`, body: 'Taking you to your dashboard…' })
        setTimeout(() => { router.push('/dashboard'); router.refresh() }, 1200)
      }
    } catch (err: any) {
      const msg: string = err?.message ?? 'Something went wrong.'
      let friendly = msg
      if (msg.includes('Email not confirmed')) friendly = 'Please confirm your email first.'
      else if (msg.includes('Invalid login credentials')) friendly = 'Incorrect email or password.'
      else if (msg.toLowerCase().includes('rate limit')) friendly = 'Too many attempts. Wait a moment.'
      else if (msg.includes('User already registered')) friendly = 'That email is already registered.'
      setFeedback({ text: friendly, kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function handleForgot() {
    const emailVal = email.trim()
    if (!emailVal) {
      setFeedback({ text: 'Enter your email first.', kind: 'error' })
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(emailVal, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    if (error) setFeedback({ text: error.message, kind: 'error' })
    else setFeedback({ text: 'Password reset link sent to your inbox.', kind: 'success' })
  }

  return (
    <>
      <div className="bg" aria-hidden="true" />

      <button
        type="button"
        className={`trigger ${open ? 'away' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open login"
      >
        <span>Log In</span>
        <i className="ph-bold ph-arrow-up" aria-hidden="true" />
      </button>

      <div
        className={`overlay ${open ? 'on' : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <div
        className={`sheet ${open ? 'on' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheetTitle"
      >
        <button
          type="button"
          className="close"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <i className="ph-bold ph-x" aria-hidden="true" />
        </button>

        {done ? (
          <div className="success-state">
            <div className="success-circle">
              <i className="ph-fill ph-check-circle" />
            </div>
            <h2>{done.title}</h2>
            <p>{done.body}</p>
          </div>
        ) : (
          <>
            <h1 id="sheetTitle" className="title">
              {mode === 'signup' ? 'Create account' : 'Welcome back'}
            </h1>

            <form onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label className="field-label" htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setFeedback(null) }}
                />
                {email.length > 0 && (
                  <i className={`ph field-icon show ${emailOk ? 'ph-check-circle ok' : 'ph-x-circle bad'}`} />
                )}
              </div>

              <div className="field has-toggle">
                <label className="field-label" htmlFor="password">Password</label>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFeedback(null) }}
                />
                <button
                  type="button"
                  className="field-toggle"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(v => !v)}
                >
                  <i className={showPassword ? 'ph ph-eye-slash' : 'ph ph-eye'} />
                </button>
                {password.length > 0 && (
                  <i className={`ph field-icon show ${passwordOk ? 'ph-check-circle ok' : 'ph-x-circle bad'}`} />
                )}
              </div>

              <div className="row">
                <label className="remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Remember me
                </label>
                {mode === 'login' && (
                  <button type="button" className="link" onClick={handleForgot}>
                    Forgot password?
                  </button>
                )}
              </div>

              <button type="submit" className="submit" disabled={busy}>
                <span>
                  {busy
                    ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
                    : (mode === 'signup' ? 'Create account' : 'Sign in')}
                </span>
                {busy
                  ? <i className="ph ph-circle-notch spin" />
                  : <i className="ph-bold ph-arrow-right" />}
              </button>

              {feedback && (
                <div className={`feedback ${feedback.kind}`} role="alert">
                  <i className={feedback.kind === 'success' ? 'ph-fill ph-check-circle' : 'ph-fill ph-warning-circle'} />
                  <span>{feedback.text}</span>
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </>
  )
}