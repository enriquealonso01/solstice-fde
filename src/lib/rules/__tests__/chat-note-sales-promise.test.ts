// The web-chat channel note must not tell the model to promise the guest that Sales has their group
// request.
//
// PR #66 corrected agent/sol.md — the escalation reaches the concierge supervisor's queue, not the
// group sales board, and a human routes it onward — but deliberately left chat.ts saying the
// opposite, as assumption 16. Both strings end up in the same live prompt, and the channel note is
// appended LAST, so it won.
//
// Measured against production, four runs of four, the guest was told:
//   "I've logged this and it's going to our Sales team today. They'll reach out to dana.reyes@…"
//   "This has gone to our Sales team … They'll reach out to dana.reyes@… with a quote."
//   "This is logged and going to our Sales team today."
// while the tool result in the model's own context read "Escalation … to agm". A named destination
// and a promised day, both false.
//
// IMPORTANT, and the reason this file is careful: the note now carries a prose explanation that
// necessarily QUOTES the phrases it forbids ("Sales has it", "going anywhere today"). A test that
// greps the raw source matches its own explanation and passes while the instruction is wrong — the
// trap from iterations 8, 41 and 42. So every assertion below runs on the note's template-literal
// body with comment lines stripped, and there is a case that proves the stripping works.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NL = String.fromCharCode(10)
const chat = readFileSync(join(process.cwd(), 'netlify/functions/chat.ts'), 'utf8').split('\r\n').join(NL)

/** The note's template literal only: not the comment above it, not the rest of the file. */
function noteBody(): string {
  const m = chat.match(/const CHAT_CHANNEL_NOTE = `([^`]*)`/)
  return m ? m[1] : ''
}

/** Comment lines removed, so an assertion can never be satisfied by an explanation. */
function stripComments(text: string): string {
  return text
    .split(NL)
    .filter((line) => !line.trim().startsWith('//'))
    .join(NL)
}

const note = stripComments(noteBody())

describe('the web chat channel note', () => {
  it('is reachable, and is the instruction rather than the commentary', () => {
    expect(note.length).toBeGreaterThan(200)
    expect(note).toMatch(/ON THIS CHANNEL/)
    expect(note).toMatch(/create_escalation/)
    expect(note).toMatch(/no inquiry-creation tool/i)
  })

  it('guards its own guard: the commentary is excluded from what is asserted', () => {
    // The explanation above the note quotes the failing production replies. If stripping ever
    // breaks, this catches it rather than the prohibition cases silently passing on prose.
    const raw = chat.slice(0, chat.indexOf('const CHAT_CHANNEL_NOTE'))
    expect(raw).toMatch(/going to our Sales team today/)
    expect(note).not.toMatch(/going to our Sales team today/)
  })

  it('does not tell the model the escalation reaches Sales', () => {
    expect(note).not.toMatch(/reaches Sales/i)
    expect(note).not.toMatch(/to Sales with the details/i)
  })

  it('does not tell the model to say Sales will follow up or make contact', () => {
    expect(note).not.toMatch(/tell them Sales will follow up/i)
    expect(note).not.toMatch(/Sales will (follow up|be in touch|contact|reach out)/i)
  })

  it('says who actually has it, which is a manager', () => {
    expect(note).toMatch(/a manager has it/i)
  })

  it('forbids naming the contact and promising a time', () => {
    expect(note).toMatch(/never name who will make contact/i)
    expect(note).toMatch(/never promise when/i)
  })

  it('agrees with agent/sol.md rather than contradicting it', () => {
    // The two strings are concatenated into one prompt. If sol.md stops saying the escalation is not
    // the sales board, this pairing is worth revisiting rather than silently diverging again.
    const sol = readFileSync(join(process.cwd(), 'agent/sol.md'), 'utf8')
    expect(sol).toMatch(/not the group sales board/i)
    expect(note).toMatch(/does not reach the group sales board/i)
  })

  it('still comes after the shared definition, so it refines rather than replaces it', () => {
    const assign = chat.split(NL).find((line) => line.includes('cachedPrompt =')) ?? ''
    expect(assign.indexOf('SOL_SYSTEM_PROMPT')).toBeLessThan(assign.indexOf('CHAT_CHANNEL_NOTE'))
  })
})
