// Reconciliation against the generated ruleset.
//
// `data/generated/rules.json` is the machine extraction of every rule in the four provided
// files, including the six buried in free-text `notes`. `src/lib/rules/thresholds.ts` is the
// live control surface the panel edits during the demo. Two representations of the same
// business rules is only safe if something proves they agree, so this does.
//
// If a threshold is changed in thresholds.ts and NOT in the source data, these fail. That is
// the intended behaviour during the demo: the panel's live edit is a deliberate divergence,
// and this suite is the thing that would have caught it if it were an accident.

import { describe, expect, it } from 'vitest'
import { getRuleset, listProperties } from '../../../../netlify/functions/_lib/data'
import { evaluate_group_rules } from '../../../../netlify/functions/group/tools'
import { PROPERTY_RULES } from '../thresholds'
import {
  CHICAGO_LEAD_TIME,
  COLUMBUS_YOUTH_INSURANCE,
  DENVER_SKI_WEEKENDS,
  PHOENIX_OFF_PEAK,
  PROVIDENCE_OVERFLOW,
  SACRAMENTO_LEGISLATURE_WEEKS,
  documentRuleApplies,
} from '../seasonal'

const ruleset = getRuleset()
const rules = ruleset.rules
const codes = Object.keys(PROPERTY_RULES)

function rule(id: string) {
  const found = rules.find((r) => r.rule_id === id)
  expect(found, `rules.json is missing ${id}`).toBeDefined()
  return found!
}

function numericValue(id: string): number {
  const constraint = rule(id).constraint
  expect(constraint, `${id} has no constraint`).not.toBeNull()
  return constraint!.value as number
}

describe('the control surface agrees with the generated ruleset', () => {
  it.each(codes)('%s discount ceiling', (code) => {
    expect(PROPERTY_RULES[code].max_discount_auto_approve_pct).toBe(
      numericValue(`${code}.discount_ceiling.base`),
    )
  })

  it.each(codes)('%s auto-approve room cap', (code) => {
    expect(PROPERTY_RULES[code].group_block_auto_approve_max_rooms).toBe(
      numericValue(`${code}.auto_approve_rooms.base`),
    )
  })

  it.each(codes)('%s meeting capacity', (code) => {
    expect(PROPERTY_RULES[code].max_meeting_capacity).toBe(
      numericValue(`${code}.meeting_capacity.max`),
    )
  })

  it.each(codes)('%s room-type inventory', (code) => {
    const generated = rule(`${code}.inventory_capacity.room_type`).constraint!.value as Record<
      string,
      number
    >
    expect(PROPERTY_RULES[code].inventory).toEqual(generated)
  })

  it.each(codes)('%s blackout windows', (code) => {
    const generated = rules
      .filter(
        (r) =>
          r.property_code === code && (r.kind === 'blackout' || r.kind === 'hard_blackout'),
      )
      .flatMap((r) => (r.constraint?.value ?? []) as { start: string; end: string }[])
    // SOL-AUS carries the SXSW window twice, once as `blackout` and once as `hard_blackout`.
    // Both mean the hotel is shut to group business; one range is one range.
    const unique = [...new Map(generated.map((r) => [`${r.start}..${r.end}`, r])).values()]
    expect(PROPERTY_RULES[code].blackout_dates).toEqual(unique)
  })

  it('also agrees with the property export itself', () => {
    for (const property of listProperties()) {
      const table = PROPERTY_RULES[property.property_code]
      expect(table.max_discount_auto_approve_pct).toBe(property.max_discount_auto_approve_pct)
      expect(table.group_block_auto_approve_max_rooms).toBe(
        property.group_block_auto_approve_max_rooms,
      )
      expect(table.max_meeting_capacity).toBe(property.max_meeting_capacity)
    }
  })
})

