// The seasonal and special rules are buried in a free-text `notes` column. Hoping the model
// notices them at runtime is not a plan, so they are parsed into structured rules at build
// time. These tests pin both halves: that each rule came out with the right shape, and that
// the parser is genuinely reading the numbers out of the text rather than hardcoding them.

import { describe, it, expect } from 'vitest'

import { getRule, getRulesForProperty, getRuleset, listProperties } from '../../../netlify/functions/_lib/data'
import type { Rule } from '../../../netlify/functions/_lib/data'
// @ts-expect-error -- .mjs build helper, no declaration file; vitest resolves it fine.
import { buildRules, splitClauses } from '../lib/rules.mjs'

function requireRule(id: string): Rule {
  const rule = getRule(id)
  if (!rule) throw new Error(`missing rule ${id}. Run: node scripts/data/build.mjs`)
  return rule
}

describe('Denver ski-season weekends', () => {
  const rule = requireRule('SOL-DEN.discount_ceiling.ski_season_weekends')

  it('caps the discount at 8%', () => {
    expect(rule.kind).toBe('discount_ceiling')
    expect(rule.constraint).toMatchObject({ field: 'requested_discount_pct', op: 'lte', value: 8, unit: 'percent' })
  })

  it('applies to December through February, Thursday through Sunday', () => {
    expect(rule.applies_when.months).toEqual([12, 1, 2])
    expect(rule.applies_when.weekdays).toEqual(['Thu', 'Fri', 'Sat', 'Sun'])
    expect(rule.applies_when.match).toBe('any_night')
  })

  it('carries the sentence it was parsed from', () => {
    expect(rule.provenance.extraction).toBe('parsed_from_notes')
    expect(rule.provenance.source_text).toContain('8%')
  })
})

