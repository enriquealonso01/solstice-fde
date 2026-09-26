/**
 * No verdict, and no hand-written reason anywhere, may promise an approver the schema cannot
 * enforce.
 *
 * The narrow version of this check has existed since T1c: `inquiries.test.ts` evaluates INQ-2002
 * and asserts its GRP-DISCOUNT-CEILING reason says no "general manager". Its comment states the
 * general principle -- `staff_role` is ('concierge', 'group_sales', 'admin') and `approveProposal`
 * applies no test beyond group_sales|admin, so naming a GM promises a tier nothing enforces.
 *
 * **Ten lines above it, the same file evaluated the same inquiry and checked the rooms-cap reason
 * only for the string "40 rooms".** So the rooms-cap verdict kept the phrase, and said it twice:
 * `needs the general manager, the general manager at Solstice Tampa Bayshore, to approve it`. The
 * reasoning had been applied to the sentence that was noticed rather than to the rule.
 *
 * Measured before the fix, by evaluating all ten inquiries rather than the one that was reported:
 * **nine of ten carried it** -- four flags with the stutter, five passes saying "without going to
 * the general manager". The plan filed it as one on-screen instance.
 *
 * So this sweeps the class instead:
 *   1. every verdict of every inquiry in the dataset,
 *   2. the lead-time reason, which no inquiry in the dataset reaches, driven directly,
 *   3. every hand-written `human_reason` literal in the repo -- mocks and fixtures included,
 *      because two of those carried a superseded sentence where a reader would take it as current.
 *
 * On the vocabulary itself: `property.general_manager` IS a real named person in the shipped data,
 * and every proposal PDF signs on their behalf, so naming a GM was policy-grounded (Policy 13 puts
 * group authority with "Sales and the General Manager"). The objection is only about enforcement.
 * "A named approver" is what the app can actually guarantee: an approval that happened and is
 * attributable. `engine.ts` has one function returning that phrase, and every rule calls it.
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
 * The phrase, in the shapes it has actually appeared in: "general manager" and "GM" as a word.
 * Word-bounded for GM because "judgment" and "segment" both contain "gm".
 */
const UNENFORCED_TIER = /general manager|\bGM\b/i

/** Proof the matcher works, so a green sweep cannot mean a broken regex. Both real sentences. */
const HISTORICAL = [
  'so this one is 5 rooms past the line and needs the general manager, the general manager at Solstice Tampa Bayshore, to approve it.',
  'Priced at the compliant 15%; going to 17% needs a GM override.',
]

describe('the matcher would catch what was actually there', () => {
  for (const sentence of HISTORICAL) {
    it(`matches: ${sentence.slice(0, 48)}...`, () => {
      expect(UNENFORCED_TIER.test(sentence)).toBe(true)
    })
  }

  it('does not fire on words that merely contain "gm"', () => {
    expect(UNENFORCED_TIER.test('a judgment call on one segment of the stay')).toBe(false)
  })
})

