// The group rules engine.
//
// One entry point, `evaluateGroupRules`, returning one `RuleVerdict` per check. Every verdict
// carries the number that was asked for, the number that governs, and a sentence a rep can read
// aloud to a customer without translating anything. No check consults a language model, and no
// threshold is stated anywhere except thresholds.ts.

import type { GroupInquiry, Property, RuleVerdict } from '../../../shared/types'
import { assessCompleteness, describeMissing, type RequiredField } from './completeness'
import {
  daysBetween,
  describeRange,
  nightsBetween,
  parseDate,
  speakDate,
  stayOverlapsRange,
} from './dates'
import { rateFieldForRoomType, DEFAULT_ROOM_TYPE } from './pricing'
import { documentRuleApplies, effectiveDiscountCeiling, windowCoversStay } from './seasonal'
import { getPropertyRules } from './thresholds'
import type { Decision, EvaluationResult, PropertyRuleSet, RuleId } from './types'
import { verdict } from './types'
import { RATE_SANITY_BAND, validatePropertyData } from './validation'

export interface EvaluateOptions {
  inquiry: GroupInquiry
  /** The property master record, used for rate validation. Optional: rule checks that do not
   *  touch rates work without it. */
  property?: Property | null
  /** Override the rule set. Defaults to the table in thresholds.ts. */
  rules?: PropertyRuleSet | null
  /** When the inquiry arrived, for the lead-time rule. Defaults to today. */
  received_date?: string | null
  /** Raw, unparsed values so questions can quote the customer back to themselves. */
  raw_values?: Partial<Record<RequiredField, string>>
  /** Whether we hold any way of reaching this customer. Passed in because the inquiry record
   *  the engine is handed has its real email and phone redacted. */
  contact_present?: boolean
}

