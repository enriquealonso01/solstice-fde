// Voice-path reads and writes against `sessions`, `messages` and `tool_invocations`.
//
// This file holds ONLY what is specific to a phone call. The Supabase client, missing-table
// detection, trace writes and every PII masking function come from netlify/functions/_lib/,
// which is the single source of truth for all of them. Nothing here reimplements a shared helper:
// two masking implementations is exactly the drift AGENTS.md rule 6 exists to prevent.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { getGuestByPhone, type GuestLookup } from '../../_lib/data'
import { describeDbError, isMissingTable } from '../../_lib/db'
import { maskPhone } from '../../_lib/mask'

/**
 * Deterministic UUIDv5-shaped id from stable parts.
 * Used so a cumulative `message_history` payload can be upserted repeatedly without duplicating
 * turns: turn N of a session always lands on the same primary key.
 */
export function deterministicUuid(...parts: string[]): string {
  const hash = createHash('sha1').update(parts.join('\u0000')).digest()
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = b.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

// ---------------------------------------------------------------- sessions

export type SessionStatus = 'active' | 'ended' | 'taken_over'

export interface SessionRow {
  id: string
  channel: 'voice' | 'chat'
  guest_id: string | null
  guest_label: string | null
  phone_masked: string | null
  status: SessionStatus
  intent: string | null
  call_control_id: string | null
  telnyx_conversation_id: string | null
  /** The supervisor's own leg, when one is live. Drives the active rung in the supervisor UI. */
  supervisor_call_control_id: string | null
  /** monitor | whisper | barge, or null when no supervisor is attached. */
  supervisor_role: string | null
  started_at: string
  ended_at: string | null
}

export async function findSessionByCallControlId(
  db: SupabaseClient,
  callControlId: string,
): Promise<SessionRow | null> {
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .eq('call_control_id', callControlId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(describeDbError(error, 'findSessionByCallControlId'))
  return (data?.[0] as SessionRow | undefined) ?? null
}

export async function findSessionByConversationId(
  db: SupabaseClient,
  conversationId: string,
): Promise<SessionRow | null> {
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .eq('telnyx_conversation_id', conversationId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(describeDbError(error, 'findSessionByConversationId'))
  return (data?.[0] as SessionRow | undefined) ?? null
}

export async function getSessionById(db: SupabaseClient, id: string): Promise<SessionRow | null> {
  const { data, error } = await db.from('sessions').select('*').eq('id', id).limit(1)
  if (error) throw new Error(describeDbError(error, 'getSessionById'))
  return (data?.[0] as SessionRow | undefined) ?? null
}

export async function insertSession(
  db: SupabaseClient,
  row: Partial<SessionRow> & { channel: 'voice' | 'chat' },
): Promise<SessionRow> {
  const { data, error } = await db.from('sessions').insert(row).select('*').single()
  if (error) throw new Error(describeDbError(error, 'insertSession'))
  return data as SessionRow
}

export async function updateSession(db: SupabaseClient, id: string, patch: Partial<SessionRow>): Promise<void> {
  const { error } = await db.from('sessions').update(patch).eq('id', id)
  if (error) throw new Error(describeDbError(error, 'updateSession'))
}

/** Find the session a supervisor leg belongs to, for events that carry no client_state. */
export async function findSessionBySupervisorLeg(
  db: SupabaseClient,
  supervisorCallControlId: string,
): Promise<SessionRow | null> {
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .eq('supervisor_call_control_id', supervisorCallControlId)
    .limit(1)
  if (error) {
    if (isMissingSupervisorColumn(error)) return null
    throw new Error(describeDbError(error, 'findSessionBySupervisorLeg'))
  }
  return (data?.[0] as SessionRow | undefined) ?? null
}

/**
 * `sessions.supervisor_call_control_id` / `supervisor_role` exist in the deployed database but are
 * NOT in supabase/schema.sql yet, so a project built from that file alone will not have them.
 * Isolated from the main session patch and never fatal: losing the UI's rung indicator is a bad
 * day, dropping the supervisor's audio is a worse one.
 */
function isMissingSupervisorColumn(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST204' || error.code === '42703') return true
  return /supervisor_(call_control_id|role)/i.test(error.message ?? '') && /column|schema cache/i.test(error.message ?? '')
}

const SUPERVISOR_COLUMN_HINT =
  'sessions.supervisor_call_control_id / supervisor_role are missing. Add them to supabase/schema.sql: ' +
  'alter table sessions add column supervisor_call_control_id text, add column supervisor_role text;'

/** Record which leg is supervising this call and at which rung. Returns false if the columns are absent. */
export async function setSupervisorLeg(
  db: SupabaseClient,
  sessionId: string,
  supervisorCallControlId: string | null,
  role: string | null,
): Promise<boolean> {
  const { error } = await db
    .from('sessions')
    .update({ supervisor_call_control_id: supervisorCallControlId, supervisor_role: role })
    .eq('id', sessionId)
  if (!error) return true
  if (isMissingSupervisorColumn(error)) {
    console.warn(`[solstice] ${SUPERVISOR_COLUMN_HINT}`)
    return false
  }
  console.warn(describeDbError(error, 'setSupervisorLeg'))
  return false
}

// ---------------------------------------------------------------- messages

export type MessageRole = 'user' | 'assistant' | 'system' | 'supervisor'

/** Telnyx can emit roles we do not model; anything unrecognised is archived as `system`. */
export function normaliseRole(raw: string | null | undefined): MessageRole {
  const r = (raw ?? '').toLowerCase()
  if (r === 'user' || r === 'human' || r === 'caller') return 'user'
  if (r === 'assistant' || r === 'ai' || r === 'bot') return 'assistant'
  if (r === 'supervisor') return 'supervisor'
  return 'system'
}

export interface TranscriptTurn {
  role: string
  content: string
}

/**
 * Upsert a cumulative turn list. The Nth turn of a session always gets the same deterministic id,
 * so a replayed or out-of-order `message_history_updated` webhook is a no-op instead of a
 * duplicate. This table is both the live supervisor feed (via Supabase Realtime) and the
 * post-call archive: one transcript path, not two.
 */
export async function upsertTranscriptTurns(
  db: SupabaseClient,
  sessionId: string,
  turns: TranscriptTurn[],
): Promise<number> {
  const rows = turns
    .map((turn, index) => ({
      id: deterministicUuid(sessionId, String(index), normaliseRole(turn.role)),
      session_id: sessionId,
      role: normaliseRole(turn.role),
      content: (turn.content ?? '').toString(),
    }))
    .filter((r) => r.content.trim().length > 0)

  if (rows.length === 0) return 0

  const { error } = await db.from('messages').upsert(rows, { onConflict: 'id', ignoreDuplicates: false })
  if (error) throw new Error(describeDbError(error, 'upsertTranscriptTurns'))
  return rows.length
}

export async function insertMessage(
  db: SupabaseClient,
  sessionId: string,
  role: MessageRole,
  content: string,
): Promise<void> {
  const { error } = await db.from('messages').insert({ session_id: sessionId, role, content })
  if (error) throw new Error(describeDbError(error, 'insertMessage'))
}

// ---------------------------------------------------------------- supervisor legs

/**
 * `tool_invocations` is the durable store for the supervisor leg id, which schema.sql has no
 * column for. It genuinely belongs in the session trace the supervisor UI already renders, so
 * this is not a hack shelf. If schema.sql later grows `sessions.supervisor_call_control_id`,
 * move it; nothing else reads these rows.
 */
export const SUPERVISOR_LEG_TOOL = 'supervisor.leg_opened'
export const SUPERVISOR_LEG_ENDED_TOOL = 'supervisor.leg_ended'

export interface SupervisorLegRecord {
  supervisor_call_control_id: string
  role: string
  created_at: string
}

/** Most recent supervisor leg for a session that has not been recorded as ended. */
export async function findLiveSupervisorLeg(
  db: SupabaseClient,
  sessionId: string,
): Promise<SupervisorLegRecord | null> {
  const { data, error } = await db
    .from('tool_invocations')
    .select('tool, args_masked, created_at')
    .eq('session_id', sessionId)
    .in('tool', [SUPERVISOR_LEG_TOOL, SUPERVISOR_LEG_ENDED_TOOL])
    .order('created_at', { ascending: false })
    .limit(25)
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(describeDbError(error, 'findLiveSupervisorLeg'))
  }

  const ended = new Set<string>()
  for (const row of (data ?? []) as Array<{ tool: string; args_masked: Record<string, unknown>; created_at: string }>) {
    const ccid = String(row.args_masked?.supervisor_call_control_id ?? '')
    if (!ccid) continue
    if (row.tool === SUPERVISOR_LEG_ENDED_TOOL) {
      ended.add(ccid)
      continue
    }
    if (!ended.has(ccid)) {
      return {
        supervisor_call_control_id: ccid,
        role: String(row.args_masked?.role ?? 'monitor'),
        created_at: row.created_at,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- guests

export interface GuestMatch {
  guest_id: string
  label: string
  phone_masked: string
  loyalty_tier: string | null
}

/**
 * Caller ID -> guest, for the call's label only: caller ID is not proof of identity. Matched on the
 * peppered phone hash, so no phone number is stored or compared in the clear. Only the masked phone
 * ever leaves this function.
 */
export function identifyCallerByPhone(fromE164: string | null | undefined): GuestMatch | null {
  let hit: GuestLookup
  try {
    hit = getGuestByPhone(fromE164)
  } catch {
    // No LOOKUP_PEPPER: the call goes on as an unknown caller.
    return null
  }
  if (hit.status !== 'found' || hit.matched_on !== 'phone') return null
  const { guest } = hit
  const name = [guest.first_name, guest.last_name].filter(Boolean).join(' ')
  return {
    guest_id: guest.guest_id,
    label: name.length > 0 ? name : guest.guest_id,
    phone_masked: maskPhone(fromE164),
    loyalty_tier: guest.loyalty_tier && guest.loyalty_tier !== 'None' ? guest.loyalty_tier : null,
  }
}

// ---------------------------------------------------------------- audit

export async function writeAudit(
  db: SupabaseClient,
  row: { actor?: string | null; action: string; subject: string; detail?: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from('audit_log').insert({
    actor: row.actor ?? null,
    action: row.action,
    subject: row.subject,
    detail: row.detail ?? {},
  })
  // An audit write must never break a live call; log and carry on.
  if (error) console.warn(describeDbError(error, 'writeAudit'))
}
