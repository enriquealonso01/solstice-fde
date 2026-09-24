// The human-takeover ladder.  POST /api/voice/supervisor  { session_id, action }
//
//   action = listen   -> dial a supervisor leg with supervisor_role "monitor"
//   action = whisper  -> switch_supervisor_role "whisper"  (only the agent side hears us)
//   action = barge    -> switch_supervisor_role "barge"    (everyone hears us)
//   action = takeover -> ai_assistant_stop on the guest leg, supervisor promoted to barge
//
// Agent A5 calls this from the supervisor dashboard. Exactly the ladder in plans/02-voice-realtime.md.
//
// ---------------------------------------------------------------------------------------------
// DOCUMENTED FALLBACK, must be tested once the account has balance
// ---------------------------------------------------------------------------------------------
// Telnyx documents `supervise_call_control_id` + `supervisor_role` for ordinary Call Control legs,
// and it documents `ai_assistant_start`. It does NOT document whether supervision works against a
// leg that is currently running an AI assistant. Mechanically the assistant leg is an ordinary
// Call Control leg, so it should; nothing in the docs says it does not. That is an assumption,
// and it is the single riskiest assumption in the voice path.
//
// If `listen` returns an error along the lines of "cannot supervise this call" / "invalid call
// state", switch to the conference shape, which IS explicitly documented as a real combination:
//
//   1. On call.initiated (netlify/functions/telnyx/index.ts), instead of answering and starting
//      the assistant on the bare leg:
//        POST /v2/calls/{guest_leg}/actions/answer
//        POST /v2/conferences  { call_control_id: guest_leg, name: `session-${session_id}` }
//        POST /v2/calls/{guest_leg}/actions/ai_assistant_start  { send_message_history_updates: true }
//      (the assistant runs on the leg that is already a conference participant)
//   2. For `listen` here, replace dialSupervisorLeg(...) with:
//        POST /v2/calls  { to: supervisorSipUri(), from: TELNYX_PHONE_NUMBER,
//                          connection_id: TELNYX_CALL_CONTROL_APP_ID }
//        then on call.answered for that leg:
//        POST /v2/conferences/{conference_id}/actions/join
//          { call_control_id: supervisor_leg, supervisor_role: "monitor", mute: true }
//   3. whisper / barge become:
//        POST /v2/conferences/{conference_id}/actions/update
//          { call_control_id: supervisor_leg, supervisor_role: "whisper" | "barge" }
//   4. `takeover` is unchanged: ai_assistant_stop on the guest leg, supervisor unmuted at barge.
//
// The state this module persists (supervisor leg id per session, in `tool_invocations`) is the
// same under both shapes, so swapping is a change to three call sites, not a redesign.
// ---------------------------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { json, readJsonBody } from '../telnyx/_lib/http'
import { envOrNull, supervisorSipUri } from '../telnyx/_lib/env'
import {
  aiAssistantStop,
  dialSupervisorLeg,
  encodeClientState,
  switchSupervisorRole,
  type SupervisorRole,
} from '../telnyx/_lib/telnyxClient'
import {
  SUPERVISOR_LEG_TOOL,
  findLiveSupervisorLeg,
  getSessionById,
  insertMessage,
  isDbUnavailable,
  recordToolInvocation,
  serviceClient,
  updateSession,
  writeAudit,
} from '../telnyx/_lib/db'
import { safeLog } from '../telnyx/_lib/mask'

export const SUPERVISOR_ACTIONS = ['listen', 'whisper', 'barge', 'takeover'] as const
export type SupervisorAction = (typeof SUPERVISOR_ACTIONS)[number]

export interface SupervisorRequestBody {
  session_id: string
  action: SupervisorAction
  /** Optional: profiles.id of the staff member clicking, for audit_log. */
  actor_id?: string | null
}

export interface SupervisorResponseBody {
  ok: boolean
  action: SupervisorAction | null
  /** The supervisor's own leg, if one is live. A5 does not need it, but it makes debugging sane. */
  supervisor_call_control_id: string | null
  role: SupervisorRole | null
  session_status: string | null
  message: string
  error?: string
}

const ACTION_TO_ROLE: Record<SupervisorAction, SupervisorRole> = {
  listen: 'monitor',
  whisper: 'whisper',
  barge: 'barge',
  takeover: 'barge',
}

function fail(message: string, status: number, action: SupervisorAction | null = null): Response {
  const body: SupervisorResponseBody = {
    ok: false,
    action,
    supervisor_call_control_id: null,
    role: null,
    session_status: null,
    message,
    error: message,
  }
  return json(body, status)
}

