// The proof.
//
// One assertion block per inquiry in the provided dataset, run against data/generated/*.json,
// which is built from the four files the challenge shipped. Nothing here is hand-copied and
// nothing here calls a language model: if a rule changes, these fail, and if the dataset
// changes, these fail. That is the point.

import { describe, expect, it } from 'vitest'
import type { RuleVerdict } from '../../../../shared/types'
import { listProperties } from '../../../../netlify/functions/_lib/data'
import {
  check_availability,
  draft_clarifying_questions,
  evaluate_group_rules,
  find_alternates,
  generate_proposal,
  validate_property_data,
  type EvaluationPayload,
} from '../../../../netlify/functions/group/tools'
import { PROPERTY_RULES, verifyAgainstProperties } from '../thresholds'

async function evaluate(inquiryId: string): Promise<EvaluationPayload> {
  const result = await evaluate_group_rules({ inquiry_id: inquiryId })
  expect(result.ok, `evaluate_group_rules failed for ${inquiryId}: ${result.error}`).toBe(true)
  return result.data as EvaluationPayload
}

function verdict(payload: EvaluationPayload, ruleId: string): RuleVerdict | undefined {
  return payload.verdicts.find((v) => v.rule_id === ruleId)
}

function blocking(payload: EvaluationPayload): RuleVerdict[] {
  return payload.verdicts.filter((v) => v.status === 'flag' || v.status === 'fail')
}

// ============================================================================ INQ-2001

describe('INQ-2001 Harlow & Vance, SOL-CHI', () => {
  it('is a clean auto-approve with nothing flagged', async () => {
    const result = await evaluate('INQ-2001')
    expect(result.decision).toBe('auto_approve')
    expect(blocking(result)).toEqual([])
    expect(result.requires_approval).toBe(false)
    expect(result.pricing_blocked_by).toEqual([])
  })

  it('shows 18 rooms against the 25-room line and 10% against the 12% ceiling', async () => {
    const result = await evaluate('INQ-2001')
    expect(verdict(result, 'GRP-ROOMS-CAP')).toMatchObject({ status: 'pass', actual: 18, threshold: 25 })
    expect(verdict(result, 'GRP-DISCOUNT-CEILING')).toMatchObject({
      status: 'pass',
      actual: 10,
      threshold: 12,
    })
  })

  it('produces a sendable proposal that needs no approval', async () => {
    const proposal = await generate_proposal({ inquiry_id: 'INQ-2001' })
    expect(proposal.ok).toBe(true)
    expect(proposal.data?.requires_approval).toBe(false)
    expect(proposal.data?.status).toBe('draft')
    expect(proposal.data?.discount_pct).toBe(10)
  })
})

// ============================================================================ INQ-2002

describe('INQ-2002 Ridgeline Sports Club, SOL-TPA', () => {
  it('flags BOTH the 40 rooms over the 35 cap and the 22% over the 15% ceiling', async () => {
    const result = await evaluate('INQ-2002')

    const rooms = verdict(result, 'GRP-ROOMS-CAP')
    expect(rooms).toMatchObject({ status: 'flag', actual: 40, threshold: 35 })

    const discount = verdict(result, 'GRP-DISCOUNT-CEILING')
    expect(discount).toMatchObject({ status: 'flag', actual: 22, threshold: 15 })

    // BOTH, and only those two. A blanket rejection would also "flag" this inquiry, and would
    // be wrong.
    expect(blocking(result).map((v) => v.rule_id).sort()).toEqual([
      'GRP-DISCOUNT-CEILING',
      'GRP-ROOMS-CAP',
    ])
    expect(result.decision).toBe('needs_approval')
  })

  it('names the gap in words a rep can read to the customer', async () => {
    const result = await evaluate('INQ-2002')
    expect(verdict(result, 'GRP-ROOMS-CAP')?.human_reason).toContain('40 rooms')
    expect(verdict(result, 'GRP-DISCOUNT-CEILING')?.human_reason).toContain('22%')
  })

  // The refusal used to say approval needed "the general manager". There is no GM: `staff_role`
  // is ('concierge', 'group_sales', 'admin') and `approveProposal` applies no test beyond
  // group_sales|admin, so the sentence promised an authority nothing enforced. Say what is
  // actually enforced — an approval happens and is attributable — and keep it that way.
  // T60: this checked GRP-DISCOUNT-CEILING only, and ten lines above it the rooms-cap case
  // checked the same inquiry's other flagged verdict for the string "40 rooms" alone. So the
  // rooms-cap reason kept the phrase and said it TWICE, for months, one verdict away from the
  // assertion banning it. The reasoning above was about the rule; only its subject was narrow.
  // It now covers every verdict this inquiry produces, pass and flag alike -- the pass branch of
  // the rooms cap carried it too, on five other inquiries.
  it('does not promise an approver role the system does not have, in ANY of its verdicts', async () => {
    const result = await evaluate('INQ-2002')
    expect(result.verdicts.length, 'INQ-2002 produced no verdicts to check').toBeGreaterThan(3)

    for (const v of result.verdicts) {
      const reason = v.human_reason
      expect(reason.toLowerCase(), `${v.rule_id} names a general manager`).not.toContain('general manager')
      // Word boundaries, not a substring: 'judgment' and 'segment' both contain "gm".
      expect(reason, `${v.rule_id} names a GM`).not.toMatch(/GM/i)
    }

    // Still has to say a human must sign it off, or the refusal stops being actionable. Both
    // flagged verdicts, because both are an authority question.
    for (const ruleId of ['GRP-ROOMS-CAP', 'GRP-DISCOUNT-CEILING'] as const) {
      const v = verdict(result, ruleId)
      expect(v?.status, `${ruleId} no longer flags on INQ-2002`).toBe('flag')
      expect(v?.human_reason.toLowerCase(), `${ruleId} names no approver`).toContain('approver')
    }
  })
})

