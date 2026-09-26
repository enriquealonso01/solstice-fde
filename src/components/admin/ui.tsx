// Small shared admin primitives. Everything leans on .panel / .btn-* / .chip from
// src/index.css so all surfaces read as one product, and on the CSS-variable
// palette (tailwind.config.js) so light and dark come from the same tokens.

import { useEffect, useState, type ReactNode } from 'react'
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

/* ------------------------------------------------------------------ *
 * Icon set — inline SVG, 1.75 stroke, no icon library.
 * ------------------------------------------------------------------ */

type IconProps = { className?: string }

function Icon({ children, className = 'h-4 w-4' }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

export const Icons = {
  sun: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  ),
  moon: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </Icon>
  ),
  chat: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.3-.7L3 21l1.8-5.7a8.4 8.4 0 1 1 16.2-3.8Z" />
    </Icon>
  ),
  inbox: (p: IconProps) => (
    <Icon {...p}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" />
    </Icon>
  ),
  home: (p: IconProps) => (
    <Icon {...p}>
      <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M9 22V12h6v10" />
    </Icon>
  ),
  map: (p: IconProps) => (
    <Icon {...p}>
      <path d="m9 3-6 2v16l6-2 6 2 6-2V3l-6 2-6-2Zm0 0v16m6-14v16" />
    </Icon>
  ),
  coins: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="9" cy="8" r="6" />
      <path d="M18.1 8.9A6 6 0 0 1 15 19.7M7 14.1A6 6 0 1 0 17 18" />
    </Icon>
  ),
  takeOver: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3v10m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  ),
  handBack: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 21V11m0 0 4 4m-4-4-4 4" />
      <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
    </Icon>
  ),
  signOut: (p: IconProps) => (
    <Icon {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5m5 5H9" />
    </Icon>
  ),
  search: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  ),
  file: (p: IconProps) => (
    <Icon {...p}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h6" />
    </Icon>
  ),
  mic: (p: IconProps) => (
    <Icon {...p}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
    </Icon>
  ),
  send: (p: IconProps) => (
    <Icon {...p}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Icon>
  ),
}

/* ------------------------------------------------------------------ *
 * Theme toggle — lives in the AdminShell header; sets data-theme on
 * <html> and persists the choice. The inline script in index.html
 * applies it before first paint on the next load.
 * ------------------------------------------------------------------ */

export type ThemeChoice = 'light' | 'dark'

export function currentTheme(): ThemeChoice {
  if (typeof document === 'undefined') return 'light'
  const applied = document.documentElement.dataset.theme
  if (applied === 'light' || applied === 'dark') return applied
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: ThemeChoice) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('solstice-theme', theme)
  } catch {
    // Private mode: the choice just does not survive the reload.
  }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeChoice>(() => currentTheme())
  // Another tab (or the OS, before an explicit choice) can change the theme.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setTheme(currentTheme())
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  const next = theme === 'dark' ? 'light' : 'dark'
  const Sun = Icons.sun
  const Moon = Icons.moon
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next)
        setTheme(next)
      }}
      className={`btn-ghost !rounded-full !px-2.5 ${className}`}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="sr-only">Switch to {next} mode</span>
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Monogram tile — a stable hue derived from the name's hash, so the
 * same person or company always wears the same color.
 * ------------------------------------------------------------------ */

const MONOGRAM_HUES = [
  'bg-agent-soft text-agent',
  'bg-good-soft text-good',
  'bg-warn-soft text-warn',
  'bg-info-soft text-info',
  'bg-bad-soft text-bad',
]

