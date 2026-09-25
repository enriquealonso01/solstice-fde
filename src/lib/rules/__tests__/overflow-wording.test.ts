// The overflow-routing verdict is read aloud at demo beat 4b and shown on the rep's screen.
//
// The regression this guards, seen in production: the sentence rendered as "we are passing this to
// the the Boston-area sister property team". The template hard-coded an article before
// `routing.refer_to`, and the configured value (`seasonal.ts:68`) already starts with "the" —
// so the two collided. One doubled article, in the one verdict a panel is invited to read.
//
// The fix removed the article rather than the duplicate, so the sentence now reads correctly for
// ANY refer_to value, whether it is a description ("the Boston-area sister property") or a property
// name ("Solstice Boston Seaport"). That matters because there is one config today and adding a
// second is a one-line change that would otherwise reintroduce the bug from the other direction.

import { describe, expect, it } from 'vitest'
import { evaluateGroupRules } from '../engine'
import { PROVIDENCE_OVERFLOW } from '../seasonal'

/** No doubled article, anywhere, whatever the configured referral target is called. */
const DOUBLED_WORD = /\b(\w+) \1\b/i

describe('the overflow-routing verdict reads correctly', () => {
  it('has no doubled word, which is how the original defect showed', () => {
    const text = overflowReason()
    expect(text).toBeTruthy()
    const doubled = text.match(DOUBLED_WORD)
    expect(doubled, `doubled word: ${doubled?.[0]}`).toBeNull()
  })

  it('names the referral target exactly once per mention, not "the the ..."', () => {
    const text = overflowReason()
    expect(text).not.toMatch(/to the the /i)
    expect(text).toContain(PROVIDENCE_OVERFLOW.refer_to)
  })

  it('still says the honest thing: that we cannot quote for a hotel we cannot see', () => {
    const text = overflowReason()
    expect(text).toMatch(/not in the system we can see/i)
    expect(text).toMatch(/not able to quote a rate|cannot quote/i)
    // and still offers the partial hold, which is the useful half of the answer
    expect(text).toMatch(/hold \d+ rooms here/i)
  })

  it('does not depend on the configured name starting with an article', () => {
    // The template must not supply its own article. If it did, a refer_to that is a bare property
    // name would read "...passing this to Solstice Boston Seaport team".
    const text = overflowReason()
    const idx = text.indexOf(PROVIDENCE_OVERFLOW.refer_to)
    const before = text.slice(Math.max(0, idx - 12), idx)
    expect(before).not.toMatch(/\bthe\s+$/i)
  })
})

/** Pull the GRP-OVERFLOW-ROUTING reason out of a real evaluation of the Providence overflow case. */
function overflowReason(): string {
  const result = evaluateGroupRules({
    inquiry: {
      inquiry_id: 'INQ-TEST-OVERFLOW',
      source: 'portal',
      company_name: 'Overflow Test Co',
      contact_name: 'A Tester',
      contact_email: 'tester@example.com',
      contact_phone: null,
      event_type: 'Conference',
      preferred_property_code: 'SOL-PVD',
      alternate_property_ok: false,
      arrival_date: '2027-05-10',
      departure_date: '2027-05-12',
      rooms_requested: PROVIDENCE_OVERFLOW.over_rooms + 5,
      room_type_preference: 'Standard King',
      requested_discount_pct: 5,
      meeting_capacity_needed: null,
      special_requests: null,
      missing_fields: [],
    } as Parameters<typeof evaluateGroupRules>[0]['inquiry'],
    contact_present: true,
  })
  const verdict = result.verdicts.find((v) => v.rule_id === 'GRP-OVERFLOW-ROUTING')
  return verdict?.human_reason ?? ''
}
