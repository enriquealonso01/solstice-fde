/**
 * check_service_recovery_eligibility (Policy 5) and check_comp_authority (Policy 7).
 *
 * Both are pure date and money arithmetic, which is precisely why they are code
 * and not prompt text. Two details the brief singles out are encoded here:
 *
 *  - POLICY 5 WRINKLE: a complaint the guest raised DURING the stay counts as the
 *    complaint having been made. The 72 hours is anchored to checkout either way,
 *    and following up later to ask what we will do about it neither restarts the
 *    clock nor forfeits the claim.
 *  - POLICY 7 AGGREGATION: several small issues in one stay are SUMMED before the
 *    $50 front-desk authority is tested. Three $20 problems are a $60 decision,
 *    not three $20 decisions.
 */
import type { Citation, ToolResult } from '../../../shared/types'
import { toolFail, toolOk } from './_deps'
import {
  addHours,
  atLocalTime,
  describeInstant,
  formatCents,
  hoursBetween,
  nowFrom,
  optBoolean,
  optNumber,
  optString,
  policyCitation,
  reservationCitation,
  toCents,
  type ToolArgs,
  type ToolContext,
} from './helpers'
import { findReservationById, pickRelevantReservation, reservationsForGuest } from './lookups'
import { COMP_AUTHORITY, ESCALATION_MATRIX, POLICY_RULES, SERVICE_RECOVERY } from './rules'

// -------------------------------------- check_service_recovery_eligibility

