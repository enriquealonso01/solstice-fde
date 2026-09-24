// The judgment moment.
//
// When the only thing wrong with an inquiry is that the customer asked for more discount than we
// can sign off, the useful response is not "rejected" and it is not "approved anyway". It is three
// costed options with the tradeoffs spelled out, so a sales rep can decide in ten seconds and the
// decision lands in the audit log with a reason attached.
//
// Nothing here is generated prose. The options, and the value-adds attached to them, are data.

import type { GroupInquiry, Property } from '../../../shared/types'
import { formatUsd, priceBlock, type PricedBlock } from './pricing'
import type { PropertyRuleSet } from './types'

export type DecisionOptionId = 'approve_at_ceiling' | 'escalate_to_gm' | 'counter_with_value_add'

export interface ValueAdd {
  key: string
  /** Read aloud to the customer. Must describe something the hotel provably has. */
  label: string
  /** Why we are allowed to offer it, from the property record or the policy reference. */
  basis: string
}

export interface DecisionOption {
  id: DecisionOptionId
  label: string
  discount_pct: number
  /** null when the rep can action it alone. */
  requires_approval_from: string | null
  total_cents: number
  /** Positive = the hotel keeps more than the customer asked to pay. */
  delta_vs_requested_cents: number
  value_add: ValueAdd | null
  human_reason: string
}

export interface DecisionOptionsInput {
  inquiry: GroupInquiry
  property: Property
  rules: PropertyRuleSet
  /** The ceiling that actually applies, seasonal override already resolved. */
  ceiling_pct: number
  requested_pct: number
  general_manager?: string
  /** Rack rate in cents from the sanctioned rate lookup. See PriceBlockInput. */
  nightly_rack_cents?: number
}

/** The value-adds a rep may attach to a counter-offer, in preference order.
 *  Each one is gated on something the property record actually shows, so we never
 *  promise a facility a hotel does not have. */
const VALUE_ADDS: {
  key: string
  build: (input: DecisionOptionsInput) => ValueAdd | null
}[] = [
  {
    key: 'secondary-meeting-room',
    build: ({ inquiry, rules }) => {
      const needed = inquiry.meeting_capacity_needed ?? 0
      if (needed <= 0) return null
      if (rules.max_meeting_capacity < needed) return null
      return {
        key: 'secondary-meeting-room',
        label: 'complimentary use of a second, quieter meeting room alongside the main space',
        basis: `${rules.property_name} seats up to ${rules.max_meeting_capacity} and this group needs ${needed}, so there is room to give them a second space without turning other business away.`,
      }
    },
  },
  {
    key: 'partial-room-upgrade',
    build: ({ inquiry, rules }) => {
      const rooms = inquiry.rooms_requested ?? 0
      if (rooms <= 0) return null
      const suites = rules.inventory['Suite'] ?? 0
      const deluxe = rules.inventory['Deluxe King'] ?? 0
      if (suites + deluxe < 2) return null
      const share = Math.max(1, Math.min(Math.floor(rooms / 5), suites))
      return {
        key: 'partial-room-upgrade',
        label: `an upgrade to the next room class for ${share} of the ${rooms} rooms, subject to availability on the day`,
        basis: `${rules.property_name} holds ${suites} suites and ${deluxe} deluxe rooms, so a ${share}-room upgrade is within what the building can absorb. Wording stays "subject to availability", which is what our own policy allows us to promise.`,
      }
    },
  },
]

function pickValueAdd(input: DecisionOptionsInput): ValueAdd | null {
  for (const candidate of VALUE_ADDS) {
    const built = candidate.build(input)
    if (built) return built
  }
  return null
}

function price(input: DecisionOptionsInput, pct: number): PricedBlock {
  return priceBlock({
    property: input.property,
    rooms: input.inquiry.rooms_requested ?? 0,
    arrival_date: input.inquiry.arrival_date,
    departure_date: input.inquiry.departure_date,
    room_type: input.inquiry.room_type_preference,
    discount_pct: pct,
    nightly_rack_cents: input.nightly_rack_cents,
  })
}

/** The midpoint between what we can approve and what they asked for, rounded to a whole
 *  point so the number sounds like a negotiation and not a formula. */
export function counterPct(ceiling: number, requested: number): number {
  const mid = Math.round((ceiling + requested) / 2)
  return Math.min(Math.max(mid, ceiling), requested)
}

/** Three options, always in this order: the one the rep can do now, the one that needs the GM,
 *  and the one that splits the difference. */
export function buildDecisionOptions(input: DecisionOptionsInput): DecisionOption[] {
  const { ceiling_pct, requested_pct, rules } = input
  const gm = input.general_manager ?? `the general manager at ${rules.property_name}`

  const atCeiling = price(input, ceiling_pct)
  const atRequested = price(input, requested_pct)
  const counter = counterPct(ceiling_pct, requested_pct)
  const atCounter = price(input, counter)

  const valueAdd = pickValueAdd(input)
  const gapCents = atCeiling.total_cents - atRequested.total_cents

  const options: DecisionOption[] = [
    {
      id: 'approve_at_ceiling',
      label: `Approve now at ${ceiling_pct}%`,
      discount_pct: ceiling_pct,
      requires_approval_from: null,
      total_cents: atCeiling.total_cents,
      delta_vs_requested_cents: gapCents,
      value_add: null,
      human_reason: `Send it today at ${ceiling_pct}%, which is the most we are allowed to approve on our own for these dates. The block comes to ${formatUsd(atCeiling.total_cents)}. Nobody else has to sign anything, and the customer hears back from us within the hour. The risk is that they asked for ${requested_pct}% and may push back on the ${round1(requested_pct - ceiling_pct)}-point difference.`,
    },
    {
      id: 'escalate_to_gm',
      label: `Escalate to the GM for the full ${requested_pct}%`,
      discount_pct: requested_pct,
      requires_approval_from: gm,
      total_cents: atRequested.total_cents,
      delta_vs_requested_cents: 0,
      value_add: null,
      human_reason: `Give them exactly what they asked for, ${requested_pct}%, which brings the block to ${formatUsd(atRequested.total_cents)}. That is ${formatUsd(gapCents)} less than approving at ${ceiling_pct}%, and it is above our own authority, so ${gm} has to approve it. Front-of-house cannot sign this one off. Expect the answer to take a day, which matters if the customer is shopping other hotels this week.`,
    },
  ]

  if (valueAdd) {
    options.push({
      id: 'counter_with_value_add',
      label: `Counter at ${counter}% plus a value-add`,
      discount_pct: counter,
      requires_approval_from: counter > ceiling_pct ? gm : null,
      total_cents: atCounter.total_cents,
      delta_vs_requested_cents: atCounter.total_cents - atRequested.total_cents,
      value_add: valueAdd,
      human_reason: `Meet them in the middle at ${counter}%, ${formatUsd(atCounter.total_cents)} for the block, and add ${valueAdd.label}. ${valueAdd.basis} This usually closes without a second conversation, because the customer gets something they actually wanted rather than a smaller number. ${counter > ceiling_pct ? `It still needs ${gm} to sign off the extra point, but it is a far easier ask than the full ${requested_pct}%.` : 'It sits inside our own authority, so we can send it today.'}`,
    })
  }

  return options
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
