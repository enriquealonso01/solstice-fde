// UI-side view model for the chat panel. The wire contract lives in
// src/lib/chatClient.ts; this is what the components actually render.
import type { Citation } from '../../../shared/types'

export type { Citation }

export type ToolStatus = 'running' | 'done'

/** One tool call, from the moment the agent starts it to the moment it resolves. */
export interface ToolActivity {
  /** Stable key: the server may run the same tool twice in one turn. */
  key: string
  name: string
  /** Server-supplied human sentence, e.g. "checking your reservation". */
  summary: string
  status: ToolStatus
  citations: Citation[]
  startedAt: number
  endedAt?: number
}

export type TurnStatus = 'streaming' | 'complete' | 'failed'

export interface GuestTurn {
  id: string
  role: 'guest'
  text: string
  at: number
}

export interface AgentTurn {
  id: string
  role: 'agent'
  text: string
  at: number
  tools: ToolActivity[]
  /** Deduped union of every citation the tools returned for this turn. */
  citations: Citation[]
  status: TurnStatus
  error?: string
  /** True for the locally rendered opening greeting, which never hits the wire. */
  greeting?: boolean
}

/** A file a supervisor handed the guest. Mirrors StoredAttachment in
 *  netlify/functions/supervisor/attachments.ts, which is what writes it. */
export interface TurnAttachment {
  filename: string
  content_type: string
  bytes: number
  url: string
}

/**
 * A message from a human member of staff, not from Sol.
 *
 * Kept as its own kind rather than an AgentTurn with a flag, because the difference is the whole
 * point: an AgentTurn carries tool chips, citations and a retry affordance, and none of those mean
 * anything for something a person typed. Rendering a supervisor's sentence in Sol's bubble would
 * also tell the guest the AI said it, which is the one thing this feature exists to avoid.
 */
export interface StaffTurn {
  id: string
  role: 'staff'
  text: string
  at: number
  attachment?: TurnAttachment
}

export type Turn = GuestTurn | AgentTurn | StaffTurn

export type TransportMode = 'live' | 'mock'

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'thinking' }
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'failed'; message: string }
