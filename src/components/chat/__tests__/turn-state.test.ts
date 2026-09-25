// G-chat: a failed turn must survive the `done` that follows it.
//
// The regression this guards, found in production by intercepting the documented failure stream
// and driving the real widget: the guest sent a message, the server emitted `error` with the
// guest-safe line and then `done`, and the guest saw their own message, no answer, and no
// explanation at all. `netlify/functions/chat.ts` emits `done` after `error` on every failure
// path (lines 211, 264, 458) precisely so the client re-enables input — so the client must treat
// `done` as "the turn is over", not "the turn succeeded".

import { describe, expect, it } from 'vitest'
import { applyDoneToConnection, applyDoneToTurn } from '../turnState'
import type { AgentTurn, Citation, ConnectionState, ToolActivity } from '../types'

const GUEST_SAFE_FAILURE =
  "I've hit a technical problem on my side, and I'd rather not guess at an answer. Let me get a colleague to pick this up with you."

const citationsFrom = (tools: ToolActivity[]): Citation[] =>
  tools.flatMap((tool) => tool.citations ?? [])

const turn = (over: Partial<AgentTurn> = {}): AgentTurn =>
  ({
    id: 'agent-1',
    role: 'agent',
    text: '',
    at: 0,
    tools: [],
    citations: [],
    status: 'streaming',
    ...over,
  }) as AgentTurn

describe('applyDoneToTurn', () => {
  it('keeps a failed turn failed, and keeps the guest-safe message', () => {
    const failed = turn({ status: 'failed', error: GUEST_SAFE_FAILURE, text: '' })
    const after = applyDoneToTurn(failed, citationsFrom)
    expect(after.status).toBe('failed')
    expect(after.error).toBe(GUEST_SAFE_FAILURE)
  })

  it('completes a turn that did not fail', () => {
    const after = applyDoneToTurn(turn({ text: 'Check-in is at 3pm.' }), citationsFrom)
    expect(after.status).toBe('complete')
    expect(after.text).toBe('Check-in is at 3pm.')
  })

  it('settles a running tool chip either way, so nothing spins forever', () => {
    const running: ToolActivity = { name: 'get_policy', status: 'running' } as ToolActivity
    const ok = applyDoneToTurn(turn({ tools: [running] }), citationsFrom)
    const bad = applyDoneToTurn(turn({ status: 'failed', error: 'x', tools: [running] }), citationsFrom)
    expect(ok.tools[0].status).toBe('done')
    expect(bad.tools[0].status).toBe('done')
  })

  it('does not attach citations to a failed turn', () => {
    const withCitation: ToolActivity = {
      name: 'get_policy',
      status: 'done',
      citations: [{ source: 'policy', ref: 'policy:1', label: 'Policy 1' } as Citation],
    } as ToolActivity
    const after = applyDoneToTurn(
      turn({ status: 'failed', error: GUEST_SAFE_FAILURE, tools: [withCitation] }),
      citationsFrom,
    )
    // A citation under an answer the guest never got would imply it was grounded in policy.
    expect(after.citations).toEqual([])
  })
})

describe('applyDoneToConnection', () => {
  it('does not clear a failure banner when the turn ends', () => {
    const failed: ConnectionState = { kind: 'failed', message: GUEST_SAFE_FAILURE }
    expect(applyDoneToConnection(failed)).toEqual(failed)
  })

  it('returns to idle from any non-failed state', () => {
    expect(applyDoneToConnection({ kind: 'thinking' })).toEqual({ kind: 'idle' })
    expect(applyDoneToConnection({ kind: 'reconnecting', attempt: 2 } as ConnectionState)).toEqual({ kind: 'idle' })
    expect(applyDoneToConnection({ kind: 'idle' })).toEqual({ kind: 'idle' })
  })
})
