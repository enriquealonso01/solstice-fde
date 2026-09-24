// Inbound Telnyx webhook.  Deployed as the `telnyx` function, reached at /api/telnyx via the
// /api/* redirect in netlify.toml.  This one URL is the Call Control Application's
// webhook_event_url, so every voice event for Sol lands here:
//
//   call.initiated                            -> answer, then ai_assistant_start
//   call.answered                             -> safety-net start if the first attempt failed
//   call.ai_gather.message_history_updated    -> live transcript into `messages` (THE live feed)
//   call.conversation.ended                   -> close the session
//   call.conversation_insights.generated      -> archive insights
//   call.hangup                               -> close the session / retire a supervisor leg
//
// plans/02-voice-realtime.md is the contract: message history arrives in the call.ai_gather.*
// namespace even though the assistant is started with ai_assistant_start. Do not filter on
// call.conversation.* for transcripts.

import type { Context } from '@netlify/functions'
import { ack, json } from './_lib/http'
import { envOrNull } from './_lib/env'
import {
  TELNYX_SIGNATURE_HEADER,
  TELNYX_TIMESTAMP_HEADER,
  verifyTelnyxSignature,
} from './_lib/signature'
import {
  aiAssistantStart,
  answerCall,
  decodeClientState,
  encodeClientState,
} from './_lib/telnyxClient'
import { maskArgs, maskPhone, safeLog } from '../_lib/mask'
import { classifyLeg, isGuestCall, legConfigFromEnv } from './_lib/legs'
import { missingDbEnv, recordToolInvocation, tryGetDb } from '../_lib/db'
import {
  SUPERVISOR_LEG_ENDED_TOOL,
  findSessionByCallControlId,
  findSessionByConversationId,
  findSessionBySupervisorLeg,
  getSessionById,
  identifyCallerByPhone,
  insertSession,
  setSupervisorLeg,
  updateSession,
  upsertTranscriptTurns,
  type SessionRow,
  type TranscriptTurn,
} from './_lib/sessions'
import type { SupabaseClient } from '@supabase/supabase-js'

interface TelnyxEvent {
  event_type: string
  id?: string
  occurred_at?: string
  payload?: Record<string, unknown>
}

interface CallClientState {
  kind?: 'guest' | 'supervisor'
  session_id?: string
}

/**
 * Best-effort, per-instance memory of which calls we already started the assistant on.
 * Serverless instances are not shared, so this is a hint, not a lock. The real protection is
 * that a duplicate ai_assistant_start returns a Telnyx error which we swallow.
 */
