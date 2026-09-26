// G16: a failed handoff is never described as a handoff, on either channel.
//
// A warm transfer is announced before it connects, and on chat nobody is guaranteed to be watching.
// So transfer_to_human must never tell the model a colleague is joining, and when no escalation
// exists yet it must tell the model to create one first, so a written record exists either way.

import { afterEach, describe, expect, it } from 'vitest'
import { transferToHuman } from '../../../../netlify/functions/tools/escalation'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

const chat = (): ToolContext => ({ channel: 'chat', session_id: 'sess-1' }) as ToolContext
const voice = (): ToolContext => ({ channel: 'voice', session_id: 'sess-1' }) as ToolContext

/** `ToolResult.data` is deliberately opaque in the contract; these tests assert on its fields. */
const fields = (result: { data?: unknown }): Record<string, unknown> => (result.data ?? {}) as Record<string, unknown>

/** Phrases that promise a live handoff. None may ever be suggested to the model on chat. */
const PROMISES_A_LIVE_HANDOFF = [/joining (this|the) chat/i, /is joining/i, /while they connect/i, /connecting you/i, /transferring you/i, /hold while/i]

/** The guidance may name forbidden phrases in order to forbid them, so drop the prohibitions first. */
function affirmativeGuidance(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|,\s*(?=(?:do not|don't|never)\b)/i)
    .filter((clause) => !/^\s*(do not|don't|never)\b/i.test(clause.trim()))
    .join(' ')
}

describe('transfer_to_human on chat', () => {
  it('never tells the model to say a colleague is joining, with or without an escalation', async () => {
    for (const args of [{ reason: 'Guest demands a manager', escalation_id: 'ESC-1' }, { reason: 'Guest demands a manager' }]) {
      const guidance = affirmativeGuidance(String(fields(await transferToHuman(args, chat())).human_reason))
      for (const pattern of PROMISES_A_LIVE_HANDOFF) expect(guidance, `guidance must not match ${pattern}`).not.toMatch(pattern)
    }
  })

  it('the filter still catches the original defect sentence', () => {
    const defect = 'Tell the guest a colleague is joining the chat, keep them company until that happens.'
    expect(PROMISES_A_LIVE_HANDOFF.some((p) => p.test(affirmativeGuidance(defect)))).toBe(true)
  })

  it('reports that a supervisor can join, separately from anyone being on the way', async () => {
    const data = fields(await transferToHuman({ reason: 'wants a manager', escalation_id: 'ESC-1' }, chat()))
    expect(data.transfer_available).toBe(true)
    expect(data.live_handoff_guaranteed).toBe(false)
  })

  it('with no escalation on file, demands one before anything is said', async () => {
    const data = fields(await transferToHuman({ reason: 'wants a manager' }, chat()))
    expect(String(data.human_reason)).toMatch(/create the escalation/i)
    expect(String(data.fallback)).toMatch(/nothing durable has reached a human/i)
  })

  it('carries the context readback and the routing authority', async () => {
    const data = fields(await transferToHuman({ reason: 'Guest reports a threat in the lobby', escalation_id: 'ESC-9' }, chat()))
    expect(String(data.context_readback)).toContain('Guest reports a threat in the lobby')
    expect(String(data.context_readback)).toContain('ESC-9')
    expect(data.authority_required).toBeTruthy()
  })

  it('refuses a transfer with no reason', async () => {
    expect((await transferToHuman({}, chat())).ok).toBe(false)
  })
})

describe('transfer_to_human on the voice leg', () => {
  const saved = { target: process.env.TELNYX_TRANSFER_TARGET, demo: process.env.DEMO_PHONE, key: process.env.TELNYX_API_KEY }
  const configure = (on: boolean) => {
    delete process.env.TELNYX_TRANSFER_TARGET
    if (on) {
      process.env.DEMO_PHONE = '+15555550100'
      process.env.TELNYX_API_KEY = 'test-key'
    } else {
      delete process.env.DEMO_PHONE
      delete process.env.TELNYX_API_KEY
    }
  }
  afterEach(() => {
    for (const [name, value] of [['TELNYX_TRANSFER_TARGET', saved.target], ['DEMO_PHONE', saved.demo], ['TELNYX_API_KEY', saved.key]] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('with a transfer configured and no escalation, says to create the escalation before announcing', async () => {
    configure(true)
    const data = fields(await transferToHuman({ reason: 'wants a manager' }, voice()))
    expect(data.directive).toBe('telnyx_warm_transfer')
    expect(data.transfer_available).toBe(true)
    expect(String(data.fallback)).toMatch(/create_escalation/)
    expect(String(data.human_reason)).toMatch(/Create the escalation first/)
  })

  it('with an escalation on file, lets the transfer go ahead', async () => {
    configure(true)
    const data = fields(await transferToHuman({ reason: 'wants a manager', escalation_id: 'ESC-2' }, voice()))
    expect(data.fallback).toBeNull()
    expect(String(data.human_reason)).toMatch(/read the context back/)
  })

  it('with nothing configured, refuses to pretend and promises only a callback with a record', async () => {
    configure(false)
    const data = fields(await transferToHuman({ reason: 'wants a manager' }, voice()))
    expect(data.transfer_available).toBe(false)
    expect(String(data.human_reason)).toMatch(/Do not pretend a transfer happened/)
    expect(String(data.fallback)).toMatch(/create an escalation/)
  })
})
