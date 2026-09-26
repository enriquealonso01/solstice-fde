// Entry point for the `tools` Netlify function: the shared tool layer over HTTPS.
//
// WHY A DISPATCHER
// Netlify treats a directory inside netlify/functions/ as ONE function whose entry point is
// index.ts; the sibling modules here are bundled as helpers and never get URLs of their own.
// netlify.toml already redirects /api/* -> /.netlify/functions/:splat and passes trailing
// segments through, which gives us one URL per tool without one file per tool:
//
//   POST /api/tools/<tool_name>   -> run that tool, return the ToolResult envelope
//   POST /api/tools               -> same, with { tool, args } in the body (used by chat.ts's
//                                    sibling runtimes and by anything doing a generic call)
//   GET  /api/tools               -> the tool catalogue, which is what the Telnyx provisioning
//                                    script reads to register its webhook tools
//
// The Telnyx assistant calls the per-name URLs and passes {{call_control_id}} in the body. We
// resolve that to the session row so the voice supervisor's trace and the chat trace are fed
// by this one code path, writing the same `tool_invocations` shape either way.
//
// We deliberately do NOT set `export const config = { path: ... }`: a v2 path config would move
// the function off its default /.netlify/functions/ URL and fight the redirect in netlify.toml,
// which is not ours to edit (AGENTS.md rule 3).

import type { Context } from '@netlify/functions'
import type { Channel, ToolResult } from '../../../shared/types'
import { getDatabase } from './_deps'
import type { ToolArgs, ToolContext } from './helpers'
import {
  hasTool,
  recordClassifiedIntent,
  recordToolInvocation,
  runTool,
  summarize,
  toolDefinitions,
  toolSpecs,
} from './registry'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/** `/api/tools/get_policy` arrives as `/.netlify/functions/tools/get_policy`, sometimes with a
 *  trailing slash under `netlify dev`. Take the last non-empty segment either way. */
function lastSegment(pathname: string): string {
  const parts = pathname.split('/').filter((p) => p.length > 0)
  return parts[parts.length - 1] ?? ''
}

/** Keys that steer the call rather than being arguments to the tool itself. */
const CONTROL_KEYS = new Set(['tool', 'name', 'args', 'session_id', 'channel', 'call_control_id', 'telnyx_conversation_id'])

