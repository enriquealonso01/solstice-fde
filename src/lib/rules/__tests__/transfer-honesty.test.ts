// G16 on the chat channel: a failed handoff must never be described as a handoff.
//
// The regression this guards, found in production: asked for a manager, Sol answered
// "I've flagged this for a manager and a colleague is joining this chat now to go over your
// bill. Please stay with me a moment while they connect." Nothing was joining. There is no
// supervisor presence signal in this system and nothing consumes `request_supervisor_takeover`
// — takeover happens only if a human at the console chooses to join. The old chat branch
// instructed exactly that sentence, while the voice branch had always refused to pretend.

import { describe, expect, it } from 'vitest'
import { transferToHuman } from '../../../../netlify/functions/tools/escalation'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

const chat = (over: Partial<ToolContext> = {}): ToolContext =>
  ({ channel: 'chat', session_id: 'sess-1', ...over }) as ToolContext

const voice = (): ToolContext => ({ channel: 'voice', session_id: 'sess-1' }) as ToolContext

/** `ToolResult.data` is deliberately opaque in the contract; these tests assert on its fields. */
const fields = (result: { data?: unknown }): Record<string, unknown> =>
  (result.data ?? {}) as Record<string, unknown>

/** Phrases that promise a live handoff. None may ever be suggested to the model on chat. */
const PROMISES_A_LIVE_HANDOFF = [
  /joining (this|the) chat/i,
  /is joining/i,
  /while they connect/i,
  /connecting you/i,
  /transferring you/i,
  /hold while/i,
]

/**
 * The guidance is allowed — required, in fact — to name the forbidden phrases in order to
 * forbid them, so matching the raw string would flag its own prohibition. Drop the clauses
 * that are prohibitions and check what is left, which is what the model is actually told to
 * do. This still catches the original defect: "Tell the guest a colleague is joining the
 * chat" survives the filter and matches.
 */
function affirmativeGuidance(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|,\s*(?=(?:do not|don't|never)\b)/i)
    .filter((clause) => !/^\s*(do not|don't|never)\b/i.test(clause.trim()))
    .join(' ')
}

/** Guard the guard: the string this test exists because of must still be caught. */
const ORIGINAL_DEFECT =
  'A supervisor has been flagged into this conversation. Tell the guest a colleague is joining the chat, keep them company until that happens, and do not close the conversation yourself.'

describe('G16 — chat never promises a handoff that cannot happen', () => {
  it('does not instruct the model to say a colleague is joining, even with an escalation on file', async () => {
    const result = await transferToHuman(
      { reason: 'Guest is angry about a bill and demands a manager', escalation_id: 'ESC-1' },
      chat(),
    )
    expect(result.ok).toBe(true)
    const guidance = affirmativeGuidance(String(fields(result).human_reason))
    for (const pattern of PROMISES_A_LIVE_HANDOFF) {
      expect(guidance, `guidance must not match ${pattern}`).not.toMatch(pattern)
    }
    expect(String(fields(result).human_reason)).toMatch(/manager/i)
  })

  it('reports that a live handoff is not guaranteed, separately from the route existing', async () => {
    const result = await transferToHuman({ reason: 'wants a manager', escalation_id: 'ESC-1' }, chat())
    // The route exists — a supervisor can join a chat.
    expect(fields(result).transfer_available).toBe(true)
    // But nothing guarantees one is on the way, and that is stated rather than implied.
    expect(fields(result).live_handoff_guaranteed).toBe(false)
  })

  it('with no escalation on file, forbids claiming anyone is joining and demands one is created', async () => {
    const result = await transferToHuman({ reason: 'wants a manager' }, chat())
    const guidance = affirmativeGuidance(String(fields(result).human_reason))
    for (const pattern of PROMISES_A_LIVE_HANDOFF) {
      expect(guidance, `guidance must not match ${pattern}`).not.toMatch(pattern)
    }
    expect(String(fields(result).human_reason)).toMatch(/create the escalation/i)
    expect(String(fields(result).fallback)).toMatch(/nothing durable has reached a human/i)
  })

  it('still carries the context readback and the routing authority, so the fix loses nothing', async () => {
    const result = await transferToHuman(
      { reason: 'Guest reports a threat in the lobby', escalation_id: 'ESC-9' },
      chat(),
    )
    expect(String(fields(result).context_readback)).toContain('Guest reports a threat in the lobby')
    expect(String(fields(result).context_readback)).toContain('ESC-9')
    expect(fields(result).authority_required).toBeTruthy()
    expect(fields(result).session_id).toBe('sess-1')
  })

  it('leaves the voice branch alone — it already refused to pretend', async () => {
    const result = await transferToHuman({ reason: 'wants a manager' }, voice())
    expect(fields(result).directive).toBe('telnyx_warm_transfer')
  })

  it('still refuses a transfer with no reason, so the human knows what they are walking into', async () => {
    const result = await transferToHuman({}, chat())
    expect(result.ok).toBe(false)
  })

  it('the filter does not neuter the check: the original defect string is still caught', () => {
    const guidance = affirmativeGuidance(ORIGINAL_DEFECT)
    const matched = PROMISES_A_LIVE_HANDOFF.some((p) => p.test(guidance))
    expect(matched).toBe(true)
  })
})