const assistantStartFailed = new Set<string>()

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method === 'GET') {
    // Cheap liveness probe for the Backend Map health dots. Reveals no secrets.
    return json({
      ok: true,
      service: 'telnyx-inbound-webhook',
      signature_verification: envOrNull('TELNYX_PUBLIC_KEY') ? 'enabled' : 'DISABLED (TELNYX_PUBLIC_KEY unset)',
      assistant_configured: Boolean(envOrNull('TELNYX_ASSISTANT_ID')),
    })
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const rawBody = await req.text()

  const check = verifyTelnyxSignature({
    rawBody,
    signature: req.headers.get(TELNYX_SIGNATURE_HEADER),
    timestamp: req.headers.get(TELNYX_TIMESTAMP_HEADER),
    publicKeyBase64: envOrNull('TELNYX_PUBLIC_KEY'),
  })
  if (!check.ok) {
    safeLog('[solstice] webhook signature rejected', { reason: check.reason })
    return json({ ok: false, error: 'invalid_signature' }, 401)
  }
  if (check.skipped) {
    console.warn(`[solstice] WEBHOOK SIGNATURE NOT VERIFIED: ${check.reason}`)
  }

  let event: TelnyxEvent
  try {
    const parsed = JSON.parse(rawBody) as { data?: TelnyxEvent }
    if (!parsed?.data?.event_type) return json({ ok: false, error: 'not_a_telnyx_event' }, 400)
    event = parsed.data
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const sb = tryGetDb()
  if (!sb) {
    // Still acknowledge: Telnyx must not retry-storm while Supabase env is being wired.
    console.error(
      `[solstice] ${event.event_type} received but Supabase is unconfigured: ${missingDbEnv().join(', ')} unset`,
    )
    return ack('supabase_unavailable', { event_type: event.event_type })
  }

  try {
    return await route(sb, event)
  } catch (err) {
    console.error(`[solstice] handler threw on ${event.event_type}: ${(err as Error).message}`)
    return ack('handler_error', { event_type: event.event_type, error: (err as Error).message })
  }
}

async function route(sb: SupabaseClient, event: TelnyxEvent): Promise<Response> {
  const payload = event.payload ?? {}
  const cfg = legConfigFromEnv()

  // Classify the leg BEFORE any handler runs, so no event type can do guest work on a supervisor
  // leg. See _lib/legs.ts for why this is four independent signals rather than one.
  if (classifyLeg(payload, cfg) === 'supervisor') {
    return onSupervisorLegEvent(sb, event.event_type, payload)
  }

  switch (event.event_type) {
    case 'call.initiated':
      return onCallInitiated(sb, payload)
    case 'call.answered':
      return onCallAnswered(sb, payload)
    case 'call.ai_gather.message_history_updated':
      return onMessageHistoryUpdated(sb, payload)
    case 'call.conversation.ended':
      return onConversationEnded(sb, payload)
    case 'call.conversation_insights.generated':
      return onInsightsGenerated(sb, payload)
    case 'call.hangup':
      return onHangup(sb, payload)
    default:
      safeLog('[solstice] unhandled event', { event_type: event.event_type })
      return ack('ignored', { event_type: event.event_type })
  }
}

// ---------------------------------------------------------------- supervisor legs

/**
 * Everything that happens on a supervisor leg. The one rule: never answer it, never identify it,
 * never start Sol on it, never create a session for it. Telnyx bridges it to the guest leg itself
 * via supervise_call_control_id; our only job is to stay out of the way and keep the session
 * row's rung indicator honest.
 */
async function onSupervisorLegEvent(
  sb: SupabaseClient,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const callControlId = str(payload.call_control_id)
  const clientState = decodeClientState<CallClientState>(str(payload.client_state))

  safeLog('[solstice] supervisor leg event', {
    event_type: eventType,
    to: str(payload.to),
    direction: str(payload.direction),
    session_id: clientState?.session_id ?? null,
  })

  if (eventType !== 'call.hangup' || !callControlId) {
    return ack('supervisor_leg_event', { event_type: eventType })
  }

  // Resolve the session by client_state first, then by the leg id stored at dial time.
  let sessionId = clientState?.session_id ?? null
  if (!sessionId) {
    const found = await findSessionBySupervisorLeg(sb, callControlId)
    sessionId = found?.id ?? null
  }
  if (!sessionId) return ack('supervisor_leg_hangup_unmatched')

  // Retire the leg so the next Listen click dials a fresh one instead of switching a dead one.
  await trace({
    session_id: sessionId,
    tool: SUPERVISOR_LEG_ENDED_TOOL,
    args: { supervisor_call_control_id: callControlId },
    summary: 'supervisor leg hung up',
    grounded: true,
  })
  await setSupervisorLeg(sb, sessionId, null, null)
  return ack('supervisor_leg_closed', { session_id: sessionId })
}

// ---------------------------------------------------------------- call.initiated

async function onCallInitiated(sb: SupabaseClient, payload: Record<string, unknown>): Promise<Response> {
  const callControlId = str(payload.call_control_id)
  const direction = str(payload.direction)
  const from = str(payload.from)
  const clientState = decodeClientState<CallClientState>(str(payload.client_state))

  if (!callControlId) return ack('no_call_control_id')

  // Session creation is the only destructive path here, so it gets the strictest gate.
  if (!isGuestCall(payload, legConfigFromEnv())) {
    safeLog('[solstice] call.initiated ignored, not a guest call', {
      direction,
      to: str(payload.to),
      connection_id: str(payload.connection_id),
      kind: clientState?.kind ?? null,
    })
    return ack('not_a_guest_call')
  }

  const session = await ensureGuestSession(sb, callControlId, from)

  const guestState = encodeClientState({ kind: 'guest', session_id: session.id })

  const answered = await answerCall(callControlId, guestState)
  if (!answered.ok) {
    console.error(`[solstice] answer failed for session ${session.id}: ${answered.error}`)
    await trace({
      session_id: session.id,
      tool: 'voice.answer',
      summary: `FAILED: ${answered.error}`,
      grounded: false,
    })
    return ack('answer_failed', { error: answered.error })
  }

  const started = await startAssistant(session.id, callControlId, guestState)
  if (!started) assistantStartFailed.add(callControlId)

  return ack('call_answered', { session_id: session.id, assistant_started: started })
}

// ---------------------------------------------------------------- call.answered

async function onCallAnswered(sb: SupabaseClient, payload: Record<string, unknown>): Promise<Response> {
  const callControlId = str(payload.call_control_id)
  const clientState = decodeClientState<CallClientState>(str(payload.client_state))
  if (!callControlId) return ack('no_call_control_id')

  if (clientState?.kind === 'supervisor') {
    safeLog('[solstice] supervisor leg answered', { call_control_id: callControlId })
    return ack('supervisor_leg_answered')
  }

  // Safety net only. The documented flow starts the assistant on call.initiated; this covers the
  // case where the call was not yet in a state Telnyx would accept ai_assistant_start on.
  if (!assistantStartFailed.has(callControlId)) return ack('already_started_or_not_ours')

  const session = await findSessionByCallControlId(sb, callControlId)
  if (!session) return ack('no_session_for_leg')

  const guestState = encodeClientState({ kind: 'guest', session_id: session.id })
  const started = await startAssistant(session.id, callControlId, guestState)
  if (started) assistantStartFailed.delete(callControlId)
  return ack('retry_start', { session_id: session.id, assistant_started: started })
}

// ---------------------------------------------------------------- transcript

/**
 * THE live transcript. Telnyx sends the FULL history each time, so we upsert on a deterministic
 * per-turn id rather than appending. Supabase Realtime pushes the insert to the supervisor UI,
 * which is what makes the split-screen demo work.
 */
async function onMessageHistoryUpdated(
  sb: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<Response> {
  const callControlId = str(payload.call_control_id)
  const conversationId = str(payload.conversation_id) ?? str(payload.telnyx_conversation_id)
  const clientState = decodeClientState<CallClientState>(str(payload.client_state))

  const turns = extractTurns(payload)
  if (turns.length === 0) return ack('no_turns_in_payload')

  let session: SessionRow | null = null
  if (clientState?.session_id) session = await getSessionById(sb, clientState.session_id)
  if (!session && callControlId) session = await findSessionByCallControlId(sb, callControlId)
  if (!session && conversationId) session = await findSessionByConversationId(sb, conversationId)
  if (!session && callControlId) {
    // A transcript with no session means we missed call.initiated. Recover rather than drop it.
    session = await ensureGuestSession(sb, callControlId, str(payload.from))
  }
  if (!session) return ack('no_session_resolved')

  if (conversationId && session.telnyx_conversation_id !== conversationId) {
    await updateSession(sb, session.id, { telnyx_conversation_id: conversationId })
  }

  const written = await upsertTranscriptTurns(sb, session.id, turns)
  return ack('transcript_upserted', { session_id: session.id, turns: written })
}

function extractTurns(payload: Record<string, unknown>): TranscriptTurn[] {
  const candidates = [payload.message_history, payload.messages, payload.history]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    const turns: TranscriptTurn[] = []
    for (const raw of candidate) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Record<string, unknown>
      const role = str(entry.role) ?? str(entry.speaker) ?? 'system'
      const content = str(entry.content) ?? str(entry.text) ?? str(entry.message) ?? flattenContent(entry.content)
      if (content) turns.push({ role, content })
    }
    if (turns.length > 0) return turns
  }
  return []
}