export async function handleSupervisor(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail('method_not_allowed', 405)

  const parsed = await readJsonBody<SupervisorRequestBody>(req)
  if (!parsed.ok) return fail(parsed.error, 400)

  const { session_id: sessionId, action, actor_id: actorId } = parsed.value
  if (!sessionId || typeof sessionId !== 'string') return fail('session_id is required', 400)
  if (!SUPERVISOR_ACTIONS.includes(action)) {
    return fail(`action must be one of ${SUPERVISOR_ACTIONS.join(', ')}`, 400)
  }

  const sb = serviceClient()
  if (isDbUnavailable(sb)) return fail(sb.error, 503, action)

  const connectionId = envOrNull('TELNYX_CALL_CONTROL_APP_ID')
  const fromNumber = envOrNull('TELNYX_PHONE_NUMBER')
  if (!connectionId || !fromNumber) {
    return fail(
      'TELNYX_CALL_CONTROL_APP_ID and TELNYX_PHONE_NUMBER must be set. Run scripts/telnyx/provision.mjs.',
      503,
      action,
    )
  }

  let sipUri: string
  try {
    sipUri = supervisorSipUri()
  } catch (err) {
    return fail((err as Error).message, 503, action)
  }

  try {
    const session = await getSessionById(sb, sessionId)
    if (!session) return fail(`no session ${sessionId}`, 404, action)
    if (session.channel !== 'voice') {
      return fail('supervision applies to voice sessions only; chat takeover is a different path', 409, action)
    }
    if (!session.call_control_id) {
      return fail('session has no call_control_id, so there is no live leg to supervise', 409, action)
    }
    if (session.status === 'ended' || session.ended_at) {
      return fail('this call has already ended', 409, action)
    }

    const guestLeg = session.call_control_id
    const clientState = encodeClientState({ kind: 'supervisor', session_id: session.id })
    const targetRole = ACTION_TO_ROLE[action]

    // ------------------------------------------------------------------ takeover
    if (action === 'takeover') {
      const stopped = await aiAssistantStop(guestLeg)
      if (!stopped.ok) {
        await trace(sb, session.id, 'supervisor.takeover', { role: 'barge' }, `FAILED: ${stopped.error}`, false)
        return fail(`ai_assistant_stop failed: ${stopped.error}`, 502, action)
      }

      // The call stays live (Telnyx docs are explicit about this); now make sure the human is
      // actually audible to the guest.
      const leg = await ensureLeg(sb, {
        sessionId: session.id,
        guestLeg,
        connectionId,
        fromNumber,
        sipUri,
        clientState,
        role: 'barge',
      })

      await updateSession(sb, session.id, { status: 'taken_over' })
      await insertMessage(
        sb,
        session.id,
        'supervisor',
        'Supervisor took over the call. Sol has been stopped; the guest is still connected.',
      )
      await writeAudit(sb, {
        actor: actorId ?? null,
        action: 'voice.takeover',
        subject: `session:${session.id}`,
        detail: { supervisor_call_control_id: leg.callControlId, leg_error: leg.error ?? null },
      })
      await trace(sb, session.id, 'supervisor.takeover', { role: 'barge' }, 'Sol stopped, call still live', true)

      const body: SupervisorResponseBody = {
        ok: true,
        action,
        supervisor_call_control_id: leg.callControlId,
        role: 'barge',
        session_status: 'taken_over',
        message: leg.callControlId
          ? 'Sol stopped. You are live on the call.'
          : `Sol stopped and the call is still up, but the supervisor leg could not be dialled: ${leg.error}`,
      }
      return json(body, 200)
    }

    // ------------------------------------------------------- listen / whisper / barge
    const existing = await findLiveSupervisorLeg(sb, session.id)

    if (existing) {
      if (existing.role === targetRole) {
        const body: SupervisorResponseBody = {
          ok: true,
          action,
          supervisor_call_control_id: existing.supervisor_call_control_id,
          role: targetRole,
          session_status: session.status,
          message: `Already on ${targetRole}.`,
        }
        return json(body, 200)
      }

      const switched = await switchSupervisorRole(existing.supervisor_call_control_id, targetRole, clientState)
      if (!switched.ok) {
        await trace(sb, session.id, `supervisor.${action}`, { role: targetRole }, `FAILED: ${switched.error}`, false)
        return fail(`switch_supervisor_role failed: ${switched.error}`, 502, action)
      }

      // Re-record the leg at its new role so the next lookup reads the current rung.
      await recordToolInvocation(sb, {
        session_id: session.id,
        tool: SUPERVISOR_LEG_TOOL,
        args_masked: { supervisor_call_control_id: existing.supervisor_call_control_id, role: targetRole },
        result_summary: `Supervisor role switched to ${targetRole}`,
        grounded: true,
      })
      await writeAudit(sb, {
        actor: actorId ?? null,
        action: `voice.${action}`,
        subject: `session:${session.id}`,
        detail: { role: targetRole },
      })

      const body: SupervisorResponseBody = {
        ok: true,
        action,
        supervisor_call_control_id: existing.supervisor_call_control_id,
        role: targetRole,
        session_status: session.status,
        message:
          targetRole === 'monitor'
            ? 'Listening. Neither side can hear you.'
            : targetRole === 'whisper'
              ? 'Whispering. Only Sol hears you.'
              : 'Barged in. Both sides hear you.',
      }
      return json(body, 200)
    }

    // No leg yet. Dial one straight at the requested rung, so clicking Whisper without having
    // clicked Listen first still does the obvious thing.
    const leg = await ensureLeg(sb, {
      sessionId: session.id,
      guestLeg,
      connectionId,
      fromNumber,
      sipUri,
      clientState,
      role: targetRole,
    })
    if (!leg.callControlId) return fail(leg.error ?? 'could not dial supervisor leg', 502, action)

    await writeAudit(sb, {
      actor: actorId ?? null,
      action: `voice.${action}`,
      subject: `session:${session.id}`,
      detail: { role: targetRole, supervisor_call_control_id: leg.callControlId },
    })

    const body: SupervisorResponseBody = {
      ok: true,
      action,
      supervisor_call_control_id: leg.callControlId,
      role: targetRole,
      session_status: session.status,
      message: `Supervisor leg ringing your browser at ${sipUri}. Answer it to ${action}.`,
    }
    return json(body, 200)
  } catch (err) {
    safeLog(`supervisor ${action} threw`, { session_id: sessionId })
    return fail((err as Error).message, 500, action)
  }
}

