/**
 * check_late_checkout, check_upgrade_eligibility, book_amenity.
 *
 * Policy 6 is where "guaranteed" has to mean something. Gold benefits are
 * conditioned on availability; Platinum's 2PM checkout is granted without an
 * availability gate because the policy says "no blackout dates and no
 * exceptions". Where Policy 6 admits it has no answer (two Platinum guests, one
 * last suite) the tool returns a documented policy gap and routes to the manager
 * on duty instead of inventing a tiebreak.
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
  type ToolArgs,
  type ToolContext,
} from './helpers'
import { findGuestById, findPropertyByCode, findReservationById, pickRelevantReservation, reservationsForGuest } from './lookups'
import { houseOccupancy, sameDayAvailability } from './availability'
import { AMENITY_CATALOG, ANIMAL_RULES, POLICY_RULES, TIER_BENEFITS } from './rules'

interface StayContext {
  reservation: Reservation
  guest: Guest | null
  property: Property | null
}

async function resolveStay(args: ToolArgs, ctx: ToolContext): Promise<StayContext | string> {
  const reservationId = optString(args, 'reservation_id') ?? optString(args, 'confirmation_number')
  const guestId = optString(args, 'guest_id') ?? ctx.guest_id

  let reservation: Reservation | null = null
  if (reservationId) {
    reservation = await findReservationById(reservationId)
    if (!reservation) return `No reservation found for ${reservationId}.`
  } else if (guestId) {
    reservation = pickRelevantReservation(await reservationsForGuest(guestId), nowFrom(ctx))
    if (!reservation) return `No reservations found for guest ${guestId}.`
  } else {
    return 'Need a reservation id or a verified guest id. Identify the guest first.'
  }

  return {
    reservation,
    guest: await findGuestById(reservation.guest_id),
    property: await findPropertyByCode(reservation.property_code),
  }
}

// -------------------------------------------------------- check_late_checkout

export async function checkLateCheckout(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const stay = await resolveStay(args, ctx)
  if (typeof stay === 'string') return toolFail(stay)
  const { reservation, guest, property } = stay

  const tier = guest?.loyalty_tier ?? 'None'
  const benefit = TIER_BENEFITS[tier]
  const standard = POLICY_RULES.standard_check_out_local

  const rawRequest = optString(args, 'requested_time') ?? optString(args, 'time')
  const requested = rawRequest ? normalizeTime(rawRequest) : (benefit.late_checkout_local ?? '13:00')
  if (!requested) {
    return toolFail(`Could not read "${rawRequest}" as a time. Ask the guest for a clock time such as 1 PM.`)
  }

  const citations: Citation[] = [policyCitation(1), policyCitation(6), reservationCitation(reservation.reservation_id)]
  if (guest) citations.push(guestCitation(guest.guest_id))
  if (property) citations.push(propertyCitation(property.property_code, property.property_name))

  const requestedMin = localTimeToMinutes(requested)
  const standardMin = localTimeToMinutes(standard)
  const entitledMin = benefit.late_checkout_local ? localTimeToMinutes(benefit.late_checkout_local) : standardMin

  if (requestedMin <= standardMin) {
    return toolOk(
      {
        decision: 'not_needed',
        may_promise: true,
        tier,
        requested_time: requested,
        standard_checkout: standard,
        human_reason: `${requested} is at or before the standard ${standard} checkout, so no late checkout is required.`,
      },
      { citations },
    )
  }

  // Platinum: guaranteed to the tier time, with no availability gate.
  const withinEntitlement = requestedMin <= entitledMin
  if (benefit.guaranteed && withinEntitlement) {
    return toolOk(
      {
        decision: 'guaranteed',
        may_promise: true,
        tier,
        requested_time: requested,
        entitled_until: benefit.late_checkout_local,
        standard_checkout: standard,
        availability_checked: false,
        human_reason: `Policy 6: Platinum members have a guaranteed late checkout until ${benefit.late_checkout_local}, with no blackout dates and no exceptions. ${requested} is inside that, so it is confirmed, not requested.`,
      },
      { citations },
    )
  }

  // Everything else is availability-gated, which is exactly what Policy 1 says.
  const occupancy = property ? houseOccupancy(property, reservation.check_out_date) : 1
  const gate = POLICY_RULES.discretionary_late_checkout_max_occupancy
  const looksAvailable = occupancy <= gate

  if (withinEntitlement && benefit.late_checkout_local) {
    return toolOk(
      {
        decision: looksAvailable ? 'available_subject_to_confirmation' : 'not_available_today',
        // Never a promise: the benefit itself is written "subject to availability".
        may_promise: false,
        tier,
        requested_time: requested,
        entitled_until: benefit.late_checkout_local,
        standard_checkout: standard,
        availability_checked: true,
        same_day_occupancy_pct: Math.round(occupancy * 100),
        availability_provenance: 'simulated_inventory_service',
        human_reason: looksAvailable
          ? `Policy 6: ${tier} members get late checkout to ${benefit.late_checkout_local} subject to availability. The house on ${reservation.check_out_date} is at ${Math.round(occupancy * 100)}% so it looks grantable, but it is the front desk's call on the day. Offer it as likely, not as confirmed.`
          : `Policy 6: ${tier} members get late checkout to ${benefit.late_checkout_local} subject to availability. The house on ${reservation.check_out_date} is at ${Math.round(occupancy * 100)}%, so it is not available. Offer bag storage or a later lobby arrangement instead, and do not promise the time.`,
      },
      { citations },
    )
  }

  // Beyond any tier entitlement, including a Platinum guest asking past 2PM.
  return toolOk(
    {
      decision: 'needs_front_desk',
      may_promise: false,
      tier,
      requested_time: requested,
      entitled_until: benefit.late_checkout_local,
      standard_checkout: standard,
      availability_checked: true,
      same_day_occupancy_pct: Math.round(occupancy * 100),
      availability_provenance: 'simulated_inventory_service',
      human_reason: benefit.late_checkout_local
        ? `${requested} is past the ${benefit.late_checkout_local} that ${tier} guarantees. Anything beyond the tier benefit is front-desk discretion on the day and cannot be promised here.`
        : `${tier} carries no late-checkout entitlement. Policy 1 makes late checkout same-day availability and front-desk discretion, so it cannot be promised here.`,
    },
    { citations },
  )
}

// --------------------------------------------------- check_upgrade_eligibility

export async function checkUpgradeEligibility(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const stay = await resolveStay(args, ctx)
  if (typeof stay === 'string') return toolFail(stay)
  const { reservation, guest, property } = stay

  const tier = guest?.loyalty_tier ?? 'None'
  const benefit = TIER_BENEFITS[tier]

  const citations: Citation[] = [policyCitation(6), reservationCitation(reservation.reservation_id)]
  if (guest) citations.push(guestCitation(guest.guest_id))
  if (property) citations.push(propertyCitation(property.property_code, property.property_name))

  const staffDirectives = reservation.internal_notes ? [reservation.internal_notes] : []

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

  const snapshot = sameDayAvailability(property, reservation.check_in_date, target)
  const hasInventory = snapshot.rooms_available > 0

  const base = {
    tier,
    current_room_type: reservation.room_type,
    target_room_class: target,
    availability: {
      date: snapshot.date,
      room_class: snapshot.room_class,
      rooms_available: snapshot.rooms_available,
      total_rooms: snapshot.total_rooms,
      provenance: snapshot.provenance,
      assumption: snapshot.assumption,
    },
    staff_directives: staffDirectives,
    staff_directives_are_internal: true,
  }

  if (benefit.upgrade === 'next_class_guaranteed') {
    if (hasInventory) {
      return toolOk(
        {
          ...base,
          decision: 'guaranteed',
          may_promise: true,
          human_reason: `Policy 6: Platinum gets a guaranteed upgrade to the next room class based on same-day inventory. ${target} inventory exists for ${snapshot.date}, so confirm the upgrade.`,
        },
        { citations },
      )
    }
    // The gap Policy 6 openly admits it does not answer.
    return toolOk(
      {
        ...base,
        decision: 'policy_gap_manager_decision',
        may_promise: false,
        policy_gap: true,
        human_reason: `Policy 6 guarantees Platinum the next room class based on same-day inventory, and there is no ${target} inventory on ${snapshot.date}. Policy 6 states plainly that competing claims on the last room are a judgment call for the manager on duty. Do not promise the upgrade and do not invent a tiebreak: say the guarantee is being honoured through the manager on duty and hand it over.`,
        escalation_required: true,
        escalation_category: 'authority_exceeded',
      },
      { citations },
    )
  }

  return toolOk(
    {
      ...base,
      decision: hasInventory ? 'available_subject_to_confirmation' : 'not_available',
      may_promise: false,
      human_reason: hasInventory
        ? `Policy 6: Gold gets a complimentary upgrade at check-in when one is available. ${snapshot.rooms_available} ${target} rooms look open on ${snapshot.date}, so offer it as likely and let check-in confirm it. Do not promise it.`
        : `Policy 6: the Gold upgrade is available only when a room is. There is no ${target} inventory on ${snapshot.date}, so say so honestly rather than raise an expectation.`,
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
  const { reservation, property } = stay

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

  let availability = null
  if (amenity.inventory_dependent && property) {
    const snapshot = sameDayAvailability(property, reservation.check_in_date, reservation.room_type)
    availability = {
      date: snapshot.date,
      rooms_available: snapshot.rooms_available,
      provenance: snapshot.provenance,
      assumption: snapshot.assumption,
    }
  }

  const confirmed = amenity.confirmable_by_agent && !amenity.inventory_dependent && !amenity.chargeable

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
      human_reason: confirmed
        ? `${amenity.label} is a zero-cost standard service, so it is logged against the stay and the property will action it.`
        : `${amenity.label} is passed to the property as a request, not a confirmation. ${amenity.note}`,
    },
    { citations },
  )
}
