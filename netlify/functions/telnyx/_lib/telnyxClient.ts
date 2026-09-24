// Thin Telnyx REST client for the serverless functions.
//
// Deliberately NEVER throws and NEVER retries: the Telnyx account balance is small and a retry
// loop inside a webhook handler is how you turn one failed call into a bill. Every caller gets a
// discriminated result and decides what to do.

import { TELNYX_API_BASE, envOrThrow } from './env'

export interface TelnyxOk<T> {
  ok: true
  status: number
  data: T
}

export interface TelnyxErr {
  ok: false
  status: number
  /** Human-readable, safe to log. Telnyx error payloads do not contain guest PII. */
  error: string
  detail?: unknown
}

export type TelnyxResult<T> = TelnyxOk<T> | TelnyxErr

interface TelnyxCallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  /** Some Telnyx endpoints (the WebRTC token mint) return text/plain, not JSON. */
  expect?: 'json' | 'text'
}

function buildUrl(path: string, query?: TelnyxCallOptions['query']): string {
  const url = new URL(`${TELNYX_API_BASE}${path.startsWith('/') ? path : `/${path}`}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

function describeError(status: number, payload: unknown): string {
  // Telnyx error shape: { errors: [{ code, title, detail, source }] }
  const errs = (payload as { errors?: Array<{ code?: string; title?: string; detail?: string }> })?.errors
  if (Array.isArray(errs) && errs.length > 0) {
    return errs
      .map((e) => [e.code, e.title, e.detail].filter(Boolean).join(': '))
      .join(' | ')
  }
  if (typeof payload === 'string' && payload.length > 0) return payload.slice(0, 500)
  return `Telnyx returned HTTP ${status}`
}

/**
 * One request. One attempt. No retry.
 * `T` is the shape of the `data` member of the Telnyx envelope (already unwrapped).
 */
export async function telnyx<T = unknown>(
  path: string,
  opts: TelnyxCallOptions = {},
): Promise<TelnyxResult<T>> {
  const { method = 'GET', body, query, expect = 'json' } = opts

  let apiKey: string
  try {
    apiKey = envOrThrow('TELNYX_API_KEY')
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message }
  }

  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: expect === 'text' ? 'text/plain, application/json' : 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, status: 0, error: `Network error calling Telnyx ${method} ${path}: ${(err as Error).message}` }
  }

  const rawText = await res.text()

  if (expect === 'text') {
    if (!res.ok) {
      let parsed: unknown = rawText
      try {
        parsed = JSON.parse(rawText)
      } catch {
        /* keep raw text */
      }
      return { ok: false, status: res.status, error: describeError(res.status, parsed), detail: parsed }
    }
    // Some deployments wrap the token in JSON anyway; unwrap if so.
    const trimmed = rawText.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { data?: T; token?: T }
        return { ok: true, status: res.status, data: (parsed.data ?? parsed.token ?? (parsed as unknown)) as T }
      } catch {
        /* fall through to raw */
      }
    }
    return { ok: true, status: res.status, data: trimmed as unknown as T }
  }

  let parsed: unknown = null
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText)
    } catch {
      parsed = rawText
    }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: describeError(res.status, parsed), detail: parsed }
  }

  const envelope = parsed as { data?: T } | null
  return { ok: true, status: res.status, data: (envelope?.data ?? (parsed as T)) as T }
}

// ---------------------------------------------------------------- call control actions

export interface CallActionResult {
  result?: string
  call_control_id?: string
  call_leg_id?: string
  call_session_id?: string
}

export function encodeClientState(state: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
}

export function decodeClientState<T = Record<string, unknown>>(encoded: string | null | undefined): T | null {
  if (!encoded) return null
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as T
  } catch {
    return null
  }
}

/** POST /v2/calls/{id}/actions/answer */
export function answerCall(callControlId: string, clientState?: string) {
  return telnyx<CallActionResult>(`/calls/${encodeURIComponent(callControlId)}/actions/answer`, {
    method: 'POST',
    body: clientState ? { client_state: clientState } : {},
  })
}

/**
 * POST /v2/calls/{id}/actions/ai_assistant_start
 *
 * `send_message_history_updates: true` is the whole reason the supervisor transcript is live:
 * it makes Telnyx fire `call.ai_gather.message_history_updated` once per conversation turn.
 * See plans/02-voice-realtime.md. The event lands in the call.ai_gather.* namespace even though
 * the assistant was started through ai_assistant_start; do not filter on call.conversation.*.
 */
export function aiAssistantStart(
  callControlId: string,
  assistantId: string,
  opts: { clientState?: string; greeting?: string; voice?: string } = {},
) {
  const body: Record<string, unknown> = {
    assistant: { id: assistantId },
    assistant_id: assistantId, // sent both ways: the field name has moved between API revisions
    send_message_history_updates: true,
    interruption_settings: { enable: true },
  }
  if (opts.greeting) body.greeting = opts.greeting
  if (opts.voice) body.voice = opts.voice
  if (opts.clientState) body.client_state = opts.clientState

  return telnyx<CallActionResult>(
    `/calls/${encodeURIComponent(callControlId)}/actions/ai_assistant_start`,
    { method: 'POST', body },
  )
}

/**
 * POST /v2/calls/{id}/actions/ai_assistant_stop
 *
 * Telnyx docs, verbatim: "The call remains active and can continue with other call control
 * commands." That is exactly the takeover rung: Sol goes silent, the guest stays connected.
 */
export function aiAssistantStop(callControlId: string, clientState?: string) {
  return telnyx<CallActionResult>(`/calls/${encodeURIComponent(callControlId)}/actions/ai_assistant_stop`, {
    method: 'POST',
    body: clientState ? { client_state: clientState } : {},
  })
}

export type SupervisorRole = 'monitor' | 'whisper' | 'barge'

/** POST /v2/calls — dial a new leg that supervises an existing one. */
export function dialSupervisorLeg(args: {
  connectionId: string
  to: string
  from: string
  superviseCallControlId: string
  supervisorRole: SupervisorRole
  clientState?: string
  timeoutSecs?: number
}) {
  return telnyx<CallActionResult>('/calls', {
    method: 'POST',
    body: {
      connection_id: args.connectionId,
      to: args.to,
      from: args.from,
      supervise_call_control_id: args.superviseCallControlId,
      supervisor_role: args.supervisorRole,
      client_state: args.clientState,
      timeout_secs: args.timeoutSecs ?? 30,
    },
  })
}

/** POST /v2/calls/{supervisor_leg}/actions/switch_supervisor_role */
export function switchSupervisorRole(supervisorCallControlId: string, role: SupervisorRole, clientState?: string) {
  return telnyx<CallActionResult>(
    `/calls/${encodeURIComponent(supervisorCallControlId)}/actions/switch_supervisor_role`,
    { method: 'POST', body: { role, client_state: clientState } },
  )
}

/** POST /v2/calls/{id}/actions/hangup */
export function hangupCall(callControlId: string) {
  return telnyx<CallActionResult>(`/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
    method: 'POST',
    body: {},
  })
}

/**
 * POST /v2/telephony_credentials/{id}/token
 * Mints a short-lived JWT that @telnyx/webrtc accepts as `login_token`.
 * Returns the JWT as text/plain on most API revisions.
 */
export function mintWebrtcToken(credentialId: string) {
  return telnyx<string>(`/telephony_credentials/${encodeURIComponent(credentialId)}/token`, {
    method: 'POST',
    expect: 'text',
  })
}
