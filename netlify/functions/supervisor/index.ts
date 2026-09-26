// Human intervention in a text conversation.
//
//   POST /api/supervisor/join      take the chat off Sol and onto yourself
//   POST /api/supervisor/message   say something to the guest, with or without a file
//   POST /api/supervisor/release   hand the guest back to Sol
//   POST /api/supervisor/reap      close conversations that ended without an event
//   GET  /api/supervisor           health probe, for the Backend Map
//
// WHY THIS IS NOT THE VOICE LADDER. `/api/voice/supervisor` climbs listen -> whisper -> barge ->
// takeover, and every rung is a Telnyx Call Control primitive operating on live audio. A chat has
// no audio and no third party to route it through: the supervisor simply becomes the author of the
// next message. Reusing the ladder would have meant four buttons where three of them could not do
// anything, which is worse than a different control for a different channel.
//
// TAKEOVER IS ENFORCED, NOT ANNOUNCED. `join` sets `sessions.status = 'taken_over'`, and
// netlify/functions/chat.ts reads that status at the top of every turn and does not call the model
// while it is set. Without that check "take over" would be a label on a button and Sol would keep
// answering over the supervisor's shoulder. The button is the UI; the status is the mechanism.
//
// THE BROWSER CANNOT WRITE THESE ROWS DIRECTLY. `messages` has a select policy for concierge and
// admin and no insert policy at all (supabase/schema.sql), so the admin console is read-only
// against Postgres by construction. A supervisor message therefore has to come through here, where
// the token is verified as the user, the role is checked against the same rule RLS enforces, and
// the write happens with the service role. The UI's convenience is not the access control.

import type { Context } from '@netlify/functions'
import type { StaffRole } from '../../../shared/types'
import { json, readJsonBody } from '../telnyx/_lib/http'
import { authorizeStaff, type AuthOk } from '../group/auth'
import { tryGetDb, describeDbError, isDbConfigured } from '../_lib/db'
import { reapStaleSessions, normaliseIdleMinutes } from '../_lib/reap'
import { storeAttachment, ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, type StoredAttachment } from './attachments'

/** Mirrors ALLOWED_ROLES in netlify/functions/voice/credentials.ts: the two roles that hold guest
 *  conversations. Group sales does not answer concierge chats, here or in the database. */
const CONCIERGE_ROLES: StaffRole[] = ['concierge', 'admin']

const DENIED =
  'This role cannot join a guest conversation. Live sessions are readable by concierge and admin only, ' +
  'which is what row level security enforces in the database as well.'

/** A supervisor note is a chat message, not an essay. Long enough for a real answer with a link. */
const MAX_TEXT_LENGTH = 4000

export default async function handler(req: Request, _context: Context): Promise<Response> {
  const route = lastSegment(new URL(req.url).pathname)

  if (req.method === 'GET' && (route === 'supervisor' || route === '')) return health()

  if (req.method !== 'POST') {
    return json({ ok: false, error: `${req.method} is not supported on /api/supervisor/${route}` }, 405)
  }

  switch (route) {
    case 'join':
      return handleJoinOrRelease(req, 'join')
    case 'release':
      return handleJoinOrRelease(req, 'release')
    case 'message':
      return handleMessage(req)
    case 'reap':
      return handleReap(req)
    default:
      return json(
        {
          ok: false,
          error: `unknown supervisor route "${route}"`,
          routes: ['/api/supervisor/join', '/api/supervisor/message', '/api/supervisor/release', '/api/supervisor/reap'],
        },
        404,
      )
  }
}

// ---------------------------------------------------------------- join / release

interface JoinBody {
  session_id?: string
}

async function handleJoinOrRelease(req: Request, mode: 'join' | 'release'): Promise<Response> {
  const auth = await authorizeStaff(req, CONCIERGE_ROLES, DENIED)
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

  const body = await readJsonBody<JoinBody>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const sessionId = (body.value.session_id ?? '').trim()
  if (!isUuid(sessionId)) return json({ ok: false, error: 'session_id must be a uuid' }, 400)

  const db = tryGetDb()
  if (!db) return json({ ok: false, error: 'Supabase is not configured on this deploy.' }, 503)

  const found = await db.from('sessions').select('id, channel, status, ended_at').eq('id', sessionId).limit(1)
  if (found.error) return json({ ok: false, error: describeDbError(found.error, 'supervisor join (read)') }, 503)
  const session = found.data?.[0] as
    | { id: string; channel: string; status: string; ended_at: string | null }
    | undefined
  if (!session) return json({ ok: false, error: 'no such session' }, 404)

  // A finished conversation cannot be joined. Offering it would put a supervisor in front of a
  // composer whose messages nobody will ever read, which is a worse outcome than a refusal.
  if (session.ended_at) {
    return json({ ok: false, error: 'this conversation has already ended' }, 409)
  }

  // Voice takeover is the ladder's job: it has to stop the assistant leg on Telnyx, not just
  // change a row. Silently doing half of that here would leave Sol talking to the caller.
  if (session.channel !== 'chat') {
    return json(
      { ok: false, error: 'this is a phone call. Use the supervisor ladder, which stops the assistant leg on Telnyx.' },
      409,
    )
  }

  const status = mode === 'join' ? 'taken_over' : 'active'
  const wrote = await db.from('sessions').update({ status }).eq('id', sessionId)
  if (wrote.error) return json({ ok: false, error: describeDbError(wrote.error, `supervisor ${mode}`) }, 503)

  // A system turn, so the change of hands is in the transcript rather than only in the audit log.
  // The archive should read like what the guest experienced, and the guest is told either way.
  await insertMessage(db, sessionId, 'system', mode === 'join' ? JOIN_NOTE : RELEASE_NOTE)
  await audit(db, auth, mode === 'join' ? 'chat.taken_over' : 'chat.released', sessionId, { channel: 'chat' })
  await trace(db, sessionId, `supervisor.${mode === 'join' ? 'takeover' : 'release'}`, {
    actor_role: auth.role,
    channel: 'chat',
  }, mode === 'join' ? 'Sol stood down; the supervisor is answering' : 'Handed back to Sol')

  return json({ ok: true, session_id: sessionId, status })
}

