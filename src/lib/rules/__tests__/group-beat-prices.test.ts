/**
 * The prices the demo runbook reads aloud must be the prices the pricing function produces.
 *
 * Beat 4 is the approval-gate beat, and it works by naming money: the block can go out today at the
 * 15% we can authorise, or at the 17% the customer asked for once a named human signs it. The
 * difference between those two numbers **is** the gate, so a presenter who reads one of them wrongly
 * has undercut the beat while looking at the correct figure on screen.
 *
 * Until iteration 108 the runbook printed one of the three: *"approve at 15% for $7,994.25, escalate
 * for a sign-off at 17%, or counter at 16%"*. The 17% figure was checkable elsewhere —
 * `show-verdict.ts` prints it — and the 16% one appeared nowhere. Measured against the deployed
 * `price_block` for INQ-2009's own shape (SOL-PHX, 15 Deluxe King rooms, 2026-07-28 to 07-31):
 *
 *     15% -> 799,425c = $7,994.25      16% -> 790,020c = $7,900.20      17% -> 780,615c = $7,806.15
 *
 * So the one number it printed was right, and the runbook now prints all three plus the $188.10
 * spread. This pins them to `priceBlock` rather than to my transcription of it: a rate change, a
 * rounding change or a different room type fails here, naming the figure that moved.
 *
 * Hermetic on purpose — `priceBlock` is a pure function over the compiled property data, so this
 * needs no network. The figures were taken from production first and agree with it.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { priceBlock } from '../pricing'
import { listProperties } from '../../../../netlify/functions/_lib/data'

const repoRoot = resolve(__dirname, '../../../..')

/** INQ-2009 exactly as the inquiry data carries it. */
const INQ_2009 = {
  property_code: 'SOL-PHX',
  rooms: 15,
  nights: 3,
  room_type: 'Deluxe King',
} as const

function totalAt(discount_pct: number): number {
  const property = listProperties().find((p) => p.property_code === INQ_2009.property_code)
  expect(property, `${INQ_2009.property_code} is not in the compiled property data`).toBeTruthy()
  const block = priceBlock({
    property: property!,
    rooms: INQ_2009.rooms,
    nights: INQ_2009.nights,
    room_type: INQ_2009.room_type,
    discount_pct,
  })
  return block.total_cents
}

const EXPECTED = [
  { pct: 15, cents: 799_425, printed: '$7,994.25', role: 'the discount we can authorise ourselves' },
  { pct: 16, cents: 790_020, printed: '$7,900.20', role: 'the counter' },
  { pct: 17, cents: 780_615, printed: '$7,806.15', role: 'the discount the customer asked for' },
]

describe("the group beat's three prices", () => {
  it.each(EXPECTED)('$pct% is $printed — $role', ({ pct, cents, printed }) => {
    expect(
      totalAt(pct),
      `priceBlock puts INQ-2009 at ${pct}% somewhere other than ${printed}. The runbook reads that ` +
        `figure out during beat 4, so either the rate moved or the beat is now wrong.`,
    ).toBe(cents)
    // The runbook must actually carry it, or this test is guarding a number nobody says.
    const runbook = readFileSync(join(repoRoot, 'docs/demo-runbook.md'), 'utf8')
    expect(runbook, `docs/demo-runbook.md no longer prints ${printed}`).toContain(printed)
  })

  it('keeps the spread that is the whole point of the beat', () => {
    const spread = totalAt(15) - totalAt(17)
    expect(spread).toBe(18_810)
    const runbook = readFileSync(join(repoRoot, 'docs/demo-runbook.md'), 'utf8')
    expect(
      runbook,
      'The runbook no longer states the difference between approving at 15% and escalating at 17%. ' +
        'That difference is what makes "it needs approval" concrete.',
    ).toContain('$188.10')
  })

  it('orders them the way discounts actually work, which is the sanity check on all of it', () => {
    // A bigger discount cannot cost more. If this ever fails, one of the figures above is a typo
    // that happened to match a wrong implementation.
    expect(totalAt(15)).toBeGreaterThan(totalAt(16))
    expect(totalAt(16)).toBeGreaterThan(totalAt(17))
  })
})
