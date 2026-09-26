/**
 * The phone assistant's instructions are the chat prompt plus one channel line, and nothing else
 * from agent/sol.md: not the tool table, not the guardrail table, not the assumptions.
 *
 * `compileInstructions` is imported from the provisioning script, so this tests the real compile, and
 * the committed export is checked against it.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileInstructions, MAX_INSTRUCTION_CHARS } from '../../../../scripts/telnyx/provision.mjs'
import { SOL_SYSTEM_PROMPT } from '../../../../netlify/functions/tools/solPrompt'

const repoRoot = resolve(__dirname, '../../../..')
const markdown = readFileSync(resolve(repoRoot, 'agent/sol.md'), 'utf8')
const compiled = compileInstructions(markdown)

describe('the compiled voice prompt', () => {
  it('starts with exactly the prompt chat sends', () => {
    expect(compiled.instructions.startsWith(`${SOL_SYSTEM_PROMPT}\n\n`)).toBe(true)
  })

  it('adds only a short channel line after it', () => {
    const addendum = compiled.instructions.slice(SOL_SYSTEM_PROMPT.length)
    expect(addendum.length).toBeLessThan(100)
    expect(addendum).toMatch(/voice channel/)
  })

  it('carries none of the documentation around the block', () => {
    expect(compiled.instructions).not.toMatch(/^#{1,6} /m)
    expect(compiled.instructions).not.toMatch(/^\|/m)
    expect(compiled.instructions).not.toContain('<!--')
  })

  it('fits under the cap without truncation', () => {
    expect(compiled.truncated).toBe(false)
    expect(compiled.instructions.length).toBeLessThanOrEqual(MAX_INSTRUCTION_CHARS)
  })

  it('refuses a file with no SOL:SYSTEM block instead of sending something else', () => {
    expect(() => compileInstructions('# Sol\n\nNo prompt here.')).toThrow(/SOL:SYSTEM/)
  })
})

/**
 * exports/telnyx-assistant.json is the live phone assistant as last read. The only export allowed to
 * differ from the compile is this one: the whole-file prompt the assistant held before
 * `provision.mjs --instructions-only` was first run.
 */
const KNOWN_DRIFT_SHA256 = 'db46c4049b9372bb6f1864a3b5bd52f6c8de18b96c9b54c31c6b385105430de2'

describe('the live phone assistant, as last exported', () => {
  it('runs this compile, or is the one export named as known drift', () => {
    const live = (JSON.parse(readFileSync(resolve(repoRoot, 'exports/telnyx-assistant.json'), 'utf8')) as { instructions: string }).instructions
    if (live === compiled.instructions) return
    expect(
      createHash('sha256').update(live).digest('hex'),
      'The phone agent runs a prompt agent/sol.md no longer compiles to. Run ' +
        '`node scripts/telnyx/provision.mjs --instructions-only`, then `npm run telnyx:export`.',
    ).toBe(KNOWN_DRIFT_SHA256)
  })
})

describe('the compile is independent of line endings', () => {
  const lf = markdown.replace(/\r\n?/g, '\n')
  const crlf = lf.replace(/\n/g, '\r\n')

  it('produces identical text from a CRLF and an LF checkout, with no carriage returns', () => {
    expect(crlf).not.toBe(lf)
    expect(compileInstructions(crlf).instructions).toBe(compileInstructions(lf).instructions)
    expect(compileInstructions(crlf).instructions).not.toMatch(/\r/)
  })
})
