/**
 * `docs/how-this-was-built.md`'s flagship anecdote, checked against the export it is about.
 *
 * The document argues the whole agentic approach, and its strongest paragraph is the one where
 * securing `/api/tools` broke every webhook the voice agent calls, and a second bug was found while
 * fixing the first. It said:
 *
 *   > all **eleven** group tools were registered against the concierge dispatcher …
 *   > Fixing only the first bug would have converted **24** silent 401s into **11** working calls
 *   > and **11** confusing ones.
 *
 * 11 + 11 is not 24, and `exports/telnyx-assistant.json` — which a reviewer can open — says 23
 * webhook tools: **11** concierge and routing at `/api/tools/<name>`, **12** group at
 * `/api/group/tool`, plus a native `transfer` and `hangup` that carry no webhook and so could not
 * have returned a 401 at all. Two of the three figures were wrong and the third contradicted them,
 * in the sentence doing the most persuasive work in the package.
 *
 * It had been swept once and cleared. The T43 sweep read it as *"a historical account of a past
 * debugging session, correctly past tense"* — which is true, and beside the point: that sweep was
 * hunting figures that **grow**, and this one was simply wrong on the day it was written. A check
 * scoped to one failure mode walked past another in the same sentence. That is the same shape as the
 * guard T51 widened, and it is why this file derives the numbers instead of restating them.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

const DOC = 'docs/how-this-was-built.md'
const doc = read(DOC)

interface ExportedTool {
  type?: string
  webhook?: { name?: string; url?: string }
}

const tools: ExportedTool[] = (() => {
  const parsed = JSON.parse(read('exports/telnyx-assistant.json')) as {
    tools?: ExportedTool[]
    data?: { tools?: ExportedTool[] }
  }
  return parsed.tools ?? parsed.data?.tools ?? []
})()

const webhooks = tools.filter((t) => t.type === 'webhook')
const conciergeWebhooks = webhooks.filter((t) => (t.webhook?.url ?? '').includes('/api/tools/'))
const groupWebhooks = webhooks.filter((t) => (t.webhook?.url ?? '').includes('/api/group/tool'))

/** The doc writes small counts as words and larger ones as digits, so check whichever it uses. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const says = (n: number): boolean => {
  const forms = [String(n)]
  if (n < WORDS.length) forms.push(WORDS[n])
  return forms.some((f) => new RegExp(String.raw`\b${f}\b`).test(doc))
}

describe('the export the built-doc anecdote is about', () => {
  it('is readable and still has tools in it', () => {
    expect(tools.length, 'exports/telnyx-assistant.json has no tools; the anecdote has nothing to check').toBeGreaterThan(0)
  })

  it('splits into exactly the two dispatchers the anecdote describes', () => {
    // If a third webhook target appears, the "two places" sentence in the doc stops being true and
    // the arithmetic below stops being the whole story. Fail here rather than let the doc drift.
    const stray = webhooks.filter(
      (t) => !conciergeWebhooks.includes(t) && !groupWebhooks.includes(t),
    )
    expect(
      stray.map((t) => `${t.webhook?.name ?? '(unnamed)'} -> ${t.webhook?.url ?? ''}`),
      `${DOC} says the webhook tools point at two places, /api/tools/<name> and /api/group/tool. ` +
        `These point somewhere else, so the anecdote's split no longer accounts for every tool.`,
    ).toEqual([])
    expect(conciergeWebhooks.length + groupWebhooks.length).toBe(webhooks.length)
  })

  it('has non-webhook entries that could not have returned a 401', () => {
    const native = tools.filter((t) => t.type !== 'webhook').map((t) => t.type)
    expect(native, 'the doc names a native transfer and hangup; the export no longer has them').toEqual(
      expect.arrayContaining(['transfer', 'hangup']),
    )
  })
})

describe('the numbers the built doc states about it', () => {
  it.each([
    ['webhook tools that returned 401', () => webhooks.length],
    ['concierge and routing tools', () => conciergeWebhooks.length],
    ['group tools', () => groupWebhooks.length],
    ['entries in the export', () => tools.length],
    // Deliberately loose: this only asks whether the figure appears in the document at all, which is
    // a presence check, not a placement one. The strict binding of all three to the export is the
    // arithmetic case below; these exist so that a figure vanishing from the paragraph is noticed too.
  ])('%s — the figure in the doc matches the export', (label, measure) => {
    const n = measure()
    expect(
      says(n),
      `${DOC} does not state ${n} anywhere, and the export says there are ${n} ${label}. The paragraph ` +
        `invites a reviewer to open the export and count, so every figure in it has to survive that.`,
    ).toBe(true)
  })

  it('states a split that adds up', () => {
    // The original failed exactly here: 11 working + 11 confusing against a stated 24.
    const flat = doc.replace(/\s+/g, ' ')
    const m = flat.match(
      /converted (\d+) silent 401s into (\d+) working calls and\s+(\d+) confusing ones/i,
    )
    expect(m, `${DOC} no longer contains the 401 arithmetic sentence; update or remove this case`).toBeTruthy()

    const [total, working, confusing] = (m as RegExpMatchArray).slice(1).map(Number)
    expect(
      working + confusing,
      `${DOC} says ${working} working + ${confusing} confusing out of ${total}. Those do not sum, and a ` +
        `reviewer adding two numbers in the document's most persuasive sentence is the cheapest way to ` +
        `lose them.`,
    ).toBe(total)
    expect(total, 'the stated total is not the export\'s webhook count').toBe(webhooks.length)
    expect(working, 'the working half is not the concierge and routing count').toBe(conciergeWebhooks.length)
    expect(confusing, 'the confusing half is not the group count').toBe(groupWebhooks.length)
  })
})

describe('the guarantee the built doc says was falsified', () => {
  it('names G17 rather than calling this file a README', () => {
    // It said "a guarantee this README makes in writing". This file is not a README, and the
    // guarantee is G17 in agent/sol.md's guardrail table -- a named deliverable, which is stronger.
    expect(doc, `${DOC} still refers to itself as a README`).not.toMatch(/guarantee this README makes/)
    expect(doc, `${DOC} no longer names the guardrail it says was falsified`).toContain('**G17**')
  })

  it('still finds G17 saying what the doc quotes it as saying', () => {
    const sol = read('agent/sol.md')
    expect(
      sol,
      `agent/sol.md's guardrail table no longer carries G17 as "every tool call is recorded, masked". ` +
        `${DOC} quotes it for the untraced-session finding, so the quotation has to stay true.`,
    ).toMatch(/\|\s*G17\s*\|\s*Every tool call is recorded, masked/i)
  })
})