describe('the six rules buried in free text', () => {
  it('Denver ski weekends: Dec to Feb, Thursday to Sunday, 8%', () => {
    const generated = rule('SOL-DEN.discount_ceiling.ski_season_weekends')
    expect(DENVER_SKI_WEEKENDS.max_discount_pct).toBe(generated.constraint!.value)
    expect(DENVER_SKI_WEEKENDS.window.months).toEqual(generated.applies_when.months)
    // rules.json names weekdays; WEEKDAYS.indexOf(name) equals Date#getDay().
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    expect([...DENVER_SKI_WEEKENDS.window.weekdays].sort()).toEqual(
      generated.applies_when.weekdays!.map((d) => WEEKDAYS.indexOf(d)).sort(),
    )
    expect(generated.applies_when.match).toBe('any_night')
  })

  it('Sacramento legislature weeks: Jan to May, weekdays, 8%', () => {
    const generated = rule('SOL-SAC.discount_ceiling.state_legislature_session_weeks')
    expect(SACRAMENTO_LEGISLATURE_WEEKS.max_discount_pct).toBe(generated.constraint!.value)
    expect(SACRAMENTO_LEGISLATURE_WEEKS.window.months).toEqual(generated.applies_when.months)
    expect(SACRAMENTO_LEGISLATURE_WEEKS.window.weekdays).toEqual([1, 2, 3, 4, 5])
  })

  it('Chicago lead time: over 25 rooms needs 14 days, and the same severity', () => {
    const generated = rule('SOL-CHI.lead_time.over_25_rooms')
    expect(CHICAGO_LEAD_TIME.min_days).toBe(generated.constraint!.value)
    // "over 25" is min_rooms 26 in the generated predicate, over_rooms 25 here. Same line.
    expect(CHICAGO_LEAD_TIME.over_rooms + 1).toBe(generated.applies_when.min_rooms)
    expect(CHICAGO_LEAD_TIME.on_violation).toBe(generated.on_violation)
  })

  it('Providence overflow: over 15 rooms goes to an unresolved sister property', () => {
    const generated = rule('SOL-PVD.routing.overflow_block')
    expect(PROVIDENCE_OVERFLOW.over_rooms).toBe(generated.constraint!.value)
    expect(PROVIDENCE_OVERFLOW.refer_to).toContain(generated.referral!.target_description)
    // Both sides agree the target does not exist in the directory.
    expect(generated.referral!.resolved).toBe(false)
    expect(generated.referral!.target_property_code).toBeNull()
  })

  it('Columbus youth insurance: our trigger is a superset of the generated one', () => {
    const generated = rule('SOL-CMH.required_document.youth_groups_insurance_certificate')
    const generatedTriggers = generated.applies_when.text_match!.any_of

    // Every phrase the generated rule fires on must also fire ours, so we can never be
    // laxer than the extraction. We are deliberately broader: a school trip that never uses
    // the word "youth" still needs the certificate.
    for (const trigger of generatedTriggers) {
      expect(COLUMBUS_YOUTH_INSURANCE.applies_when_matches).toContain(trigger)
    }
    expect(COLUMBUS_YOUTH_INSURANCE.applies_when_matches.length).toBeGreaterThan(
      generatedTriggers.length,
    )
    expect(documentRuleApplies(COLUMBUS_YOUTH_INSURANCE, 'School Band Trip')).toBe(true)
    expect(documentRuleApplies(COLUMBUS_YOUTH_INSURANCE, 'Corporate Retreat')).toBe(false)
  })

  it('Phoenix off-peak is advisory, and is not allowed to move a price', () => {
    const generated = rule('SOL-PHX.advisory.off_peak_rates')
    expect(generated.kind).toBe('advisory')
    expect(generated.constraint).toBeNull()
    expect(generated.on_violation).toBeNull()
    expect(PHOENIX_OFF_PEAK.window.months).toEqual(generated.applies_when.months)
    expect(PHOENIX_OFF_PEAK.approx_change_pct).toBe(-20)
  })
})

describe('discount ceilings resolve the way the ruleset says they do', () => {
  it('most restrictive wins: the 8% seasonal cap beats the 10% general one', async () => {
    expect(ruleset.resolution.discount_ceiling).toBe('most_restrictive_wins')
    const result = await evaluate_group_rules({ inquiry_id: 'INQ-2010' })
    expect(result.data!.effective_discount_pct_ceiling).toBe(8)
  })

  it('and the general ceiling applies when no seasonal window is touched', async () => {
    // Same hotel, November, outside the January-to-May session window.
    const result = await evaluate_group_rules({ inquiry_id: 'INQ-2005' })
    expect(result.data!.effective_discount_pct_ceiling).toBe(10)
  })
})
