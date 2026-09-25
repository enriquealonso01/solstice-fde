/**
 * The voice prompt must fit, and must be seen to fit.
 *
 * `agent/sol.md` calls itself the single agent definition, but the phone agent carried none of four
 * hours of edits to it. The cause was not a judgement call: the compile had grown to 32,831 chars
 * against a `MAX_INSTRUCTION_CHARS` of 30,000, and over the cap `compileInstructions` truncates and
 * appends a marker. Nothing failed, nothing warned; the deliverable simply stopped describing the
 * thing it claimed to define.
 *
 * Two properties are worth pinning, and only one of them is the number:
 *
 *  1. The compile fits under the cap, so provisioning cannot silently drop the tail.
 *  2. The parts that must steer a live call survive the compile. A size test alone would be
 *     satisfied by deleting the guardrails, which is the cheapest way to get under a limit and the
 *     worst. So the guardrail and routing text is asserted present in the OUTPUT, not the input.
 *
 * `compileInstructions` is imported from the provisioning script rather than reimplemented here. A
 * copy of those three regexes in a test would pass forever while the real compile drifted, which is
 * the same failure this test exists to prevent.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileInstructions, MAX_INSTRUCTION_CHARS } from '../../../../scripts/telnyx/provision.mjs'

const repoRoot = resolve(__dirname, '../../../..')
const markdown = readFileSync(resolve(repoRoot, 'agent/sol.md'), 'utf8')
const compiled = compileInstructions(markdown)

describe('the compiled voice prompt', () => {
  it('fits under the cap, so provisioning does not truncate it', () => {
    expect(
      compiled.instructions.length,
      `agent/sol.md compiles to ${compiled.instructions.length} chars against a cap of ` +
        `${MAX_INSTRUCTION_CHARS}. Over the cap the tail is silently dropped and the phone agent ` +
        `stops matching its own definition. Wrap documentation-rather-than-instruction in ` +
        `<!-- voice:exclude --> ... <!-- /voice:exclude --> rather than raising the cap.`,
    ).toBeLessThanOrEqual(MAX_INSTRUCTION_CHARS)
  })

  it('reports no truncation', () => {
    expect(compiled.truncated).toBe(false)
  })

  it('does not end mid-sentence, which is what truncation looks like', () => {
    expect(compiled.instructions).not.toContain('[truncated at')
    expect(compiled.instructions.trimEnd()).toMatch(/[.`|)\]-]$/)
  })

  it.each([
    ['the routing rule', 'routing'],
    ['verification before stay details', 'confirmation'],
    ['the group lane', 'group'],
    ['escalation', 'escalat'],
  ])('keeps %s in the compiled output, not just in the file', (_label, needle) => {
    expect(compiled.instructions.toLowerCase()).toContain(needle)
  })

  it('still carries the guardrail section that a call depends on', () => {
    expect(compiled.instructions).toContain('Guardrails')
  })

  it('excludes what is marked chat-only, or the exclusion is not doing anything', () => {
    // Section 8's transcripts are wrapped. If they reappear in the compile the wrapper broke, and
    // the prompt is back over the cap without anyone being told.
    expect(markdown).toContain('## 8. Sample transcripts')
    expect(compiled.instructions).not.toContain('## 8. Sample transcripts')
  })

  it('leaves the full file intact for the chat runtime, which reads it raw', () => {
    // chat.ts reads agent/sol.md directly, so excluding a section from VOICE must not remove it
    // from the file. This is the property that makes one definition serve two runtimes.
    expect(markdown).toContain('## 9. Where this runs')
    expect(markdown.length).toBeGreaterThan(compiled.instructions.length)
  })
})
