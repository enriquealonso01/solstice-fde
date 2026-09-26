import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { ChevronDownIcon, CloseIcon, SolMark } from './glyphs'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { useFocusTrap } from './hooks'
import type { ConnectionState, TransportMode, Turn } from './types'
import type { VoiceSession } from './useTelnyxVoice'

interface ChatPanelProps {
  panelId: string
  turns: Turn[]
  connection: ConnectionState
  transportMode: TransportMode | null
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onRetry: () => void
  onClose: () => void
  suggestions: string[]
  onSuggestion: (text: string) => void
  voice: VoiceSession
  busy: boolean
  /** A human member of staff is answering, so Sol is standing down. */
  takenOver: boolean
  inputRef: RefObject<HTMLTextAreaElement>
}

export function ChatPanel(props: ChatPanelProps) {
  const {
    panelId,
    turns,
    connection,
    transportMode,
    draft,
    onDraftChange,
    onSend,
    onRetry,
    onClose,
    suggestions,
    onSuggestion,
    voice,
    busy,
    takenOver,
    inputRef,
  } = props

  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = panelId + '-title'

  useFocusTrap(panelRef, true)

  // Focus the composer on open, not the close button: the guest came here to talk.
  useEffect(() => {
    inputRef.current?.focus()
  }, [inputRef])

  return (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
      className="sol-rise sol-panel-height flex w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-solstice-sand bg-white shadow-[0_28px_70px_-24px_rgba(20,18,16,0.55)]"
    >
      <header className="relative shrink-0 border-b border-solstice-gold/20 bg-solstice-ink px-4 py-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_85%_-20%,rgba(200,151,63,0.28),transparent_60%)]"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-solstice-gold/25 to-solstice-ember/25 text-solstice-cream ring-1 ring-inset ring-solstice-gold/25">
            <SolMark className="h-5 w-5" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-[17px] leading-tight text-solstice-cream">
              Sol
            </h2>
            <p className="truncate text-[10.5px] uppercase tracking-[0.13em] text-solstice-cream/55">
              Solstice concierge
            </p>
          </div>

          <StatusPill connection={connection} transportMode={transportMode} />

          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-solstice-cream/65 transition hover:bg-white/10 hover:text-solstice-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-gold"
          >
            <CloseIcon className="h-4 w-4 sm:hidden" />
            <ChevronDownIcon className="hidden h-4 w-4 sm:block" />
            <span className="sr-only">Close the conversation with Sol</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col bg-solstice-cream/50">
        {takenOver ? (
          /* Said once, above the transcript, rather than repeated on every staff message. The guest
             is entitled to know they stopped talking to an AI; they do not need reminding each turn. */
          <div
            role="status"
            className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-solstice-gold/40 bg-solstice-gold/[0.08] px-3 py-2"
          >
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-solstice-gold" />
            <p className="text-[12px] leading-relaxed text-solstice-slate">
              <span className="font-medium text-solstice-ink">A Solstice team member has joined.</span> They can see
              this whole conversation, and they are answering you directly now.
            </p>
          </div>
        ) : null}

        <MessageList turns={turns} connection={connection} onRetry={onRetry} />

        {suggestions.length > 0 ? (
          <div className="shrink-0 px-4 pb-3">
            <ul className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => onSuggestion(suggestion)}
                    className="rounded-full border border-solstice-sand bg-white px-3 py-1.5 text-[11.5px] text-solstice-slate shadow-sm transition hover:border-solstice-stone/40 hover:bg-solstice-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Composer
        value={draft}
        onChange={onDraftChange}
        onSubmit={onSend}
        busy={busy}
        voice={voice}
        inputRef={inputRef}
      />

      {/* Telnyx renders the assistant's audio here. */}
      <audio ref={voice.remoteAudioRef} autoPlay playsInline className="hidden" />
    </div>
  )
}

function StatusPill({
  connection,
  transportMode,
}: {
  connection: ConnectionState
  transportMode: TransportMode | null
}) {
  const reconnecting = connection.kind === 'reconnecting'
  const failed = connection.kind === 'failed'
  const demo = transportMode === 'mock'

  const label = reconnecting ? 'Reconnecting' : failed ? 'Offline' : demo ? 'Demo agent' : 'Online'
  const dot = reconnecting
    ? 'bg-solstice-gold'
    : failed
      ? 'bg-solstice-ember'
      : demo
        ? 'bg-solstice-gold'
        : 'bg-emerald-400'

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-solstice-cream/70 sm:inline-flex"
      title={demo ? 'The chat server is not reachable, so Sol is running its scripted demo path.' : undefined}
    >
      <span
        className={[
          'h-1.5 w-1.5 rounded-full',
          dot,
          reconnecting ? 'motion-safe:animate-pulse' : '',
        ].join(' ')}
      />
      {label}
    </span>
  )
}
