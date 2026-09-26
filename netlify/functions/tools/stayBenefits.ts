/**
 * check_late_checkout, check_upgrade_eligibility, book_amenity.
 *
 * Only Platinum's 2 PM checkout is promised outright: Policy 6 guarantees it and no
 * inventory is involved. Anything that hangs on same-day inventory (every upgrade,
 * Gold's 1 PM, inventory-dependent amenities) is offered as eligible, never promised,
 * because our only inventory source is simulated, and its figures stay out of the result.
 * A cancelled or checked-out stay gets nothing, and no inventory is looked up for it.
 */
import type { Citation, Guest, Property, Reservation, ToolResult } from '../../../shared/types'
import { toolFail, toolOk } from './_deps'
import {
  guestCitation,
  isAccessibleRoom,
  localTimeToMinutes,
  nextRoomClass,
  normalizeText,
  normalizeTime,
  nowFrom,
  optString,
  policyCitation,
  propertyCitation,
  reservationCitation,
  stayPhase,
  todayISO,
  type StayPhase,
  type ToolArgs,
  type ToolContext,
} from './helpers'
import { findGuestById, findPropertyByCode, reservationOfVerifiedGuest, reservationsForGuest } from './lookups'
import { sameDayAvailability } from './availability'
import { AMENITY_CATALOG, ANIMAL_RULES, POLICY_RULES, TIER_BENEFITS } from './rules'

interface StayContext {
  reservation: Reservation
  guest: Guest | null
  property: Property | null
  phase: StayPhase
  today: string
  staffDirectives: string[]
}

async function resolveStay(args: ToolArgs, ctx: ToolContext): Promise<StayContext | string> {
  const owned = await reservationOfVerifiedGuest(args, ctx)
  if ('error' in owned) return owned.error
  const { reservation } = owned
  const now = nowFrom(ctx)

  // A note on one stay can restrict another (R55004's "Suite upgrade is NOT guaranteed" covers
  // R55015), so the verified guest's other stays' notes come along.
  const otherStays = (await reservationsForGuest(reservation.guest_id)).filter((r) => r.reservation_id !== reservation.reservation_id)

  return {
    reservation,
    guest: await findGuestById(reservation.guest_id),
    property: await findPropertyByCode(reservation.property_code),
    phase: stayPhase(reservation.check_in_date, reservation.check_out_date, now),
    today: todayISO(now),
    staffDirectives: [reservation, ...otherStays].flatMap((r) => (r.internal_notes ? [`${r.reservation_id}: ${r.internal_notes}`] : [])),
  }
}

/** When an eligible benefit is settled: on arrival for an upcoming stay, else on the day it applies. */
function frontDeskConfirms({ phase, today }: StayContext, day = today): string {
  if (phase === 'upcoming') return 'the front desk confirms on arrival'
  return day === today ? 'the front desk confirms today' : `the front desk confirms on ${day}`
}

/**
 * Where same-day availability comes from, without the figure: it is simulated, and anything in a
 * result reaches the model. A real PMS behind `sameDayAvailability` is where a figure could come back.
 */
function availabilityBasis(property: Property, date: string, roomClass: string) {
  const { provenance, assumption } = sameDayAvailability(property, date, roomClass)
  return { date, room_class: roomClass, provenance, assumption }
}

/** A cancelled or checked-out stay gets no benefits, and no inventory is looked up for it. */
function closedStay({ reservation, phase }: StayContext, extra: Record<string, unknown> = {}): ToolResult | null {
  let decision: string
  let why: string
  if (reservation.status === 'Cancelled') {
    decision = 'reservation_cancelled'
    why = 'That reservation was cancelled'
  } else if (phase === 'ended') {
    decision = 'stay_ended'
    why = `That stay has ended (checked out ${reservation.check_out_date})`
  } else {
    return null
  }
  return toolOk(
    {
      ...extra,
      // `decision` is what the late-checkout and upgrade chips show, `status` the amenity chip.
      decision,
      status: decision,
      may_promise: false,
      reservation_id: reservation.reservation_id,
      check_out_date: reservation.check_out_date,
      human_reason: `${why}, so there is no late checkout, upgrade or request to arrange on it. If the guest has another booking, ask for that confirmation number.`,
    },
    { citations: [reservationCitation(reservation.reservation_id)] },
  )
}

