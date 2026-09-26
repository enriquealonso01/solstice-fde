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
    return <div className="grid min-h-screen place-items-center text-solstice-stone">Loading…</div>
  }

  return (
    <div className="grid min-h-screen place-items-center bg-solstice-cream px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link to="/" className="font-display text-4xl tracking-tight text-solstice-ink">
            Solstice<span className="text-solstice-ember">.</span>
          </Link>
          <p className="mt-2 text-sm text-solstice-stone">Staff access</p>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="panel p-6">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-solstice-stone">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-solstice-sand bg-white px-3 py-2 text-sm text-solstice-ink outline-none transition focus:border-solstice-ember focus:ring-1 focus:ring-solstice-ember"
              placeholder="you@solsticehotels.com"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-medium uppercase tracking-wide text-solstice-stone">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-solstice-sand bg-white px-3 py-2 text-sm text-solstice-ink outline-none transition focus:border-solstice-ember focus:ring-1 focus:ring-solstice-ember"
              placeholder="••••••••"
            />
          </label>

          {error ? (
            <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="mt-4 text-center text-xs leading-relaxed text-solstice-stone">
            Access is scoped by role in the database. Concierge supervisors see conversations,
            group sales sees inquiries, and neither can read the other.
          </p>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/" className="text-solstice-stone underline-offset-4 hover:text-solstice-ink hover:underline">
            Back to the hotel site
          </Link>
        </p>
      </div>
    </div>
  )
}
