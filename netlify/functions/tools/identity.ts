/**
 * identify_guest and get_reservation.
 *
 * Two guardrails live here rather than in the prompt:
 *  1. TWO FACTORS OR NOTHING. A guest is verified only by a pair in VERIFICATION_FACTOR_PAIRS
 *     (lookups.ts). Every failure returns the same NOT_VERIFIED payload, so the chat cannot be used
 *     to learn which confirmation numbers exist or who holds them.
 *  2. THE CARD LAST 4 NEVER LEAVES THE TOOL LAYER. It is not returned to the model at all, so the
 *     model cannot say it, on either channel.
 */
import type { Citation, Guest, Reservation, ToolResult } from '../../../shared/types'
import { toolOk, toolFail, toolState, toolUngrounded } from './_deps'
import {
  atLocalTime,
  guestCitation,
  hoursBetween,
  nowFrom,
  optString,
  policyCitation,
  propertyCitation,
  reservationCitation,
  type ToolArgs,
  type ToolContext,
} from './helpers'
import {
  FACTOR_PAIRS_IN_WORDS,
  findPropertyByCode,
  foreignGuestId,
  pickRelevantReservation,
  reservationOfVerifiedGuest,
  reservationsForGuest,
  VERIFICATION_FACTOR_PAIRS,
  verifyIdentity,
  type IdentityFactor,
} from './lookups'
import { POLICY_RULES, RATE_PLAN_TERMS } from './rules'

// ------------------------------------------------------------- identify_guest

/** The only answer to a failed verification: identical whether or not the number exists. */
export const NOT_VERIFIED = {
  verified: false,
  accepted_factor_pairs: VERIFICATION_FACTOR_PAIRS.map((pair) => pair.join(' + ')),
  next_step: `Not verified. Ask for ${FACTOR_PAIRS_IN_WORDS}. Say nothing about any booking, and do not say whether the number exists, until identify_guest returns verified: true.`,
}

export async function identifyGuest(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const foreign = foreignGuestId(args, ctx)
  if (foreign) return toolFail(foreign)

  const claim = {
    confirmation_number: optString(args, 'confirmation_number') ?? optString(args, 'reservation_id'),
    // The voice tool sends the caller's full name as `name`.
    last_name: optString(args, 'last_name') ?? optString(args, 'name'),
    phone: optString(args, 'phone'),
    email: optString(args, 'email'),
  }

  // Only proof verifies: an identity already on the conversation is never re-issued without it.
  if (!Object.values(claim).some(Boolean)) return toolFail(`No identifying detail supplied. Ask for ${FACTOR_PAIRS_IN_WORDS}.`)

  const match = verifyIdentity(claim)
  return match ? verifiedResult(match.guest, match.matched_on, ctx) : toolState(NOT_VERIFIED)
}

async function verifiedResult(guest: Guest, matchedOn: IdentityFactor[], ctx: ToolContext): Promise<ToolResult> {
  const stays = await reservationsForGuest(guest.guest_id)
  const relevant = pickRelevantReservation(stays, nowFrom(ctx))

  const citations: Citation[] = [guestCitation(guest.guest_id)]
  if (relevant) citations.push(reservationCitation(relevant.reservation_id))

  return toolOk(
    {
      verified: true,
      matched_on: matchedOn,
      guest: {
        guest_id: guest.guest_id,
        first_name: guest.first_name,
        last_name: guest.last_name,
        loyalty_tier: guest.loyalty_tier,
        loyalty_points: guest.loyalty_points,
        member_since: guest.member_since,
        email_masked: guest.email_masked,
        phone_masked: guest.phone_masked,
      },
      reservations: stays.map((r) => ({
        reservation_id: r.reservation_id,
        property_code: r.property_code,
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        status: r.status,
      })),
      most_relevant_reservation_id: relevant?.reservation_id ?? null,
    },
    { citations, masked_fields: ['email', 'phone'] },
  )
}

// ------------------------------------------------------------- get_reservation

interface CancellationTerms {
  rate_plan: string
  refund_class: string
  human_summary: string
  recourse: string | null
  free_cancellation_deadline: string | null
  inside_free_cancellation_window: boolean | null
  penalty_if_cancelled_now: string | null
  policy_ref: number | null
  no_show_charge_applied: boolean
}

