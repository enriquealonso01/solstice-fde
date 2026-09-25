/**
 * Documents that quote the agent must quote what it actually says.
 *
 * One change to a single `human_reason` string in T1c invalidated two documents at once:
 * `docs/live-modification.md`, whose whole value is that it is a real capture of a demo moment the
 * brief stages, and `docs/role-walkthroughs.md`. Both were caught by hand, one of them two
 * iterations late, and a presenter reading the stale page would have shown a panel output that did
 * not match the screen in front of them.
 *
 * Hand-auditing found them. This makes the audit automatic, which is the same move as the
 * `tool-naming` guard: the failure mode is not that someone writes the wrong sentence, it is that
 * someone changes the right sentence somewhere else and never thinks to look here.
 *
 * Scope, stated honestly: this pins the one rules-derived sentence the demo documents quote. It is
 * not a general proof that every quotation in every document is current. Files under
 * `transcripts/` are deliberately excluded — those are dated captures of real conversations, and
 * rewriting one to match today's code would be falsifying a record rather than fixing a document.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuleVerdict } from '../../../../shared/types'
import { evaluate_group_rules, type EvaluationPayload } from '../../../../netlify/functions/group/tools'

const repoRoot = resolve(__dirname, '../../../..')

/** Markdown wraps, indents and prefixes blockquotes; none of that is a difference in the text. */
function flatten(text: string): string {
  return text.replace(/^[>\s]+/gm, ' ').replace(/\s+/g, ' ').trim()
}

async function ceilingReason(inquiryId: string): Promise<string> {
  const result = await evaluate_group_rules({ inquiry_id: inquiryId })
  expect(result.ok, `evaluate_group_rules failed: ${result.error}`).toBe(true)
  const verdicts = (result.data as EvaluationPayload).verdicts as RuleVerdict[]
  const verdict = verdicts.find((v) => v.rule_id === 'GRP-DISCOUNT-CEILING')
  expect(verdict, 'INQ-2009 should carry a discount-ceiling verdict').toBeDefined()
  return verdict!.human_reason
}

/** The demo documents that quote the rules engine verbatim. */
const QUOTING_DOCS = ['docs/live-modification.md', 'docs/role-walkthroughs.md']

describe('demo documents quote the refusal the engine actually produces', () => {
  it('INQ-2009 still produces the sentence those documents were captured from', async () => {
    const reason = await ceilingReason('INQ-2009')

    // Guards the specific regression: the sentence must not promise an approver role that the
    // schema cannot enforce. Word boundary, because "judgment" and "segment" contain "gm".
    expect(reason.toLowerCase()).not.toContain('general manager')
    expect(reason).not.toMatch(/\bGM\b/i)
    expect(reason).toContain('named approver')
  })

  for (const relative of QUOTING_DOCS) {
    it(`${relative} quotes it verbatim`, async () => {
      const reason = flatten(await ceilingReason('INQ-2009'))
      const doc = flatten(readFileSync(resolve(repoRoot, relative), 'utf8'))

      expect(
        doc.includes(reason),
        `${relative} no longer quotes the current refusal.\n\nEngine now says:\n  ${reason}\n\n` +
          `Re-run the capture rather than hand-editing the file - see docs/live-modification.md.`,
      ).toBe(true)
    })
  }

  it('fails loudly if the engine sentence is empty, so the check cannot pass vacuously', async () => {
    const reason = await ceilingReason('INQ-2009')
    expect(reason.length).toBeGreaterThan(40)
  })
})