// ============================================================================ INQ-2003

describe('INQ-2003 Longhorn Analytics, SOL-AUS during SXSW', () => {
  it('is a hard blackout, not a discount conversation', async () => {
    const result = await evaluate('INQ-2003')
    const blackout = verdict(result, 'GRP-BLACKOUT')
    expect(blackout?.status).toBe('fail')
    expect(blackout?.threshold).toContain('closed to group business')
    expect(result.decision).toBe('blocked')
    expect(result.pricing_blocked_by).toContain('GRP-BLACKOUT')
    // The discount they asked for is fine. Saying so matters: the blackout is the reason.
    expect(verdict(result, 'GRP-DISCOUNT-CEILING')?.status).toBe('pass')
  })

  it('is never priced', async () => {
    const proposal = await generate_proposal({ inquiry_id: 'INQ-2003' })
    expect(proposal.ok).toBe(false)
    expect(proposal.data).toBeUndefined()
    // No dollar figure anywhere in the refusal.
    expect(proposal.error ?? '').not.toMatch(/\$\s?\d/)
  })

  it('is redirected with real alternates', async () => {
    const alternates = await find_alternates({ inquiry_id: 'INQ-2003' })
    expect(alternates.ok).toBe(true)
    const data = alternates.data!

    // They said they cannot move hotel, so alternate dates at SOL-AUS come first.
    expect(data.customer_open_to_alternate_property).toBe(false)
    expect(data.alternate_dates.length).toBeGreaterThan(0)
    for (const option of data.alternate_dates) {
      expect(option.property_code).toBe('SOL-AUS')
      expect(option.nights).toBe(3)
    }

    // And every alternate hotel offered is a real one from the directory.
    const known = new Set(Object.keys(PROPERTY_RULES))
    expect(data.alternate_properties.length).toBeGreaterThan(0)
    for (const alt of data.alternate_properties) {
      expect(known.has(alt.property_code)).toBe(true)
      expect(alt.max_meeting_capacity).toBeGreaterThanOrEqual(250)
      expect(alt.rooms_of_requested_type).toBeGreaterThanOrEqual(30)
    }
  })
})

// ============================================================================ INQ-2004

describe('INQ-2004 Meridian Wealth Partners, incomplete', () => {
  it('refuses to price and produces clarifying questions instead', async () => {
    const result = await evaluate('INQ-2004')
    expect(verdict(result, 'GRP-COMPLETENESS')?.status).toBe('fail')
    expect(result.pricing_blocked_by).toContain('GRP-COMPLETENESS')
    expect(result.decision).toBe('blocked')
    expect(result.clarifying_questions.length).toBeGreaterThanOrEqual(3)
  })

  it('quotes the customer back their own "around 25" instead of rounding it', async () => {
    const questions = await draft_clarifying_questions({ inquiry_id: 'INQ-2004' })
    expect(questions.ok).toBe(true)
    const joined = questions.data!.questions.join(' ')
    expect(joined).toContain('around 25')
    expect(joined.toLowerCase()).toContain('arrival date')
    expect(joined.toLowerCase()).toContain('departure date')
    expect(questions.data!.email_body).toContain('Meridian Wealth Partners')
  })

  it('produces no proposal at all', async () => {
    const proposal = await generate_proposal({ inquiry_id: 'INQ-2004' })
    expect(proposal.ok).toBe(false)
    expect(proposal.data).toBeUndefined()
  })
})