export async function checkServiceRecoveryEligibility(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const now = nowFrom(ctx)
  const reservationId = optString(args, 'reservation_id') ?? optString(args, 'confirmation_number')
  const guestId = optString(args, 'guest_id') ?? ctx.guest_id

  let reservation = reservationId ? await findReservationById(reservationId) : null
  if (!reservation && guestId) {
    reservation = pickRelevantReservation(await reservationsForGuest(guestId), now)
  }
  if (!reservation) {
    return toolFail(
      reservationId
        ? `No reservation found for ${reservationId}.`
        : 'Need a reservation id or a verified guest id before the service recovery window can be calculated.',
    )
  }

  const checkoutAt = atLocalTime(reservation.check_out_date, POLICY_RULES.standard_check_out_local)
  const checkInAt = atLocalTime(reservation.check_in_date, POLICY_RULES.standard_check_in_local)
  const deadlineAt = addHours(checkoutAt, SERVICE_RECOVERY.window_hours)

  const raisedDuringStay = optBoolean(args, 'issue_raised_during_stay') ?? optBoolean(args, 'reported_during_stay')
  const reportedAtRaw = optString(args, 'issue_reported_at') ?? optString(args, 'reported_at')

  let complaintAt: Date
  let complaintBasis: string

  if (reportedAtRaw) {
    const parsed = new Date(reportedAtRaw.length === 10 ? `${reportedAtRaw}T12:00:00Z` : reportedAtRaw)
    if (Number.isNaN(parsed.getTime())) {
      return toolFail(`Could not read "${reportedAtRaw}" as a date or time. Ask the guest roughly when they first raised it.`)
    }
    complaintAt = parsed
    complaintBasis = 'the timestamp supplied for when the issue was first raised'
  } else if (raisedDuringStay) {
    // The guest told us they raised it with housekeeping or the front desk during
    // the stay. We do not know the hour; checkout is the conservative anchor and
    // is inside the window by construction.
    complaintAt = checkoutAt
    complaintBasis = 'the guest raised it during the stay, so the complaint is treated as made by checkout'
  } else {
    complaintAt = now
    complaintBasis = 'the guest is raising it now'
  }

  const wasRaisedInStay = complaintAt.getTime() <= checkoutAt.getTime() && complaintAt.getTime() >= checkInAt.getTime()
  const eligible = complaintAt.getTime() <= deadlineAt.getTime()
  const hoursAfterCheckout = hoursBetween(checkoutAt, complaintAt)
  const hoursSinceCheckoutNow = hoursBetween(checkoutAt, now)

  const citations: Citation[] = [policyCitation(5), reservationCitation(reservation.reservation_id)]

  const shared = {
    reservation_id: reservation.reservation_id,
    rate_plan: reservation.rate_plan,
    checkout_at: checkoutAt.toISOString(),
    checkout_at_human: describeInstant(checkoutAt),
    window_hours: SERVICE_RECOVERY.window_hours,
    deadline_at: deadlineAt.toISOString(),
    deadline_at_human: describeInstant(deadlineAt),
    complaint_made_at: complaintAt.toISOString(),
    complaint_basis: complaintBasis,
    complaint_raised_during_stay: wasRaisedInStay,
    hours_after_checkout_at_complaint: Math.round(hoursAfterCheckout * 10) / 10,
    hours_since_checkout_now: Math.round(hoursSinceCheckoutNow * 10) / 10,
    /**
     * Policy 3 governs cancellation and changes, not service failures, so a
     * non-refundable rate plan does not by itself bar a Policy 5 remedy. Any
     * remedy still has to clear Policy 7 comp authority. Flagged as our reading
     * so a reviewer can disagree with it in one place.
     */
    rate_plan_note:
      reservation.rate_plan === 'Advance Purchase'
        ? 'This is an Advance Purchase booking. Policy 3 makes it non-refundable for cancellations and changes; it does not speak to a service failure during the stay. Do not quote Policy 3 as a reason to refuse service recovery, and do not promise a remedy either: run the amount through comp authority.'
        : null,
  }

  if (eligible) {
    return toolOk(
      {
        ...shared,
        eligible: true,
        remedies_available: SERVICE_RECOVERY.inside_window_remedies,
        may_promise: false,
        next_step:
          'Inside the 72-hour window, so a refund, a credit or a comp night can be considered. Decide the amount, then run it through comp authority before offering anything. Never name a figure before that check.',
        human_reason: wasRaisedInStay
          ? `The guest raised this during the stay, which Policy 5 counts as the complaint having been made. The 72-hour clock runs from checkout at ${describeInstant(checkoutAt)} and following up later does not forfeit it.`
          : `Reported ${Math.round(hoursAfterCheckout)} hours after checkout, inside the ${SERVICE_RECOVERY.window_hours}-hour window that closes ${describeInstant(deadlineAt)}.`,
      },
      { citations },
    )
  }

  const route = ESCALATION_MATRIX[SERVICE_RECOVERY.outside_window_escalation_category]
  return toolOk(
    {
      ...shared,
      eligible: false,
      remedies_available: SERVICE_RECOVERY.outside_window_remedies,
      remedies_forbidden: SERVICE_RECOVERY.outside_window_forbidden,
      may_promise: false,
      escalation_required: true,
      escalation_category: SERVICE_RECOVERY.outside_window_escalation_category,
      authority_required: route.authority,
      next_step:
        'Outside the window. Say so plainly and kindly, offer loyalty points as a goodwill gesture, and do not offer or hint at a refund or a comp night. If the guest still wants a refund, that is a Policy 15 escalation to the Manager on duty or AGM the same day.',
      human_reason: `The complaint was made ${Math.round(hoursAfterCheckout)} hours after checkout, past the ${SERVICE_RECOVERY.window_hours}-hour window that closed ${describeInstant(deadlineAt)}. Policy 5 leaves loyalty points as the only goodwill gesture the front desk can offer.`,
    },
    { citations: [...citations, policyCitation(15)] },
  )
}

// ------------------------------------------------------- check_comp_authority

interface CompItem {
  description: string
  amount_cents: number
}