export const JOIN_NOTE = 'A Solstice team member joined this conversation. Sol has stood down.'
export const RELEASE_NOTE = 'The team member handed this conversation back to Sol.'

// ---------------------------------------------------------------- message

interface MessageBody {
  session_id?: string
  text?: string
  attachment?: {
    filename?: string
    content_type?: string
    /** Base64, no data: prefix. JSON rather than multipart because that is what the rest of this
     *  API speaks, and a concierge note is measured in kilobytes. */
    data_base64?: string
  }
}

async function handleMessage(req: Request): Promise<Response> {
  const auth = await authorizeStaff(req, CONCIERGE_ROLES, DENIED)
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

  const body = await readJsonBody<MessageBody>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const sessionId = (body.value.session_id ?? '').trim()
  if (!isUuid(sessionId)) return json({ ok: false, error: 'session_id must be a uuid' }, 400)

  const text = (body.value.text ?? '').trim()
  const hasAttachment = Boolean(body.value.attachment?.data_base64)
  if (!text && !hasAttachment) return json({ ok: false, error: 'send text, a file, or both' }, 400)
  if (text.length > MAX_TEXT_LENGTH) {
    return json({ ok: false, error: `text is longer than ${MAX_TEXT_LENGTH} characters` }, 413)
  }

  const db = tryGetDb()
  if (!db) return json({ ok: false, error: 'Supabase is not configured on this deploy.' }, 503)

  const found = await db.from('sessions').select('id, channel, status, ended_at').eq('id', sessionId).limit(1)
  if (found.error) return json({ ok: false, error: describeDbError(found.error, 'supervisor message (read)') }, 503)
  const session = found.data?.[0] as
    | { id: string; channel: string; status: string; ended_at: string | null }
    | undefined
  if (!session) return json({ ok: false, error: 'no such session' }, 404)
  if (session.ended_at) return json({ ok: false, error: 'this conversation has already ended' }, 409)

  let attachment: StoredAttachment | null = null
  if (hasAttachment) {
    const stored = await storeAttachment(db, sessionId, {
      filename: body.value.attachment?.filename,
      contentType: body.value.attachment?.content_type,
      base64: body.value.attachment?.data_base64 ?? '',
    })
    if (!stored.ok) return json({ ok: false, error: stored.error }, stored.status)
    attachment = stored.attachment
  }

  // Sending implies taking over. A supervisor who types into a live chat has already decided; making
  // them press Join first only creates a window where Sol answers on top of them.
  if (session.status !== 'taken_over') {
    const wrote = await db.from('sessions').update({ status: 'taken_over' }).eq('id', sessionId)
    if (wrote.error) console.warn(describeDbError(wrote.error, 'supervisor message (implicit takeover)'))
    else await insertMessage(db, sessionId, 'system', JOIN_NOTE)
  }

  const inserted = await insertMessage(db, sessionId, 'supervisor', text || attachmentOnlyText(attachment), attachment)
  if (!inserted.ok) return json({ ok: false, error: inserted.error }, 503)

  await audit(db, auth, 'chat.supervisor_message', sessionId, {
    channel: 'chat',
    characters: text.length,
    attachment: attachment ? { filename: attachment.filename, bytes: attachment.bytes } : null,
  })
  await trace(
    db,
    sessionId,
    'supervisor.message',
    // The note itself is staff-authored, so it is not masked: masking exists to keep guest PII out
    // of the trace, and this text came from the supervisor who is already reading the transcript.
    { actor_role: auth.role, characters: text.length, attachment: attachment?.filename ?? null },
    attachment ? `Supervisor sent a note and ${attachment.filename}` : 'Supervisor sent a note',
  )

  return json({ ok: true, session_id: sessionId, message_id: inserted.id, attachment })
}

function attachmentOnlyText(attachment: StoredAttachment | null): string {
  return attachment ? `Sent you a file: ${attachment.filename}` : ''
}

