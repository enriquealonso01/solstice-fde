// Sol must never tell a guest about its own plumbing.
//
// The regression this guards, reproduced 3 times out of 3 in production. On the cheat sheet's
// group beat ("I need 40 rooms in Tampa in October at 22% off"), once the guest supplies an email
// Sol answers:
//
//   "I don't have a create_inquiry tool available to me directly, so let me get this logged
//    properly with our team instead."
//
// The honesty is right and the fallback is right; naming the tool to a guest is not. It is a
// sentence about the system, to a customer, on a beat a panel will run.
//
// Root cause of the failed call is separate and still open (chat's registry has 12 tools and
// `create_inquiry` is not among them, while the prompt instructs the model to call it). That is a
// capability decision for Enrique. This rule is correct whichever way that goes.
//
// Both prompt sources are checked because chat.ts:124 reads `agent/sol.md` at request time and
// falls back to the compiled `solPrompt.ts` when the markdown is not in the deployed bundle. A
// rule in only one of them is a rule that applies only sometimes.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SOL_SYSTEM_PROMPT } from '../../../../netlify/functions/tools/solPrompt'
import { toolDefinitions } from '../../../../netlify/functions/tools/registry'

// Normalise line endings: the markdown is read from disk (CRLF on a Windows checkout) while a TS
// template literal is normalised to LF by the language. That difference is a checkout artefact,
// not a difference in what Sol is told.
const lf = (s: string): string => s.split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10))
const markdown = lf(readFileSync(join(process.cwd(), 'agent/sol.md'), 'utf8'))

/** Phrases that would be Sol describing its own mechanism to a guest. */
const SOURCES: [string, string][] = [
  ['agent/sol.md', markdown],
  ['solPrompt.ts', lf(SOL_SYSTEM_PROMPT)],
]

describe('the prompt forbids naming tools to a guest', () => {
  for (const [label, text] of SOURCES) {
    it(`${label} carries the rule`, () => {
      expect(text).toMatch(/Never name a tool to a guest/i)
      expect(text).toMatch(/never tell them what you can or cannot call/i)
    })

    it(`${label} shows the failing sentence as the example, so the rule is concrete`, () => {
      expect(text).toMatch(/I don't have a\s+create_inquiry tool available/i)
    })

    it(`${label} still says what to do instead, rather than only what not to do`, () => {
      expect(text).toMatch(/noting it for the team|getting a person onto it/i)
    })
  }

  it('both sources agree — a rule in only one of them applies only sometimes', () => {
    // chat.ts reads the markdown when it is bundled and the compiled copy when it is not.
    const rule = /Never name a tool to a guest[^]*?say nothing about the mechanism\./i
    const fromMarkdown = markdown.match(rule)?.[0]
    const fromCompiled = lf(SOL_SYSTEM_PROMPT).match(rule)?.[0]
    expect(fromMarkdown).toBeTruthy()
    expect(fromCompiled).toBeTruthy()
    expect(fromCompiled).toBe(fromMarkdown)
  })

  // The rule above suppresses the SYMPTOM. This pins the CAUSE: chat is told to call a tool it
  // does not have, so the model keeps reporting the contradiction however the rule is worded.
  it('chat really does not have create_inquiry, which is why the note exists', () => {
    const names = toolDefinitions().map((t) => t.name)
    expect(names).not.toContain('create_inquiry')
    expect(names).not.toContain('update_inquiry')
    // ...and the ones the channel note tells it to use instead really are there.
    expect(names).toContain('create_escalation')
    expect(names).toContain('classify_intent')
  })

  it('the chat channel note tells the model what this channel can do, not what it cannot call', () => {
    const chat = readFileSync(join(process.cwd(), 'netlify/functions/chat.ts'), 'utf8')
    const note = lf(chat).match(/const CHAT_CHANNEL_NOTE = `[^`]*`/)?.[0] ?? ''
    expect(note).toMatch(/no inquiry-creation tool/i)
    expect(note).toMatch(/create_escalation/)
    // Appended to the shared definition, not replacing it: the note must come AFTER the prompt.
    const assign = chat.split(String.fromCharCode(10)).find((line) => line.includes('cachedPrompt =')) ?? ''
    expect(assign).toContain('SOL_SYSTEM_PROMPT')
    expect(assign).toContain('CHAT_CHANNEL_NOTE')
    expect(assign.indexOf('SOL_SYSTEM_PROMPT')).toBeLessThan(assign.indexOf('CHAT_CHANNEL_NOTE'))
  })
})