// -------------------------------------------------------- check_late_checkout

export async function checkLateCheckout(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const stay = await resolveStay(args, ctx)
  if (typeof stay === 'string') return toolFail(stay)
  const { reservation, guest, property, staffDirectives } = stay

  const tier = guest?.loyalty_tier ?? 'None'
  const benefit = TIER_BENEFITS[tier]
  const standard = POLICY_RULES.standard_check_out_local

  const rawRequest = optString(args, 'requested_time') ?? optString(args, 'time')
  const requested = rawRequest ? normalizeTime(rawRequest) : (benefit.late_checkout_local ?? '13:00')
  const closed = closedStay(stay, { requested_time: requested ?? rawRequest })
  if (closed) return closed
  if (!requested) {
    return toolFail(`Could not read "${rawRequest}" as a time. Ask the guest for a clock time such as 1 PM.`)
  }

  const citations: Citation[] = [policyCitation(1), policyCitation(6), reservationCitation(reservation.reservation_id)]
  if (guest) citations.push(guestCitation(guest.guest_id))
  if (property) citations.push(propertyCitation(property.property_code, property.property_name))

  const base = {
    tier,
    requested_time: requested,
    check_out_date: reservation.check_out_date,
    standard_checkout: standard,
    staff_directives: staffDirectives,
    staff_directives_are_internal: true,
  }

  const requestedMin = localTimeToMinutes(requested)
  const standardMin = localTimeToMinutes(standard)
  const entitledMin = benefit.late_checkout_local ? localTimeToMinutes(benefit.late_checkout_local) : standardMin

  if (requestedMin <= standardMin) {
    return toolOk(
      {
        ...base,
        decision: 'not_needed',
        may_promise: true,
        human_reason: `${requested} is at or before the standard ${standard} checkout, so no late checkout is required.`,
      },
      { citations },
    )
  }

  // Platinum: guaranteed to the tier time. No inventory is involved, so it may be promised.
  const withinEntitlement = requestedMin <= entitledMin
  if (benefit.guaranteed && withinEntitlement) {
    return toolOk(
      {
        ...base,
        decision: 'guaranteed',
        may_promise: true,
        entitled_until: benefit.late_checkout_local,
        availability: null,
        human_reason: `Policy 6: Platinum members have a guaranteed late checkout until ${benefit.late_checkout_local}, with no blackout dates and no exceptions. ${requested} on ${reservation.check_out_date} is inside that, so it is confirmed, not requested.`,
      },
      { citations },
    )
  }

  // Everything else hangs on same-day availability (Policy 1), which we cannot know.
  const availability = property ? availabilityBasis(property, reservation.check_out_date, reservation.room_type) : null

  if (withinEntitlement && benefit.late_checkout_local) {
    return toolOk(
      {
        ...base,
        availability,
        decision: 'eligible_subject_to_availability',
        may_promise: false,
        entitled_until: benefit.late_checkout_local,
        human_reason: `Policy 6: ${tier} members get late checkout to ${benefit.late_checkout_local} subject to availability. The guest is eligible for ${requested} on ${reservation.check_out_date}, subject to same-day availability; ${frontDeskConfirms(stay, reservation.check_out_date)}.`,
      },
      { citations },
    )
  }

  // Beyond any tier entitlement, including a Platinum guest asking past 2PM.
  return toolOk(
    {
      ...base,
      availability,
      decision: 'needs_front_desk',
      may_promise: false,
      entitled_until: benefit.late_checkout_local,
      human_reason: benefit.late_checkout_local
        ? `${requested} is past the ${benefit.late_checkout_local} that ${tier} includes. Anything beyond the tier benefit is front-desk discretion on the day and cannot be promised here.`
        : `${tier} carries no late-checkout entitlement. Policy 1 makes late checkout same-day availability and front-desk discretion, so it cannot be promised here.`,
    },
    { citations },
  )
}

