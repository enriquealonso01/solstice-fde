// Closes conversations that are over but were never told so.
//
// WHY THIS EXISTS. A phone call ends with an event: Telnyx sends `call.hangup` and the webhook
// stamps `ended_at`. A web chat ends with a closed tab, and a closed tab sends nothing. So every
// chat session ever opened stayed `active` forever, and the supervisor's "Active now" tile grew
// monotonically — 308 of them by the morning of the demo. A tile that only ever counts up is not
// a live figure, it is a total, and a supervisor cannot triage a total.
//
// `scripts/cleanup-phantom-sessions.mjs` already did this, by hand, from a laptop, when somebody
// remembered. That is the wrong shape for the one thing on screen when the panel arrives. This is
// the same rule, running on a schedule and on demand, on the server.
//
// TWO DELIBERATE CHOICES, BOTH OF WHICH COULD HAVE GONE THE OTHER WAY.
//
//   1. `ended_at` is set to the last thing that actually happened, never to `now()`. A transcript
//      claiming a guest was in conversation until the sweep happened to run would be a fabricated
//      record, and this system's whole argument is that its audit trail can be trusted.
//
//   2. The idle window is 30 minutes, and a caller can shorten it but the sweep will not shorten
//      it itself. Thirty minutes is the honest answer to "has this guest gone" for someone who
//      closed a tab mid-question; anything less is an operator asserting "there are no real guests
//      right now", which is true in a rehearsal and nowhere else.
//
// A voice session is swept too, and for a real reason rather than symmetry: if the `call.hangup`
// webhook is ever lost — a redeploy mid-call, a Telnyx retry that never lands — that call is
// otherwise live forever. The sweep is the backstop for the event that did not arrive.

import type { SupabaseClient } from '@supabase/supabase-js'
import { describeDbError, isMissingTable, tryGetDb } from './db'

/** Minutes of silence after which a conversation is treated as over. */
export const DEFAULT_IDLE_MINUTES = 30

export interface ReapedSession {
  id: string
  channel: string
  status: string
  /** The timestamp written to `ended_at`: the last real activity, not the sweep time. */
  ended_at: string
  idle_minutes: number
}

export interface ReapResult {
  ok: boolean
  examined: number
  closed: ReapedSession[]
  /** Set when the sweep could not run at all. `closed` is empty in that case. */
  error: string | null
  idle_minutes: number
  dry_run: boolean
}

export interface ReapOptions {
  idleMinutes?: number
  /** Report what would close without closing it. */
  dryRun?: boolean
  /** Who asked. Written to the audit row so a sweep is attributable like any other action. */
  actor?: string
  db?: SupabaseClient
  /** Injectable for tests. */
  now?: () => number
}

/**
 * Sweep once. Never throws: this runs on a timer and from a dashboard mount, and neither caller
 * has a user to show a stack trace to. Failures come back in `error`.
 */
export async function reapStaleSessions(options: ReapOptions = {}): Promise<ReapResult> {
  const idleMinutes = normaliseIdleMinutes(options.idleMinutes)
  const dryRun = options.dryRun === true
  const now = options.now ? options.now() : Date.now()
  const cutoff = new Date(now - idleMinutes * 60_000).toISOString()
  const empty: ReapResult = { ok: false, examined: 0, closed: [], error: null, idle_minutes: idleMinutes, dry_run: dryRun }

  const db = options.db ?? tryGetDb()
  if (!db) return { ...empty, error: 'Supabase is not configured on this deploy, so no sweep ran.' }

  // `ended_at is null` is the question, not `status`. The voice webhook keeps `taken_over` on a
  // finished call on purpose — see isLive() in src/components/admin/mockData.ts — so filtering on
  // status would skip exactly the rows that caused this bug.
  const open = await db
    .from('sessions')
    .select('id, channel, status, started_at')
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(500)

  if (open.error) {
    if (isMissingTable(open.error)) return { ...empty, error: 'sessions table is not present on this database.' }
    return { ...empty, error: describeDbError(open.error, 'reapStaleSessions (select)') }
  }

  const rows = (open.data ?? []) as Array<{ id: string; channel: string; status: string; started_at: string }>
  const closed: ReapedSession[] = []

  for (const row of rows) {
    const lastAt = await lastActivityAt(db, row.id, row.started_at)
    if (lastAt >= cutoff) continue

    const idle = Math.round((now - new Date(lastAt).getTime()) / 60_000)
    const reaped: ReapedSession = {
      id: row.id,
      channel: row.channel,
      status: row.status,
      ended_at: lastAt,
      idle_minutes: Number.isFinite(idle) ? idle : idleMinutes,
    }

    if (dryRun) {
      closed.push(reaped)
      continue
    }

    // `status` is left alone when a human took the conversation over. Who handled it and whether
    // it is finished are two different facts, and overwriting the first to record the second is
    // how the archive would come to disagree with what the supervisor watched happen.
    const patch: Record<string, string> = { ended_at: lastAt }
    if (row.status !== 'taken_over') patch.status = 'ended'

    const wrote = await db.from('sessions').update(patch).eq('id', row.id).is('ended_at', null)
    // `.is('ended_at', null)` a second time is not redundant: between the select and here, a real
    // hangup webhook may have closed this row properly. Losing that race must not overwrite the
    // timestamp the webhook wrote with one this sweep guessed.
    if (wrote.error) {
      console.warn(describeDbError(wrote.error, `reapStaleSessions (close ${row.id})`))
      continue
    }
    closed.push(reaped)
  }

  if (closed.length > 0 && !dryRun) {
    await db
      .from('audit_log')
      .insert({
        actor: options.actor ?? 'system:reaper',
        action: 'sessions.reaped',
        subject: `${closed.length} session(s)`,
        detail: { idle_minutes: idleMinutes, sessions: closed.map((c) => c.id) },
      })
      // An audit failure must not undo a sweep that already happened.
      .then((r) => {
        if (r.error) console.warn(describeDbError(r.error, 'reapStaleSessions (audit)'))
      })
  }

  return { ok: true, examined: rows.length, closed, error: null, idle_minutes: idleMinutes, dry_run: dryRun }
}

/**
 * When this conversation last did anything.
 *
 * Falls back to `started_at` for a session with no messages, which is the right answer rather than
 * a missing one: a call that connected and produced nothing is idle from the moment it started.
 */
async function lastActivityAt(db: SupabaseClient, sessionId: string, startedAt: string): Promise<string> {
  const res = await db
    .from('messages')
    .select('created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (res.error) return startedAt
  const last = (res.data?.[0] as { created_at?: string } | undefined)?.created_at
  // A message older than the session row itself would mean clock skew between two writers; take
  // the later of the two rather than trusting either blindly.
  if (!last) return startedAt
  return last > startedAt ? last : startedAt
}

/** Clamped, because an idle window of 0 would close a conversation mid-sentence. */
export function normaliseIdleMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_IDLE_MINUTES
  return Math.min(Math.floor(n), 24 * 60)
}