/** Some model APIs send content as an array of {type, text} parts. */
function flattenContent(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const parts = value
    .map((p) => (p && typeof p === 'object' ? str((p as Record<string, unknown>).text) : null))
    .filter((s): s is string => Boolean(s))
  return parts.length > 0 ? parts.join(' ') : null
}

// ---------------------------------------------------------------- archive

async function onConversationEnded(sb: SupabaseClient, payload: Record<string, unknown>): Promise<Response> {
  const conversationId = str(payload.conversation_id) ?? str(payload.telnyx_conversation_id)
  const callControlId = str(payload.call_control_id)

  let session: SessionRow | null = null
  if (callControlId) session = await findSessionByCallControlId(sb, callControlId)
  if (!session && conversationId) session = await findSessionByConversationId(sb, conversationId)
  if (!session) return ack('no_session_for_conversation')

  // A call the supervisor took over stays `taken_over` in the archive; that distinction is the
  // whole point of the status column.
  const patch: Partial<SessionRow> = {
    ended_at: new Date().toISOString(),
    telnyx_conversation_id: conversationId ?? session.telnyx_conversation_id,
  }
  if (session.status !== 'taken_over') patch.status = 'ended'
  await updateSession(sb, session.id, patch)

  await trace({
    session_id: session.id,
    tool: 'voice.conversation_ended',
    args: { conversation_id: conversationId ?? null },
    summary: 'Telnyx reported the assistant conversation ended',
    grounded: true,
  })
  return ack('conversation_ended', { session_id: session.id })
}

/**
 * Post-call insights. schema.sql has no `sessions.insights` column, so the blob is archived as a
 * tool_invocation on the session, which the supervisor trace already renders. See the note in
 * _lib/db.ts; a `sessions.insights jsonb` column would be the cleaner home.
 */