// ---------------------------------------------------------------- reap

async function handleReap(req: Request): Promise<Response> {
  const auth = await authorizeStaff(req, CONCIERGE_ROLES, DENIED)
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

  const body = await readJsonBody<{ idle_minutes?: number; dry_run?: boolean }>(req)
  const idleMinutes = body.ok ? normaliseIdleMinutes(body.value.idle_minutes) : undefined
  const dryRun = body.ok ? body.value.dry_run === true : false

  const result = await reapStaleSessions({ idleMinutes, dryRun, actor: auth.actor })
  return json(result, result.ok ? 200 : 503)
}

// ---------------------------------------------------------------- shared writes

async function insertMessage(
  db: NonNullable<ReturnType<typeof tryGetDb>>,
  sessionId: string,
  role: 'system' | 'supervisor',
  content: string,
  attachment: StoredAttachment | null = null,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const row: Record<string, unknown> = { session_id: sessionId, role, content }
  if (attachment) row.attachment = attachment

  const res = await db.from('messages').insert(row).select('id').limit(1)
  if (!res.error) return { ok: true, id: (res.data?.[0] as { id?: string } | undefined)?.id ?? null }

  // `messages.attachment` is a jsonb column added by supabase/migrations/005_message_attachments.sql.
  // A database built from schema.sql alone does not have it, and the same is true of any deploy where
  // that migration has not been pasted in yet. Rather than fail the send, fall back to a row without
  // the column and put the file in the text, where the guest can still reach it. The attachment
  // itself is already uploaded and served from Storage either way.
  //
  // This mirrors isMissingSupervisorColumn() in netlify/functions/telnyx/_lib/sessions.ts, and for
  // the same reason: losing a UI affordance is a bad day, losing the message is a worse one.
  if (attachment && isMissingColumn(res.error, 'attachment')) {
    const fallback = await db
      .from('messages')
      .insert({ session_id: sessionId, role, content: `${content}\n${attachment.url}`.trim() })
      .select('id')
      .limit(1)
    if (!fallback.error) {
      console.warn('[solstice] messages.attachment is missing; apply supabase/migrations/005_message_attachments.sql')
      return { ok: true, id: (fallback.data?.[0] as { id?: string } | undefined)?.id ?? null }
    }
    return { ok: false, error: describeDbError(fallback.error, 'insertMessage (fallback)') }
  }

  return { ok: false, error: describeDbError(res.error, 'insertMessage') }
}

/** PGRST204 is PostgREST's schema cache missing a column; 42703 is Postgres saying the same thing. */
function isMissingColumn(error: { code?: string | null; message?: string | null } | null, column: string): boolean {
  if (!error) return false
  if (error.code === 'PGRST204' || error.code === '42703') return true
  return new RegExp(column, 'i').test(error.message ?? '') && /column|schema cache/i.test(error.message ?? '')
}

async function audit(
  db: NonNullable<ReturnType<typeof tryGetDb>>,
  auth: AuthOk,
  action: string,
  subject: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const res = await db
    .from('audit_log')
    .insert({ actor: auth.actor, action, subject, detail: { ...detail, actor_role: auth.role } })
  if (res.error) console.warn(describeDbError(res.error, `audit ${action}`))
}

/** The tool trace is what the panel reads to answer "what did a human do here". A supervisor's
 *  actions belong in it for the same reason the agent's do. */
async function trace(
  db: NonNullable<ReturnType<typeof tryGetDb>>,
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  summary: string,
): Promise<void> {
  const res = await db.from('tool_invocations').insert({
    session_id: sessionId,
    tool,
    args_masked: args,
    result_summary: summary,
    // A human action is grounded by definition: a person decided it. Leaving this null would put a
    // question mark next to it in the trace, next to the agent calls where null means "unknown".
    grounded: true,
  })
  if (res.error) console.warn(describeDbError(res.error, `trace ${tool}`))
}

// ---------------------------------------------------------------- misc

function health(): Response {
  return json({
    ok: true,
    service: 'supervisor',
    routes: {
      '/api/supervisor/join': { method: 'POST', body: { session_id: 'uuid' }, auth: 'Bearer <supabase access token>' },
      '/api/supervisor/message': {
        method: 'POST',
        body: { session_id: 'uuid', text: 'string', attachment: { filename: 'string', content_type: 'string', data_base64: 'string' } },
        auth: 'Bearer <supabase access token>',
      },
      '/api/supervisor/release': { method: 'POST', body: { session_id: 'uuid' }, auth: 'Bearer <supabase access token>' },
      '/api/supervisor/reap': { method: 'POST', body: { idle_minutes: 30, dry_run: false }, auth: 'Bearer <supabase access token>' },
    },
    roles: CONCIERGE_ROLES,
    attachments: { bucket: ATTACHMENT_BUCKET, max_bytes: MAX_ATTACHMENT_BYTES },
    configured: { database: isDbConfigured() },
  })
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function lastSegment(pathname: string): string {
  const parts = pathname.split('/').filter((p) => p.length > 0)
  return parts[parts.length - 1] ?? ''
}