// ---------------------------------------------------------------- leg management

interface EnsureLegArgs {
  sessionId: string
  guestLeg: string
  connectionId: string
  fromNumber: string
  sipUri: string
  clientState: string
  role: SupervisorRole
}

/**
 * Return the live supervisor leg, dialling one if there is none.
 * Never throws: takeover must still report success on stopping Sol even if the browser leg fails.
 */
async function ensureLeg(
  sb: SupabaseClient,
  args: EnsureLegArgs,
): Promise<{ callControlId: string | null; error?: string }> {
  const existing = await findLiveSupervisorLeg(sb, args.sessionId)
  if (existing) {
    if (existing.role === args.role) return { callControlId: existing.supervisor_call_control_id }
    const switched = await switchSupervisorRole(existing.supervisor_call_control_id, args.role, args.clientState)
    if (switched.ok) {
      await recordToolInvocation(sb, {
        session_id: args.sessionId,
        tool: SUPERVISOR_LEG_TOOL,
        args_masked: { supervisor_call_control_id: existing.supervisor_call_control_id, role: args.role },
        result_summary: `Supervisor role switched to ${args.role}`,
        grounded: true,
      })
      return { callControlId: existing.supervisor_call_control_id }
    }
    return { callControlId: existing.supervisor_call_control_id, error: switched.error }
  }

  const started = Date.now()
  const dialled = await dialSupervisorLeg({
    connectionId: args.connectionId,
    to: args.sipUri,
    from: args.fromNumber,
    superviseCallControlId: args.guestLeg,
    supervisorRole: args.role,
    clientState: args.clientState,
  })

  if (!dialled.ok) {
    await trace(
      sb,
      args.sessionId,
      SUPERVISOR_LEG_TOOL,
      { role: args.role, to: args.sipUri },
      `FAILED: ${dialled.error}`,
      false,
      Date.now() - started,
    )
    return { callControlId: null, error: dialled.error }
  }

  const ccid = dialled.data?.call_control_id ?? null
  await recordToolInvocation(sb, {
    session_id: args.sessionId,
    tool: SUPERVISOR_LEG_TOOL,
    args_masked: { supervisor_call_control_id: ccid, role: args.role, to: args.sipUri },
    result_summary: `Supervisor leg dialled at ${args.role}`,
    grounded: true,
    latency_ms: Date.now() - started,
  })
  return { callControlId: ccid }
}

async function trace(
  sb: SupabaseClient,
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  summary: string,
  grounded: boolean,
  latencyMs?: number,
): Promise<void> {
  await recordToolInvocation(sb, {
    session_id: sessionId,
    tool,
    args_masked: args,
    result_summary: summary,
    grounded,
    latency_ms: latencyMs ?? null,
  })
}