export function cancellationTerms(reservation: Reservation, now: Date): CancellationTerms {
  const terms = RATE_PLAN_TERMS[reservation.rate_plan] ?? {
    refund_class: 'not_documented' as const,
    policy_ref: null,
    human_summary: `No written policy covers the rate plan "${reservation.rate_plan}". Do not extrapolate.`,
    recourse: null,
  }

  const isNoShow = reservation.status === 'No-show'
  const base: CancellationTerms = {
    rate_plan: reservation.rate_plan,
    refund_class: terms.refund_class,
    human_summary: terms.human_summary,
    recourse: terms.recourse,
    free_cancellation_deadline: null,
    inside_free_cancellation_window: null,
    penalty_if_cancelled_now: null,
    policy_ref: terms.policy_ref,
    no_show_charge_applied: isNoShow,
  }

  if (isNoShow) {
    base.human_summary =
      'Marked a no-show. Policy 4 charges the full first night whatever the rate plan. On an Advance Purchase booking already paid in full there is nothing further to refund.'
    base.policy_ref = 4
    return base
  }

  if (terms.refund_class === 'free_cancellation_window') {
    const checkIn = atLocalTime(reservation.check_in_date, POLICY_RULES.standard_check_in_local)
    const deadline = new Date(checkIn.getTime() - POLICY_RULES.free_cancellation_window_hours * 3_600_000)
    base.free_cancellation_deadline = deadline.toISOString()
    const past = now.getTime() > deadline.getTime()
    base.inside_free_cancellation_window = !past
    base.penalty_if_cancelled_now = past ? POLICY_RULES.late_cancellation_penalty : 'none'

    // State which side of the deadline this booking is on: a fact the model has to derive from a
    // boolean is a fact it can get backwards.
    const deadlineText = deadline.toISOString().slice(0, 10)
    base.human_summary = past
      ? `${terms.human_summary} This booking is PAST that deadline, which fell on ${deadlineText}, so cancelling now forfeits ${POLICY_RULES.late_cancellation_penalty}. It is too late to cancel free of charge.`
      : `${terms.human_summary} This booking is STILL INSIDE the free window, which runs until ${deadlineText}, so cancelling now costs nothing.`
  }

  if (terms.refund_class === 'non_refundable') {
    base.penalty_if_cancelled_now = 'the full booking; it is non-refundable and non-changeable'
  }

  return base
}

export async function getReservation(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const owned = await reservationOfVerifiedGuest(args, ctx)
  if ('error' in owned) return toolFail(owned.error)
  const reservation = owned.reservation
  const now = nowFrom(ctx)

  const property = await findPropertyByCode(reservation.property_code)
  const terms = cancellationTerms(reservation, now)

  const citations: Citation[] = [reservationCitation(reservation.reservation_id)]
  if (property) citations.push(propertyCitation(property.property_code, property.property_name))
  if (terms.policy_ref) citations.push(policyCitation(terms.policy_ref))

  const hoursToCheckIn = hoursBetween(now, atLocalTime(reservation.check_in_date, POLICY_RULES.standard_check_in_local))
  const hoursSinceCheckOut = hoursBetween(atLocalTime(reservation.check_out_date, POLICY_RULES.standard_check_out_local), now)

  const data = {
    reservation: {
      reservation_id: reservation.reservation_id,
      guest_id: reservation.guest_id,
      property_code: reservation.property_code,
      property_name: property?.property_name ?? null,
      check_in_date: reservation.check_in_date,
      check_out_date: reservation.check_out_date,
      room_type: reservation.room_type,
      rate_plan: reservation.rate_plan,
      nightly_rate: reservation.nightly_rate,
      total_nights: reservation.total_nights,
      status: reservation.status,
      special_requests: reservation.special_requests,
    },
    // The card last 4 is deliberately absent. The model never sees it, so it can
    // never read it back on a call or print it in a chat.
    payment_on_file: true,
    timing: {
      hours_until_check_in: Math.round(hoursToCheckIn * 10) / 10,
      hours_since_check_out: Math.round(hoursSinceCheckOut * 10) / 10,
      standard_check_in_local: POLICY_RULES.standard_check_in_local,
      standard_check_out_local: POLICY_RULES.standard_check_out_local,
    },
    cancellation_terms: terms,
    /**
     * Operational instructions attached to the record by staff. These steer the
     * agent's behaviour; they are internal and must never be read back to the
     * guest verbatim.
     */
    staff_directives: reservation.internal_notes ? [reservation.internal_notes] : [],
    staff_directives_are_internal: true,
  }

  if (terms.refund_class === 'not_documented') {
    return toolUngrounded(
      {
        ...data,
        escalation_required: true,
        escalation_reason: `No written policy covers cancellation or refund of a ${reservation.rate_plan} booking. Say plainly that you cannot confirm it and hand to the property team.`,
      },
      { citations, masked_fields: ['payment_last4'] },
    )
  }

  return toolOk(data, { citations, masked_fields: ['payment_last4'] })
}