export function Monogram({ name, className = 'h-8 w-8 text-xs' }: { name: string; className?: string }) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const hue = MONOGRAM_HUES[Math.abs(hash) % MONOGRAM_HUES.length]
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-xl font-medium ${hue} ${className}`}
    >
      {initials || '?'}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Progress ring — a circular SVG percentage.
 * ------------------------------------------------------------------ */

export function ProgressRing({
  value,
  size = 40,
  stroke = 4,
  tone = 'accent',
  label,
}: {
  value: number
  size?: number
  stroke?: number
  tone?: 'accent' | 'good' | 'warn' | 'bad' | 'info' | 'agent'
  label?: string
}) {
  const clamped = Math.max(0, Math.min(100, value))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const colorVar = {
    accent: 'rgb(var(--accent))',
    good: 'rgb(var(--good))',
    warn: 'rgb(var(--warn))',
    bad: 'rgb(var(--bad))',
    info: 'rgb(var(--info))',
    agent: 'rgb(var(--agent))',
  }[tone]
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colorVar}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums text-ink">
        {label ?? `${Math.round(clamped)}%`}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Segmented bar — a thin breakdown of a whole into named parts.
 * ------------------------------------------------------------------ */

export type Segment = { label: string; value: number; tone: 'accent' | 'good' | 'warn' | 'bad' | 'info' | 'agent' }

export function SegmentedBar({ segments, className = '' }: { segments: Segment[]; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1
  const colorVar = {
    accent: 'rgb(var(--accent))',
    good: 'rgb(var(--good))',
    warn: 'rgb(var(--warn))',
    bad: 'rgb(var(--bad))',
    info: 'rgb(var(--info))',
    agent: 'rgb(var(--agent))',
  }
  return (
    <div className={className}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={segments.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(', ')}>
        {segments.map((s) => (
          <span
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, background: colorVar[s.tone] }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorVar[s.tone] }} />
            {s.label}
            <span className="tabular-nums text-faint">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Status chips — a pill with a colored dot AND a text label, so the
 * meaning never depends on the color alone.
 * ------------------------------------------------------------------ */

export function Chip({
  tone,
  children,
  title,
}: {
  tone: 'good' | 'warn' | 'bad' | 'info' | 'agent' | 'neutral' | 'accent'
  children: ReactNode
  title?: string
}) {
  const map = {
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    info: 'bg-info-soft text-info',
    agent: 'bg-agent-soft text-agent',
    accent: 'bg-accent/10 text-accent',
    neutral: 'bg-line/60 text-muted',
  } as const
  const dot = {
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad',
    info: 'bg-info',
    agent: 'bg-agent',
    accent: 'bg-accent',
    neutral: 'bg-faint',
  } as const
  return (
    <span className={`chip ${map[tone]}`} title={title}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Tells the operator whether they are looking at the database or at fixtures. */
export function SourceChip({ source }: { source: DataSource }) {
  return source === 'live' ? (
    <Chip tone="good" title="Reading real records from the database">
      Live data
    </Chip>
  ) : (
    <Chip tone="warn" title="The database has nothing in it yet, so this is sample data">
      Demo data
    </Chip>
  )
}

export function ChannelChip({ channel }: { channel: Channel }) {
  return channel === 'voice' ? <Chip tone="accent">Voice call</Chip> : <Chip tone="info">Web chat</Chip>
}

export function SessionStatusChip({ status }: { status: SessionStatus }) {
  const map: Record<SessionStatus, { tone: 'good' | 'warn' | 'neutral'; label: string }> = {
    active: { tone: 'good', label: 'Active' },
    taken_over: { tone: 'warn', label: 'Human in control' },
    ended: { tone: 'neutral', label: 'Ended' },
  }
  const s = map[status]
  return (
    <Chip tone={s.tone}>{s.label}</Chip>
  )
}

export function VerdictChip({ status }: { status: 'pass' | 'flag' | 'fail' }) {
  const map = {
    pass: { tone: 'good', label: 'Pass' },
    flag: { tone: 'warn', label: 'Flag' },
    fail: { tone: 'bad', label: 'Fail' },
  } as const
  const s = map[status]
  return <Chip tone={s.tone}>{s.label}</Chip>
}

export function SeverityChip({ severity }: { severity: 'clear' | 'flag' | 'fail' }) {
  const map = {
    clear: { tone: 'good', label: 'Within rules' },
    flag: { tone: 'warn', label: 'Needs decision' },
    fail: { tone: 'bad', label: 'Outside rules' },
  } as const
  const s = map[severity]
  return <Chip tone={s.tone}>{s.label}</Chip>
}

export function ProposalStatusChip({ status }: { status: string }) {
  const map: Record<string, { tone: 'neutral' | 'warn' | 'info' | 'good' | 'bad'; label: string }> = {
    draft: { tone: 'neutral', label: 'Draft' },
    awaiting_approval: { tone: 'warn', label: 'Awaiting approval' },
    approved: { tone: 'info', label: 'Approved' },
    sent: { tone: 'good', label: 'Sent' },
    rejected: { tone: 'bad', label: 'Declined' },
  }
  const s = map[status] ?? { tone: 'neutral' as const, label: status.replace(/_/g, ' ') }
  return <Chip tone={s.tone}>{s.label}</Chip>
}

/** grounded:false is the single most important thing on the trace. Make it loud. */
export function GroundedChip({ grounded }: { grounded: boolean | null }) {
  if (grounded === null) return <Chip tone="neutral">Grounding unknown</Chip>
  return grounded ? (
    <Chip tone="good" title="Every claim in this answer came from a checked source">
      Grounded
    </Chip>
  ) : (
    <Chip tone="bad" title="The source check failed, so the agent must ask a person rather than guess">
      Not grounded
    </Chip>
  )
}

export function SourceBadge({ source }: { source: 'portal' | 'voice' | 'manual' }) {
  const map = {
    portal: { tone: 'info', label: 'Web portal' },
    voice: { tone: 'accent', label: 'Voice' },
    manual: { tone: 'neutral', label: 'Entered by hand' },
  } as const
  const s = map[source]
  return <Chip tone={s.tone}>{s.label}</Chip>
}

/* ------------------------------------------------------------------ *
 * Layout primitives
 * ------------------------------------------------------------------ */

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value ?? '—'}</dd>
    </div>
  )
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-display text-3xl leading-none text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-faint">{hint}</div> : null}
    </div>
  )
}

/** A serif line and a clear next step, not a dead end. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-2xl italic text-muted">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-faint">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-xl border border-warn-ring bg-warn-soft px-3 py-2 text-xs text-warn">
      Could not read the live records, so this is sample data. {message}
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
    <div role="alert" className="panel border-bad-ring bg-bad-soft p-5">
      <h2 className="font-display text-2xl text-bad">
        {problem === 'expired' ? 'Your session ended' : problem === 'forbidden' ? 'Not permitted' : 'Server unavailable'}
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-bad">{ACCESS_MESSAGE[problem]}</p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-bad/80">
        Sample data is suppressed on this screen on purpose. Showing you numbers that are not
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
    return <span className="text-xs font-normal text-faint">A link to the quote is created when it is sent.</span>
  }

  if (!/^https?:\/\//i.test(pdfPath)) {
    // A storage path, not yet a signed URL. Show the filename only; it carries no token.
    const name = pdfPath.split('/').pop() ?? pdfPath
    return <span className="text-xs font-normal text-faint">Saved as {name}; a private link is issued when it is sent.</span>
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
      <a href={href} target="_blank" rel="noreferrer noopener" className="btn-ghost !rounded-full !px-3 !py-1 text-xs">
        Open the quote
      </a>
      <button type="button" onClick={() => void copy()} className="btn-ghost !rounded-full !px-3 !py-1 text-xs">
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <span className="text-[11px] font-normal text-faint" title="Anyone with this link can open the document">
        the link carries a private access key
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
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left transition hover:text-ink"
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 text-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          >
            <path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{title}</span>
          {summary && !open ? <span className="truncate text-xs font-normal text-faint">{summary}</span> : null}
        </button>
        {right ? <span className="flex shrink-0 items-center gap-2">{right}</span> : null}
      </header>
      {open ? children : null}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Confirm dialog — a styled native <dialog> replaces window.confirm.
 * ------------------------------------------------------------------ */

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null)

  useEffect(() => {
    const el = dialog
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open, dialog])

  // Click on the backdrop closes, same instinct as Esc.
  function onClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialog) onCancel()
  }

  return (
    <dialog ref={setDialog} className="sol-dialog" onClick={onClick} onClose={onCancel}>
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      {body ? <div className="mt-2 text-sm leading-relaxed text-muted">{body}</div> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className={tone === 'danger' ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}

/** The one dark quote card: the key insight, set like an epigraph. */
export function HeroQuote({ children, attribution }: { children: ReactNode; attribution?: string }) {
  return (
    <figure className="panel relative overflow-hidden border-transparent bg-hero text-hero-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(24rem 12rem at 85% 0%, rgb(var(--accent) / 0.25), transparent 65%), radial-gradient(20rem 10rem at 0% 100%, rgb(var(--agent) / 0.18), transparent 60%)',
        }}
      />
      <blockquote className="relative px-6 py-5 sm:px-8 sm:py-7">
        <p className="font-display text-2xl italic leading-snug sm:text-3xl">{children}</p>
        {attribution ? <figcaption className="mt-3 text-xs uppercase tracking-[0.18em] text-hero-text/60">{attribution}</figcaption> : null}
      </blockquote>
    </figure>
  )
}
