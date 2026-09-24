// Small shared admin primitives. Everything leans on .panel / .btn-* / .chip from
// src/index.css so the three dashboards read as one product.

import type { ReactNode } from 'react'
import type { Channel } from '../../../shared/types'
import type { DataSource } from './useAdminData'
import type { SessionStatus } from './mockData'

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>
}

export function PanelHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <header className="panel-header flex items-center justify-between gap-3">
      <span>{title}</span>
      {right ? <span className="flex items-center gap-2">{right}</span> : null}
    </header>
  )
}

/** Tells the operator whether they are looking at the database or at fixtures. */
export function SourceChip({ source }: { source: DataSource }) {
  return source === 'live' ? (
    <span className="chip bg-emerald-50 text-emerald-800" title="Reading the Supabase tables">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Live
    </span>
  ) : (
    <span className="chip bg-amber-50 text-amber-800" title="Backend not seeded yet; showing demo fixtures">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Demo data
    </span>
  )
}

export function ChannelChip({ channel }: { channel: Channel }) {
  return channel === 'voice' ? (
    <span className="chip bg-solstice-ember/10 text-solstice-ember">Voice</span>
  ) : (
    <span className="chip bg-sky-50 text-sky-800">Chat</span>
  )
}

export function SessionStatusChip({ status }: { status: SessionStatus }) {
  const map: Record<SessionStatus, { cls: string; label: string }> = {
    active: { cls: 'bg-emerald-50 text-emerald-800', label: 'Active' },
    taken_over: { cls: 'bg-solstice-gold/20 text-solstice-ink', label: 'Human in control' },
    ended: { cls: 'bg-solstice-sand/60 text-solstice-stone', label: 'Ended' },
  }
  const s = map[status]
  return <span className={`chip ${s.cls}`}>{s.label}</span>
}

export function VerdictChip({ status }: { status: 'pass' | 'flag' | 'fail' }) {
  const map = {
    pass: { cls: 'bg-emerald-50 text-emerald-800', label: 'Pass' },
    flag: { cls: 'bg-amber-50 text-amber-900', label: 'Flag' },
    fail: { cls: 'bg-rose-50 text-rose-800', label: 'Fail' },
  } as const
  const s = map[status]
  return <span className={`chip ${s.cls}`}>{s.label}</span>
}

export function SeverityChip({ severity }: { severity: 'clear' | 'flag' | 'fail' }) {
  const map = {
    clear: { cls: 'bg-emerald-50 text-emerald-800', label: 'Within rules' },
    flag: { cls: 'bg-amber-50 text-amber-900', label: 'Needs decision' },
    fail: { cls: 'bg-rose-50 text-rose-800', label: 'Outside rules' },
  } as const
  const s = map[severity]
  return <span className={`chip ${s.cls}`}>{s.label}</span>
}

export function ProposalStatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-solstice-sand/60 text-solstice-slate',
    awaiting_approval: 'bg-amber-50 text-amber-900',
    approved: 'bg-sky-50 text-sky-800',
    sent: 'bg-emerald-50 text-emerald-800',
    rejected: 'bg-rose-50 text-rose-800',
  }
  return <span className={`chip ${map[status] ?? 'bg-solstice-sand/60 text-solstice-slate'}`}>{status.replace(/_/g, ' ')}</span>
}

/** grounded:false is the single most important thing on the trace. Make it loud. */
export function GroundedChip({ grounded }: { grounded: boolean | null }) {
  if (grounded === null) return <span className="chip bg-solstice-sand/60 text-solstice-stone">unknown</span>
  return grounded ? (
    <span className="chip bg-emerald-50 text-emerald-800">grounded</span>
  ) : (
    <span className="chip bg-rose-50 text-rose-800" title="Tool could not ground its answer; the agent must escalate, not improvise">
      not grounded
    </span>
  )
}

export function SourceBadge({ source }: { source: 'portal' | 'voice' | 'manual' }) {
  const map = {
    portal: 'bg-sky-50 text-sky-800',
    voice: 'bg-solstice-ember/10 text-solstice-ember',
    manual: 'bg-solstice-sand/60 text-solstice-slate',
  } as const
  return <span className={`chip ${map[source]}`}>{source}</span>
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-solstice-stone">{label}</dt>
      <dd className="mt-0.5 text-sm text-solstice-ink">{value ?? '—'}</dd>
    </div>
  )
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-solstice-stone">{label}</div>
      <div className="mt-1 font-display text-3xl leading-none text-solstice-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-solstice-stone">{hint}</div> : null}
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-xl text-solstice-slate">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-sm text-sm text-solstice-stone">{body}</p> : null}
    </div>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Live read failed, showing demo fixtures. {message}
    </p>
  )
}
