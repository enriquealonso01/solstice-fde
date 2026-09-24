/**
 * Browser voice for the chat panel.
 *
 * Anonymous WebRTC login straight against the Telnyx AI Assistant, so the guest
 * talks to the same Sol that answers the phone number on the landing page: one
 * assistant, two entry points, no second persona to keep in sync.
 *
 * Requires `telephony_settings.supports_unauthenticated_web_calls = true` on the
 * assistant. When `VITE_TELNYX_ASSISTANT_ID` is empty the hook reports
 * `unconfigured` and the mic renders disabled, never crashing the panel.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Call, TelnyxRTC } from '@telnyx/webrtc'

export type VoiceState =
  /** No assistant id in the environment. Mic is disabled with a reason. */
  | 'unconfigured'
  /** Browser cannot do WebRTC capture at all (or the page is not secure). */
  | 'unsupported'
  | 'idle'
  | 'connecting'
  | 'live'
  | 'ending'
  | 'error'

export interface VoiceSession {
  state: VoiceState
  error: string | null
  muted: boolean
  /** Attach to an <audio> element; Telnyx renders the assistant's voice into it. */
  remoteAudioRef: RefObject<HTMLAudioElement>
  start: () => void
  stop: () => void
  toggleMute: () => void
  /** Why the mic is unavailable, for the tooltip. Null when it is available. */
  unavailableReason: string | null
}

const LIVE_CALL_STATES = new Set(['active'])
const DEAD_CALL_STATES = new Set(['hangup', 'destroy', 'purge'])

export function useTelnyxVoice(assistantId: string | undefined): VoiceSession {
  const trimmedId = (assistantId ?? '').trim()

  const supported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.RTCPeerConnection === 'function'

  const initialState: VoiceState = !supported ? 'unsupported' : trimmedId ? 'idle' : 'unconfigured'

  const [state, setState] = useState<VoiceState>(initialState)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)

  const clientRef = useRef<TelnyxRTC | null>(null)
  const callRef = useRef<Call | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  const teardown = useCallback(() => {
    const call = callRef.current
    callRef.current = null
    if (call) {
      void Promise.resolve(call.hangup()).catch(() => undefined)
    }
    const client = clientRef.current
    clientRef.current = null
    if (client) {
      void Promise.resolve(client.disconnect()).catch(() => undefined)
    }
  }, [])

  // Never leave a call running behind a closed panel or a navigation.
  useEffect(() => teardown, [teardown])

  const start = useCallback(() => {
    if (!supported) {
      setState('unsupported')
      return
    }
    if (!trimmedId) {
      setState('unconfigured')
      return
    }
    if (clientRef.current) return

    setError(null)
    setMuted(false)
    setState('connecting')

    // Loaded on demand: the WebRTC bundle is large and most guests type.
    void import('@telnyx/webrtc')
      .then(({ TelnyxRTC: TelnyxRTCClient }) => {
        const client = new TelnyxRTCClient({
          anonymous_login: {
            target_id: trimmedId,
            target_type: 'ai_assistant',
          },
        })
        clientRef.current = client

        client.on('telnyx.ready', () => {
          if (clientRef.current !== client) return
          try {
            const call = client.newCall({
              // An AI assistant call has no destination; the assistant is the target.
              destinationNumber: '',
              audio: true,
              video: false,
              remoteElement: remoteAudioRef.current ?? undefined,
              preferred_codecs: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 1 }],
            })
            callRef.current = call
          } catch (cause: unknown) {
            setError(messageOf(cause, 'Sol could not open the voice channel.'))
            setState('error')
            teardown()
          }
        })

        client.on('telnyx.notification', (notification) => {
          if (clientRef.current !== client) return

          if (notification.type === 'userMediaError') {
            setError('Sol needs microphone access. Allow it in your browser, then try again.')
            setState('error')
            teardown()
            return
          }

          if (notification.type !== 'callUpdate' || !notification.call) return
          const callState = String(notification.call.state)

          if (LIVE_CALL_STATES.has(callState)) {
            setState('live')
          } else if (DEAD_CALL_STATES.has(callState)) {
            callRef.current = null
            setState((previous) => (previous === 'error' ? previous : 'idle'))
            teardown()
          }
        })

        client.on('telnyx.error', (event) => {
          if (clientRef.current !== client) return
          setError(messageOf(event, 'The voice connection failed.'))
          setState('error')
          teardown()
        })

        void Promise.resolve(client.connect()).catch((cause: unknown) => {
          if (clientRef.current !== client) return
          setError(messageOf(cause, 'Sol could not connect to the voice service.'))
          setState('error')
          teardown()
        })
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause, 'The voice module could not be loaded.'))
        setState('error')
      })
  }, [supported, trimmedId, teardown])

  const stop = useCallback(() => {
    if (!clientRef.current && !callRef.current) return
    setState('ending')
    teardown()
    setMuted(false)
    setState(trimmedId ? 'idle' : 'unconfigured')
  }, [teardown, trimmedId])

  const toggleMute = useCallback(() => {
    const call = callRef.current
    if (!call) return
    setMuted((previous) => {
      if (previous) call.unmuteAudio()
      else call.muteAudio()
      return !previous
    })
  }, [])

  const unavailableReason =
    state === 'unconfigured'
      ? 'Voice is not wired up yet. Set VITE_TELNYX_ASSISTANT_ID to enable it.'
      : state === 'unsupported'
        ? 'This browser cannot capture microphone audio on a non-secure page.'
        : null

  return { state, error, muted, remoteAudioRef, start, stop, toggleMute, unavailableReason }
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
