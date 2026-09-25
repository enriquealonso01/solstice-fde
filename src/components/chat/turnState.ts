// What `done` is allowed to do to a turn that already failed.
//
// THE BUG THIS EXISTS FOR. `netlify/functions/chat.ts` emits `error` and then ALWAYS emits
// `done` (lines 211, 264 and 458), because `done` is what tells the client to re-enable input
// rather than hang. The client's `done` handler used to set `status: 'complete'` and
// `connection: idle` unconditionally, which overwrote the failure a few milliseconds after it
// arrived. The result, observed in production: a guest whose turn failed saw their own message,
// no answer, and no explanation. The guest-safe line the server had carefully written never
// reached them.
//
// `done` means "the turn is over", not "the turn succeeded". These two functions are the whole
// distinction, kept pure so the behaviour can be tested without a browser.

import type { AgentTurn, ConnectionState, ToolActivity } from './types'

type Citationish = (tools: ToolActivity[]) => AgentTurn['citations']

/** Tool chips left mid-flight when the stream ended. They resolve either way. */
function settleTools(tools: ToolActivity[]): ToolActivity[] {
  return tools.map((tool) => (tool.status === 'running' ? { ...tool, status: 'done' as const, endedAt: Date.now() } : tool))
}

/**
 * Apply `done` to a turn. A failed turn stays failed and keeps its message; only its tool chips
 * are settled, because those show what Sol actually managed to do before it broke.
 */
export function applyDoneToTurn(turn: AgentTurn, citations: Citationish): AgentTurn {
  if (turn.status === 'failed') {
    return { ...turn, tools: settleTools(turn.tools) }
  }
  return {
    ...turn,
    status: 'complete',
    citations: citations(turn.tools),
    tools: settleTools(turn.tools),
  }
}

/**
 * Apply `done` to the connection banner. A failure is not cleared by the turn ending: the guest
 * needs to still be looking at the reason when the input comes back.
 */
export function applyDoneToConnection(previous: ConnectionState): ConnectionState {
  return previous.kind === 'failed' ? previous : { kind: 'idle' }
}
