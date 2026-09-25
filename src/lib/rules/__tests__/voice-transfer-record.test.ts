// A warm transfer is announced before it connects, so it needs a written record behind it.
//
// G16 is "a failed handoff is never described as a handoff". The chat branch of `transfer_to_human`
// has refused to describe one since PR #7: with no escalation it tells the model to create one first
// and never to say a colleague is joining. The voice branch only refused when **no transfer target was
// configured** — and that is not the deployed configuration.
//
// Two variables decide it, and iteration 54 found that only one had been checked:
//
//     const target = process.env.TELNYX_TRANSFER_TARGET ?? process.env.DEMO_PHONE ?? null
//
// `TELNYX_TRANSFER_TARGET` is absent from the deployed environment. `DEMO_PHONE` is set. So
// `configured` is TRUE in production, which the live tool confirmed:
//
//     POST /api/tools/transfer_to_human {"channel":"voice", …}
//       -> transfer_available: True, directive: telnyx_warm_transfer, fallback: null,
//          escalation_id: None,
//          human_reason: "Announce the handoff before it happens … then step aside."
//
// Announce first, nothing in writing, and a transfer that can fail for reasons this branch cannot see.
// So the configured path now also insists on a record when none exists. These tests pin the shape of
// the decision rather than the prose, so rewording stays cheap and dropping the guarantee does not.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NL = String.fromCharCode(10)
const src = readFileSync(join(process.cwd(), 'netlify/functions/tools/escalation.ts'), 'utf8')

/** Comments quote the very phrases these cases forbid, so strip them. Iterations 8, 41, 42, 46. */
function stripComments(text: string): string {
  return text
    .split(NL)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join(NL)
}

const code = stripComments(src)

/** The voice branch only: from the channel check to the end of its return. */
const voiceBranch = (() => {
  const start = code.indexOf("if (ctx.channel === 'voice')")
  const end = code.indexOf('request_supervisor_takeover')
  return code.slice(start, end)
})()

describe('transfer_to_human on the voice leg', () => {
  it('is reachable — the branch was located and still offers a warm transfer', () => {
    expect(voiceBranch.length).toBeGreaterThan(300)
    expect(voiceBranch).toContain('telnyx_warm_transfer')
  })

  it('reads BOTH variables, because either one makes a transfer look configured', () => {
    // The bug behind this file was checking one of these and concluding the other branch was live.
    expect(voiceBranch).toContain('TELNYX_TRANSFER_TARGET')
    expect(voiceBranch).toContain('DEMO_PHONE')
  })

  it('asks whether an escalation exists, not only whether a transfer is configured', () => {
    expect(voiceBranch).toMatch(/escalationExists/)
    // and it must be consulted inside the configured path, not only the unconfigured one
    const configuredAt = voiceBranch.indexOf('configured')
    expect(voiceBranch.indexOf('escalationExists')).toBeGreaterThan(configuredAt)
  })

  it('tells the model to create the record before announcing the handoff', () => {
    expect(voiceBranch).toMatch(/create_escalation/)
    expect(voiceBranch).toMatch(/before you announce the handoff|Create the escalation first/)
  })

  it('still steps aside when a record already exists, so it is not a blanket refusal', () => {
    // Guard the guard: the cheap way to pass everything above is to refuse every transfer.
    expect(voiceBranch).toMatch(/read the context back to the person picking up/)
    expect(voiceBranch).toMatch(/transfer_available: configured/)
  })

  it('keeps refusing outright when nothing is configured', () => {
    expect(voiceBranch).toMatch(/No transfer destination is configured/)
    expect(voiceBranch).toMatch(/Do not pretend a transfer happened/)
  })
})

describe('transfer_to_human on chat, which must not regress', () => {
  const chatBranch = code.slice(code.indexOf('request_supervisor_takeover'))

  it('still separates "a route exists" from "someone is coming"', () => {
    expect(chatBranch).toMatch(/live_handoff_guaranteed: false/)
  })

  it('still refuses to say a colleague is joining when nothing is in writing', () => {
    expect(chatBranch).toMatch(/Never describe a handoff that has not happened/)
    expect(chatBranch).toMatch(/nothing durable has reached a human/)
  })

  it('shares one escalationExists rather than computing it twice', () => {
    // It was declared in both branches after the voice fix; two copies drift.
    const occurrences = code.split('const escalationExists').length - 1
    expect(occurrences).toBe(1)
  })
})
