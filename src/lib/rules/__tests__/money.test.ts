// Money units.
//
// This suite exists because of a bug that every other test passed through. `pricing` carried its
// totals in integer cents and its line items in dollars, inside one object. The admin table
// formatted every money field as cents, exactly as the contract says, and rendered an 18-room
// block at $1.97 a night. The totals were right, so nothing downstream complained.
//
// The rule enforced here is deliberately mechanical rather than a list of known fields: every
// numeric field on a pricing object must either be named `*_cents` and hold an integer, or be
// one of the handful of things that are not money at all. A future field that quietly holds
// dollars fails this without anyone having to remember to add an assertion for it.

import { describe, expect, it } from 'vitest'
import { formatUsd, priceBlock } from '../pricing'
import { listProperties } from '../../../../netlify/functions/_lib/data'
import {
  generate_proposal,
  materialiseProposal,
} from '../../../../netlify/functions/group/tools'
import { getProposal, resetProposalStore } from '../../../../netlify/functions/group/store'

/** Numeric fields on a pricing object or a line that are counts, percentages or versions,
 *  not amounts of money. Anything else numeric must be `*_cents`. */
const NOT_MONEY = new Set([
  'rooms',
  'nights',
  'discount_pct',
  'requested_discount_pct',
  'revision',
  'pdf_bytes_length',
  'latency_ms',
])

/** Subtrees that carry quantities rather than currency. `RuleVerdict.actual` and `.threshold`
 *  are room counts, headcounts and percentages by design, so they are out of scope here rather
 *  than exempted field by field. */
const NOT_MONEY_SUBTREES = new Set(['verdicts', 'decision_options', 'trace'])

