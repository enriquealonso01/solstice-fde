import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { SendIcon } from './glyphs'
import { MicButton, VoiceBar } from './MicButton'
import type { VoiceSession } from './useTelnyxVoice'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  voice: VoiceSession
  inputRef: RefObject<HTMLTextAreaElement>
}

const MAX_ROWS_PX = 120

export function Composer({ value, onChange, onSubmit, busy, voice, inputRef }: ComposerProps) {
  const voiceActive = voice.state === 'connecting' || voice.state === 'live' || voice.state === 'ending'

  // Grow to fit, up to four-ish lines, then scroll.
  useLayoutEffect(() => {
    const node = inputRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = String(Math.min(node.scrollHeight, MAX_ROWS_PX)) + 'px'
  }, [value, inputRef])

  const submit = () => {
    if (busy || !value.trim()) return
    onSubmit()
  }

  return (
    <div className="border-t border-line bg-card px-3 pb-3 pt-2.5">
      {voice.error ? (
        <p className="mb-2 rounded-lg bg-accent/[0.07] px-2.5 py-1.5 text-[11px] leading-snug text-accent" role="status">
          {voice.error}
        </p>
      ) : null}

      {voiceActive ? (
        <VoiceBar voice={voice} />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex items-end gap-2"
        >
          <MicButton voice={voice} />

          <div className="min-w-0 flex-1 rounded-2xl border border-line bg-canvas/60 px-3 py-2 transition focus-within:border-faint/60 focus-within:bg-card">
            <label htmlFor="sol-composer" className="sr-only">
              Message Sol
            </label>
            <textarea
              id="sol-composer"
              ref={inputRef}
              rows={1}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder="Ask Sol anything about your stay"
              className="block max-h-[120px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-ink placeholder:text-muted/60 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
          >
            <SendIcon className="h-4 w-4" />
            <span className="sr-only">Send message</span>
          </button>
        </form>
      )}

      <p className="mt-2 text-center text-[10px] leading-snug text-muted/60">
        Sol answers from Solstice policy and your reservation. Anything it cannot confirm goes to a person.
      </p>
    </div>
  )
}
