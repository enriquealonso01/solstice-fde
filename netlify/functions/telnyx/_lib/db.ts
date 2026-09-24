// Supabase access for the voice path, using the service role key.
// RLS is the real access control for the browser; these functions run server-side on Telnyx's
// behalf, where there is no signed-in user to scope to, so they bypass RLS deliberately.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { envOrNull } from './env'
import { maskPhone, phoneDigits } from './mask'

let cached: SupabaseClient | null = null

export interface DbUnavailable {
  ok: false
  error: string
}

/** Returns the service-role client, or a typed failure if the env is not wired yet. */
export function serviceClient(): SupabaseClient | DbUnavailable {
  if (cached) return cached
  const url = envOrNull('SUPABASE_URL')
  const key = envOrNull('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    return { ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on this deploy' }
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return cached
}

export function isDbUnavailable(v: SupabaseClient | DbUnavailable): v is DbUnavailable {
  return (v as DbUnavailable).ok === false
}

/** Postgres "relation does not exist" — schema.sql has not been applied to this project yet. */
export function isMissingTable(err: { code?: string | null } | null | undefined): boolean {
  return err?.code === '42P01'
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
  sb: SupabaseClient,
  callControlId: string,
): Promise<SessionRow | null> {
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .eq('call_control_id', callControlId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) {
    if (isMissingTable(error)) throw new Error('Supabase table `sessions` is missing. Apply supabase/schema.sql.')
    throw new Error(`sessions lookup failed: ${error.message}`)
  }
  return (data?.[0] as SessionRow | undefined) ?? null
}

export async function findSessionByConversationId(
  sb: SupabaseClient,
  conversationId: string,
): Promise<SessionRow | null> {
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .eq('telnyx_conversation_id', conversationId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`sessions lookup by conversation failed: ${error.message}`)
  return (data?.[0] as SessionRow | undefined) ?? null
}

export async function getSessionById(sb: SupabaseClient, id: string): Promise<SessionRow | null> {
  const { data, error } = await sb.from('sessions').select('*').eq('id', id).limit(1)
  if (error) {
    if (isMissingTable(error)) throw new Error('Supabase table `sessions` is missing. Apply supabase/schema.sql.')
    throw new Error(`sessions lookup failed: ${error.message}`)
  }
  return (data?.[0] as SessionRow | undefined) ?? null
}

export async function insertSession(
  sb: SupabaseClient,
  row: Partial<SessionRow> & { channel: 'voice' | 'chat' },
): Promise<SessionRow> {
  const { data, error } = await sb.from('sessions').insert(row).select('*').single()
  if (error) throw new Error(`session insert failed: ${error.message}`)
  return data as SessionRow
}

export async function updateSession(
  sb: SupabaseClient,
  id: string,
  patch: Partial<SessionRow>,
): Promise<void> {
  const { error } = await sb.from('sessions').update(patch).eq('id', id)
  if (error) throw new Error(`session update failed: ${error.message}`)
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
  sb: SupabaseClient,
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

  const { error } = await sb.from('messages').upsert(rows, { onConflict: 'id', ignoreDuplicates: false })
  if (error) {
    if (isMissingTable(error)) throw new Error('Supabase table `messages` is missing. Apply supabase/schema.sql.')
    throw new Error(`transcript upsert failed: ${error.message}`)
  }
  return rows.length
}

export async function insertMessage(
  sb: SupabaseClient,
  sessionId: string,
  role: MessageRole,
  content: string,
): Promise<void> {
  const { error } = await sb.from('messages').insert({ session_id: sessionId, role, content })
  if (error) throw new Error(`message insert failed: ${error.message}`)
}

// ---------------------------------------------------------------- tool_invocations

/**
 * `tool_invocations` doubles as the durable store for voice-path side facts that schema.sql has
 * no dedicated column for: the supervisor leg id and the post-call insights blob. Both genuinely
 * belong in the session trace the supervisor UI already renders, so this is not a hack shelf.
 * If schema.sql later grows `sessions.supervisor_call_control_id` and `sessions.insights`, move
 * them; nothing else reads these rows.
 */
export async function recordToolInvocation(
  sb: SupabaseClient,
  row: {
    session_id: string | null
    tool: string
    args_masked?: Record<string, unknown>
    result_summary?: string | null
    grounded?: boolean | null
    latency_ms?: number | null
  },
): Promise<void> {
  const { error } = await sb.from('tool_invocations').insert({
    session_id: row.session_id,
    tool: row.tool,
    args_masked: row.args_masked ?? {},
    result_summary: row.result_summary ?? null,
    grounded: row.grounded ?? null,
    latency_ms: row.latency_ms ?? null,
  })
  if (error && !isMissingTable(error)) {
    // A failed trace write must never break a live call.
    console.warn(`[solstice] tool_invocations insert failed: ${error.message}`)
  }
}

export interface SupervisorLegRecord {
  supervisor_call_control_id: string
  role: string
  created_at: string
}

export const SUPERVISOR_LEG_TOOL = 'supervisor.leg_opened'
export const SUPERVISOR_LEG_ENDED_TOOL = 'supervisor.leg_ended'

/** Most recent supervisor leg for a session that has not been recorded as ended. */
export async function findLiveSupervisorLeg(
  sb: SupabaseClient,
  sessionId: string,
): Promise<SupervisorLegRecord | null> {
  const { data, error } = await sb
    .from('tool_invocations')
    .select('tool, args_masked, created_at')
    .eq('session_id', sessionId)
    .in('tool', [SUPERVISOR_LEG_TOOL, SUPERVISOR_LEG_ENDED_TOOL])
    .order('created_at', { ascending: false })
    .limit(25)
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(`supervisor leg lookup failed: ${error.message}`)
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
  sb: SupabaseClient,
  fromE164: string | null | undefined,
): Promise<GuestMatch | null> {
  const digits = phoneDigits(fromE164)
  if (!digits) return null
  const dashed = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`

  const exact = await sb.from('guests').select('guest_id, data').eq('data->>phone', dashed).limit(1)
  if (exact.error) {
    if (isMissingTable(exact.error)) return null
    console.warn(`[solstice] guest exact lookup failed: ${exact.error.message}`)
  }
  const hit = exact.data?.[0] as { guest_id: string; data: Record<string, unknown> } | undefined
  if (hit) return toGuestMatch(hit, fromE164)

  const scan = await sb.from('guests').select('guest_id, data').limit(1000)
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
    label: name.length > 0 ? name : row.guest_id,
    phone_masked: maskPhone(fromE164),
    loyalty_tier: tier && tier !== 'None' ? tier : null,
  }
}

// ---------------------------------------------------------------- audit

export async function writeAudit(
  sb: SupabaseClient,
  row: { actor?: string | null; action: string; subject: string; detail?: Record<string, unknown> },
): Promise<void> {
  const { error } = await sb.from('audit_log').insert({
    actor: row.actor ?? null,
    action: row.action,
    subject: row.subject,
    detail: row.detail ?? {},
  })
  if (error && !isMissingTable(error)) {
    console.warn(`[solstice] audit_log insert failed: ${error.message}`)
  }
}
