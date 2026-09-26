// Alternates: what we offer when the answer is no.
//
// A blackout or an undersized ballroom is only half an answer. The other half is the next
// thing the customer can actually book. Two kinds of alternate, both derived from the same
// threshold table, neither one invented:
//   - different dates at the hotel they asked for
//   - a different Solstice hotel over the same dates
// We never suggest a property that is not in the directory, and we never suggest dates that
// collide with another blackout.

import type { DateRange, GroupInquiry, Property } from '../../../shared/types'
import {
  addDays,
  describeRange,
  formatDate,
  nightsBetween,
  parseDate,
  speakDate,
  stayOverlapsRange,
} from './dates'
import { DEFAULT_ROOM_TYPE } from './pricing'
import { effectiveDiscountCeiling } from './seasonal'
import { PROPERTY_RULES, getPropertyRules } from './thresholds'
import type { PropertyRuleSet } from './types'

export interface AlternateProperty {
  property_code: string
  property_name: string
  city: string | null
  state: string | null
  rooms_of_requested_type: number
  max_meeting_capacity: number
  discount_ceiling_pct: number
  human_reason: string
}

export interface AlternateDates {
  property_code: string
  arrival_date: string
  departure_date: string
  nights: number
  human_reason: string
}

export interface AlternatesInput {
  inquiry: GroupInquiry
  /** Property master records, purely to name the city in the sentence we read aloud. */
  properties?: Property[]
  /** Defaults to every property in the threshold table except the one they asked for. */
  candidates?: PropertyRuleSet[]
  limit?: number
}

export interface AlternatesResult {
  /** The customer's own answer to "would another hotel work?", honoured in the ordering. */
  customer_open_to_alternate_property: boolean
  /** The blackout their stay falls in, or null when something else is the reason. */
  closed_period: DateRange | null
  alternate_dates: AlternateDates[]
  alternate_properties: AlternateProperty[]
}

function cityOf(properties: Property[] | undefined, code: string): { city: string | null; state: string | null } {
  const match = properties?.find((p) => p.property_code === code)
  return { city: match?.city ?? null, state: match?.state ?? null }
}

/** Same length of stay, moved clear of every blackout at the same hotel.
 *  We offer the week before and the week after, because those are the two a customer
 *  with a fixed event usually can and cannot flex to, and they should hear both. */
export function findAlternateDates(inquiry: GroupInquiry, rules?: PropertyRuleSet | null): AlternateDates[] {
  const ruleSet = rules ?? getPropertyRules(inquiry.preferred_property_code)
  if (!ruleSet) return []
  const arrival = parseDate(inquiry.arrival_date)
  const departure = parseDate(inquiry.departure_date)
  if (!arrival || !departure) return []
  const nights = nightsBetween(arrival, departure)
  if (nights <= 0) return []

  const blocking = ruleSet.blackout_dates.find((range) => stayOverlapsRange(arrival, departure, range))
  if (!blocking) return []

  const blackoutStart = parseDate(blocking.start)
  const blackoutEnd = parseDate(blocking.end)
  if (!blackoutStart || !blackoutEnd) return []

  const suggestions: AlternateDates[] = []

  // Check out on the morning the blackout opens: the last night is the day before.
  const beforeDeparture = blackoutStart
  const beforeArrival = addDays(beforeDeparture, -nights)
  if (!ruleSet.blackout_dates.some((r) => stayOverlapsRange(beforeArrival, beforeDeparture, r))) {
    suggestions.push({
      property_code: ruleSet.property_code,
      arrival_date: formatDate(beforeArrival),
      departure_date: formatDate(beforeDeparture),
      nights,
      human_reason: `The same ${nights}-night stay finishing the morning the closed period begins, so ${speakDate(beforeArrival)} to ${speakDate(beforeDeparture)}. Everything they asked for is available on those dates.`,
    })
  }

  // Arrive the day after the blackout closes.
  const afterArrival = addDays(blackoutEnd, 1)
  const afterDeparture = addDays(afterArrival, nights)
  if (!ruleSet.blackout_dates.some((r) => stayOverlapsRange(afterArrival, afterDeparture, r))) {
    suggestions.push({
      property_code: ruleSet.property_code,
      arrival_date: formatDate(afterArrival),
      departure_date: formatDate(afterDeparture),
      nights,
      human_reason: `The same ${nights}-night stay starting the day after the closed period ends, so ${speakDate(afterArrival)} to ${speakDate(afterDeparture)}. That is the first date we can take the block at this hotel.`,
    })
  }

  return suggestions
}

/** Other Solstice hotels that can genuinely take this business over the same dates.
 *  A candidate only makes the list if it clears every hard constraint the original failed. */
