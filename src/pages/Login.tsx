// Staff sign-in. Three roles, three landing surfaces.
// The route guard and this redirect are both cosmetic: RLS decides what the
// account can actually read, so a wrong guess here leaks nothing.

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, getMyRole } from '@/lib/supabase'
import type { StaffRole } from '../../shared/types'

const LANDING: Record<StaffRole, string> = {
  concierge: '/admin/sessions',
  group_sales: '/admin/inquiries',
  gm: '/admin/inquiries',
  admin: '/admin',
}

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Already signed in with a role? Skip the form.
  useEffect(() => {
    let alive = true
    void getMyRole()
      .then((role) => {
        if (!alive) return
        if (role) navigate(LANDING[role], { replace: true })
        else setChecking(false)
      })
      .catch(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [navigate])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        setError(signInError.message)
        return
      }
      const role = await getMyRole()
      if (!role) {
        setError('This account has no staff role yet. Ask a Solstice administrator to grant one.')
        await supabase.auth.signOut()
        return
      }
      navigate(LANDING[role], { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link to="/" className="font-display text-4xl tracking-tight text-ink">
            Solstice<span className="text-accent">.</span>
          </Link>
          <p className="mt-2 text-sm text-muted">Staff access</p>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="panel p-6">
          <label className="block">
            <span className="eyebrow">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="you@solsticehotels.com"
            />
          </label>

          <label className="mt-4 block">
            <span className="eyebrow">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="••••••••"
            />
          </label>

          {error ? (
            <p role="alert" className="mt-4 rounded-xl border border-bad-ring bg-bad-soft px-3 py-2 text-sm text-bad">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted">
            Every person signs in here — concierge supervisors, group sales, managers. Each sees
            only the parts of the hotel that are theirs to answer.
          </p>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/" className="text-muted underline-offset-4 hover:text-ink hover:underline">
            Back to the hotel site
          </Link>
        </p>
      </div>
    </div>
  )
}
