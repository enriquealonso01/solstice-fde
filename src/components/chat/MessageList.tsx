import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { AlertIcon, SolMark } from './glyphs'
import { Citations } from './Citations'
import { ToolTrace } from './ToolChip'
import type { AgentTurn, ConnectionState, StaffTurn, Turn, TurnAttachment } from './types'

interface MessageListProps {
  turns: Turn[]
  connection: ConnectionState
  onRetry: () => void
}

/**
 * The transcript.
 *
 * Accessibility note worth defending out loud: the log is `aria-live="polite"`,
 * but a reply that is still streaming is rendered `aria-hidden`. Announcing a
 * character-by-character reveal would make a screen reader stutter the same
 * sentence fifty times. The finished text replaces the hidden node, which the
 * live region reads as a single addition, once, in full.
 */
export function MessageList({ turns, connection, onRetry }: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const onScroll = () => {
    const node = scrollerRef.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    stickToBottomRef.current = distance < 64
  }

  // Follow the stream, unless the guest has scrolled up to read something.
  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node || !stickToBottomRef.current) return
    node.scrollTop = node.scrollHeight
  })

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin]"
    >
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        aria-label="Conversation with Sol"
        className="flex flex-col gap-3"
      >
        {turns.map((turn) =>
          turn.role === 'guest' ? (
            <GuestBubble key={turn.id} text={turn.text} />
          ) : turn.role === 'staff' ? (
            <StaffBubble key={turn.id} turn={turn} />
          ) : (
            <AgentBubble key={turn.id} turn={turn} onRetry={onRetry} />
          ),
        )}
      </div>

      {connection.kind === 'reconnecting' ? (
        <StatusLine>Reconnecting to Sol, attempt {connection.attempt}&hellip;</StatusLine>
      ) : null}
    </div>
  )
}

function GuestBubble({ text }: { text: string }) {
  return (
    <div className="sol-rise flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-solstice-ink px-3.5 py-2.5 text-[13px] leading-relaxed text-solstice-cream shadow-sm">
        {text}
      </p>
    </div>
  )
}

/**
 * A message from a person, not from Sol.
 *
 * Visually distinct on purpose, and the distinction is load-bearing rather than decorative: a guest
 * has to be able to tell at a glance which sentences came from an AI and which came from a member
 * of staff. Same side as Sol, because both are the hotel answering, but a gold rail, a person's
 * label and no Sol mark.
 */
function StaffBubble({ turn }: { turn: StaffTurn }) {
  return (
    <div className="sol-rise flex items-start gap-2">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-solstice-gold/40 bg-solstice-gold/10 text-[10px] font-semibold uppercase text-solstice-ink shadow-sm">
        SH
      </span>
      <div className="min-w-0 max-w-[88%]">
        <p className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-solstice-stone">
          Solstice team
        </p>
        <div className="rounded-2xl rounded-bl-md border border-solstice-gold/35 bg-solstice-gold/[0.06] px-3.5 py-2.5 shadow-sm">
          {turn.text ? (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-solstice-slate">
              {turn.text}
            </p>
          ) : null}
          {turn.attachment ? <AttachmentLink attachment={turn.attachment} /> : null}
        </div>
      </div>
    </div>
  )
}

function AttachmentLink({ attachment }: { attachment: TurnAttachment }) {
  return (
    <a
      href={attachment.url}
      target="_blank"
      // noopener because this opens a Storage URL in a new tab; without it the opened page keeps a
      // handle on this window.
      rel="noopener noreferrer"
      download={attachment.filename}
      className="mt-2 flex items-center gap-2 rounded-lg border border-solstice-sand bg-white px-2.5 py-2 transition hover:border-solstice-stone/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
    >
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded bg-solstice-cream text-[9px] font-semibold uppercase text-solstice-stone"
      >
        {fileTag(attachment.filename)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-solstice-ink">{attachment.filename}</span>
        <span className="block text-[11px] text-solstice-stone">{humanBytes(attachment.bytes)}</span>
      </span>
    </a>
  )
}

function fileTag(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot + 1) : ''
  return (ext || 'file').slice(0, 4)
}

function humanBytes(n: number): string {
  if (!n) return 'file'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

function AgentBubble({ turn, onRetry }: { turn: AgentTurn; onRetry: () => void }) {
  const streaming = turn.status === 'streaming'
  const hasText = turn.text.length > 0
  const failed = turn.status === 'failed'

  // A finished turn with nothing in it has nothing to draw.
  if (!streaming && !hasText && !failed && turn.tools.length === 0) return null

  return (
    <div className="sol-rise flex items-start gap-2">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-solstice-sand bg-white text-solstice-ink shadow-sm">
        <SolMark className="h-3.5 w-3.5" />
      </span>

      <div className="min-w-0 max-w-[88%]">
        <ToolTrace tools={turn.tools} />

        {hasText ? (
          <div className="rounded-2xl rounded-bl-md border border-solstice-sand bg-white px-3.5 py-2.5 shadow-sm">
            {streaming ? (
              <p
                aria-hidden="true"
                className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-solstice-slate"
              >
                {turn.text}
                <Caret />
              </p>
            ) : (
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-solstice-slate">
                {turn.text}
              </p>
            )}

            {!streaming ? <Citations citations={turn.citations} /> : null}
          </div>
        ) : null}

        {streaming && !hasText ? <TypingDots /> : null}
        {failed ? <FailureCard message={turn.error} onRetry={onRetry} /> : null}
      </div>
    </div>
  )
}

function Caret() {
  return (
    <span
      className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[2px] rounded-full bg-solstice-ember/70 align-baseline"
      aria-hidden="true"
    />
  )
}

/** Shown between "sent" and the first token, and again after a reconnect. */
function TypingDots() {
  const hostRef = useRef<HTMLSpanElement>(null)

  // Stagger once, rather than re-applying inline styles on every render.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.querySelectorAll<HTMLElement>('.sol-dot').forEach((dot, index) => {
      dot.style.animationDelay = String(index * 160) + 'ms'
    })
  }, [])

  return (
    <span
      ref={hostRef}
      className="inline-flex items-center gap-1 rounded-2xl rounded-bl-md border border-solstice-sand bg-white px-3.5 py-3 shadow-sm"
    >
      <span className="sr-only">Sol is working on it</span>
      <span className="sol-dot h-1.5 w-1.5 rounded-full bg-solstice-stone" />
      <span className="sol-dot h-1.5 w-1.5 rounded-full bg-solstice-stone" />
      <span className="sol-dot h-1.5 w-1.5 rounded-full bg-solstice-stone" />
    </span>
  )
}

function FailureCard({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl rounded-bl-md border border-solstice-ember/30 bg-solstice-ember/[0.06] px-3.5 py-2.5">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-solstice-ember" />
      <div className="min-w-0">
        <p className="text-[13px] leading-relaxed text-solstice-slate">
          {message ?? 'Sol could not complete that reply.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1.5 rounded-md text-[12px] font-medium text-solstice-ember underline underline-offset-2 transition hover:text-solstice-ember/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-center text-[11px] text-solstice-stone/80" role="status">
      {children}
    </p>
  )
}