describe('Sacramento legislature weeks', () => {
  const rule = requireRule('SOL-SAC.discount_ceiling.state_legislature_session_weeks')

  it('caps the discount at 8% on January-May weekdays', () => {
    expect(rule.constraint!.value).toBe(8)
    expect(rule.applies_when.months).toEqual([1, 2, 3, 4, 5])
    expect(rule.applies_when.weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  })

  // INQ-2010: 10% requested, inside the window, under the property's standing 10% ceiling.
  it('is the binding ceiling for INQ-2010 under most_restrictive_wins', () => {
    expect(getRuleset().resolution.discount_ceiling).toBe('most_restrictive_wins')
    const ceilings = getRulesForProperty('SOL-SAC')
      .filter((r) => r.kind === 'discount_ceiling')
      .map((r) => Number(r.constraint!.value))
    expect(ceilings).toContain(10) // the standing ceiling
    expect(Math.min(...ceilings)).toBe(8) // what actually binds in-window
  })
})

describe('Austin SXSW', () => {
  const rule = requireRule('SOL-AUS.hard_blackout.sxsw')

  it('is a hard fail, not a negotiation', () => {
    expect(rule.kind).toBe('hard_blackout')
    expect(rule.on_violation).toBe('fail')
    expect(rule.negotiable).toBe(false)
    expect(rule.recommended_action).toMatch(/Do not counter on price/i)
  })

  it('covers the SXSW window from the blackout column', () => {
    expect(rule.constraint!.value).toEqual([{ start: '2027-03-10', end: '2027-03-19' }])
  })

  // INQ-2003 asks for 2027-03-14 to 2027-03-17.
  it('the INQ-2003 dates fall inside it', () => {
    const [window] = rule.constraint!.value as { start: string; end: string }[]
    expect('2027-03-14' >= window.start && '2027-03-17' <= window.end).toBe(true)
  })
})

describe('Chicago lead time', () => {
  const rule = requireRule('SOL-CHI.lead_time.over_25_rooms')

  it('requires 14 days once a block passes 25 rooms', () => {
    expect(rule.kind).toBe('lead_time')
    expect(rule.applies_when.min_rooms).toBe(26) // "over 25" is inclusive of 26
    expect(rule.constraint).toMatchObject({ field: 'lead_time_days', op: 'gte', value: 14, unit: 'days' })
  })

  it('does not fire for INQ-2001, which is 18 rooms', () => {
    expect(18 >= rule.applies_when.min_rooms!).toBe(false)
  })
})

describe('Columbus youth-group insurance certificate', () => {
  const rule = requireRule('SOL-CMH.required_document.youth_groups_insurance_certificate')

  it('asks for the certificate rather than rejecting the block', () => {
    expect(rule.kind).toBe('required_document')
    expect(rule.on_violation).toBe('flag')
    expect(rule.constraint).toMatchObject({ field: 'documents_on_file', op: 'includes', value: 'insurance certificate' })
  })

  it('matches on the audience words taken from the note itself', () => {
    expect(rule.applies_when.text_match!.any_of).toContain('youth')
    expect(rule.applies_when.text_match!.fields).toContain('event_type')
  })

  // INQ-2008 is "Youth Group Travel" at SOL-CMH.
  it('fires for an event type containing the term', () => {
    const terms = rule.applies_when.text_match!.any_of
    expect(terms.some((t) => 'Youth Group Travel'.toLowerCase().includes(t))).toBe(true)
  })
})

describe('Providence overflow routing', () => {
  const rule = requireRule('SOL-PVD.routing.overflow_block')

  it('routes blocks over 15 rooms elsewhere', () => {
    expect(rule.kind).toBe('routing')
    expect(rule.applies_when.min_rooms).toBe(16)
    expect(rule.constraint).toMatchObject({ field: 'rooms_requested', op: 'lte', value: 15 })
  })

  it('does not resolve the sister property, because it does not exist', () => {
    expect(rule.referral).toBeDefined()
    expect(rule.referral!.target_description).toMatch(/Boston-area sister property/i)
    expect(rule.referral!.resolved).toBe(false)
    expect(rule.referral!.target_property_code).toBeNull()
    expect(rule.referral!.resolution_note).toMatch(/UNRESOLVED/)
  })

  it('tells the agent to surface the referral without inventing inventory', () => {
    expect(rule.recommended_action).toMatch(/Do NOT quote rooms, rates, or availability/i)
  })

  it('there really is no Boston-area property in the directory', () => {
    const massachusetts = listProperties().filter(
      (p) => p.state === 'MA' || /boston/i.test(p.city) || /boston/i.test(p.property_name),
    )
    expect(massachusetts).toEqual([])
  })

  // INQ-2007 is a 20-room request at SOL-PVD.
  it('fires for INQ-2007 at 20 rooms', () => {
    expect(20 >= rule.applies_when.min_rooms!).toBe(true)
  })
})

describe('the parser reads the data, it does not know the answers', () => {
  // The strongest available proof: feed it a property that does not exist with different
  // numbers in the prose, and check the numbers follow the text.
  const fake = {
    property_code: 'SOL-TEST',
    property_name: 'Solstice Test Harbour',
    city: 'Testville',
    state: 'ZZ',
    total_rooms: 100,
    inventory: { 'Standard King': 100 },
    base_rate_standard: 100,
    base_rate_deluxe: 120,
    base_rate_suite: 200,
    meeting_space_sqft: 1000,
    max_meeting_capacity: 50,
    group_block_auto_approve_max_rooms: 10,
    max_discount_auto_approve_pct: 20,
    blackout_dates: [{ start: '2030-01-01', end: '2030-01-05' }],
    general_manager: 'Test Manager',
    data_quality_flags: [],
    __raw: {},
    notes:
      'Regatta weekends (Jun-Aug, Fri-Sun) run at reduced group discount ceiling of 3%; ' +
      'group requests over 40 rooms need 5+ days lead time; ' +
      'blocks over 60 rooms should be routed to Solstice Chicago Riverwalk instead; ' +
      'verify insurance certificate for school groups',
  }

  const { rules } = buildRules([fake]) as { rules: Rule[] }

  it('pulls a 3% ceiling and a Jun-Aug / Fri-Sun window out of prose it has never seen', () => {
    const seasonal = rules.find((r) => r.rule_id === 'SOL-TEST.discount_ceiling.regatta_weekends')!
    expect(seasonal.constraint!.value).toBe(3)
    expect(seasonal.applies_when.months).toEqual([6, 7, 8])
    expect(seasonal.applies_when.weekdays).toEqual(['Fri', 'Sat', 'Sun'])
  })

  it('converts "5+ days" to 5 days and "over 40 rooms" to min_rooms 41', () => {
    const lead = rules.find((r) => r.kind === 'lead_time')!
    expect(lead.constraint!.value).toBe(5)
    expect(lead.applies_when.min_rooms).toBe(41)
  })

  it('resolves a referral when the target IS in the directory', () => {
    const { rules: withDirectory } = buildRules([
      fake,
      ...listProperties().map((p) => ({ ...p, __raw: {} })),
    ]) as { rules: Rule[] }
    const routing = withDirectory.find((r) => r.rule_id === 'SOL-TEST.routing.overflow_block')!
    expect(routing.referral!.resolved).toBe(true)
    expect(routing.referral!.target_property_code).toBe('SOL-CHI')
  })

  it('derives the document audience from the note, not a lookup table', () => {
    const doc = rules.find((r) => r.kind === 'required_document')!
    expect(doc.applies_when.text_match!.any_of).toContain('school')
  })
})

describe('every sentence of every note is accounted for', () => {
  it('notes_coverage has a row per clause and each row names a rule', () => {
    const coverage = getRuleset().notes_coverage
    for (const property of listProperties()) {
      const clauses = splitClauses(property.notes) as string[]
      const rows = coverage.filter((c) => c.property_code === property.property_code)
      expect(rows.length, property.property_code).toBe(clauses.length)
      for (const row of rows) expect(row.rule_ids.length, `${property.property_code}: "${row.clause}"`).toBeGreaterThan(0)
    }
  })

  it('unparsed clauses survive as advisories that grant nothing', () => {
    const unparsed = getRuleset().notes_coverage.filter((c) => !c.parsed)
    for (const row of unparsed) {
      for (const id of row.rule_ids) {
        const rule = getRule(id)!
        expect(rule.kind).toBe('advisory')
        expect(rule.constraint).toBeNull()
        expect(rule.on_violation).toBeNull()
        expect(rule.pricing_safe).toBe(false)
      }
    }
  })

  it('the Phoenix ~20% off-peak note is context, never a discount', () => {
    const rule = requireRule('SOL-PHX.advisory.off_peak_rates')
    expect(rule.kind).toBe('advisory')
    expect(rule.pricing_safe).toBe(false)
    expect(rule.approximate).toBe(true)
    expect(rule.applies_when.months).toEqual([6, 7, 8])
    expect(rule.recommended_action).toMatch(/NOT a discount/i)
  })
})

describe('every property has the structural rules the engine needs', () => {
  it('ceiling, room cap, capacity and inventory exist for all ten', () => {
    for (const property of listProperties()) {
      const kinds = getRulesForProperty(property.property_code).map((r) => r.kind)
      expect(kinds, property.property_code).toContain('discount_ceiling')
      expect(kinds, property.property_code).toContain('auto_approve_rooms')
      expect(kinds, property.property_code).toContain('meeting_capacity')
      expect(kinds, property.property_code).toContain('inventory_capacity')
    }
  })

  it('SOL-SAC cannot seat the 300-person session INQ-2005 asks for', () => {
    const capacity = requireRule('SOL-SAC.meeting_capacity.max')
    expect(capacity.on_violation).toBe('fail')
    expect(Number(capacity.constraint!.value)).toBe(140)
    expect(300 <= Number(capacity.constraint!.value)).toBe(false)
  })
})