// --------------------------------------------------- check_upgrade_eligibility

export async function checkUpgradeEligibility(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const stay = await resolveStay(args, ctx)
  if (typeof stay === 'string') return toolFail(stay)
  const { reservation, guest, property, phase, staffDirectives } = stay
  const closed = closedStay(stay)
  if (closed) return closed

  const tier = guest?.loyalty_tier ?? 'None'
  const benefit = TIER_BENEFITS[tier]

  const citations: Citation[] = [policyCitation(6), reservationCitation(reservation.reservation_id)]
  if (guest) citations.push(guestCitation(guest.guest_id))
  if (property) citations.push(propertyCitation(property.property_code, property.property_name))

  if (isAccessibleRoom(reservation.room_type)) {
    return toolOk(
      {
        decision: 'human_review',
        may_promise: false,
        tier,
        current_room_type: reservation.room_type,
        human_reason:
          'This stay is in an accessible room. Moving a guest out of an accessible room is an accessibility decision, not an upgrade, so it is never applied automatically. Confirm the guest\'s needs and let the front desk decide.',
        assumption:
          'Policy 6 does not address accessible rooms. Holding them out of the automatic upgrade ladder is our stated assumption, not a written policy.',
        staff_directives: staffDirectives,
        staff_directives_are_internal: true,
      },
      { citations },
    )
  }

  if (benefit.upgrade === 'none') {
    return toolOk(
      {
        decision: 'not_eligible',
        may_promise: true,
        tier,
        current_room_type: reservation.room_type,
        human_reason:
          tier === 'Silver'
            ? 'Policy 6: Silver members earn points but have no automatic upgrade at check-in. Anything else is front-desk discretion on the day.'
            : 'Policy 6: there is no tier upgrade entitlement on this booking. Anything else is front-desk discretion on the day.',
        staff_directives: staffDirectives,
        staff_directives_are_internal: true,
      },
      { citations },
    )
  }

  const target = nextRoomClass(reservation.room_type)
  if (!target) {
    return toolOk(
      {
        decision: 'already_top_class',
        may_promise: true,
        tier,
        current_room_type: reservation.room_type,
        human_reason: `Policy 6 grants an upgrade to the next room class. ${reservation.room_type} is already the top class we hold, so there is no next class to move to.`,
        staff_directives: staffDirectives,
        staff_directives_are_internal: true,
      },
      { citations },
    )
  }

  if (!property) {
    return toolFail(`No property record for ${reservation.property_code}, so same-day inventory cannot be checked. Escalate rather than assume.`)
  }

  // The room depends on same-day inventory, which we cannot know, so every tier gets eligibility.
  const entitlement =
    benefit.upgrade === 'next_class_guaranteed'
      ? `Policy 6: Platinum members are entitled to an upgrade to the next room class based on same-day inventory; competing claims on the last room are the manager on duty's call.`
      : `Policy 6: ${tier} members get a complimentary upgrade at check-in when a room is free.`
  const when = phase === 'upcoming' ? `at check-in on ${reservation.check_in_date}` : 'today'

  return toolOk(
    {
      decision: 'eligible_subject_to_availability',
      may_promise: false,
      tier,
      current_room_type: reservation.room_type,
      target_room_class: target,
      availability: availabilityBasis(property, reservation.check_in_date, target),
      staff_directives: staffDirectives,
      staff_directives_are_internal: true,
      human_reason: `${entitlement} The guest is eligible for an upgrade to ${target} ${when}, subject to same-day availability; ${frontDeskConfirms(stay)}.`,
    },
    { citations },
  )
}

// -------------------------------------------------------------- book_amenity

const PET_WORDS = ['pet', 'dog', 'cat', 'puppy', 'kitten', 'animal']
const SERVICE_ANIMAL_WORDS = ['service animal', 'service dog', 'guide dog', 'assistance animal']