function parseItems(args: ToolArgs): CompItem[] {
  const out: CompItem[] = []

  const raw = args['items'] ?? args['issues'] ?? args['charges']
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        out.push({ description: 'unlabelled item', amount_cents: Math.round(entry * 100) })
        continue
      }
      if (typeof entry === 'object' && entry !== null) {
        const obj = entry as Record<string, unknown>
        const cents =
          typeof obj.amount_cents === 'number'
            ? Math.round(obj.amount_cents)
            : typeof obj.amount === 'number'
              ? Math.round(obj.amount * 100)
              : typeof obj.amount === 'string'
                ? Math.round(Number(String(obj.amount).replace(/[$,]/g, '')) * 100)
                : NaN
        if (Number.isFinite(cents)) {
          out.push({
            description: typeof obj.description === 'string' ? obj.description : typeof obj.label === 'string' ? obj.label : 'unlabelled item',
            amount_cents: cents,
          })
        }
      }
    }
  }

  const single = toCents(optNumber(args, 'amount')) ?? optNumber(args, 'amount_cents')
  if (single !== undefined && Number.isFinite(single)) {
    out.push({ description: optString(args, 'description') ?? 'requested comp', amount_cents: Math.round(single) })
  }

  return out
}

export async function checkCompAuthority(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const items = parseItems(args)
  const compNight = optBoolean(args, 'comp_night') ?? optBoolean(args, 'full_night') ?? false

  if (items.length === 0 && !compNight) {
    return toolFail('Need an amount, or a list of items with amounts, before comp authority can be decided.')
  }

  const reservationId = optString(args, 'reservation_id') ?? optString(args, 'confirmation_number')
  const reservation = reservationId ? await findReservationById(reservationId) : null
  if (reservationId && !reservation) return toolFail(`No reservation found for ${reservationId}.`)

  // Policy 7 says "per stay". Comps from a PREVIOUS stay are reported for context
  // but never counted against this stay's authority.
  const priorStayCents = toCents(optNumber(args, 'prior_stay_comps')) ?? optNumber(args, 'prior_stay_comps_cents') ?? 0

  const totalCents = items.reduce((sum, i) => sum + i.amount_cents, 0)
  const limit = COMP_AUTHORITY.front_desk_max_cents
  const withinAmount = totalCents <= limit
  const withinAuthority = withinAmount && !compNight

  const route = ESCALATION_MATRIX.authority_exceeded
  const citations: Citation[] = [policyCitation(7)]
  if (reservation) citations.push(reservationCitation(reservation.reservation_id))
  if (!withinAuthority) citations.push(policyCitation(15))

  const aggregationNote =
    items.length > 1
      ? `Policy 7 requires the items to be added up before authority is tested: ${items
          .map((i) => `${i.description} ${formatCents(i.amount_cents)}`)
          .join(' + ')} = ${formatCents(totalCents)}.`
      : `Single item totalling ${formatCents(totalCents)}.`

  return toolOk(
    {
      items,
      item_count: items.length,
      total_cents: totalCents,
      total_display: formatCents(totalCents),
      front_desk_limit_cents: limit,
      front_desk_limit_display: formatCents(limit),
      comp_night_requested: compNight,
      within_front_desk_authority: withinAuthority,
      authority_required: withinAuthority ? 'front_desk' : route.authority,
      remaining_front_desk_authority_cents: Math.max(0, limit - totalCents),
      aggregation_applied: COMP_AUTHORITY.aggregate_per_stay,
      aggregation_note: aggregationNote,
      prior_stay_comps_cents: priorStayCents,
      prior_stay_note:
        priorStayCents > 0
          ? `${formatCents(priorStayCents)} was comped on a PREVIOUS stay. Policy 7's limit is per stay, so it does not count against this stay's authority. Do not add a fresh comp on top of it unless a new issue is confirmed.`
          : null,
      escalation_required: !withinAuthority,
      escalation_category: withinAuthority ? null : 'authority_exceeded',
      may_promise: withinAuthority,
      human_reason: withinAuthority
        ? `${aggregationNote} That is inside the ${formatCents(limit)} per-stay front-desk authority, so it can be actioned without manager approval.`
        : compNight
          ? `A full comped night always needs AGM or GM sign-off whatever the amount, so this is not a front-desk decision. Present it as being put to the manager, never as approved.`
          : `${aggregationNote} That exceeds the ${formatCents(limit)} per-stay front-desk authority, so it needs AGM or GM sign-off the same day. Present it as being put to the manager, never as approved.`,
      staff_directives: reservation?.internal_notes ? [reservation.internal_notes] : [],
      staff_directives_are_internal: true,
    },
    { citations },
  )
}
