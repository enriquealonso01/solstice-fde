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
import { attachableReservation, findGuestById, foreignGuestId } from './lookups'
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

/**
 * One conversation, one open escalation per category.
 *
 * A two-turn group request produced TWO rows: the model calls `create_escalation` when it has the
 * gist, and again once the guest gives an email. Measured on production, five of thirty-one
 * sessions carried a duplicate — the supervisor's queue shows one guest twice, and the FIRST copy
 * is the one missing the detail, so the more complete row is the one that looks like the repeat.
 *
 * The guarantee belongs here rather than in the prompt. "Do not call this twice" is a rule a model
 * follows most of the time; this makes it true every time, which is the same reason the business
 * rules live in the tool layer and not in the instructions.
 *
 * Category is part of the key on purpose. A caller whose group enquiry turns into a safety report
 * must open a SECOND escalation — different category, different authority, different urgency — and
 * silently folding that into the first would be a far worse bug than the one being fixed. Only an
 * `open` row is a merge target: once a supervisor has closed one, a fresh problem is a fresh row.
 */
export function mergeTargetFor(
  rows: Array<{ id: string; category: string; status: string }> | null | undefined,
  category: string,
): string | null {
  if (!rows) return null
  const hit = rows.find((r) => r.category === category && r.status === 'open')
  return hit ? hit.id : null
}

// ---------------------------------------------------------- create_escalation

export async function createEscalation(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const summary = optString(args, 'summary') ?? optString(args, 'reason')
  if (!summary) return toolFail('An escalation needs a one-line summary of what happened.')

  const requested = optString(args, 'category')
  const category: EscalationCategory =
    requested && (CATEGORIES as string[]).includes(requested) ? (requested as EscalationCategory) : inferCategory(`${requested ?? ''} ${summary}`)

  const route = ESCALATION_MATRIX[category]

  const foreign = foreignGuestId(args, ctx)
  if (foreign) return toolFail(foreign)
  // Never refused for want of verification; it attaches only records this conversation has proven.
  const reservation = await attachableReservation(args, ctx)
  // Kept for the manager on the stored packet only, marked unverified; never looked up.
  const claimed = reservation ? undefined : (optString(args, 'reservation_id') ?? optString(args, 'confirmation_number'))
  const guest = ctx.guest_id ? await findGuestById(ctx.guest_id) : null

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
  let mergedIntoExisting = false
  try {
    const db = getDatabase()
    if (db) {
      // Look for an open escalation this session already raised in the same category, and enrich it
      // rather than adding a second row. See mergeTargetFor above for why category is part of the key.
      let existingId: string | null = null
      if (ctx.session_id) {
        const { data: open } = await db
          .from('escalations')
          .select('id,category,status')
          .eq('session_id', ctx.session_id)
        existingId = mergeTargetFor(open as Array<{ id: string; category: string; status: string }> | null, category)
      }

      if (existingId) {
        packet.escalation_id = existingId
        const { error } = await db
          .from('escalations')
          .update({
            severity: route.severity,
            summary,
            packet: claimed ? { ...packet, claimed_reservation_id_unverified: claimed } : packet,
          })
          .eq('id', existingId)
        if (error) persistenceError = error.message
        else {
          persistedId = existingId
          mergedIntoExisting = true
        }
      } else {
        const { data, error } = await db
          .from('escalations')
          .insert({
            session_id: ctx.session_id ?? null,
            category,
            severity: route.severity,
            summary,
            packet: claimed ? { ...packet, claimed_reservation_id_unverified: claimed } : packet,
            status: 'open',
          })
          .select('id')
          .single()
        if (error) persistenceError = error.message
        else if (data && typeof data.id === 'string') persistedId = data.id
      }
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
      // True when this enriched the escalation the session already had rather than opening a
      // second one. Visible in the trace so the audit trail shows a merge, not a silent drop.
      merged_into_existing: mergedIntoExisting,
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

  const escalationExists = Boolean(escalationId)

  if (ctx.channel === 'voice') {
    // Two variables decide this, not one. `TELNYX_TRANSFER_TARGET` is absent from the deployed
    // environment, but `DEMO_PHONE` is set and is the `??` fallback, so `configured` is TRUE in
    // production — the announce-the-handoff path is the live one, not the refusal below. Checked with
    // `netlify env:list` against the deploy, because the local `.env` has neither.
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
        //
        // AND the one that is not about configuration at all. A warm transfer is announced BEFORE it
        // connects, so between the announcement and the pickup there is a window in which the guest
        // has been told a manager is coming and nothing durable exists — and a transfer can fail for
        // reasons this branch cannot see, an unfunded account being the obvious one. That is G16 on
        // the leg G16 was written for. So when no escalation exists yet, say so here too: the chat
        // branch below has done this since PR #7 and the asymmetry was an oversight, not a decision.
        fallback: configured
          ? escalationExists
            ? null
            : 'No escalation exists yet, so if this transfer does not connect nothing durable has reached a human. Call create_escalation before you announce the handoff.'
          : 'No transfer destination is configured, so the call cannot be handed off live. Tell the guest a manager will call them back today, create an escalation if one does not exist yet, and stay with the guest until they are done.',
        human_reason: configured
          ? escalationExists
            ? 'Announce the handoff before it happens, read the context back to the person picking up, then step aside.'
            : 'Create the escalation first, so there is a written record if the transfer does not connect. Then announce the handoff, read the context back to the person picking up, and step aside.'
          : 'Do not pretend a transfer happened. Say plainly that you are putting a manager on it and that they will call back today.',
      },
      { citations: [policyCitation(15)] },
    )
  }

  // Chat: the supervisor console owns takeover. The tool raises the hand; it does
  // not flip the session itself, because a session is only "taken_over" once a
  // human has actually joined it.
  //
  // WHICH MEANS NOBODY IS GUARANTEED TO BE WATCHING. There is no supervisor presence
  // signal anywhere in this system, and nothing consumes `request_supervisor_takeover`:
  // takeover happens when a human sitting at the console chooses to join. So this branch
  // must not tell the guest that a colleague is joining *now*, or ask them to hold while
  // someone "connects" — that is G16's failure ("I'm transferring you now" into silence)
  // wearing a different channel. The voice branch above refuses to pretend when no transfer is
  // configured — and, since iteration 54, also insists on a record when one IS configured, because
  // that is the live configuration and an announced transfer can still fail to connect.
  //
  // The durable record is the escalation, not this call. If one does not exist yet, the
  // hand has not actually been raised anywhere a human will see it, and saying so is the
  // whole point of `fallback`.
  return toolOk(
    {
      directive: 'request_supervisor_takeover',
      // A supervisor *can* join a chat, so the route exists. What is not true is that one
      // is on their way, so the two facts are reported separately rather than as one flag.
      transfer_available: true,
      live_handoff_guaranteed: false,
      session_id: ctx.session_id ?? null,
      context_readback: readback,
      escalation_id: escalationId,
      authority_required: route.authority,
      fallback: escalationExists
        ? null
        : 'No escalation exists yet, so nothing durable has reached a human. Call create_escalation before you finish this turn, then tell the guest a manager has it.',
      human_reason: escalationExists
        ? 'A manager has this in writing. Tell the guest a manager is taking it and will pick it up here, stay with them, and do not close the conversation yourself. Do not say a colleague is joining now, do not ask them to hold while someone connects, and do not promise how long it will take.'
        : 'Do not tell the guest anyone is joining. Create the escalation first, then say a manager is taking it and will come back to them here. Never describe a handoff that has not happened.',
    },
    { citations: [policyCitation(15)] },
  )
}
