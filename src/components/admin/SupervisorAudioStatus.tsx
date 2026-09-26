// Registers the supervisor SIP client on the dashboard and reports whether it worked.
//
// This exists so the answer to "can I take this call?" is on screen BEFORE anyone opens
// a session and clicks a rung. Enrique tests from a real phone and every attempt costs
// him a call, so a broken credentials endpoint should be visible while he is still
// looking at the list, not discovered by a leg that opens and dies in silence.

import { useSupervisorVoice } from './useSupervisorVoice'

export default function SupervisorAudioStatus() {
  const voice = useSupervisorVoice(true)

  const tone = voice.ready
    ? 'border-good-ring bg-good-soft text-good'
    : voice.state === 'requesting' || voice.state === 'connecting'
      ? 'border-line bg-card text-muted'
      : 'border-bad-ring bg-bad-soft text-bad'

  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm ${tone}`}>
      {/* The element must exist for the client to have somewhere to render audio. */}
      <audio ref={voice.remoteAudioRef} autoPlay playsInline className="hidden" />
      <span
        aria-hidden
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          voice.ready ? 'bg-good-soft' : voice.state === 'requesting' || voice.state === 'connecting' ? 'sol-dot bg-faint' : 'bg-bad-soft'
        }`}
      />
      <span className="min-w-0">
        <span className="font-medium">
          {voice.ready ? 'Supervisor audio ready' : 'Supervisor audio not registered'}
        </span>
        <span className="block text-xs leading-relaxed">
          {voice.ready
            ? 'This browser is connected to the phone system, so a call you take over will reach your headset.'
            : voice.unavailableReason}
        </span>
      </span>
      {!voice.ready && (voice.state === 'unavailable' || voice.state === 'error') ? (
        <button type="button" className="btn-ghost ml-auto shrink-0 !py-1 text-xs" onClick={voice.retry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}