describe('no verdict in the dataset promises an approver the schema cannot enforce', () => {
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
        if (UNENFORCED_TIER.test(v.human_reason)) {
          offenders.push(`${inquiry.inquiry_id} ${v.rule_id} [${v.status}]: ${v.human_reason}`)
        }
      }
    }

    expect(reasonsChecked, 'verdicts carried no reasons, so the sweep proved nothing').toBeGreaterThan(30)
    expect(
      offenders,
      `${offenders.length} verdict reason(s) name an authority the schema does not have. Call\n` +
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
      expect(v.human_reason).not.toMatch(UNENFORCED_TIER)
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
 * The lead-time reason, which no inquiry in the dataset reaches.
 *
 * `CHICAGO_LEAD_TIME` is the only lead-time rule configured and SOL-CHI's one inquiry is 18 rooms
 * against an over_rooms of 25, so the sweep above never renders this string. It carried the phrase
 * too. Driven directly here, because "no live instance" is how a string stays wrong.
 */
describe('the lead-time reason, which no dataset inquiry renders', () => {
  const leadTimeReason = (): RuleVerdict | undefined => {
    const day = 86_400_000
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
        arrival_date: new Date(Date.now() + 5 * day).toISOString().slice(0, 10),
        departure_date: new Date(Date.now() + 7 * day).toISOString().slice(0, 10),
        rooms_requested: CHICAGO_LEAD_TIME.over_rooms + 5,
        room_type_preference: 'Standard King',
        requested_discount_pct: 5,
        meeting_capacity_needed: null,
        special_requests: null,
        missing_fields: [],
      } as Parameters<typeof evaluateGroupRules>[0]['inquiry'],
      contact_present: true,
    })
    return result.verdicts.find((v) => v.rule_id === 'GRP-LEAD-TIME')
  }

  it('renders at all, or this case is asserting over undefined', () => {
    const v = leadTimeReason()
    expect(v, 'the synthetic short-notice inquiry no longer triggers GRP-LEAD-TIME').toBeDefined()
    expect(v!.status).toBe(CHICAGO_LEAD_TIME.on_violation)
  })

  it('does not promise the unenforced tier', () => {
    expect(leadTimeReason()!.human_reason).not.toMatch(UNENFORCED_TIER)
  })

  it('does not imply the proposal can be signed off and sent, because a fail refuses it', () => {
    // on_violation is 'fail', and generate_proposal returns fail() with the blocker's reason as
    // the refusal text. "Needs X to sign it off before it goes out" would be wrong here: nothing
    // goes out.
    const reason = leadTimeReason()!.human_reason
    expect(CHICAGO_LEAD_TIME.on_violation).toBe('fail')
    expect(reason).not.toMatch(/before it goes out/i)
  })
})

/**
 * Hand-written reasons: mocks, fixtures, and any module that writes the field directly.
 *
 * Two of these carried a sentence the engine had stopped producing -- `mockData.ts`, which is the
 * admin screens' demo data source and therefore renders, and `send-gate-bypass.test.ts`, where a
 * reader would take it as the current wording. Nothing was broken by either, which is exactly why
 * neither got fixed for months.
 */
describe('no hand-written reason literal carries the phrase', () => {
  /**
   * Where a reason is about **who signs off a group proposal**. Scoped deliberately.
   *
   * The first version of this swept every `.ts` under src, netlify, shared and scripts, and failed
   * on three reasons in `netlify/functions/tools/rules.ts` -- the concierge ESCALATION_MATRIX,
   * which quotes Policy 15 (*"goes straight to the General Manager and Regional Security"*) and
   * Policy 7 (*"comps over $50 ... need AGM or GM sign-off"*), and lists those humans in `notify`.
   *
   * **Those are correct, and scrubbing them would make the tool misquote its own policy.** The
   * defect is not the words "general manager" appearing anywhere; it is a GROUP APPROVAL verdict
   * naming a tier the app will not enforce. A guard that could not tell those apart would have
   * pushed me to break a working tool to keep itself green.
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
        if (UNENFORCED_TIER.test(m[2])) {
          const line = text.slice(0, m.index).split('\n').length
          offenders.push(`${relative(repoRoot, file).replace(/\\/g, '/')}:${line}: ${m[2].slice(0, 110)}`)
        }
      }
    }
    expect(
      offenders,
      `a hand-written reason names an authority the schema does not have. If it is a fixture for a\n` +
        `different assertion, it still has to read as current, because someone will read it that way:\n\n` +
        offenders.join('\n'),
    ).toEqual([])
  })

  /**
   * The exclusion above, asserted rather than assumed.
   *
   * If someone reads this guard and "fixes" the escalation matrix to match it, a policy citation
   * stops citing the policy. This says out loud that the phrase belongs there.
   */
  it('keeps the phrase where it is a policy citation, which is the excluded case', () => {
    const safety = ESCALATION_MATRIX.safety.human_reason
    expect(safety, 'Policy 15 names the General Manager; quoting it is correct').toMatch(/General Manager/)
    expect(safety).toContain('Policy 15')
    // And it is genuinely outside the swept population, not passing by luck.
    expect(REASON_ROOTS.some((r) => 'netlify/functions/tools'.startsWith(r))).toBe(false)
  })
})
