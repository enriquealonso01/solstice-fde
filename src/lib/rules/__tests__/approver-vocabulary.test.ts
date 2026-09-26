/**
 * Verdicts name the approver one way: "a named approver", from describeApprover() in engine.ts.
 *
 * Who that is gets enforced in the group function, not in the sentence: an approver role
 * (APPROVER_ROLES, the general manager under Policy 13) who did not create or submit the proposal.
 * A verdict that names a person or a tier directly would drift from that rule the day it changes,
 * which is how two verdicts of one inquiry once ended up wording it differently.
 *
 * So this sweeps the class:
 *   1. every verdict of every inquiry in the dataset,
 *   2. the lead-time reason, which no inquiry in the dataset reaches, driven directly,
 *   3. every hand-written `human_reason` literal in the group code, mocks and fixtures included.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuleVerdict } from '../../../../shared/types'
import { listInquiries } from '../../../../netlify/functions/_lib/data'
import { evaluate_group_rules, type EvaluationPayload } from '../../../../netlify/functions/group/tools'
import { evaluateGroupRules } from '../engine'
import { CHICAGO_LEAD_TIME } from '../seasonal'
import { ESCALATION_MATRIX } from '../../../../netlify/functions/tools/rules'

const repoRoot = resolve(__dirname, '../../../..')

/**
 * A tier named in a verdict instead of through describeApprover(): "general manager" or "GM" as a
 * word. Word-bounded for GM because "judgment" and "segment" both contain "gm".
 */
const NAMED_TIER = /general manager|\bGM\b/i

/** Proof the matcher works, so a green sweep cannot mean a broken regex. Both real sentences. */
const HISTORICAL = [
  'so this one is 5 rooms past the line and needs the general manager, the general manager at Solstice Tampa Bayshore, to approve it.',
  'Priced at the compliant 15%; going to 17% needs a GM override.',
]

describe('the matcher would catch what was actually there', () => {
  for (const sentence of HISTORICAL) {
    it(`matches: ${sentence.slice(0, 48)}...`, () => {
      expect(NAMED_TIER.test(sentence)).toBe(true)
    })
  }

  it('does not fire on words that merely contain "gm"', () => {
    expect(NAMED_TIER.test('a judgment call on one segment of the stay')).toBe(false)
  })
})

