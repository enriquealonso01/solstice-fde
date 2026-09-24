// Pricing. All arithmetic in integer cents; dollars appear only at the edges.
//
// Two hard rules:
//  1. We never price from a quarantined rate field (see validation.ts). SOL-PVD's -395 suite
//     rate must not reach a customer-facing number, not even multiplied by zero.
//  2. We never price a stay the rules engine has blocked. The caller checks
//     `EvaluationResult.pricing_blocked_by` first; `priceBlock` also refuses defensively.

import type { Property } from '../../../shared/types'
import { nightsBetween, parseDate } from './dates'
import { isQuarantined, validatePropertyData, type RateField } from './validation'

/**
 * A priced line on a proposal. EVERY MONETARY FIELD IS INTEGER CENTS AND SAYS SO IN ITS NAME.
 *
 * This interface exists because the previous one did not. `shared/types.ts` declares
 * `ProposalLine` with `nightly_rate` and `line_total`, which we were filling with dollars while
 * the totals beside them were cents, inside one object. The admin table formatted every field as
 * cents, correctly per the contract, and rendered an $18-a-night room at $1.97. No test caught
 * it because no test asserted the unit.
 *
 * Gross and net are both carried, named, so nothing downstream has to recompute either:
 *   line_total_cents  sums to subtotal_cents  (before the group discount)
 *   net_total_cents   sums to total_cents     (after it)
 */
export interface ProposalLineCents {
  room_type: string
  rooms: number
  nights: number
  /** Rack rate per room per night, before any group discount. */
  nightly_rate_cents: number
  /** nightly_rate_cents x rooms x nights. Sums across lines to `subtotal_cents`. */
  line_total_cents: number
  /** What the customer actually pays per room per night. */
  nightly_net_cents: number
  /** nightly_net_cents x rooms x nights. Sums across lines to `total_cents`. */
  net_total_cents: number
}

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
  /**
   * The rack rate in integer cents, supplied by the caller.
   *
   * `netlify/functions/_lib/data.ts#getPropertyRate()` is the sanctioned way to obtain a rate:
   * it is the function that refuses SOL-PVD's quarantined suite rate. The group tools call it
   * and pass the result here. When this is omitted we fall back to reading the property record
   * and re-running the same quarantine check locally, which keeps this module pure and
   * browser-safe for the admin UI. The two paths agree, and a test asserts it.
   */
  nightly_rack_cents?: number
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
  line_items: ProposalLineCents[]
}

// NOTE: there are deliberately no `subtotal` / `total` dollar mirrors on this type. They used to
// exist to satisfy `Proposal` in shared/types.ts, and they were the same hazard as the line items:
// a bare number beside a field of cents, one keystroke away from being formatted as the wrong
// unit. Callers use `subtotal_cents` and `total_cents`, and `formatUsd` when a person has to read
// it.

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

  const nightlyRackCents = input.nightly_rack_cents ?? toCents(Number(property[rateField]))
  if (!Number.isFinite(nightlyRackCents) || nightlyRackCents <= 0) {
    return failure(
      input,
      `We do not have a usable nightly rate for ${roomType} at ${property.property_name}, so this block cannot be priced automatically.`,
    )
  }
  /**
   * ROUNDING. The discount is applied to the NIGHTLY rate and the result is rounded to a whole
   * cent before it is multiplied out, because that is the number that appears on the invoice and
   * a hotel cannot charge a third of a cent for a room. `Math.round` takes a half-cent UP, so a
   * tie goes to the hotel by at most half a cent per room-night; rounding the customer's way
   * would mean the block total no longer equals the rate the contract states times the nights,
   * which is the sort of discrepancy that ends up in a dispute.
   *
   * Every rack rate in the provided data is a whole number of dollars, so no rounding actually
   * occurs today. This is here for the day one of them is not.
   */
  const nightlyNetCents = Math.round((nightlyRackCents * (100 - discount_pct)) / 100)

  const subtotalCents = nightlyRackCents * rooms * nights
  const totalCents = nightlyNetCents * rooms * nights
  const discountCents = subtotalCents - totalCents

  const lineItems: ProposalLineCents[] = [
    {
      room_type: roomType,
      rooms,
      nights,
      nightly_rate_cents: nightlyRackCents,
      line_total_cents: nightlyRackCents * rooms * nights,
      nightly_net_cents: nightlyNetCents,
      net_total_cents: nightlyNetCents * rooms * nights,
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
  }
}

/** What one extra point of discount costs the hotel on this block. The number a rep needs
 *  in front of them before deciding whether to escalate for two more points. */
export function costPerDiscountPointCents(block: PricedBlock): number {
  if (!block.ok) return 0
  return Math.round((block.nightly_rack_cents / 100) * block.rooms * block.nights)
}
