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

/**
 * The compiled prompt must not depend on whose machine compiled it.
 *
 * `*.md` is not pinned in `.gitattributes`, so `agent/sol.md` is checked out CRLF on Windows and LF
 * everywhere else. `compileInstructions` collapsed runs of blank lines with a bare-newline pattern,
 * which matches nothing in CRLF text, and then measured the result against the 30,000 cap. The same
 * commit therefore compiled to **29,411** characters on this machine and **29,006** on a Linux
 * checkout: 400 carriage returns and 5 surviving blank lines.
 *
 * Two things followed. The margin everyone was reasoning about was 405 characters too small -- the
 * real head-room is 994, and both this file's status notes and the plan's banner carried the wrong
 * figure (589 and 681). And `exports/telnyx-assistant.json` is what the live assistant returned, so
 * a reviewer compiling the source on their own machine would not reproduce it, which is exactly the
 * parity the export exists to demonstrate.
 *
 * Found by accident: a Python edit rewrote the working file to LF and the compile dropped by 405
 * characters with no content change. It is the fifth time this session that an unexplained number
 * was the only signal something was wrong.
 */
describe('the compile is independent of line endings', () => {
  const lf = markdown.replace(/\r\n?/g, '\n')
  const crlf = lf.replace(/\n/g, '\r\n')

  it('produces identical bytes from a CRLF and an LF checkout', () => {
    expect(crlf).not.toBe(lf) // the fixture is doing something
    expect(
      compileInstructions(crlf).instructions,
      'The same commit compiles differently depending on the checkout, so the live assistant and ' +
        'the committed export cannot both be reproducible.',
    ).toBe(compileInstructions(lf).instructions)
  })

  it('emits no carriage returns, which are what inflated the measured size', () => {
    expect(compileInstructions(crlf).instructions).not.toMatch(/\r/)
  })

  it('actually collapses blank-line runs, whatever the input endings', () => {
    for (const [label, input] of [
      ['LF', lf],
      ['CRLF', crlf],
    ] as const) {
      expect(compileInstructions(input).instructions, `${label} input left a blank-line run`).not.toMatch(
        /\n{3,}/,
      )
    }
  })
})

/**
 * What the deliverable says the head-room is must be what the head-room is.
 *
 * `agent/sol.md` told a reader the voice compile 'is 1.4KB from a hard 30,000-char cap'. True when
 * written; the real margin by iteration 96 was 994 characters, under 1KB. The number is load-bearing
 * -- it is the figure anyone editing this file uses to decide whether an addition needs wrapping --
 * and an exact count in a file edited every iteration is guaranteed to rot.
 *
 * So the file states a bucket instead, and the bucket is pinned here. A claim that cannot be checked
 * is how the previous one survived being wrong.
 */
describe('the head-room the deliverable claims', () => {
  const margin = MAX_INSTRUCTION_CHARS - compiled.instructions.length
  const BUCKET = 'under a thousand characters of head-room'

  it('is stated as a bucket, not as a figure that rots', () => {
    expect(markdown, `agent/sol.md no longer says "${BUCKET}"; update this case with it`).toContain(BUCKET)
  })

  it('matches the measured margin', () => {
    expect(margin, `agent/sol.md claims "${BUCKET}" and the margin is ${margin}`).toBeGreaterThan(0)
    expect(margin, `agent/sol.md claims "${BUCKET}" and the margin is ${margin}`).toBeLessThan(1000)
  })

  it('states no head-room figure in KB, because that is the form that went stale', () => {
    expect(markdown, 'agent/sol.md is back to claiming head-room in KB').not.toMatch(/[0-9.]+ ?KB from a hard/i)
  })
})

/**
 * A `voice:exclude` block that spans a section boundary is a trap, and there is exactly one.
 *
 * At iteration 122 the obvious way to buy prompt margin looked like wrapping `## 7. Changing a rule live` —
 * 2.7KB of operator documentation a guest on a call never needs. Measured instead of assumed:
 *
 *     as shipped            compiled 29,784   margin  216   truncated false
 *     section 7 wrapped     compiled 30,033   margin  -33   truncated TRUE
 *
 * **Wrapping a section to remove text from the prompt made the prompt bigger and pushed it over the cap.**
 * The cause: section 7 already contains **one opening `<!-- voice:exclude -->` and no closing marker** — its
 * partner lives further down the file. `STRIP_BLOCK` is a non-greedy pair-in-document-order regex, so a new
 * opener at the section head pairs with the *existing block's* closer and every boundary after it inverts.
 *
 * The consequence is worth more than the margin: **"is this text in the voice prompt?" cannot be answered by
 * looking at the section it sits in.** Only `compileInstructions` can answer it.
 *
 * This pins the known spanning block so it cannot multiply. Making the file free of them would mean moving
 * markers inside the live prompt, which costs a re-provision for a structural tidy — not a change to make
 * hours before a submission. What must not happen is a *second* one arriving unnoticed, since each makes the
 * next person's reasoning about the prompt wronger.
 */
describe('voice:exclude block structure', () => {
  /** Top-level section heading each marker falls under, in document order. */
  function markerSections(): { marker: 'open' | 'close'; section: string }[] {
    const out: { marker: 'open' | 'close'; section: string }[] = []
    let section = '(before the first heading)'
    for (const line of markdown.split(/\r?\n/)) {
      if (/^## /.test(line)) section = line.trim()
      if (line.includes('<!-- voice:exclude -->')) out.push({ marker: 'open', section })
      if (line.includes('<!-- /voice:exclude -->')) out.push({ marker: 'close', section })
    }
    return out
  }

  it('has balanced markers, so the compile is not silently inverted', () => {
    const m = markerSections()
    expect(m.filter((x) => x.marker === 'open').length).toBe(m.filter((x) => x.marker === 'close').length)
    expect(m.length, 'no voice:exclude markers found at all; this test would then prove nothing').toBeGreaterThan(2)
  })

  it('opens and closes each block in the same section, except the one known crossing', () => {
    const m = markerSections()
    const spanning: string[] = []
    for (let i = 0; i + 1 < m.length; i += 2) {
      const [open, close] = [m[i], m[i + 1]]
      // Pairs are in document order, exactly as STRIP_BLOCK reads them.
      if (open.marker !== 'open' || close.marker !== 'close') {
        spanning.push(`markers out of order near ${open.section}`)
        continue
      }
      if (open.section !== close.section) spanning.push(`${open.section} -> ${close.section}`)
    }

    // The one that exists, named so a second cannot hide behind it.
    //
    // Measured, after I wrote "-> ## 8. Sample transcripts" from memory and this case corrected me: the
    // block opens in section 7 and closes in section **9**, so section 8 sits entirely inside it. That is
    // why the transcripts never reach the voice prompt -- the case above asserts exactly that -- and it is
    // the mechanism T48 measured when wrapping section 7 pushed the compile to 30,033 and truncated it.
    const KNOWN = ['## 7. Changing a rule live -> ## 9. Where this runs']
    expect(
      spanning,
      `A voice:exclude block that starts in one section and ends in another makes "is this in the prompt?" ` +
        `unanswerable from the section. One such block exists and is allowed; a new one is not. Wrapping a ` +
        `region near either end of it changes what gets stripped -- measure compileInstructions before and ` +
        `after, every time.`,
    ).toEqual(KNOWN)
  })
})
