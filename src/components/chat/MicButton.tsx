import { useId, useState } from 'react'
import { MicIcon, StopIcon } from './glyphs'
import type { VoiceSession } from './useTelnyxVoice'

/**
 * Hand-off to voice, in place, without leaving the conversation.
 *
 * When `VITE_TELNYX_ASSISTANT_ID` is empty the button renders disabled with a
 * tooltip explaining why, rather than throwing when a guest presses it. A
 * disabled <button> does not fire pointer events, so the tooltip is driven from
 * the wrapper.
 */
export function MicButton({ voice }: { voice: VoiceSession }) {
  const [tipOpen, setTipOpen] = useState(false)
  const tipId = useId()

  const unavailable = voice.unavailableReason !== null
  const connecting = voice.state === 'connecting' || voice.state === 'ending'
  const live = voice.state === 'live'

  const tip = voice.unavailableReason ?? (live ? 'End the voice call' : 'Talk to Sol')

  const onClick = () => {
    if (unavailable) return
    if (live || connecting) voice.stop()
    else voice.start()
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTipOpen(true)}
      onMouseLeave={() => setTipOpen(false)}
      onFocusCapture={() => setTipOpen(true)}
      onBlurCapture={() => setTipOpen(false)}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={unavailable}
        aria-describedby={tipId}
        aria-pressed={live}
        title={tip}
        className={[
          'grid h-9 w-9 place-items-center rounded-full border transition',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40 focus-visible:ring-offset-1 focus-visible:ring-offset-white',
          unavailable
            ? 'cursor-not-allowed border-solstice-sand bg-solstice-sand/25 text-solstice-stone/45'
            : live
              ? 'border-solstice-ember bg-solstice-ember text-white shadow-sm'
              : 'border-solstice-sand bg-white text-solstice-slate hover:border-solstice-stone/40 hover:text-solstice-ink',
        ].join(' ')}
      >
        {connecting ? (
          <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : live ? (
          <StopIcon className="h-3.5 w-3.5" />
        ) : (
          <MicIcon className="h-4 w-4" />
        )}
        <span className="sr-only">
          {live ? 'End the voice call with Sol' : 'Talk to Sol using your microphone'}
        </span>
      </button>

      <span
        id={tipId}
        role="tooltip"
        className={[
          'pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-52 rounded-lg bg-solstice-ink px-2.5 py-1.5 text-[11px] leading-snug text-solstice-cream shadow-lg transition-opacity duration-150',
          tipOpen ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      >
        {tip}
      </span>
    </span>
  )
}

/** Replaces the composer while a call is up. */
export function VoiceBar({ voice }: { voice: VoiceSession }) {
  const connecting = voice.state === 'connecting'

  return (
    <div className="sol-rise flex items-center gap-3 rounded-xl border border-solstice-ember/30 bg-solstice-ember/[0.06] px-3 py-2.5">
      <span className="relative grid h-8 w-8 shrink-0 place-items-center">
        <span className="absolute inset-0 rounded-full bg-solstice-ember/20 motion-safe:animate-ping" />
        <span className="relative grid h-8 w-8 place-items-center rounded-full bg-solstice-ember text-white">
          <MicIcon className="h-4 w-4" />
        </span>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-solstice-slate">
          {connecting ? 'Connecting to Sol…' : voice.muted ? 'Microphone muted' : 'Listening'}
        </p>
        <p className="truncate text-[11px] text-solstice-stone">
          Same Sol that answers the phone line.
        </p>
      </div>

      <button
        type="button"
        onClick={voice.toggleMute}
        disabled={voice.state !== 'live'}
        className="rounded-md px-2 py-1 text-[12px] font-medium text-solstice-slate transition hover:bg-white/70 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
      >
        {voice.muted ? 'Unmute' : 'Mute'}
      </button>

      <button
        type="button"
        onClick={voice.stop}
        className="rounded-md bg-solstice-ink px-2.5 py-1 text-[12px] font-medium text-solstice-cream transition hover:bg-solstice-slate focus:outline-none focus-visible:ring-2 focus-visible:ring-solstice-ember/40"
      >
        End
      </button>
    </div>
  )
}
