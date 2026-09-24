// Voice-path reads and writes against `sessions`, `messages`, `tool_invocations` and `guests`.
//
// This file holds ONLY what is specific to a phone call. The Supabase client, missing-table
// detection, trace writes and every PII masking function come from netlify/functions/_lib/,
// which is the single source of truth for all of them. Nothing here reimplements a shared helper:
// two masking implementations is exactly the drift AGENTS.md rule 6 exists to prevent.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { describeDbError, isMissingTable } from '../../_lib/db'
import { maskPhone } from '../../_lib/mask'

/**
 * Digits-only normaliser for matching a caller ID against the guest export.
 * NOT a masking function: it exists because the export stores `312-555-0148` while Telnyx sends
 * `+13125550148`, and the two only compare on their last ten digits. The masked form that gets
 * stored or logged always comes from the shared maskPhone.
 */
export function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

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
 * Caller ID -> guest. The provided export stores phones as "312-555-0148", so we try the exact
 * dashed form first (indexable, cheap) and fall back to a bounded scan that normalises to digits.
 * Only the masked phone ever leaves this function.
 */
export async function identifyCallerByPhone(
  db: SupabaseClient,
  fromE164: string | null | undefined,
): Promise<GuestMatch | null> {
  const digits = phoneDigits(fromE164)
  if (!digits) return null
  const dashed = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`

  const exact = await db.from('guests').select('guest_id, data').eq('data->>phone', dashed).limit(1)
  if (exact.error) {
    if (isMissingTable(exact.error)) return null
    console.warn(describeDbError(exact.error, 'identifyCallerByPhone (exact)'))
  }
  const hit = exact.data?.[0] as { guest_id: string; data: Record<string, unknown> } | undefined
  if (hit) return toGuestMatch(hit, fromE164)

  const scan = await db.from('guests').select('guest_id, data').limit(1000)
  if (scan.error || !scan.data) return null
  for (const row of scan.data as Array<{ guest_id: string; data: Record<string, unknown> }>) {
    if (phoneDigits(String(row.data?.phone ?? '')) === digits) return toGuestMatch(row, fromE164)
  }
  return null
}

function toGuestMatch(
  row: { guest_id: string; data: Record<string, unknown> },
  fromE164: string | null | undefined,
): GuestMatch {
  const first = String(row.data?.first_name ?? '').trim()
  const last = String(row.data?.last_name ?? '').trim()
  const name = [first, last].filter(Boolean).join(' ')
  const tier = row.data?.loyalty_tier ? String(row.data.loyalty_tier) : null
  return {
    guest_id: row.guest_id,
    // The guest row may already carry a masked phone; the shared maskPhone is idempotent, so
    // passing either form through it is safe.
    label: name.length > 0 ? name : row.guest_id,
    phone_masked: maskPhone(fromE164),
    loyalty_tier: tier && tier !== 'None' ? tier : null,
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