async function onInsightsGenerated(sb: SupabaseClient, payload: Record<string, unknown>): Promise<Response> {
  const conversationId = str(payload.conversation_id) ?? str(payload.telnyx_conversation_id)
  const callControlId = str(payload.call_control_id)

  let session: SessionRow | null = null
  if (conversationId) session = await findSessionByConversationId(sb, conversationId)
  if (!session && callControlId) session = await findSessionByCallControlId(sb, callControlId)

  const results = payload.results ?? payload.insights ?? payload.insight_results ?? null
  const insightSummary =
    typeof results === 'string' ? results : JSON.stringify(results ?? {}).slice(0, 8000)

  await trace({
    session_id: session?.id ?? null,
    tool: 'voice.conversation_insights',
    args: { conversation_id: conversationId ?? null },
    summary: insightSummary,
    grounded: true,
  })

  return ack('insights_archived', { session_id: session?.id ?? null })
}

// ---------------------------------------------------------------- hangup

async function onHangup(sb: SupabaseClient, payload: Record<string, unknown>): Promise<Response> {
  const callControlId = str(payload.call_control_id)
  const clientState = decodeClientState<CallClientState>(str(payload.client_state))
  if (!callControlId) return ack('no_call_control_id')

  // Supervisor legs never reach here; route() intercepts them via classifyLeg().
  void clientState

  const session = await findSessionByCallControlId(sb, callControlId)
  if (!session) return ack('no_session_for_leg')
  if (session.ended_at) return ack('already_ended')

  await updateSession(sb, session.id, {
    status: session.status === 'taken_over' ? 'taken_over' : 'ended',
    ended_at: new Date().toISOString(),
  })
  return ack('session_closed', { session_id: session.id })
}

// ---------------------------------------------------------------- helpers

async function ensureGuestSession(
  sb: SupabaseClient,
  callControlId: string,
  from: string | null,
): Promise<SessionRow> {
  const existing = await findSessionByCallControlId(sb, callControlId)
  if (existing) return existing

  const guest = await identifyCallerByPhone(sb, from)
  const label = guest
    ? guest.loyalty_tier
      ? `${guest.label} (${guest.loyalty_tier})`
      : guest.label
    : `Unknown caller ${maskPhone(from)}`

  const session = await insertSession(sb, {
    channel: 'voice',
    call_control_id: callControlId,
    guest_id: guest?.guest_id ?? null,
    guest_label: label,
    phone_masked: maskPhone(from),
    status: 'active',
  })

  await trace({
    session_id: session.id,
    tool: 'identify_guest',
    args: { channel: 'voice', phone: from },
    summary: guest ? `Matched ${guest.guest_id}` : 'No guest matched this caller ID',
    grounded: Boolean(guest),
  })

  safeLog('[solstice] voice session opened', {
    session_id: session.id,
    guest_id: guest?.guest_id ?? null,
    phone: from,
  })
  return session
}

async function startAssistant(
  sessionId: string,
  callControlId: string,
  clientState: string,
): Promise<boolean> {
  const assistantId = envOrNull('TELNYX_ASSISTANT_ID')
  if (!assistantId) {
    console.error('[solstice] TELNYX_ASSISTANT_ID is not set; run scripts/telnyx/provision.mjs')
    await trace({
      session_id: sessionId,
      tool: 'voice.ai_assistant_start',
      summary: 'FAILED: TELNYX_ASSISTANT_ID not configured',
      grounded: false,
    })
    return false
  }

  const started = new Date()
  const res = await aiAssistantStart(callControlId, assistantId, {
    clientState,
    greeting: envOrNull('TELNYX_ASSISTANT_GREETING') ?? undefined,
  })
  const latency = Date.now() - started.getTime()

  await trace({
    session_id: sessionId,
    tool: 'voice.ai_assistant_start',
    args: { assistant_id: assistantId, send_message_history_updates: true },
    summary: res.ok ? 'Sol started with live history updates' : `FAILED: ${res.error}`,
    grounded: res.ok,
    latency_ms: latency,
  })

  if (!res.ok) console.error(`[solstice] ai_assistant_start failed: ${res.error}`)
  return res.ok
}

/**
 * Trace row helper. Fills the shared recordToolInvocation contract and runs args through the
 * shared maskArgs, so nothing unmasked can reach `tool_invocations.args_masked`. The shared
 * helper resolves its own client and never throws, so a failed trace cannot drop a live call.
 */
async function trace(row: {
  session_id: string | null
  tool: string
  args?: Record<string, unknown>
  summary: string
  grounded: boolean
  latency_ms?: number | null
}): Promise<void> {
  await recordToolInvocation({
    session_id: row.session_id,
    tool: row.tool,
    args_masked: maskArgs(row.args ?? {}).masked,
    result_summary: row.summary,
    grounded: row.grounded,
    latency_ms: row.latency_ms ?? null,
  })
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