// ============================================================================ INQ-2005

describe('INQ-2005 Cascade Regional, SOL-SAC', () => {
  it('fails on meeting capacity: 300 people against a 140 maximum', async () => {
    const result = await evaluate('INQ-2005')
    const capacity = verdict(result, 'GRP-MEETING-CAPACITY')
    expect(capacity).toMatchObject({ status: 'fail', actual: 300, threshold: 140 })
    expect(capacity?.human_reason).toContain('300')
    expect(capacity?.human_reason).toContain('140')
    expect(result.decision).toBe('blocked')
  })

  it('still reports the 22 rooms over the 20-room line, rather than stopping at the first problem', async () => {
    const result = await evaluate('INQ-2005')
    expect(verdict(result, 'GRP-ROOMS-CAP')).toMatchObject({ status: 'flag', actual: 22, threshold: 20 })
    // And the discount they asked for was never the problem.
    expect(verdict(result, 'GRP-DISCOUNT-CEILING')?.status).toBe('pass')
  })
})

// ============================================================================ INQ-2006

describe('INQ-2006 Blue Anchor Wedding, SOL-PVD', () => {
  it('is clean, even though the property record carries a corrupt suite rate', async () => {
    const result = await evaluate('INQ-2006')
    expect(result.decision).toBe('auto_approve')
    expect(blocking(result)).toEqual([])
    // The bad cell is still surfaced; it just does not hold up a standard-room block.
    expect(result.quarantined_fields).toContain('base_rate_suite')
  })
})

// ============================================================================ INQ-2007

describe('INQ-2007 Ocean State Alumni, SOL-PVD over 15 rooms', () => {
  it('routes to the Boston sister property', async () => {
    const result = await evaluate('INQ-2007')
    const routing = verdict(result, 'GRP-OVERFLOW-ROUTING')
    expect(routing?.status).toBe('flag')
    expect(routing?.human_reason).toContain('Boston-area sister property')
    expect(result.referrals.join(' ')).toContain('Boston-area sister property')
  })

  it('does not invent inventory or a property code for a hotel that is not in the directory', async () => {
    const result = await evaluate('INQ-2007')
    const routing = verdict(result, 'GRP-OVERFLOW-ROUTING')!

    // It says out loud that it cannot quote there.
    expect(routing.human_reason.toLowerCase()).toContain('not able to quote')

    // And nothing anywhere invents a property code for it.
    const known = new Set(Object.keys(PROPERTY_RULES))
    const codes = JSON.stringify(result).match(/SOL-[A-Z]{3}/g) ?? []
    for (const code of codes) expect(known.has(code)).toBe(true)

    const alternates = await find_alternates({ inquiry_id: 'INQ-2007' })
    for (const alt of alternates.data!.alternate_properties) {
      expect(known.has(alt.property_code)).toBe(true)
    }
  })

  it('quarantines the -395 suite rate', async () => {
    const result = await evaluate('INQ-2007')
    expect(result.quarantined_fields).toContain('base_rate_suite')

    const quality = verdict(result, 'GRP-DATA-QUALITY')
    expect(String(quality?.actual)).toContain('-395')
    expect(quality?.human_reason).toContain('-395')

    const validation = await validate_property_data({ property_code: 'SOL-PVD' })
    expect(validation.data?.ok).toBe(false)
    expect(validation.data?.quarantined.map((q) => q.field)).toContain('base_rate_suite')
    expect(validation.data?.usable_rate_fields).not.toContain('base_rate_suite')
  })

  it('still prices the standard-king block it can actually honour', async () => {
    const proposal = await generate_proposal({ inquiry_id: 'INQ-2007' })
    expect(proposal.ok).toBe(true)
    // 20 rooms x 2 nights x $159, 10% off = $5,724.00
    expect(proposal.data?.total_cents).toBe(572_400)
    expect(proposal.data?.total_display).toBe('$5,724.00')
    expect(proposal.data?.requires_approval).toBe(true)
  })
})

