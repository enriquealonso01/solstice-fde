// INQ-2009's block (SOL-PHX, 15 Deluxe King, 3 nights) priced at the ceiling, the counter and the ask.
// Figures taken from production's price_block first.
import { describe, expect, it } from 'vitest'
import { priceBlock } from '../pricing'
import { listProperties } from '../../../../netlify/functions/_lib/data'

function totalAt(discount_pct: number): number {
  const property = listProperties().find((p) => p.property_code === 'SOL-PHX')
  expect(property, 'SOL-PHX is not in the compiled property data').toBeTruthy()
  return priceBlock({ property: property!, rooms: 15, nights: 3, room_type: 'Deluxe King', discount_pct }).total_cents
}

describe('priceBlock for INQ-2009', () => {
  it.each([
    { pct: 15, cents: 799_425 },
    { pct: 16, cents: 790_020 },
    { pct: 17, cents: 780_615 },
  ])('$pct% totals $cents cents', ({ pct, cents }) => {
    expect(totalAt(pct)).toBe(cents)
  })

  it('costs less the bigger the discount', () => {
    expect(totalAt(15)).toBeGreaterThan(totalAt(16))
    expect(totalAt(16)).toBeGreaterThan(totalAt(17))
  })
})