describe('no verdict in the dataset names the approver any other way', () => {
  it('sweeps every verdict of every inquiry', async () => {
    const inquiries = listInquiries()
    // Vacuity guard: if the dataset ever fails to load, this sweep would pass over nothing.
    expect(inquiries.length, 'no inquiries loaded, so the sweep proved nothing').toBeGreaterThan(5)

    const offenders: string[] = []
    let reasonsChecked = 0

    for (const inquiry of inquiries) {
      const result = await evaluate_group_rules({ inquiry_id: inquiry.inquiry_id })
      expect(result.ok, `evaluate_group_rules failed for ${inquiry.inquiry_id}: ${result.error}`).toBe(true)
      for (const v of (result.data as EvaluationPayload).verdicts as RuleVerdict[]) {
        reasonsChecked += 1
        if (NAMED_TIER.test(v.human_reason)) {
          offenders.push(`${inquiry.inquiry_id} ${v.rule_id} [${v.status}]: ${v.human_reason}`)
        }
      }
    }

    expect(reasonsChecked, 'verdicts carried no reasons, so the sweep proved nothing').toBeGreaterThan(30)
    expect(
      offenders,
      `${offenders.length} verdict reason(s) name the approver directly. Call\n` +
        `describeApprover() in engine.ts rather than writing the phrase into one rule:\n\n` +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('covers both verdicts of INQ-2002, which is where the vocabulary split', async () => {
    const result = await evaluate_group_rules({ inquiry_id: 'INQ-2002' })
    const verdicts = (result.data as EvaluationPayload).verdicts as RuleVerdict[]
    const rooms = verdicts.find((v) => v.rule_id === 'GRP-ROOMS-CAP')
    const ceiling = verdicts.find((v) => v.rule_id === 'GRP-DISCOUNT-CEILING')

    // Both flag on this inquiry. If one ever stops flagging, this case is checking a pass branch
    // and should be re-pointed rather than quietly weakened.
    expect(rooms?.status, 'INQ-2002 rooms cap no longer flags').toBe('flag')
    expect(ceiling?.status, 'INQ-2002 ceiling no longer flags').toBe('flag')

    for (const v of [rooms!, ceiling!]) {
      expect(v.human_reason).not.toMatch(NAMED_TIER)
      // Still actionable: a refusal that names nobody tells the rep nothing.
      expect(v.human_reason.toLowerCase(), `${v.rule_id} stopped naming an approver`).toContain('approver')
    }
  })

  it('says it the same way in both, so the two verdicts cannot drift apart again', async () => {
    const result = await evaluate_group_rules({ inquiry_id: 'INQ-2002' })
    const verdicts = (result.data as EvaluationPayload).verdicts as RuleVerdict[]
    const phrases = ['GRP-ROOMS-CAP', 'GRP-DISCOUNT-CEILING'].map((id) => {
      const reason = verdicts.find((v) => v.rule_id === id)?.human_reason ?? ''
      return /(a named approver[^.]*)/.exec(reason)?.[1] ?? `<no approver clause in ${id}>`
    })
    expect(phrases[0], 'the two flagged verdicts word the approval differently').toBe(phrases[1])
  })
})

/**
 * The lead-time reason, which no inquiry in the dataset reaches: `CHICAGO_LEAD_TIME` is the only
 * lead-time rule and SOL-CHI's one inquiry is under its room count. Driven directly, on fixed dates.
 */
describe('the lead-time reason, which no dataset inquiry renders', () => {
  const leadTimeReason = (): RuleVerdict | undefined => {
    const result = evaluateGroupRules({
      inquiry: {
        inquiry_id: 'INQ-TEST-LEAD-TIME',
        source: 'portal',
        company_name: 'Short Notice Co',
        contact_name: 'A Tester',
        contact_email: 'tester@example.com',
        contact_phone: null,
        event_type: 'Conference',
        preferred_property_code: 'SOL-CHI',
        alternate_property_ok: false,
        arrival_date: '2026-08-10',
        departure_date: '2026-08-12',
        rooms_requested: CHICAGO_LEAD_TIME.over_rooms + 5,
        room_type_preference: 'Standard King',
        requested_discount_pct: 5,
        meeting_capacity_needed: null,
        special_requests: null,
        missing_fields: [],
      } as Parameters<typeof evaluateGroupRules>[0]['inquiry'],
      contact_present: true,
      received_date: '2026-08-05',
      as_of: new Date('2026-08-05T12:00:00Z'),
    })
    return result.verdicts.find((v) => v.rule_id === 'GRP-LEAD-TIME')
  }

  it('renders at all, or this case is asserting over undefined', () => {
    const v = leadTimeReason()
    expect(v, 'the synthetic short-notice inquiry no longer triggers GRP-LEAD-TIME').toBeDefined()
    expect(v!.status).toBe(CHICAGO_LEAD_TIME.on_violation)
  })

  it('does not name the tier directly', () => {
    expect(leadTimeReason()!.human_reason).not.toMatch(NAMED_TIER)
  })

  it('asks for a decision rather than promising the block goes out', () => {
    // A lead-time fail is not in pricing_blocked_by, so an approver can still take it; the reason
    // says it needs their decision, not that it will go out once signed.
    const reason = leadTimeReason()!.human_reason
    expect(CHICAGO_LEAD_TIME.on_violation).toBe('fail')
    expect(reason).not.toMatch(/before it goes out/i)
  })
})

/** Hand-written reasons: mocks, fixtures, and any module that writes the field directly. */
describe('no hand-written reason literal carries the phrase', () => {
  /**
   * Scoped to reasons about who signs off a group proposal. The concierge ESCALATION_MATRIX in
   * netlify/functions/tools/rules.ts quotes Policies 7 and 15, which name the General Manager, and
   * must keep doing so.
   */
  const REASON_ROOTS = ['src/lib/rules', 'src/components/admin', 'netlify/functions/group']
  const LITERAL = /human_reason:\s*(['"`])([\s\S]*?)\1/g

  function sources(): string[] {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry)) out.push(full)
      }
    }
    for (const root of REASON_ROOTS) walk(resolve(repoRoot, root))
    return out
  }

  it('finds the population it claims to check', () => {
    let literals = 0
    for (const file of sources()) literals += [...readFileSync(file, 'utf8').matchAll(LITERAL)].length
    // 66 when written. A floor, not a count: this must not pass because the pattern stopped
    // matching the way the field is written.
    expect(literals, 'no human_reason literals found, so this proved nothing').toBeGreaterThan(40)
  })

  it('and none of them promises the tier', () => {
    const offenders: string[] = []
    for (const file of sources()) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(LITERAL)) {
        if (NAMED_TIER.test(m[2])) {
          const line = text.slice(0, m.index).split('\n').length
          offenders.push(`${relative(repoRoot, file).replace(/\\/g, '/')}:${line}: ${m[2].slice(0, 110)}`)
        }
      }
    }
    expect(
      offenders,
      `a hand-written reason names the approver directly. If it is a fixture for a different\n` +
        `assertion, it still has to read as current, because someone will read it that way:\n\n` +
        offenders.join('\n'),
    ).toEqual([])
  })

  /** The exclusion above, asserted: the phrase belongs in a policy citation. */
  it('keeps the phrase where it is a policy citation, which is the excluded case', () => {
    const safety = ESCALATION_MATRIX.safety.human_reason
    expect(safety, 'Policy 15 names the General Manager; quoting it is correct').toMatch(/General Manager/)
    expect(safety).toContain('Policy 15')
    // And it is genuinely outside the swept population, not passing by luck.
    expect(REASON_ROOTS.some((r) => 'netlify/functions/tools'.startsWith(r))).toBe(false)
  })
})