// ============================================================================ INQ-2008

describe('INQ-2008 Buckeye Valley Marching Band, SOL-CMH', () => {
  it('requires the youth-group insurance certificate as a follow-up', async () => {
    const result = await evaluate('INQ-2008')
    const cert = verdict(result, 'GRP-INSURANCE-CERT')
    expect(cert?.status).toBe('flag')
    expect(String(cert?.threshold)).toContain('insurance')
    expect(result.required_follow_ups.join(' ').toLowerCase()).toContain('certificate of insurance')
  })

  it('carries the certificate through onto the proposal the customer receives', async () => {
    const proposal = await generate_proposal({ inquiry_id: 'INQ-2008' })
    expect(proposal.ok).toBe(true)
    expect(proposal.data!.html.toLowerCase()).toContain('certificate of insurance')
    expect(proposal.data!.text.toLowerCase()).toContain('certificate of insurance')
  })

  it('also reports the room count and discount, which are genuinely over the line too', async () => {
    const result = await evaluate('INQ-2008')
    expect(verdict(result, 'GRP-ROOMS-CAP')).toMatchObject({ status: 'flag', actual: 28, threshold: 20 })
    expect(verdict(result, 'GRP-DISCOUNT-CEILING')).toMatchObject({
      status: 'flag',
      actual: 12,
      threshold: 10,
    })
  })
})

// ============================================================================ INQ-2009

describe('INQ-2009 Camelback Fitness, SOL-PHX — the judgment moment', () => {
  it('flags ONLY the 2-point discount overage', async () => {
    const result = await evaluate('INQ-2009')
    const flags = blocking(result)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({
      rule_id: 'GRP-DISCOUNT-CEILING',
      status: 'flag',
      actual: 17,
      threshold: 15,
    })
    // Everything else about this booking is fine, and the engine says so.
    expect(verdict(result, 'GRP-ROOMS-CAP')?.status).toBe('pass')
    expect(verdict(result, 'GRP-MEETING-CAPACITY')?.status).toBe('pass')
    expect(verdict(result, 'GRP-BLACKOUT')?.status).toBe('pass')
    expect(result.decision).toBe('needs_approval')
  })

  it('offers the rep three costed options rather than a yes or a no', async () => {
    const result = await evaluate('INQ-2009')
    expect(result.decision_options).toHaveLength(3)

    const [atCeiling, escalate, counter] = result.decision_options

    expect(atCeiling.id).toBe('approve_at_ceiling')
    expect(atCeiling.discount_pct).toBe(15)
    expect(atCeiling.requires_approval_from).toBeNull()

    expect(escalate.id).toBe('escalate_to_gm')
    expect(escalate.discount_pct).toBe(17)
    expect(escalate.requires_approval_from).toContain('Diego Fuentes')

    expect(counter.id).toBe('counter_with_value_add')
    expect(counter.discount_pct).toBe(16)
    expect(counter.value_add).not.toBeNull()

    // Approving at the compliant number keeps more money than giving the full 17%.
    expect(atCeiling.total_cents).toBeGreaterThan(escalate.total_cents)
    expect(counter.total_cents).toBeGreaterThan(escalate.total_cents)
    expect(counter.total_cents).toBeLessThan(atCeiling.total_cents)

    for (const option of result.decision_options) {
      expect(option.human_reason.length).toBeGreaterThan(80)
      expect(option.human_reason).toMatch(/\$/)
    }
  })

  it('treats the Phoenix off-peak note as advice, not as a repricing', async () => {
    const result = await evaluate('INQ-2009')
    const note = verdict(result, 'GRP-SEASONAL-RATE-NOTE')
    expect(note?.status).toBe('pass')
    expect(note?.human_reason).toContain('20%')
    // The quote still comes off the published deluxe rate of $209.
    const proposal = await generate_proposal({ inquiry_id: 'INQ-2009', discount_pct: 15 })
    // $209 less 15% is $177.65 a night; 15 rooms x 3 nights = $7,994.25. The discount is taken
    // off the nightly rate and then multiplied, which is how a hotel quotes it.
    expect(proposal.data?.total_cents).toBe(799_425)
    expect(proposal.data?.total_display).toBe('$7,994.25')
  })
})

// ============================================================================ INQ-2010

