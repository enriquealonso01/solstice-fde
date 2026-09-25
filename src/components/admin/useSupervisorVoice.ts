/**
 * The supervisor's SIP client.
 *
 * Without this, the whole ladder is decorative. /api/voice/supervisor asks Telnyx to
 * dial a leg at the supervisor's SIP address; if no browser is registered there, the
 * leg opens and dies a couple of seconds later with nobody on it. That is precisely
 * the leg_opened -> leg_ended -> no voice.answer trace we saw.
 *
 * So: mint a short-lived Telnyx login token from /api/voice/credentials using the
 * staff Supabase session, register a TelnyxRTC client with it, and auto-answer the
 * inbound leg when it arrives. The supervisor already expressed intent by clicking a
 * rung, so a second "accept the call?" prompt would just add latency to a live call.
 *
 * Follows the shape of src/components/chat/useTelnyxVoice.ts (the guest mic) rather
 * than inventing a second WebRTC pattern: same lazy import, same event wiring, same
 * teardown discipline. The differences are deliberate and only two: credential login
 * instead of anonymous login, and inbound-answer instead of outbound-invite.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Call, TelnyxRTC } from '@telnyx/webrtc'
import { postJson, isAccessFailure } from './useAdminData'

export type SupervisorVoiceState =
  /** The browser cannot do WebRTC, or the page is not on a secure origin. */
  | 'unsupported'
  /** Minting a login token from /api/voice/credentials. */
  | 'requesting'
  /** Token in hand, opening the socket and registering with Telnyx. */
  | 'connecting'
  /** Registered at the SIP address. A leg dialled now will be answered. */
  | 'registered'
  /** Telnyx is dialling us; we are answering. */
  | 'ringing'
  /** Audio is flowing. The supervisor can hear the call. */
  | 'live'
  /** The account is not allowed a supervisor leg (group_sales gets this). */
  | 'forbidden'
  /** The endpoint is not deployed yet. Ladder stays disabled, loudly. */
  | 'unavailable'
  | 'error'

export interface SupervisorVoice {
  state: SupervisorVoiceState
  /** True only when a dialled leg would actually be answered. Gates the ladder. */
  ready: boolean
  error: string | null
  /** Attach to a hidden <audio>; Telnyx renders the call audio into it. */
  remoteAudioRef: RefObject<HTMLAudioElement>
  /** Why the ladder is disabled, in words an operator can act on. Null when ready. */
  unavailableReason: string | null
  /**
   * Must be called synchronously inside a click handler. Browsers refuse to play
   * audio without a user gesture, and the first rung click is the only gesture we
   * get before Telnyx dials us back.
   */
  primeAudio: () => void
  retry: () => void
}

export interface CredentialsResponse {
  login_token?: string
  /** Tolerated aliases, so a small contract difference is not a silent dead leg. */
  token?: string
  sip_username?: string
  expires_at?: string
}

const DEAD_CALL_STATES = new Set(['hangup', 'destroy', 'purge'])

