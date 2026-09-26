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

  /**
   * The **After** block, which nothing checked.
   *
   * This document shows two captures: **Before**, with Phoenix's ceiling at 15, and **After**, the same
   * command once the presenter changes it to 12. The case above asserts the doc quotes the live refusal
   * verbatim — and the live ceiling is 15, so **Before satisfies it and After is never looked at.**
   *
   * Found by sweeping for iteration 146's defect instead of treating it as one instance: a
   * `toContain(fragment)` proves nothing about *which* occurrence satisfied it, and `named approver` occurs
   * twice here. Twenty-six such pairs exist across the suite; twenty-five are identifier-presence checks
   * where any occurrence is proof. This is the one where the two occurrences are **different states of the
   * same system** and only one is verified.
   *
   * After is the half the panel sees. The Tester drove it by hand once at its iteration 61 — changed 15 to
   * 12, re-ran, got the documented block verbatim — and nothing has checked it since.
   *
   * Derived here rather than trusted: take the live sentence and substitute the ceiling and the gap. That
   * catches a reworded template (both blocks then fail, loudly), a hand-edited After block, and the
   * arithmetic going wrong — 17 asked minus 12 allowed is 5 points, and the document's own narration is that
   * *"the ceiling, the gap the rep is told about (2 points becomes 5), and the sentence itself"* move together.
   */
  describe('the After block, which the case above cannot reach', () => {
    const DOC = 'docs/live-modification.md'
    const ASKED = 17
    const AFTER_CEILING = 12
    const docText = () => flatten(readFileSync(resolve(repoRoot, DOC), 'utf8'))

    const shape = async () => {
      const reason = await ceilingReason('INQ-2009')
      const m = /up to (\d+)% on our own, so this is (\d+) points? over/.exec(reason)
      expect(
        m,
        `the engine sentence no longer has the "up to N% … so this is N points over" shape, so the After ` +
          `block cannot be derived from it. Re-capture both blocks in ${DOC} and re-point these cases.`,
      ).toBeTruthy()
      const [, ceiling, gap] = m as RegExpExecArray
      return { reason, ceiling: Number(ceiling), gap: Number(gap) }
    }

    it('states a Before gap that is the arithmetic it claims to be', async () => {
      const { ceiling, gap } = await shape()
      expect(gap, `the engine says asked ${ASKED}, allowed ${ceiling}, gap ${gap} — that is not the difference`).toBe(
        ASKED - ceiling,
      )
    })

    it('shows an After block that is the live sentence with the ceiling changed', async () => {
      const { reason, ceiling, gap } = await shape()
      const expectedAfter = reason
        .replace(`up to ${ceiling}% on our own`, `up to ${AFTER_CEILING}% on our own`)
        .replace(`so this is ${gap} points over`, `so this is ${ASKED - AFTER_CEILING} points over`)

      expect(
        docText().includes(flatten(expectedAfter)),
        `${DOC}'s After block is not what the engine would produce with the ceiling at ${AFTER_CEILING}.\n\n` +
          `Expected:\n  ${expectedAfter}\n\n` +
          `That is the output the panel sees *after* the edit they asked for. The Before block is checked ` +
          `against the live engine and passes on its own, which is how this could drift unnoticed — re-run ` +
          `the capture rather than hand-editing the file.`,
      ).toBe(true)
    })

    it('keeps the live ceiling different from the After one, or the beat shows no movement', async () => {
      const { ceiling } = await shape()
      expect(
        ceiling,
        `the live ceiling is ${ceiling}, the same as the After block's ${AFTER_CEILING}. The beat depends on ` +
          `the edit changing something; if thresholds.ts already carried ${AFTER_CEILING} the panel would ` +
          `watch him type and see nothing move.`,
      ).not.toBe(AFTER_CEILING)
    })

    it('shows the price unchanged across both blocks, which is the point being made', () => {
      // "The price did not move" is what the beat builds to: a ceiling is an authority rule, not a rate. If
      // the two blocks ever showed different prices, the narration would be contradicted on screen.
      const prices = [...docText().matchAll(/asked for \(17%\): \$([\d.]+)/g)].map((x) => x[1])
      expect(prices.length, `${DOC} no longer shows the asked-for price in both blocks`).toBe(2)
      expect(
        prices[0],
        `${DOC} shows ${prices[0]} before and ${prices[1]} after. Its headline is that the price does not ` +
          `move when the ceiling does.`,
      ).toBe(prices[1])
    })
  })
})