export function findAlternateProperties(input: AlternatesInput): AlternateProperty[] {
  const { inquiry } = input
  const arrival = parseDate(inquiry.arrival_date)
  const departure = parseDate(inquiry.departure_date)
  const rooms = typeof inquiry.rooms_requested === 'number' ? inquiry.rooms_requested : 0
  const roomType = inquiry.room_type_preference?.trim() || DEFAULT_ROOM_TYPE
  const capacityNeeded = inquiry.meeting_capacity_needed ?? 0
  const discountWanted = inquiry.requested_discount_pct ?? 0
  const limit = input.limit ?? 3

  const candidates =
    input.candidates ??
    Object.values(PROPERTY_RULES).filter((r) => r.property_code !== inquiry.preferred_property_code)

  const matches: { alt: AlternateProperty; headroom: number }[] = []

  for (const rules of candidates) {
    if (arrival && departure) {
      const blocked = rules.blackout_dates.some((range) => stayOverlapsRange(arrival, departure, range))
      if (blocked) continue
    }

    const available = rules.inventory[roomType] ?? 0
    if (rooms > 0 && available < rooms) continue
    if (capacityNeeded > 0 && rules.max_meeting_capacity < capacityNeeded) continue

    const ceiling = effectiveDiscountCeiling(
      rules.max_discount_auto_approve_pct,
      rules.seasonal_discount_rules,
      arrival,
      departure,
    ).pct
    if (discountWanted > ceiling) continue

    const { city, state } = cityOf(input.properties, rules.property_code)
    const where = city ? `${city}, ${state ?? ''}`.trim().replace(/,$/, '') : rules.property_name

    const reasonParts: string[] = []
    if (rooms > 0) reasonParts.push(`it has ${available} ${roomType} rooms, so the ${rooms}-room block fits`)
    if (capacityNeeded > 0) reasonParts.push(`its largest room seats ${rules.max_meeting_capacity}, enough for their ${capacityNeeded}`)
    reasonParts.push(`we can approve up to ${ceiling}% off there without escalating`)

    matches.push({
      headroom: ceiling - discountWanted + (rules.max_meeting_capacity - capacityNeeded) / 1000,
      alt: {
        property_code: rules.property_code,
        property_name: rules.property_name,
        city,
        state,
        rooms_of_requested_type: available,
        max_meeting_capacity: rules.max_meeting_capacity,
        discount_ceiling_pct: ceiling,
        human_reason: `${rules.property_name}${city ? ` in ${where}` : ''} is open for those exact dates: ${reasonParts.join(', and ')}.`,
      },
    })
  }

  return matches
    .sort((a, b) => b.headroom - a.headroom)
    .slice(0, limit)
    .map((m) => m.alt)
}

export function findAlternates(input: AlternatesInput): AlternatesResult {
  const rules = getPropertyRules(input.inquiry.preferred_property_code)
  const arrival = parseDate(input.inquiry.arrival_date)
  const departure = parseDate(input.inquiry.departure_date)
  return {
    customer_open_to_alternate_property: input.inquiry.alternate_property_ok,
    closed_period:
      (arrival && departure && rules?.blackout_dates.find((r) => stayOverlapsRange(arrival, departure, r))) || null,
    alternate_dates: findAlternateDates(input.inquiry, rules),
    alternate_properties: findAlternateProperties(input),
  }
}

/** One sentence summarising what we are offering instead, ordered by what the customer said
 *  they were willing to move. Read straight out in a call. */
export function describeAlternates(result: AlternatesResult): string {
  const parts: string[] = []
  if (result.closed_period) parts.push(`Those nights fall inside a closed period, ${describeRange(result.closed_period)}.`)
  const reasonOnly = parts.length

  const dateOffer = result.alternate_dates
    .map((d) => `${speakDate(d.arrival_date)} to ${speakDate(d.departure_date)}`)
    .join(' or ')
  const propertyOffer = result.alternate_properties.map((p) => p.property_name).join(', ')

  if (result.customer_open_to_alternate_property) {
    if (propertyOffer) parts.push(`We can take the whole group at ${propertyOffer} on the dates they wanted.`)
    if (dateOffer) parts.push(`Or, if they would rather stay at the hotel they chose, we are open ${dateOffer}.`)
  } else {
    if (dateOffer) parts.push(`They told us they cannot move hotels, so the offer is different dates at the same hotel: ${dateOffer}.`)
    if (propertyOffer) parts.push(`If they can flex after all, ${propertyOffer} could take the group on the original dates.`)
  }

  if (parts.length === reasonOnly) parts.push('We have no alternate that clears every requirement, so this needs a person.')
  return parts.join(' ')
}
