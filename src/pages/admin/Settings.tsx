// Super-admin settings, in plain English.
//
// Enrique: "set the phone number that Sol forwards the call to when the user asks for a
// supervisor or front desk... set the users and their permissions... and also show options to
// stop the systems like we already have somewhere in the backend page."
//
// Three sections, each answering one of those:
//   1. Transfer number — the `app_settings` row escalation reads FIRST (env vars stay as the
//      fallback). Changing it here takes effect on the next call; no redeploy.
//   2. People — `profiles.role`. The roles are the hotel's own vocabulary (see ROLE_LABEL);
//      RLS, not this page, is what actually enforces them.
//   3. Stop switches — the existing `demo_flags` controls live on the "How it works" page
//      (FailureInjection). They are surfaced here as a link, not duplicated: one switch must
//      have one home.
//
// The language on this page is written for a hotel operator, not for an engineer: the labels
// name what the thing does, never the function or table that does it.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from '@/components/admin/AdminShell'
import { ConfirmDialog } from '@/components/admin/ui'
import { accessToken, postJson } from '@/components/admin/useAdminData'

interface SettingsPayload {
  ok: boolean
  can_change: boolean
  forward: {
    value: string | null
    source: 'database' | 'environment'
    env_fallback: 'set' | 'demo_fallback' | 'none'
    updated_by: string | null
    updated_at: string | null
  }
  users: { id: string; email: string; full_name: string | null; role: string }[]
  error?: string
}

/** Plain-English role names. The values are the database's `staff_role` enum. */
const ROLE_LABEL: Record<string, string> = {
  concierge: 'Supervisor (front desk)',
  group_sales: 'Sales — basic',
  gm: 'Sales — manager approval',
  admin: 'Super admin',
}

const ROLE_ORDER = ['concierge', 'group_sales', 'gm', 'admin']

export default function SettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ userId: string; name: string; role: string } | null>(null)

  const load = useCallback(async () => {
    setFailure(null)
    // GET with the caller's token, same shape FailureInjection uses for /api/flags: a structured
    // failure the page can show, never a thrown error an operator has to interpret.
    try {
      const token = await accessToken()
      const res = await fetch('/api/settings', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const body = (await res.json()) as SettingsPayload
      if (!res.ok || !body.ok) {
        setFailure(body.error ?? `Could not load the settings (${res.status}).`)
        return
      }
      setData(body)
      setPhoneDraft(body.forward.value ?? '')
    } catch {
      setFailure('Could not reach the server to load the settings.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const savePhone = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await postJson<{ ok: boolean; effect?: string; error?: string }>('/api/settings', {
      key: 'supervisor_forward_phone',
      value: phoneDraft,
    })
    setBusy(false)
    if (!res.ok || !res.data?.ok) {
      setError(res.data?.error ?? res.error ?? 'The number was not saved.')
      return
    }
    setNotice(res.data.effect ?? 'Saved.')
    await load()
  }

  const changeRole = async (userId: string, name: string, role: string) => {
    setConfirm(null)
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await postJson<{ ok: boolean; effect?: string; error?: string }>('/api/settings', {
      key: 'user_role',
      user_id: userId,
      role,
    })
    setBusy(false)
    if (!res.ok || !res.data?.ok) {
      setError(res.data?.error ?? res.error ?? 'The role was not changed.')
      return
    }
    setNotice(`${name}: ${res.data.effect ?? 'role updated.'}`)
    await load()
  }

  const canChange = data?.can_change === true

  return (
    <AdminShell title="Settings" subtitle="Who Sol calls, who can do what, and how to stop things.">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {failure ? (
          <section className="panel">
            <p className="text-sm text-warn">{failure}</p>
          </section>
        ) : null}

        {/* 1 — the number a supervisor call is handed to */}
        <section className="panel">
          <header className="panel-header">
            <h2 className="text-base font-medium">Who answers when a guest asks for a person</h2>
          </header>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-faint">
              When a guest on a phone call asks for a supervisor or the front desk, Sol hands the call to this
              number. Changing it takes effect from the next call — nothing needs to be rebuilt.
            </p>
            {canChange ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder="+1 305 555 0100"
                  aria-label="Front desk phone number"
                  className="input flex-1"
                />
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void savePhone()}>
                  {busy ? 'Saving…' : 'Save number'}
                </button>
              </div>
            ) : (
              <p className="text-sm">{data?.forward.value ? maskPhone(data.forward.value) : 'Not set — the number built into the deploy is used.'}</p>
            )}
            <p className="text-xs text-faint">
              {data?.forward.source === 'database'
                ? `Set by ${data.forward.updated_by ?? 'an administrator'}.`
                : 'Using the number set when the site was deployed.'}
            </p>
            {notice ? <p className="text-sm text-good" role="status">{notice}</p> : null}
            {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
          </div>
        </section>

        {/* 2 — people and what they can do */}
        <section className="panel">
          <header className="panel-header">
            <h2 className="text-base font-medium">People and what they can do</h2>
          </header>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-faint">
              Each person on the team has one role. It decides which parts of this site they can open and what
              they can change.
            </p>
            {data?.users.length ? (
              <ul className="flex flex-col divide-y">
                {data.users.map((u) => (
                  <li key={u.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{u.full_name || u.email}</p>
                      <p className="truncate text-xs text-faint">{u.full_name ? u.email : null}</p>
                    </div>
                    {canChange ? (
                      <select
                        value={u.role}
                        aria-label={`Role for ${u.full_name || u.email}`}
                        disabled={busy}
                        onChange={(e) => setConfirm({ userId: u.id, name: u.full_name || u.email, role: e.target.value })}
                        className="input sm:w-56"
                      >
                        {ROLE_ORDER.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm">{ROLE_LABEL[u.role] ?? u.role}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">No one is listed yet.</p>
            )}
          </div>
        </section>

        {/* 3 — stopping the systems (existing controls, one home) */}
        <section className="panel">
          <header className="panel-header">
            <h2 className="text-base font-medium">Stopping the systems</h2>
          </header>
          <div className="flex flex-col gap-2 p-4">
            <p className="text-sm text-faint">
              The switches that take a system offline — for a demo, or when something upstream breaks — live on
              the &ldquo;How it works&rdquo; page, so there is exactly one place that changes them.
            </p>
            <Link to="/admin/backend" className="btn btn-secondary self-start">
              Open the system switches
            </Link>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title="Change this person's role?"
        body={
          confirm ? (
            <p>
              {confirm.name} will become <strong>{ROLE_LABEL[confirm.role]}</strong>. It takes effect the next
              time they sign in.
            </p>
          ) : null
        }
        confirmLabel="Change role"
        onConfirm={() => confirm && void changeRole(confirm.userId, confirm.name, confirm.role)}
        onCancel={() => setConfirm(null)}
      />
    </AdminShell>
  )
}

/** Reads as a person's number, not a database value: keep the last four visible. */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length > 4 ? `••• ••• ${digits.slice(-4)}` : value
}
