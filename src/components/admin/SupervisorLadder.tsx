// The supervisor control ladder.
//
// Each rung is a real Telnyx Call Control primitive (plans/02-voice-realtime.md):
//   listen   -> POST /v2/calls with supervise_call_control_id + supervisor_role monitor
//   whisper  -> switch_supervisor_role -> whisper
//   barge    -> switch_supervisor_role -> barge
//   takeover -> ai_assistant_stop on the assistant leg; the call stays live
//
// The browser never touches Telnyx directly. It posts { session_id, action } to
// /api/voice/supervisor and that function owns the API key and the leg bookkeeping.

import { useState } from 'react'
import type { Channel } from '../../../shared/types'
import type { SessionStatus } from './mockData'
import { isMissingBackend, postJson } from './useAdminData'

export type LadderAction = 'listen' | 'whisper' | 'barge' | 'takeover'

interface Rung {
  action: LadderAction
  label: string
  effect: string
}

const RUNGS: Rung[] = [
  { action: 'listen', label: 'Listen', effect: 'You hear both sides. Neither the guest nor Sol hears you.' },
  { action: 'whisper', label: 'Whisper', effect: 'Only Sol hears you. The guest does not.' },
  { action: 'barge', label: 'Barge', effect: 'Everyone on the call hears you. Sol keeps going.' },
  { action: 'takeover', label: 'Take over', effect: 'Sol stops talking. The call stays live and is yours.' },
]

export interface SupervisorResponse {
  ok?: boolean
  rung?: LadderAction
  supervisor_leg_id?: string
  message?: string
}

export default function SupervisorLadder({
  sessionId,
  channel,
  status,
  onTakeover,
}: {
  sessionId: string
  channel: Channel
  status: SessionStatus
  onTakeover?: () => void
}) {
  const [active, setActive] = useState<LadderAction | null>(status === 'taken_over' ? 'takeover' : null)
  const [pending, setPending] = useState<LadderAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [simulated, setSimulated] = useState(false)

  const isVoice = channel === 'voice'
  const isLive = status !== 'ended'
  const locked = active === 'takeover'
  const activeIndex = active ? RUNGS.findIndex((r) => r.action === active) : -1

  async function climb(action: LadderAction) {
    setPending(action)
    setError(null)
    const res = await postJson<SupervisorResponse>('/api/voice/supervisor', { session_id: sessionId, action })
    setPending(null)
    if (res.ok) {
      setSimulated(false)
      setActive(res.data?.rung ?? action)
      if (action === 'takeover') onTakeover?.()
      return
    }

    if (isMissingBackend(res.failure)) {
      // The endpoint is not deployed yet. Advance the rung locally so the surface is
      // demonstrable, and say plainly that no Telnyx leg was created.
      setSimulated(true)
      setActive(action)
      setError(null)
      if (action === 'takeover') onTakeover?.()
      return
    }

    // The backend answered and refused. Do not move the rung: claiming a supervisor is
    // listening to a live call when nobody is would be the worst lie this screen can tell.
    setSimulated(false)
    setError(res.error)
  }

  return (
    <div className="panel">
      <header className="panel-header flex items-center justify-between gap-3">
        <span>Supervisor control</span>
        {isVoice && isLive ? (
          <span className="text-xs font-normal text-solstice-stone">
            {activeIndex < 0 ? 'Not engaged' : `Rung ${activeIndex + 1} of ${RUNGS.length}`}
          </span>
        ) : null}
      </header>

      <div className="p-4">
        {!isVoice ? (
          <p className="rounded-md border border-solstice-sand bg-solstice-cream px-3 py-2 text-sm text-solstice-stone">
            The ladder is voice-only. This is a chat session, so there is no audio leg to monitor,
            whisper into or barge. Use the transcript to follow it.
          </p>
        ) : !isLive ? (
          <p className="rounded-md border border-solstice-sand bg-solstice-cream px-3 py-2 text-sm text-solstice-stone">
            This call has ended. The ladder is disabled; the transcript and tool trace below are the archive.
          </p>
        ) : null}

        <div className={`mt-0 grid gap-2 ${isVoice && isLive ? '' : 'pointer-events-none mt-3 opacity-40'}`}>
          {RUNGS.map((rung, i) => {
            const isActive = active === rung.action
            const isPast = activeIndex >= 0 && i < activeIndex
            const disabled = !isVoice || !isLive || pending !== null || locked
            return (
              <button
                key={rung.action}
                type="button"
                disabled={disabled}
                onClick={() => void climb(rung.action)}
                className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed ${
                  isActive
                    ? 'border-solstice-ember bg-solstice-ember/10'
                    : isPast
                      ? 'border-solstice-sand bg-solstice-sand/30'
                      : 'border-solstice-sand bg-white hover:bg-solstice-sand/30'
                } ${disabled && !isActive ? 'opacity-60' : ''}`}
              >
                <span
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    isActive
                      ? 'bg-solstice-ember text-white'
                      : isPast
                        ? 'bg-solstice-stone text-white'
                        : 'bg-solstice-sand text-solstice-stone'
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-solstice-ink">{rung.label}</span>
                    {isActive ? (
                      <span className="chip bg-solstice-ember text-white">
                        {rung.action === 'takeover' ? 'In control' : 'Active'}
                      </span>
                    ) : null}
                    {pending === rung.action ? <span className="text-xs text-solstice-stone">working…</span> : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-solstice-stone">{rung.effect}</span>
                </span>
              </button>
            )
          })}
        </div>

        {locked ? (
          <p className="mt-3 rounded-md border border-solstice-gold/50 bg-solstice-gold/10 px-3 py-2 text-xs text-solstice-ink">
            Sol has stepped aside. The guest is still connected and is now speaking to you.
          </p>
        ) : null}

        {simulated ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Simulated: <code>POST /api/voice/supervisor</code> is not responding yet, so the rung
            advanced in the UI only. No Telnyx leg was created.
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
        ) : null}
      </div>
    </div>
  )
}