function auditMoney(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => auditMoney(item, `${path}[${i}]`, problems))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${key}`
    if (NOT_MONEY_SUBTREES.has(key)) continue
    if (field && typeof field === 'object') {
      auditMoney(field, here, problems)
      continue
    }
    if (typeof field !== 'number') continue

    if (key.endsWith('_cents')) {
      if (!Number.isInteger(field)) problems.push(`${here} is ${field}, which is not a whole cent`)
      continue
    }
    if (NOT_MONEY.has(key)) continue
    problems.push(
      `${here} is a bare number (${field}) with no unit in its name. If it is money it must be named _cents and be an integer.`,
    )
  }
}

// The nine inquiries the rules engine will actually price.
const PRICEABLE = ['INQ-2001', 'INQ-2002', 'INQ-2006', 'INQ-2007', 'INQ-2008', 'INQ-2009']

describe('every monetary field on a stored proposal is integer cents', () => {
  it.each(PRICEABLE)('%s', async (inquiryId) => {
    resetProposalStore()
    const generated = await generate_proposal({ inquiry_id: inquiryId })
    expect(generated.ok, generated.error).toBe(true)

    const stored = (await getProposal(generated.data!.proposal_id))!

    // The whole stored record, not just `pricing`: a dollar value anywhere on it is the same
    // hazard, and the mirrors that used to sit beside these totals are exactly how this started.
    const problems: string[] = []
    auditMoney(stored, 'proposal', problems)
    expect(problems).toEqual([])

    // And the payload that actually crosses the wire to the admin screen.
    const onTheWire: string[] = []
    auditMoney(generated.data, 'generate_proposal', onTheWire)
    expect(onTheWire).toEqual([])
  })
})

describe('the arithmetic closes', () => {
  it.each(PRICEABLE)('%s line totals reconcile to the block totals', async (inquiryId) => {
    resetProposalStore()
    const generated = await generate_proposal({ inquiry_id: inquiryId })
    const { pricing } = (await getProposal(generated.data!.proposal_id))!

    const grossFromLines = pricing.line_items.reduce((sum, l) => sum + l.line_total_cents, 0)
    const netFromLines = pricing.line_items.reduce((sum, l) => sum + l.net_total_cents, 0)

    // Lines are gross, which is what the admin table shows above its discount row.
    expect(grossFromLines).toBe(pricing.subtotal_cents)
    expect(netFromLines).toBe(pricing.total_cents)
    expect(pricing.subtotal_cents - pricing.discount_cents).toBe(pricing.total_cents)

    for (const line of pricing.line_items) {
      expect(line.line_total_cents).toBe(line.nightly_rate_cents * line.rooms * line.nights)
      expect(line.net_total_cents).toBe(line.nightly_net_cents * line.rooms * line.nights)
      expect(line.nightly_net_cents).toBeLessThanOrEqual(line.nightly_rate_cents)
    }
  })

  it('a line rate is a plausible nightly rate, not one hundredth of one', async () => {
    resetProposalStore()
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const { pricing } = (await getProposal(generated.data!.proposal_id))!
    const line = pricing.line_items[0]

    // The bug rendered $219.00 as $1.97. Anything under $10 a night for a city hotel is wrong.
    expect(line.nightly_rate_cents).toBe(21_900)
    expect(line.nightly_net_cents).toBe(19_710)
    expect(formatUsd(line.nightly_net_cents)).toBe('$197.10')
    expect(formatUsd(line.line_total_cents)).toBe('$7,884.00')
    expect(formatUsd(line.net_total_cents)).toBe('$7,095.60')
  })
})

describe('rounding is deliberate', () => {
  it('takes a half cent to the hotel, and only ever once per room-night', () => {
    const property = listProperties().find((p) => p.property_code === 'SOL-CHI')!
    // A rate that does not divide evenly: $219.99 less 7% is $204.5907 a night.
    const block = priceBlock({
      property,
      rooms: 3,
      nights: 2,
      room_type: 'Standard King',
      discount_pct: 7,
      nightly_rack_cents: 21_999,
    })

    expect(block.ok).toBe(true)
    // 21999 * 0.93 = 20459.07 -> 20459, rounded down here because .07 is below the half.
    expect(block.nightly_net_cents).toBe(20_459)
    expect(Number.isInteger(block.nightly_net_cents)).toBe(true)

    // The rounding happens once, on the nightly rate, and is then multiplied out. The totals
    // therefore always equal the rate on the contract times rooms times nights.
    expect(block.total_cents).toBe(20_459 * 3 * 2)
    expect(block.subtotal_cents - block.discount_cents).toBe(block.total_cents)
  })

  it('rounds a dead-on half cent up', () => {
    const property = listProperties().find((p) => p.property_code === 'SOL-CHI')!
    // 20050 * 0.5 = 10025 exactly; use a rate that lands on .5 instead.
    const block = priceBlock({
      property,
      rooms: 1,
      nights: 1,
      room_type: 'Standard King',
      discount_pct: 50,
      nightly_rack_cents: 20_101,
    })
    // 20101 * 0.5 = 10050.5 -> 10051, the half going to the hotel.
    expect(block.nightly_net_cents).toBe(10_051)
  })

  it('never emits a fractional cent on any real property rate', () => {
    for (const property of listProperties()) {
      for (const pct of [0, 5, 8, 10, 12, 15, 17, 22]) {
        for (const roomType of ['Standard King', 'Deluxe King']) {
          const block = priceBlock({ property, rooms: 7, nights: 3, room_type: roomType, discount_pct: pct })
          if (!block.ok) continue
          const problems: string[] = []
          auditMoney(block, `${property.property_code}/${roomType}/${pct}%`, problems)
          expect(problems).toEqual([])
        }
      }
    }
  })
})

describe('the customer documents read from the same cents', () => {
  it('the email shows the nightly rate a person would recognise', async () => {
    resetProposalStore()
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const html = generated.data!.html

    expect(html).toContain('$197.10')
    expect(html).toContain('$219.00')
    expect(html).toContain('$7,095.60')
    // The 100x-small figures must appear nowhere.
    expect(html).not.toContain('$1.97')
    expect(html).not.toContain('$70.96')
  })

  it('the PDF is rendered from the same numbers as the email', async () => {
    resetProposalStore()
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const stored = (await getProposal(generated.data!.proposal_id))!
    const { document } = (await materialiseProposal(stored, { force_render: true }))!

    // One helper, one unit: whatever the document holds, formatUsd turns it into the string
    // that appears in both renderings.
    expect(document.nightly_net_cents).toBe(19_710)
    expect(document.nightly_rack_cents).toBe(21_900)
    expect(document.total_cents).toBe(stored.pricing.total_cents)
    expect(formatUsd(document.total_cents)).toBe('$7,095.60')

    const problems: string[] = []
    auditMoney(
      {
        nightly_rack_cents: document.nightly_rack_cents,
        nightly_net_cents: document.nightly_net_cents,
        subtotal_cents: document.subtotal_cents,
        discount_cents: document.discount_cents,
        total_cents: document.total_cents,
      },
      'document',
      problems,
    )
    expect(problems).toEqual([])
  })
})