export default async function handler(req: Request, _context: Context): Promise<Response> {
  const route = lastSegment(new URL(req.url).pathname)
  const isRoot = route === 'tools' || route === ''

  if (req.method === 'GET') {
    if (!isRoot && !hasTool(route)) return unknownTool(route)
    if (!isRoot) return json({ tool: toolSpecs().find((s) => s.name === route) ?? null })
    return catalogue()
  }

  if (req.method !== 'POST') {
    return json({ ok: false, grounded: false, error: 'Use GET for the catalogue and POST to call a tool.' }, 405)
  }

  if (!authorized(req)) {
    return json({ ok: false, grounded: false, error: 'Unauthorized.' }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    if (raw.trim() !== '') {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
    }
  } catch {
    return json({ ok: false, grounded: false, error: 'Body must be a JSON object.' }, 400)
  }

  // The tool name comes from the path when the caller has one URL per tool (Telnyx), and from
  // the body when it does not.
  const name = isRoot ? (str(body.tool) ?? str(body.name)) : route
  if (!name) return json({ ok: false, grounded: false, error: 'Missing tool name: POST /api/tools/<tool> or send { "tool": "..." }.' }, 400)
  if (!hasTool(name)) return unknownTool(name)

  const args = extractArgs(body)
  // The session, and the guest it verified, come from the call leg and never from the body.
  const sessionId = await sessionForCall(str(body.call_control_id))
  const ctx: ToolContext = {
    session_id: sessionId,
    // A call arriving with a call_control_id is voice by definition; otherwise trust the caller,
    // and default to voice because that is who reaches this endpoint over HTTPS.
    channel: resolveChannel(body.channel),
    guest_id: await verifiedGuestFor(sessionId),
  }

  const result = await runTool(name, args, ctx)
  if (name === 'identify_guest' && sessionId) await bindVerifiedGuest(sessionId, result)
  await recordToolInvocation(ctx, name, args, result)
  // Telephony reaches the tools here rather than through `chat.ts`, so the intent write has to
  // happen on this path too or a phoned-in session stays labelled "classifying…" forever.
  //
  // AWAITED, not fire-and-forget. This handler returns immediately, and a serverless container can
  // freeze the moment it does — a `void` call here was verified to lose the write while the
  // awaited `recordToolInvocation` above kept its row from the very same request. `chat.ts` gets
  // away with fire-and-forget because its SSE stream holds the invocation open; this path has no
  // such luxury. The cost is one UPDATE by primary key on a webhook whose budget is 300ms.
  await recordClassifiedIntent(ctx, name, result)

  // `summary` is the human line the guest chip and the supervisor trace both render.
  return json({ ...result, summary: summarize(name, result) })
}

// ------------------------------------------------------------------------- helpers

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Trust an explicit channel; otherwise assume voice, because that is who reaches this
 *  endpoint over HTTPS. The chat runtime calls the registry in-process. */
function resolveChannel(declared: unknown): Channel {
  return declared === 'chat' ? 'chat' : 'voice'
}

/**
 * Telnyx webhook tools POST the tool's arguments as the body itself, with the assistant's
 * template variables mixed in. A generic caller sends `{ tool, args }`. Support both, and never
 * let a control key leak into the tool arguments.
 */
function extractArgs(body: Record<string, unknown>): ToolArgs {
  if (typeof body.args === 'object' && body.args !== null && !Array.isArray(body.args)) {
    return body.args as ToolArgs
  }
  const out: ToolArgs = {}
  for (const [key, value] of Object.entries(body)) {
    if (CONTROL_KEYS.has(key)) continue
    // An unfilled Telnyx template ("{{call_control_id}}") is worse than an absent value.
    if (typeof value === 'string' && /^\{\{.*\}\}$/.test(value.trim())) continue
    out[key] = value
  }
  return out
}

/**
 * Binds a voice tool call to its conversation so the trace row lands on the right session.
 * Best effort: a missing session must never stop the tool from answering the caller.
 */
async function sessionForCall(callControlId: string | undefined): Promise<string | undefined> {
  if (!callControlId) return undefined
  try {
    const db = getDatabase()
    if (!db) return undefined
    const { data, error } = await db
      .from('sessions')
      .select('id')
      .eq('call_control_id', callControlId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return undefined
    return typeof data.id === 'string' ? data.id : undefined
  } catch {
    return undefined
  }
}

/** The guest identify_guest verified on this session, or undefined. */
async function verifiedGuestFor(sessionId: string | undefined): Promise<string | undefined> {
  if (!sessionId) return undefined
  try {
    const db = getDatabase()
    if (!db) return undefined
    const { data, error } = await db.from('sessions').select('guest_id').eq('id', sessionId).maybeSingle()
    if (error || !data) return undefined
    return str(data.guest_id)
  } catch {
    return undefined
  }
}

/** A verified identify_guest binds its guest to the session, as chat.ts does. Best effort. */
async function bindVerifiedGuest(sessionId: string, result: ToolResult): Promise<void> {
  if (!result.ok) return
  const data = result.data as { verified?: boolean; guest?: { guest_id?: string; first_name?: string; last_name?: string } } | undefined
  if (data?.verified !== true || !data.guest?.guest_id) return
  const label = [data.guest.first_name, data.guest.last_name].filter(Boolean).join(' ') || null
  try {
    const db = getDatabase()
    if (!db) return
    await db.from('sessions').update({ guest_id: data.guest.guest_id, guest_label: label }).eq('id', sessionId)
  } catch {
    // the call matters more than the label
  }
}

/** Optional shared secret. Configured -> enforced. Unconfigured -> open, and the catalogue says so. */
function authorized(req: Request): boolean {
  const expected = process.env.TOOL_WEBHOOK_SECRET
  if (!expected) return true
  const supplied = req.headers.get('x-solstice-tool-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return supplied === expected
}

function unknownTool(name: string): Response {
  return json(
    {
      ok: false,
      grounded: false,
      error: `Unknown tool "${name}". Do not answer as though it ran.`,
      available: toolSpecs().map((s) => s.name),
      catalogue: '/api/tools',
    },
    404,
  )
}

function catalogue(): Response {
  return json({
    ok: true,
    service: 'tools',
    usage: {
      'POST /api/tools/<tool>': 'call one tool; body is the arguments, plus optional call_control_id',
      'POST /api/tools': 'call one tool; body is { tool, args, call_control_id? }',
      'GET /api/tools/<tool>': 'the contract for one tool',
    },
    secured: Boolean(process.env.TOOL_WEBHOOK_SECRET),
    tools: toolSpecs(),
    definitions: toolDefinitions(),
  })
}