function resolveAmenity(input: string): (typeof AMENITY_CATALOG)[string] | null {
  const key = input.trim().toLowerCase().replace(/\s+/g, '_')
  if (AMENITY_CATALOG[key]) return AMENITY_CATALOG[key]
  const q = normalizeText(input)
  for (const amenity of Object.values(AMENITY_CATALOG)) {
    if (normalizeText(amenity.label).includes(q) || q.includes(normalizeText(amenity.label))) return amenity
    if (normalizeText(amenity.id.replace(/_/g, ' ')).includes(q)) return amenity
  }
  return null
}

export async function bookAmenity(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const requested = optString(args, 'amenity') ?? optString(args, 'item')
  if (!requested) return toolFail('Need the amenity the guest asked for.')

  const stay = await resolveStay(args, ctx)
  if (typeof stay === 'string') return toolFail(stay)
  const { reservation, property, staffDirectives } = stay

  const q = normalizeText(requested)

  // Policy 8 gets answered before anything is "booked".
  if (SERVICE_ANIMAL_WORDS.some((w) => q.includes(w))) {
    return toolOk(
      {
        status: 'not_an_amenity',
        policy_answer: 'service_animal',
        rules: ANIMAL_RULES,
        human_reason:
          'A service animal is not an amenity booking. Policy 8: service animals are always welcome and stay free of charge. You may ask what task the animal is trained to perform. You may not ask for certification, documentation or a demonstration, and no pet fee may ever be charged.',
      },
      { citations: [policyCitation(8), reservationCitation(reservation.reservation_id)] },
    )
  }

  if (PET_WORDS.some((w) => q.includes(w))) {
    return toolOk(
      {
        status: 'refused',
        policy_answer: 'pets_not_permitted',
        rules: ANIMAL_RULES,
        human_reason:
          'Policy 8: pets are not permitted at any Solstice property, with no exceptions and no pet-friendly floors. Say so directly and kindly. If the animal is a service animal under the ADA, that is a different question with a different answer: always welcome, always free.',
      },
      { citations: [policyCitation(8), reservationCitation(reservation.reservation_id)] },
    )
  }

  const closed = closedStay(stay)
  if (closed) return closed

  const amenity = resolveAmenity(requested)
  if (!amenity) {
    return toolFail(
      `"${requested}" is not a service we hold a record for. Do not invent an amenity or a price. Tell the guest you will pass it to the property team and check.`,
      { citations: [reservationCitation(reservation.reservation_id)] },
    )
  }

  const citations: Citation[] = [reservationCitation(reservation.reservation_id)]
  for (const ref of amenity.policy_refs) citations.push(policyCitation(ref))
  if (property) citations.push(propertyCitation(property.property_code, property.property_name))

  const reference = `AMN-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0')}`
  const when = optString(args, 'when') ?? optString(args, 'time') ?? null

  const availability =
    amenity.inventory_dependent && property ? availabilityBasis(property, reservation.check_in_date, reservation.room_type) : null

  const confirmed = amenity.confirmable_by_agent && !amenity.inventory_dependent && !amenity.chargeable
  let humanReason = `${amenity.label} is passed to the property as a request, not a confirmation. ${amenity.note}`
  if (confirmed) {
    humanReason = `${amenity.label} is a zero-cost standard service, so it is logged against the stay and the property will action it.`
  } else if (amenity.inventory_dependent) {
    humanReason = `${amenity.label} is passed to the property as a request, subject to same-day availability; ${frontDeskConfirms(stay)}. ${amenity.note}`
  }

  return toolOk(
    {
      status: confirmed ? 'confirmed' : 'requested',
      reference,
      amenity: { id: amenity.id, label: amenity.label },
      reservation_id: reservation.reservation_id,
      when,
      charge: {
        chargeable: amenity.chargeable,
        amount_cents: amenity.price_cents,
        // A fee we cannot price is a fee we describe, never a number we guess.
        amount_known: amenity.price_cents !== null,
        instruction_to_agent: amenity.chargeable
          ? 'Tell the guest a fee applies and that the property confirms the amount. Do not quote, estimate or range a number.'
          : 'No charge applies.',
      },
      availability,
      note: amenity.note,
      staff_directives: staffDirectives,
      staff_directives_are_internal: true,
      human_reason: humanReason,
    },
    { citations },
  )
}