export function evaluateGroupRules(options: EvaluateOptions): EvaluationResult {
  const { inquiry } = options
  const rules = options.rules ?? getPropertyRules(inquiry.preferred_property_code)
  const verdicts: RuleVerdict[] = []
  const pricingBlockedBy: RuleId[] = []
  const followUps: string[] = []
  const referrals: string[] = []

  if (!rules) {
    verdicts.push(
      verdict(
        'GRP-DATA-QUALITY',
        'fail',
        inquiry.preferred_property_code,
        'a hotel in the Solstice directory',
        `We have no record of a Solstice hotel with the code ${inquiry.preferred_property_code}, so there is nothing here we can quote. This needs a person to confirm which hotel the customer means before we go any further.`,
      ),
    )
    return {
      inquiry_id: inquiry.inquiry_id,
      property_code: inquiry.preferred_property_code,
      decision: 'blocked',
      verdicts,
      effective_discount_pct_ceiling: 0,
      pricing_blocked_by: ['GRP-DATA-QUALITY'],
      required_follow_ups: [],
      referrals: [],
      quarantined_fields: [],
      clarifying_questions: [],
    }
  }

  const arrival = parseDate(inquiry.arrival_date)
  const departure = parseDate(inquiry.departure_date)
  const rooms = typeof inquiry.rooms_requested === 'number' ? inquiry.rooms_requested : null
  const requestedDiscount =
    typeof inquiry.requested_discount_pct === 'number' ? inquiry.requested_discount_pct : 0
  const roomType = inquiry.room_type_preference?.trim() || DEFAULT_ROOM_TYPE

  // ------------------------------------------------------------------ completeness
  const completeness = assessCompleteness(inquiry, options.raw_values ?? {}, {
    contact_present: options.contact_present,
  })
  if (completeness.blocking_missing.length > 0 || completeness.advisory_missing.length > 0) {
    const blocking = completeness.blocking_missing.length > 0
    verdicts.push(
      verdict(
        'GRP-COMPLETENESS',
        blocking ? 'fail' : 'flag',
        `missing ${describeMissing([...completeness.blocking_missing, ...completeness.advisory_missing])}`,
        'arrival date, departure date, exact room count and a way to reach the customer',
        blocking
          ? `We cannot put a price on this yet. The inquiry is missing the ${describeMissing(completeness.blocking_missing)}, and guessing any of those would mean quoting a block we cannot actually hold. We have ${completeness.questions.length} short questions ready to send back.`
          : `We can price this, but we are still missing the ${describeMissing(completeness.advisory_missing)}, so we should ask alongside the proposal.`,
      ),
    )
    if (blocking) pricingBlockedBy.push('GRP-COMPLETENESS')
  } else {
    verdicts.push(
      verdict(
        'GRP-COMPLETENESS',
        'pass',
        'all required details supplied',
        'arrival date, departure date, exact room count and a way to reach the customer',
        'The customer gave us everything we need to quote: dates, an exact room count, and a way to reach them.',
      ),
    )
  }

  // ------------------------------------------------------------------ data quality
  const validation = options.property ? validatePropertyData(options.property) : null
  const quarantinedFields = validation?.quarantined.map((q) => q.field) ?? []
  if (validation && validation.quarantined.length > 0) {
    const pricingField = rateFieldForRoomType(roomType)
    const blocksThisBlock = quarantinedFields.includes(pricingField)
    const detail = validation.quarantined.map((q) => q.human_reason).join(' ')
    verdicts.push(
      verdict(
        'GRP-DATA-QUALITY',
        blocksThisBlock ? 'fail' : 'pass',
        validation.quarantined.map((q) => `${q.field} = ${q.value}`).join(', '),
        `a believable nightly rate between $${RATE_SANITY_BAND.min_usd} and $${RATE_SANITY_BAND.max_usd.toLocaleString('en-US')}`,
        blocksThisBlock
          ? `${detail} That is the exact rate this block would have been priced from, so we have stopped rather than send out a number we do not trust.`
          : `${detail} This block is quoted from a different room type, so the bad figure does not touch the price we are sending, but the property record still needs correcting.`,
      ),
    )
    if (blocksThisBlock) pricingBlockedBy.push('GRP-DATA-QUALITY')
  }

  // ------------------------------------------------------------------ blackout
  if (arrival && departure) {
    const hit = rules.blackout_dates.find((range) => stayOverlapsRange(arrival, departure, range))
    if (hit) {
      verdicts.push(
        verdict(
          'GRP-BLACKOUT',
          'fail',
          `${speakDate(arrival)} to ${speakDate(departure)}`,
          `closed to group business ${describeRange(hit)}`,
          `${rules.property_name} does not take group blocks between ${describeRange(hit)}, and these dates fall inside that window. This is a hard no for us: it is not a question of discount or room count, the hotel simply is not selling group rooms those nights. What we can do is offer different dates, or a nearby Solstice hotel that is open for the same stay.`,
        ),
      )
      pricingBlockedBy.push('GRP-BLACKOUT')
    } else {
      verdicts.push(
        verdict(
          'GRP-BLACKOUT',
          'pass',
          `${speakDate(arrival)} to ${speakDate(departure)}`,
          rules.blackout_dates.length
            ? rules.blackout_dates.map(describeRange).join(' and ')
            : 'no blackout dates scheduled',
          `These dates are clear of every blackout window at ${rules.property_name}.`,
        ),
      )
    }
  }

  // ------------------------------------------------------------------ room count
  if (rooms !== null) {
    const cap = rules.group_block_auto_approve_max_rooms
    const over = rooms > cap
    verdicts.push(
      verdict(
        'GRP-ROOMS-CAP',
        over ? 'flag' : 'pass',
        rooms,
        cap,
        over
          ? `The customer is asking for ${rooms} rooms. ${rules.property_name} lets us sign off up to ${cap} rooms on our own, so this one is ${rooms - cap} rooms past the line and needs the general manager, ${describeApprover(rules)}, to approve it.`
          : `${rooms} rooms is within the ${cap} rooms ${rules.property_name} lets us approve without going to the general manager.`,
      ),
    )
  }

  // ------------------------------------------------------------------ discount ceiling
  const applied = effectiveDiscountCeiling(
    rules.max_discount_auto_approve_pct,
    rules.seasonal_discount_rules,
    arrival,
    departure,
  )
  {
    const over = requestedDiscount > applied.pct
    const seasonalClause = applied.seasonal
      ? ` These dates land in a ${applied.seasonal.label} at ${rules.property_name}, when the ceiling tightens from ${rules.max_discount_auto_approve_pct}% to ${applied.pct}%.`
      : ''
    verdicts.push(
      verdict(
        'GRP-DISCOUNT-CEILING',
        over ? 'flag' : 'pass',
        requestedDiscount,
        applied.pct,
        over
          ? `The customer asked for ${requestedDiscount}% off.${seasonalClause} We can approve up to ${applied.pct}% on our own, so this is ${round1(requestedDiscount - applied.pct)} points over what we can authorise ourselves, and it needs a named approver to sign it off before it goes out.`
          : `${requestedDiscount}% off is within the ${applied.pct}% we can approve ourselves.${seasonalClause}`,
      ),
    )
  }

  // ------------------------------------------------------------------ meeting capacity
  if (typeof inquiry.meeting_capacity_needed === 'number' && inquiry.meeting_capacity_needed > 0) {
    const needed = inquiry.meeting_capacity_needed
    const max = rules.max_meeting_capacity
    const over = needed > max
    verdicts.push(
      verdict(
        'GRP-MEETING-CAPACITY',
        over ? 'fail' : 'pass',
        needed,
        max,
        over
          ? `They need to seat ${needed} people in one room. The largest space at ${rules.property_name} holds ${max}, so ${needed - max} people would have nowhere to sit. This is a physical limit, not a policy we can bend: either we move the meeting to a Solstice hotel with a bigger room, or we help them find an off-site venue and keep the bedrooms here.`
          : `Seating ${needed} people fits comfortably in the ${max}-person space at ${rules.property_name}.`,
      ),
    )
  }

  // ------------------------------------------------------------------ inventory
  if (rooms !== null) {
    const available = rules.inventory[roomType]
    if (typeof available === 'number') {
      const over = rooms > available
      verdicts.push(
        verdict(
          'GRP-INVENTORY',
          over ? 'fail' : 'pass',
          `${rooms} x ${roomType}`,
          `${available} x ${roomType} in the building`,
          over
            ? `They want ${rooms} ${roomType} rooms. ${rules.property_name} only has ${available} of that room type in the whole building, so we physically cannot hold the block as asked. We would need to split it across room types or move it to a larger hotel.`
            : `${rules.property_name} has ${available} ${roomType} rooms, so a ${rooms}-room block fits within the room type they asked for.`,
        ),
      )
    }
  }

  // ------------------------------------------------------------------ lead time
  if (rules.lead_time && rooms !== null && arrival) {
    const asOf = parseDate(options.received_date ?? null) ?? startOfToday()
    if (rooms > rules.lead_time.over_rooms) {
      const daysOut = daysBetween(asOf, arrival)
      const short = daysOut < rules.lead_time.min_days
      verdicts.push(
        verdict(
          'GRP-LEAD-TIME',
          short ? rules.lead_time.on_violation : 'pass',
          `${daysOut} days before arrival`,
          `${rules.lead_time.min_days} days for blocks over ${rules.lead_time.over_rooms} rooms`,
          short
            ? `A block this size at ${rules.property_name} normally needs at least ${rules.lead_time.min_days} days' notice, and we are only ${daysOut} days out. It is our busiest hotel, so squeezing ${rooms} rooms in at short notice takes the general manager's agreement.`
            : `At ${daysOut} days out we are comfortably inside the ${rules.lead_time.min_days} days' notice ${rules.property_name} wants for a block of this size.`,
        ),
      )
    }
  }

  // ------------------------------------------------------------------ overflow routing
  if (rules.overflow_routing && rooms !== null && rooms > rules.overflow_routing.over_rooms) {
    const routing = rules.overflow_routing
    const referral = `${rules.property_name} routes blocks over ${routing.over_rooms} rooms to ${routing.refer_to}.`
    referrals.push(referral)
    verdicts.push(
      verdict(
        'GRP-OVERFLOW-ROUTING',
        'flag',
        `${rooms} rooms`,
        `over ${routing.over_rooms} rooms routes to ${routing.refer_to}`,
        `${rules.property_name} is our smallest hotel, and anything over ${routing.over_rooms} rooms is meant to go to ${routing.refer_to} instead. That hotel is not in the system we can see, so we are not able to quote a rate or confirm rooms there ourselves. The honest answer to the customer is that we are passing this to the ${routing.refer_to} team, who will come back with availability and pricing. We can also hold ${routing.over_rooms} rooms here in the meantime if that helps.`,
      ),
    )
  }

  // ------------------------------------------------------------------ required documents
  for (const doc of rules.required_documents) {
    if (!documentRuleApplies(doc, inquiry.event_type, inquiry.special_requests, inquiry.company_name)) {
      continue
    }
    const followUp = `Obtain the ${doc.label} before confirming the block.`
    followUps.push(followUp)
    verdicts.push(
      verdict(
        'GRP-INSURANCE-CERT',
        'flag',
        `${inquiry.event_type} booking with no certificate on file`,
        doc.label,
        `This is a youth group, and ${rules.property_name} will not confirm a youth block until we have a ${doc.label} on file. We can still send the proposal and hold the rooms, but the booking is not confirmed until that certificate arrives, and we should say so plainly rather than let them find out at check-in.`,
      ),
    )
  }

  // ------------------------------------------------------------------ advisory rate notes
  if (arrival && departure) {
    for (const note of rules.seasonal_rate_notes) {
      if (!windowCoversStay(note.window, arrival, departure)) continue
      verdicts.push(
        verdict(
          'GRP-SEASONAL-RATE-NOTE',
          'pass',
          `${speakDate(arrival)} to ${speakDate(departure)}`,
          note.label,
          `These dates fall in the ${note.label}, when rates at ${rules.property_name} typically run about ${Math.abs(note.approx_change_pct)}% ${note.approx_change_pct < 0 ? 'below' : 'above'} the rest of the year. That is a rough guide from the property notes rather than a published rate, so we have not changed the quote off it, but it is worth knowing before we negotiate.`,
        ),
      )
    }
  }

  const decision = decide(verdicts)

  return {
    inquiry_id: inquiry.inquiry_id,
    property_code: rules.property_code,
    decision,
    verdicts,
    effective_discount_pct_ceiling: applied.pct,
    pricing_blocked_by: pricingBlockedBy,
    required_follow_ups: followUps,
    referrals,
    quarantined_fields: quarantinedFields,
    clarifying_questions: completeness.questions,
  }
}

function decide(verdicts: RuleVerdict[]): Decision {
  if (verdicts.some((v) => v.status === 'fail')) return 'blocked'
  if (verdicts.some((v) => v.status === 'flag')) return 'needs_approval'
  return 'auto_approve'
}

function describeApprover(rules: PropertyRuleSet): string {
  return `the general manager at ${rules.property_name}`
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// ---------------------------------------------------------------- helpers for callers

export function failing(result: EvaluationResult): RuleVerdict[] {
  return result.verdicts.filter((v) => v.status === 'fail')
}

export function flagged(result: EvaluationResult): RuleVerdict[] {
  return result.verdicts.filter((v) => v.status === 'flag')
}

export function verdictFor(result: EvaluationResult, ruleId: RuleId): RuleVerdict | undefined {
  return result.verdicts.find((v) => v.rule_id === ruleId)
}

/** True when the block can be quoted at all. */
export function isPriceable(result: EvaluationResult): boolean {
  return result.pricing_blocked_by.length === 0
}

export function stayLengthNights(inquiry: GroupInquiry): number {
  const arrival = parseDate(inquiry.arrival_date)
  const departure = parseDate(inquiry.departure_date)
  if (!arrival || !departure) return 0
  return nightsBetween(arrival, departure)
}