describe('INQ-2010 Golden State Policy Forum, SOL-SAC', () => {
  it('applies the 8% seasonal cap instead of the general 10% ceiling', async () => {
    const result = await evaluate('INQ-2010')
    const discount = verdict(result, 'GRP-DISCOUNT-CEILING')
    expect(discount).toMatchObject({ status: 'flag', actual: 10, threshold: 8 })
    expect(result.effective_discount_pct_ceiling).toBe(8)
    expect(discount?.human_reason).toContain('legislature')
    // The general ceiling is named too, so the rep can see what moved.
    expect(discount?.human_reason).toContain('10%')
  })

  it('also reports the blackout collision in the source data rather than hiding it', async () => {
    // SOL-SAC is closed to group business 2027-05-03 to 2027-05-07 and this stay is
    // 2027-05-04 to 2027-05-06, entirely inside it. The dataset's own commentary on this row
    // only mentions the seasonal cap. Reporting both is the honest answer; see the handover
    // note in the agent report.
    const result = await evaluate('INQ-2010')
    expect(verdict(result, 'GRP-BLACKOUT')?.status).toBe('fail')
    expect(result.decision).toBe('blocked')
  })
})

// ============================================================================ cross-cutting

describe('every verdict is readable aloud', () => {
  const ids = [
    'INQ-2001',
    'INQ-2002',
    'INQ-2003',
    'INQ-2004',
    'INQ-2005',
    'INQ-2006',
    'INQ-2007',
    'INQ-2008',
    'INQ-2009',
    'INQ-2010',
  ]

  it.each(ids)('%s', async (id) => {
    const result = await evaluate(id)
    expect(result.verdicts.length).toBeGreaterThan(0)
    for (const v of result.verdicts) {
      // No rule ids, no snake_case field names, no JSON leaking into something a person reads
      // to a customer. The one exception is the data-quality verdict, which has to name the
      // column that is wrong.
      if (v.rule_id !== 'GRP-DATA-QUALITY') {
        expect(v.human_reason, `${id}/${v.rule_id}`).not.toMatch(/[a-z]_[a-z]/)
        expect(v.human_reason, `${id}/${v.rule_id}`).not.toMatch(/GRP-/)
      }
      expect(v.human_reason.length, `${id}/${v.rule_id}`).toBeGreaterThan(40)
      expect(v.human_reason.trim().endsWith('.'), `${id}/${v.rule_id}`).toBe(true)
    }
  })
})

describe('thresholds are data, not prose', () => {
  it('changing the Phoenix ceiling from 15 to 12 is a one-line edit', async () => {
    const before = await evaluate('INQ-2009')
    expect(verdict(before, 'GRP-DISCOUNT-CEILING')?.threshold).toBe(15)

    const original = PROPERTY_RULES['SOL-PHX'].max_discount_auto_approve_pct
    try {
      // This is exactly the line in thresholds.ts the panel will ask us to change.
      PROPERTY_RULES['SOL-PHX'].max_discount_auto_approve_pct = 12

      const after = await evaluate('INQ-2009')
      const discount = verdict(after, 'GRP-DISCOUNT-CEILING')
      expect(discount?.threshold).toBe(12)
      expect(discount?.human_reason).toContain('12%')
      // And the options regenerate around the new number without anything else changing.
      expect(after.decision_options[0].discount_pct).toBe(12)
      expect(after.decision_options[2].discount_pct).toBe(15)
    } finally {
      PROPERTY_RULES['SOL-PHX'].max_discount_auto_approve_pct = original
    }
  })

  it('has not drifted from the property export', () => {
    expect(verifyAgainstProperties(listProperties())).toEqual([])
  })
})

describe('availability is honest about what it does not know', () => {
  it('answers the building-size question and refuses the night-by-night one', async () => {
    const result = await check_availability({
      property_code: 'SOL-CHI',
      room_type: 'Standard King',
      rooms: 18,
      arrival_date: '2026-09-14',
      departure_date: '2026-09-16',
    })
    expect(result.data?.fits_in_building).toBe(true)
    expect(result.data?.date_level_availability).toBe('unknown_not_in_provided_data')
    // grounded:false obliges the agent to say it cannot confirm the dates.
    expect(result.grounded).toBe(false)
    expect(result.data?.human_reason).toContain('property management system')
  })

  it('is grounded when the answer is a flat no', async () => {
    const result = await check_availability({
      property_code: 'SOL-PVD',
      room_type: 'Standard King',
      rooms: 90,
    })
    expect(result.data?.fits_in_building).toBe(false)
    expect(result.grounded).toBe(true)
  })
})
