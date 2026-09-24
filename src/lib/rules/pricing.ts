// Pricing. All arithmetic in integer cents; dollars appear only at the edges.
//
// Two hard rules:
//  1. We never price from a quarantined rate field (see validation.ts). SOL-PVD's -395 suite
//     rate must not reach a customer-facing number, not even multiplied by zero.
//  2. We never price a stay the rules engine has blocked. The caller checks
//     `EvaluationResult.pricing_blocked_by` first; `priceBlock` also refuses defensively.

import type { Property, ProposalLine } from '../../../shared/types'
import { nightsBetween, parseDate } from './dates'
import { isQuarantined, validatePropertyData, type RateField } from './validation'

export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

export function toDollars(cents: number): number {
  return Math.round(cents) / 100
}

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Room-type label -> which rate column prices it. Data, not a chain of if-statements:
 *  a new room type is one line. Matched case-insensitively by prefix. */
export const ROOM_TYPE_RATE_FIELD: [prefix: string, field: RateField][] = [
  ['suite', 'base_rate_suite'],
  ['deluxe', 'base_rate_deluxe'],
  ['standard', 'base_rate_standard'],
]

export const DEFAULT_ROOM_TYPE = 'Standard King'

export function rateFieldForRoomType(roomType: string | null | undefined): RateField {
  const label = (roomType ?? DEFAULT_ROOM_TYPE).trim().toLowerCase()
  for (const [prefix, field] of ROOM_TYPE_RATE_FIELD) {
    if (label.startsWith(prefix)) return field
  }
  return 'base_rate_standard'
}

export interface PriceBlockInput {
  property: Property
  rooms: number
  /** Either supply nights directly, or supply arrival/departure and let us count them. */
  nights?: number
  arrival_date?: string | null
  departure_date?: string | null
  room_type?: string | null
  /** Whole percentage points. The caller decides which number this is:
   *  what the customer asked for, or what the rules engine will actually allow. */
  discount_pct: number
}

export interface PricedBlock {
  ok: boolean
  error?: string
  property_code: string
  room_type: string
  rooms: number
  nights: number
  rate_field: RateField
  /** Rack rate before discount. */
  nightly_rack_cents: number
  nightly_net_cents: number
  discount_pct: number
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  line_items: ProposalLine[]
  /** Dollar mirrors for the shared `Proposal` shape and for rendering. */
  subtotal: number
  total: number
}

function failure(input: PriceBlockInput, error: string): PricedBlock {
  const roomType = input.room_type ?? DEFAULT_ROOM_TYPE
  return {
    ok: false,
    error,
    property_code: input.property.property_code,
    room_type: roomType,
    rooms: input.rooms,
    nights: input.nights ?? 0,
    rate_field: rateFieldForRoomType(roomType),
    nightly_rack_cents: 0,
    nightly_net_cents: 0,
    discount_pct: input.discount_pct,
    subtotal_cents: 0,
    discount_cents: 0,
    total_cents: 0,
    line_items: [],
    subtotal: 0,
    total: 0,
  }
}

export function priceBlock(input: PriceBlockInput): PricedBlock {
  const { property, rooms, discount_pct } = input
  const roomType = (input.room_type ?? DEFAULT_ROOM_TYPE).trim() || DEFAULT_ROOM_TYPE

  const nights =
    typeof input.nights === 'number'
      ? input.nights
      : (() => {
          const arrival = parseDate(input.arrival_date ?? null)
          const departure = parseDate(input.departure_date ?? null)
          return arrival && departure ? nightsBetween(arrival, departure) : 0
        })()

  if (!Number.isFinite(rooms) || rooms <= 0) {
    return failure(input, 'Cannot price a block without a confirmed room count.')
  }
  if (!Number.isFinite(nights) || nights <= 0) {
    return failure(input, 'Cannot price a block without confirmed arrival and departure dates.')
  }
  if (!Number.isFinite(discount_pct) || discount_pct < 0 || discount_pct >= 100) {
    return failure(input, `A discount of ${discount_pct}% is not a usable number.`)
  }

  const rateField = rateFieldForRoomType(roomType)
  const validation = validatePropertyData(property)
  if (isQuarantined(validation, rateField)) {
    const quarantined = validation.quarantined.find((q) => q.field === rateField)
    return failure(
      input,
      quarantined?.human_reason ??
        `The stored rate for ${roomType} at ${property.property_name} failed validation, so this block cannot be priced automatically.`,
    )
  }

  const nightlyRackCents = toCents(Number(property[rateField]))
  const nightlyNetCents = Math.round((nightlyRackCents * (100 - discount_pct)) / 100)

  const subtotalCents = nightlyRackCents * rooms * nights
  const totalCents = nightlyNetCents * rooms * nights
  const discountCents = subtotalCents - totalCents

  const lineItems: ProposalLine[] = [
    {
      room_type: roomType,
      rooms,
      nights,
      nightly_rate: toDollars(nightlyNetCents),
      line_total: toDollars(totalCents),
    },
  ]

  return {
    ok: true,
    property_code: property.property_code,
    room_type: roomType,
    rooms,
    nights,
    rate_field: rateField,
    nightly_rack_cents: nightlyRackCents,
    nightly_net_cents: nightlyNetCents,
    discount_pct,
    subtotal_cents: subtotalCents,
    discount_cents: discountCents,
    total_cents: totalCents,
    line_items: lineItems,
    subtotal: toDollars(subtotalCents),
    total: toDollars(totalCents),
  }
}

/** What one extra point of discount costs the hotel on this block. The number a rep needs
 *  in front of them before deciding whether to escalate for two more points. */
export function costPerDiscountPointCents(block: PricedBlock): number {
  if (!block.ok) return 0
  return Math.round((block.nightly_rack_cents / 100) * block.rooms * block.nights)
}
