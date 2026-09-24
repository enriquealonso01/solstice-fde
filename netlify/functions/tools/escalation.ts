/**
 * create_escalation and transfer_to_human (Policy 15).
 *
 * The escalation packet is the handoff contract: whoever picks the guest up,
 * human or otherwise, gets the whole situation without the guest repeating it.
 * The matrix that decides WHO gets it lives in rules.ts as data, so a supervisor
 * can audit the routing without reading TypeScript.
 */
import type { Citation, EscalationPacket, ToolResult } from '../../../shared/types'
import { getDatabase, toolFail, toolOk } from './_deps'
import {
  guestCitation,
  normalizeText,
  optString,
  optStringArray,
  policyCitation,
  reservationCitation,
  type ToolArgs,
  type ToolContext,
} from './helpers'
import { findGuestById, findReservationById } from './lookups'
import { ESCALATION_MATRIX, ESCALATION_TRIGGERS, type EscalationCategory } from './rules'

const CATEGORIES: EscalationCategory[] = ['refund', 'dispute', 'medical', 'legal', 'safety', 'authority_exceeded', 'other']

/** Plain-language trigger matching, auditable in rules.ts. Safety wins ties. */
export function inferCategory(text: string): EscalationCategory {
  const q = normalizeText(text)
  const hits: EscalationCategory[] = []
  for (const trigger of ESCALATION_TRIGGERS) {
    if (trigger.match.some((m) => q.includes(normalizeText(m)))) hits.push(trigger.category)
  }
  if (hits.includes('safety')) return 'safety'
  if (hits.includes('medical')) return 'medical'
  if (hits.includes('legal')) return 'legal'
  return hits[0] ?? 'other'
}

function newId(prefix: string): string {
  const rnd =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().split('-')[0].toUpperCase()
      : Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')
  return `${prefix}-${rnd}`
}

// ---------------------------------------------------------- create_escalation

export async function createEscalation(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const summary = optString(args, 'summary') ?? optString(args, 'reason')
  if (!summary) return toolFail('An escalation needs a one-line summary of what happened.')

  const requested = optString(args, 'category')
  const category: EscalationCategory =
    requested && (CATEGORIES as string[]).includes(requested) ? (requested as EscalationCategory) : inferCategory(`${requested ?? ''} ${summary}`)

  const route = ESCALATION_MATRIX[category]

  const reservationId = optString(args, 'reservation_id')
  const guestId = optString(args, 'guest_id') ?? ctx.guest_id
  const reservation = reservationId ? await findReservationById(reservationId) : null
  const guest = guestId ? await findGuestById(guestId) : reservation ? await findGuestById(reservation.guest_id) : null

  const citations: Citation[] = [policyCitation(15)]
  if (reservation) citations.push(reservationCitation(reservation.reservation_id))
  if (guest) citations.push(guestCitation(guest.guest_id))

  const localId = newId('ESC')
  const packet: EscalationPacket = {
    escalation_id: localId,
    session_id: ctx.session_id ?? '',
    category,
    severity: route.severity,
    summary,
    policy_citations: citations,
    attempted_resolutions: optStringArray(args, 'attempted_resolutions') ?? [],
    transcript_excerpt: optString(args, 'transcript_excerpt') ?? '',
    recommended_action: optString(args, 'recommended_action') ?? route.human_reason,
    authority_required: route.authority,
  }

  // The supervisor dashboard reads this table live. A missing table is a config
  // problem, not a reason to drop the escalation on the floor.
  let persistedId: string | null = null
  let persistenceError: string | null = null
  try {
    const db = getDatabase()
    if (db) {
      const { data, error } = await db
        .from('escalations')
        .insert({
          session_id: ctx.session_id ?? null,
          category,
          severity: route.severity,
          summary,
          packet,
          status: 'open',
        })
        .select('id')
        .single()
      if (error) persistenceError = error.message
      else if (data && typeof data.id === 'string') persistedId = data.id
    } else {
      persistenceError = 'No database configured; the escalation was not recorded.'
    }
  } catch (err) {
    persistenceError = err instanceof Error ? err.message : String(err)
  }

  return toolOk(
    {
      escalation_id: persistedId ?? localId,
      persisted: persistedId !== null,
      persistence_error: persistenceError,
      category,
      severity: route.severity,
      timing: route.timing,
      authority_required: route.authority,
      notify: route.notify,
      routing_is_mapped_assumption: route.mapped_assumption,
      routing_reason: route.human_reason,
      packet,
      may_promise: false,
      human_reason:
        route.timing === 'immediate_any_hour'
          ? `Policy 15 routes this straight to ${route.notify.join(' and ')}, any hour, without waiting for a manager on site. Tell the guest a manager is being brought in right now. Do not promise an outcome.`
          : `Policy 15 routes this to ${route.notify.join(' or ')} the same day. Tell the guest it is with a manager today and that they will hear back. Do not promise an outcome.`,
    },
    { citations },
  )
}

// --------------------------------------------------------- transfer_to_human

export async function transferToHuman(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const reason = optString(args, 'reason')
  if (!reason) return toolFail('A transfer needs a reason, so the human picking up knows what they are walking into.')

  const escalationId = optString(args, 'escalation_id') ?? null
  const category = optString(args, 'category') ?? inferCategory(reason)
  const route = ESCALATION_MATRIX[(CATEGORIES as string[]).includes(category) ? (category as EscalationCategory) : 'other']

  const readback = [
    `Reason: ${reason}.`,
    escalationId ? `Escalation ${escalationId}.` : null,
    `Authority needed: ${route.authority}.`,
    ctx.guest_id ? `Guest ${ctx.guest_id}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  if (ctx.channel === 'voice') {
    const target = process.env.TELNYX_TRANSFER_TARGET ?? process.env.DEMO_PHONE ?? null
    const configured = Boolean(target) && Boolean(process.env.TELNYX_API_KEY)
    return toolOk(
      {
        directive: 'telnyx_warm_transfer',
        transfer_available: configured,
        target: configured ? target : null,
        warm: true,
        context_readback: readback,
        escalation_id: escalationId,
        authority_required: route.authority,
        // Explicit failure path: the Telnyx account cannot place the call today.
        fallback: configured
          ? null
          : 'No transfer destination is configured, so the call cannot be handed off live. Tell the guest a manager will call them back today, create an escalation if one does not exist yet, and stay with the guest until they are done.',
        human_reason: configured
          ? 'Announce the handoff before it happens, read the context back to the person picking up, then step aside.'
          : 'Do not pretend a transfer happened. Say plainly that you are putting a manager on it and that they will call back today.',
      },
      { citations: [policyCitation(15)] },
    )
  }

  // Chat: the supervisor console owns takeover. The tool raises the hand; it does
  // not flip the session itself, because a session is only "taken_over" once a
  // human has actually joined it.
  return toolOk(
    {
      directive: 'request_supervisor_takeover',
      transfer_available: true,
      session_id: ctx.session_id ?? null,
      context_readback: readback,
      escalation_id: escalationId,
      authority_required: route.authority,
      human_reason:
        'A supervisor has been flagged into this conversation. Tell the guest a colleague is joining the chat, keep them company until that happens, and do not close the conversation yourself.',
    },
    { citations: [policyCitation(15)] },
  )
}
