// Small shared admin primitives. Everything leans on .panel / .btn-* / .chip from
// src/index.css so the three dashboards read as one product.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Channel } from '../../../shared/types'
import { ACCESS_MESSAGE, type AccessProblem, type DataSource } from './useAdminData'
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

/**
 * Shown INSTEAD of data when the failure was about credentials.
 * Deliberately not a quiet footnote: the alternative is a signed-out operator reading
 * fixture numbers as if they were this hotel's real bookings.
 */
export function AccessNotice({ problem }: { problem: AccessProblem }) {
  return (
    <div role="alert" className="panel border-rose-200 bg-rose-50 p-5">
      <h2 className="font-display text-xl text-rose-900">
        {problem === 'expired' ? 'Session expired' : problem === 'forbidden' ? 'Not permitted' : 'Server unavailable'}
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-rose-900">{ACCESS_MESSAGE[problem]}</p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-rose-800">
        Demo fixtures are suppressed on this screen on purpose. Showing you numbers that are not
        this hotel's would be worse than showing you nothing.
      </p>
      {problem === 'expired' ? (
        <Link to="/login" className="btn-primary mt-4 inline-flex">
          Sign in again
        </Link>
      ) : null}
    </div>
  )
}

/**
 * The proposal PDF link is a Supabase Storage URL with an access token in its path,
 * so anyone holding the string can read the document. It is rendered as an action and
 * never as visible text: this page also shows the customer's email and phone, and the
 * whole screen gets projected during the demo.
 */
export function ProposalPdfLink({ pdfPath }: { pdfPath: string | null }) {
  const [copied, setCopied] = useState(false)

  if (!pdfPath) {
    return <span className="text-xs font-normal text-solstice-stone">PDF is generated when this proposal is sent.</span>
  }

  if (!/^https?:\/\//i.test(pdfPath)) {
    // A storage path, not yet a signed URL. Show the filename only; it carries no token.
    const name = pdfPath.split('/').pop() ?? pdfPath
    return <span className="text-xs font-normal text-solstice-stone">Stored as {name}; signed link issued at send.</span>
  }

  const href = pdfPath

  async function copy() {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <span className="flex items-center gap-2">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="chip bg-solstice-sand/60 text-solstice-slate hover:bg-solstice-sand"
      >
        Open PDF
      </a>
      <button type="button" onClick={() => void copy()} className="chip bg-solstice-sand/60 text-solstice-slate hover:bg-solstice-sand">
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <span className="text-[11px] font-normal text-solstice-stone" title="Anyone with this link can open the document">
        link carries an access token
      </span>
    </span>
  )
}

/**
 * A panel that starts collapsed. The inquiry page grew long enough that a rep had to scroll past
 * verdicts and pricing to reach the proposal, so the heavy sections fold away and the summary
 * stays on the header where it can be read without expanding anything.
 *
 * `defaultOpen` is for the section a rep looks at first; everything else earns its space.
 */
export function CollapsiblePanel({
  title,
  summary,
  right,
  defaultOpen = false,
  children,
  className = '',
}: {
  title: ReactNode
  summary?: ReactNode
  right?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:text-solstice-ink"
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 text-solstice-stone transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          >
            <path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{title}</span>
          {summary && !open ? (
            <span className="truncate text-xs font-normal text-solstice-stone">{summary}</span>
          ) : null}
        </button>
        {right ? <span className="flex shrink-0 items-center gap-2">{right}</span> : null}
      </header>
      {open ? children : null}
    </section>
  )
}