export function useSupervisorVoice(enabled = true): SupervisorVoice {
  const supported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.RTCPeerConnection === 'function'

  const [state, setState] = useState<SupervisorVoiceState>(supported ? 'requesting' : 'unsupported')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const clientRef = useRef<TelnyxRTC | null>(null)
  const callRef = useRef<Call | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  /** Bumped on every (re)connect so StrictMode's double mount cannot cross wires. */
  const generationRef = useRef(0)
  /** Call ids already answered. `ringing` can be dispatched more than once per call. */
  const answeredRef = useRef<Set<string>>(new Set())

  const stopAudio = useCallback(() => {
    const el = remoteAudioRef.current
    if (!el) return
    try {
      el.pause()
      el.srcObject = null
    } catch {
      // A detached element can throw on pause; nothing useful to do about it.
    }
  }, [])

  const playRemote = useCallback(() => {
    const el = remoteAudioRef.current
    if (!el) return
    el.muted = false
    void el.play().catch(() => undefined)
  }, [])

  const teardown = useCallback(() => {
    const call = callRef.current
    callRef.current = null
    if (call) void Promise.resolve(call.hangup()).catch(() => undefined)

    const client = clientRef.current
    clientRef.current = null
    if (client) void Promise.resolve(client.disconnect()).catch(() => undefined)

    stopAudio()
  }, [stopAudio])

  useEffect(() => {
    if (!enabled || !supported) return

    const generation = ++generationRef.current
    const current = () => generationRef.current === generation
    let cancelled = false

    ;(async () => {
      setError(null)
      setState('requesting')

      // Re-minted on every mount: the token is opaque and short-lived, and a cached
      // one that expired overnight fails at exactly the wrong moment.
      const res = await postJson<CredentialsResponse>('/api/voice/credentials', {})
      if (cancelled || !current()) return

      if (!res.ok) {
        if (res.failure === 'forbidden') {
          setState('forbidden')
          setError('This account cannot open a supervisor audio leg. Concierge or admin only.')
        } else if (isAccessFailure(res.failure)) {
          setState('unavailable')
          setError(res.error)
        } else {
          setState('unavailable')
          setError(
            res.failure === 'not_deployed'
              ? 'Supervisor audio is not available in this version, so there is no call to join.'
              : (res.error ?? 'Could not reach the voice service.'),
          )
        }
        return
      }

      const loginToken = res.data?.login_token ?? res.data?.token
      if (!loginToken) {
        setState('error')
        setError('The voice service did not return a login for this session.')
        return
      }

      setState('connecting')

      let TelnyxRTCClient: typeof TelnyxRTC
      try {
        ;({ TelnyxRTC: TelnyxRTCClient } = await import('@telnyx/webrtc'))
      } catch (cause) {
        if (cancelled || !current()) return
        setState('error')
        setError(messageOf(cause, 'The voice module could not be loaded.'))
        return
      }
      if (cancelled || !current()) return

      const client = new TelnyxRTCClient({ login_token: loginToken })
      clientRef.current = client

      client.on('telnyx.ready', () => {
        if (!current() || clientRef.current !== client) return
        // Registered at the SIP address. Only now is a dialled leg answerable, which
        // is the single fact the ladder needs before it lets anyone click.
        setState((s) => (s === 'ringing' || s === 'live' ? s : 'registered'))
      })

      client.on('telnyx.notification', (notification) => {
        if (!current() || clientRef.current !== client) return

        if (notification.type === 'userMediaError') {
          // Listen-only would survive this, but whisper and barge would not, and the
          // supervisor should find that out now rather than mid-call.
          setError('Microphone access was refused. Listening still works; whisper and barge will not.')
          return
        }

        if (notification.type !== 'callUpdate' || !notification.call) return
        const call = notification.call as unknown as Call
        const callState = String(call.state).toLowerCase()

        if (callState === 'ringing' && String(call.direction).toLowerCase() === 'inbound') {
          callRef.current = call
          setState('ringing')
          if (answeredRef.current.has(call.id)) return
          answeredRef.current.add(call.id)
          // Auto-answer: intent was already given by the rung click.
          void Promise.resolve(
            call.answer({ remoteElement: remoteAudioRef.current ?? undefined }),
          ).catch((cause: unknown) => {
            if (!current()) return
            answeredRef.current.delete(call.id)
            setError(messageOf(cause, 'Could not answer the supervisor leg.'))
            setState('registered')
          })
          return
        }

        if (callState === 'active') {
          callRef.current = call
          setState('live')
          playRemote()
          return
        }

        if (DEAD_CALL_STATES.has(callState)) {
          callRef.current = null
          answeredRef.current.delete(call.id)
          stopAudio()
          setState((s) => (s === 'error' || s === 'forbidden' ? s : 'registered'))
        }
      })

      client.on('telnyx.error', (event) => {
        if (!current() || clientRef.current !== client) return
        setError(messageOf(event, 'The supervisor voice connection failed.'))
        // Gateway registration failures (UNREGED/NOREG, FAILED, TIMEOUT) arrive here, and
        // they are exactly what must disable the ladder. But if audio is already flowing,
        // the supervisor is on a live call: report the error, do not yank the controls.
        setState((s) => (s === 'live' || s === 'ringing' ? s : 'error'))
      })

      try {
        await client.connect()
      } catch (cause) {
        if (cancelled || !current()) return
        setState('error')
        setError(messageOf(cause, 'Could not connect to the phone system.'))
      }
    })()

    return () => {
      cancelled = true
      generationRef.current++
      answeredRef.current.clear()
      teardown()
    }
  }, [enabled, supported, attempt, teardown, stopAudio, playRemote])

  const primeAudio = useCallback(() => {
    const el = remoteAudioRef.current
    if (el) {
      el.muted = false
      // Called with no source attached yet. That is fine and is the point: it marks the
      // element as user-activated so autoplay is allowed once Telnyx attaches the stream.
      void el.play().catch(() => undefined)
    }

    // Answering pulls the mic (the inbound leg defaults to audio: true), and whisper and
    // barge are useless without it. Ask here, on the click, rather than mid-answer: a
    // gesture-initiated prompt is the one most likely to be granted, and if it is refused
    // we learn now instead of during a live call.
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      void navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          // Permission is what we wanted; the SDK opens its own stream on answer.
          stream.getTracks().forEach((t) => t.stop())
        })
        .catch(() => {
          setError('Microphone access was refused. You can listen, but whisper and barge will be silent.')
        })
    }
  }, [])

  const retry = useCallback(() => {
    teardown()
    setError(null)
    setAttempt((a) => a + 1)
  }, [teardown])

  const ready = state === 'registered' || state === 'ringing' || state === 'live'

  const unavailableReason = ready
    ? null
    : state === 'unsupported'
      ? 'This browser cannot open supervisor audio on a page that is not secure.'
      : state === 'forbidden'
        ? 'This account cannot open a supervisor audio leg. Concierge or admin only.'
        : state === 'requesting'
          ? 'Getting supervisor audio credentials…'
          : state === 'connecting'
            ? 'Connecting this browser to the phone system…'
            : (error ?? 'Supervisor audio is not registered, so a dialled leg would go unanswered.')

  // Report every transition to the server.
  //
  // Registration happens inside a browser nobody is watching, and when a supervisor leg dies two
  // seconds after being dialled the server trace cannot tell "never registered" from "registered
  // but never answered". Those have completely different fixes. One POST per transition, fire and
  // forget, so a failure to report can never affect the audio path.
  const reported = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    const key = `${state}:${error ?? ''}`
    if (reported.current === key) return
    reported.current = key
    void postJson('/api/voice/client-state', { state, detail: error ?? null }).catch(() => {})
  }, [state, error, enabled])

  return { state, ready, error, remoteAudioRef, unavailableReason, primeAudio, retry }
}

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message
  if (typeof cause === 'object' && cause !== null) {
    const record = cause as Record<string, unknown>
    if (typeof record.message === 'string' && record.message) return record.message
    const nested = record.error
    if (typeof nested === 'object' && nested !== null) {
      const nestedMessage = (nested as Record<string, unknown>).message
      if (typeof nestedMessage === 'string' && nestedMessage) return nestedMessage
    }
  }
  return fallback
}
