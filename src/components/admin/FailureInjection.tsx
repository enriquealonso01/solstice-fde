// Take a dependency offline, live, in front of an audience.
//
// The brief asks how the system degrades when something upstream fails. Everyone answers that
// with a box on a diagram. This answers it by doing it: flip the PMS off, ask Sol for a late
// checkout, and watch it decline to confirm what it can no longer verify.
//
// Deliberately loud. A switch that silently stays on after a demo would make a healthy system
// look broken to the next person who opens the app.
import { useCallback, useEffect, useState } from 'react'
import { CollapsiblePanel, EmptyState } from './ui'
import { accessToken } from './useAdminData'

interface Flag {
  key: string
  enabled: boolean
  note: string | null
  updated_by: string | null
  updated_at: string | null
  spoken_reason: string | null
}

const LABEL: Record<string, string> = {
  pms_offline: 'Property management system',
  reservations_offline: 'Central reservations',
  policy_source_offline: 'Policy reference',
}

const AFFECTS: Record<string, string> = {
  pms_offline: 'Late checkout, upgrades, amenity requests',
  reservations_offline: 'Guest identification, reading a booking',
  policy_source_offline: 'Any policy answer, service recovery, comp authority',
}

export default function FailureInjection() {
  const [flags, setFlags] = useState<Flag[] | null>(null)
  const [canChange, setCanChange] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const token = await accessToken()
      const res = await fetch('/api/flags', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const body = await res.json()
      if (!res.ok || !body.ok) return setError(body.error ?? `Request failed (${res.status})`)
      setFlags(body.flags)
      setCanChange(body.can_change)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read system switches.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(key: string, enabled: boolean) {
    setBusy(key)
    try {
      const token = await accessToken()
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ key, enabled }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) setError(body.error ?? 'That switch could not be changed.')
      else setError(null)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const active = (flags ?? []).filter((f) => f.enabled)

  return (
    <CollapsiblePanel
      className="mt-4"
      title="Failure injection"
      summary={active.length ? `${active.length} dependency offline` : 'all dependencies healthy'}
      defaultOpen={active.length > 0}
      right={
        active.length ? (
          <span className="chip bg-rose-100 text-rose-900">live outage simulated</span>
        ) : (
          <span className="chip bg-emerald-50 text-emerald-800">healthy</span>
        )
      }
    >
      {error ? (
        <EmptyState title="Cannot read system switches" body={error} />
      ) : !flags ? (
        <EmptyState title="Loading…" />
      ) : (
        <>
          <p className="px-5 pt-4 text-sm leading-relaxed text-solstice-slate">
            Switch a dependency off and the tools that need it start refusing, in exactly the shape a real
            outage produces: ungrounded, with a reason Sol says out loud. Nothing is faked downstream, which is
            the point. Tools that do not need the dependency keep working.
          </p>
          <ul className="divide-y divide-solstice-sand/60 p-2">
            {flags.map((f) => (
              <li key={f.key} className="flex items-start gap-4 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-solstice-ink">{LABEL[f.key] ?? f.key}</span>
                    {f.enabled ? (
                      <span className="chip bg-rose-100 text-rose-900">offline</span>
                    ) : (
                      <span className="chip bg-emerald-50 text-emerald-800">healthy</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-solstice-stone">Affects: {AFFECTS[f.key] ?? '—'}</p>
                  {f.enabled && f.spoken_reason ? (
                    <p className="mt-1.5 text-xs italic leading-relaxed text-rose-900">"{f.spoken_reason}"</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={!canChange || busy === f.key}
                  onClick={() => void toggle(f.key, !f.enabled)}
                  title={canChange ? undefined : 'Administrators only'}
                  className={f.enabled ? 'btn-ghost shrink-0' : 'btn-primary shrink-0'}
                >
                  {busy === f.key ? 'Working…' : f.enabled ? 'Bring back online' : 'Take offline'}
                </button>
              </li>
            ))}
          </ul>
          <p className="px-5 pb-4 text-xs leading-relaxed text-solstice-stone">
            Changes take effect within about three seconds, everywhere, without a redeploy. Switches read from
            the database rather than the environment for exactly that reason.
          </p>
        </>
      )}
    </CollapsiblePanel>
  )
}
