// POST /api/chat — Sol's chat channel.
//
// A Claude tool-use loop streamed to the browser as Server-Sent Events. The event names are a
// contract with the browser client (A2) and with the supervisor console:
//
//   session  { session_id }
//   delta    { text }
//   tool     { name, status: "running" | "done", summary, citations, enforced? }
//            a done event also carries grounded, may_promise (null when the result has none) and,
//            for create_escalation, authority_required
//   done     { message_id, latency_ms, first_token_ms, first_event_ms }
//   error    { message }
//   handoff  { message }        a human took this conversation; no delta follows on this turn
//
// `enforced: true` marks a tool call the runtime made itself (see escalateInCode); a model's own
// call never carries the field.
//
// Request body: { message: string, session_id?: string, history?: [{ role, content }] }
// `session_id` is optional on the first turn; the response's `session` event carries the id to
// send back on every turn after that. History lives server-side in `messages`, so the client
// never has to replay the conversation; `history` is only a fallback for when Supabase is not
// configured.
//
// THE BROWSER CANNOT ASSERT WHO IT IS. This endpoint is public and unauthenticated, so it takes
// no `guest_id` and no clock override from the request. Identity is established only by the
// identify_guest tool and then bound to the session row; a demo clock comes only from the
// server-side DEMO_NOW. Accepting either from the body would let anyone POST someone else's
// guest id and be handed their stay, or move the clock to walk into a closed policy window.
//
// LATENCY. The target is p50 under 800ms to the first observable event, because a chat that
// pauses feels broken in a way a phone call does not. Four things buy that:
//   1. The session id is minted here and emitted BEFORE any database work, so the client can
//      render immediately and the supervisor console can subscribe.
//   2. Every write (session row, user message, trace rows) is fire-and-forget. Nothing the
//      guest is waiting on blocks on Postgres.
//   3. The "running" tool chip is emitted from content_block_start, the moment the model names
//      the tool, rather than after the message completes.
//   4. The system prompt and tool definitions are stable across turns and carry a cache
//      breakpoint, so repeat turns re-read the prefix instead of re-processing it.
//
// Two numbers, not one. Measured against the live API on a turn that calls one
// tool: first chip lands well inside the budget; the first WORD of prose lands afterwards,
// because the model has to see the tool result before it can answer. `done` carries both, and
// both are written to `tool_invocations` as a `turn_metrics` row, so the dashboard shows the
// number the guest actually experienced rather than one from a load test.
//
// THE KEY MAY FAIL. If the Anthropic call errors, we emit `error` with a guest-safe line and
// then `done`, so the client re-enables input instead of hanging. We never fabricate a reply.

import Anthropic from '@anthropic-ai/sdk'
import type { Context } from '@netlify/functions'
import type { Citation, ToolResult } from '../../shared/types'
import { redactText } from './_lib/mask'
import { getDatabase } from './tools/_deps'
import { mergeTargetFor } from './tools/escalation'
import type { ToolArgs, ToolContext } from './tools/helpers'
import { recordToolInvocation, runningLabel, runTool, summarize, toolDefinitions } from './tools/registry'
import { classifyIntent, mustEscalate } from './tools/routing'
import type { EscalationCategory } from './tools/rules'
import { SOL_SYSTEM_PROMPT } from './tools/solPrompt'

// ------------------------------------------------------------------------------ config

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number.parseInt(process.env.SOL_MAX_TOKENS ?? '4096', 10)
/** Concierge turns are short. Low effort keeps time-to-first-token inside the budget; raise it
 *  with SOL_EFFORT if the panel wants to see the tradeoff live. */
const EFFORT = (process.env.SOL_EFFORT ?? 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/**
 * Adaptive thinking is the library default; SOL_THINKING=disabled turns it off. Production ships
 * `disabled` for behaviour, NOT as a latency dial: it was the only setting with zero behavioural
 * violations in the adversarial scenarios (docs/latency-target.md). Anything but 'disabled' is adaptive.
 */
const THINKING: Anthropic.ThinkingConfigParam =
  process.env.SOL_THINKING === 'disabled' ? { type: 'disabled' } : { type: 'adaptive' }
/**
 * Whether Sol says "let me pull that up" BEFORE a tool call on this channel.
 *
 * Off by default in chat, on purpose. The transcript already shows the guest a plain-English
 * chip for every tool as it runs, grounded in what actually executed, so a spoken preamble is
 * redundant here; worse, the model tends to restate itself once the tool returns, which arrives
 * as two replies welded together. Voice keeps the narration, because silence on a phone sounds
 * like a dropped line. SOL_NARRATION=on restores it if the room prefers the earlier first word.
 */
const NARRATE_BEFORE_TOOLS = process.env.SOL_NARRATION === 'on'
/** Separator between two utterances from different tool rounds. Never concatenate them raw. */
const PARAGRAPH_BREAK = '\n\n'

/**
 * Not every model takes the same knobs, and swapping ANTHROPIC_MODEL is something we actively
 * want to be able to do live. Haiku 4.5 rejects `output_config.effort` outright with a 400, and
 * the same is true of the older Sonnet and Haiku generations, so sending it would break every
 * turn on exactly the models someone would reach for to cut latency.
 *
 * The table below is the known-good list; `sendTuning` false means "plain request, no effort and
 * no adaptive thinking". Anything unrecognised is assumed to take the knobs and is protected by
 * the one-shot retry in the turn loop, so a model released after this was written degrades to a
 * slightly slower first turn rather than a dead endpoint.
 */
function modelTakesTuning(model: string): boolean {
  if (process.env.SOL_EFFORT === 'off') return false
  if (/^claude-haiku/.test(model)) return false
  if (/^claude-(sonnet|opus)-[0-3]/.test(model)) return false
  return true
}

const SEND_TUNING = modelTakesTuning(MODEL)

/** True when a 400 is the model rejecting a tuning parameter rather than a real request error. */
function isUnsupportedParameterError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError) || err.status !== 400) return false
  return /does not support the (effort|thinking) parameter|thinking.*not supported|effort/i.test(String(err.message))
}
/** Tool rounds per turn. Six is generous for a concierge answer and stops a runaway loop. */
const MAX_TOOL_ROUNDS = Number.parseInt(process.env.SOL_MAX_TOOL_ROUNDS ?? '6', 10)
/** How much history we replay. Long enough to hold a conversation, short enough to stay fast. */
const HISTORY_LIMIT = 40

const GUEST_SAFE_FAILURE =
  "I've hit a technical problem on my side, and I'd rather not guess at an answer. Let me get a colleague to pick this up with you."

/** Shown to the guest when a supervisor has taken the conversation. Deliberately not phrased as
 *  Sol speaking: Sol has stopped, and pretending otherwise would misrepresent who is answering. */
const HANDOFF_NOTICE = 'A Solstice team member is with you now. They can see everything above.'

// -------------------------------------------------------------------------- the prompt

/**
 * What this channel has, appended after the shared prompt. Chat has no create_inquiry, and its
 * escalations reach a manager's queue rather than the group sales board, so the note says both.
 */
const CHAT_CHANNEL_NOTE = `
ON THIS CHANNEL
You are on web chat, which has no inquiry-creation tool. Do not try to open a group inquiry here
and do not refer to one. For a group request: capture what the customer gives you, call
create_escalation, and tell them a manager has it and will follow up. That is the whole of your job
on a group request here, not a fallback from a failed attempt.

Be careful what you promise about who has it. The escalation does not reach the group sales board,
so do not tell the guest that Sales has it, that Sales or a team will contact them, or that it is
going anywhere today. You may say that a group block is priced by Sales rather than by you, because
that is true; what you have actually just done is put it in front of a manager, so say that much and
no more. For a group request, never name who will make contact, and never promise when.`

// solPrompt.ts is generated from agent/sol.md at build time. An empty prompt must stop the function
// from loading, never let Sol answer with no rules.
if (!SOL_SYSTEM_PROMPT.trim()) {
  throw new Error('SOL_SYSTEM_PROMPT is empty: run `node scripts/gen-sol-prompt.mjs` to regenerate it from agent/sol.md.')
}
const SYSTEM_PROMPT = `${SOL_SYSTEM_PROMPT}\n${CHAT_CHANNEL_NOTE}`

// ------------------------------------------------------------------------------- SSE

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Netlify's edge and most proxies buffer by default, which would defeat the whole point.
  'x-accel-buffering': 'no',
}

type Emit = (event: 'session' | 'delta' | 'tool' | 'done' | 'error' | 'handoff', data: unknown) => void

// ------------------------------------------------------------------------------ handler

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' },
    })
  }
  // GET /api/chat/inbox is the other half of supervisor intervention: the guest's browser asking
  // whether a human has said anything since it last looked. It is the only read route here.
  if (req.method === 'GET' && lastSegment(new URL(req.url).pathname) === 'inbox') {
    return inbox(req)
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST a message to /api/chat.' }), { status: 405, headers: { 'content-type': 'application/json' } })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be JSON.' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }

  const userText = str(body.message) ?? str(body.text) ?? str(body.content)
  if (!userText) {
    return new Response(JSON.stringify({ error: 'Missing "message".' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }

  const { sessionId, isNewSession } = resolveSessionId(str(body.session_id))
  // No guest_id and no `now` from the body, deliberately. See the note at the top of the file.
  // The service client rides on the context so tools that read configuration (e.g. the
  // supervisor transfer target in app_settings) can consult the database; it stays optional and
  // tools fall back to the environment when it is absent (unconfigured-app path). The cast is
  // deliberate: structurally the client satisfies the narrow read the tools make, and naming
  // the full SupabaseClient generics here hits TS2589.
  const ctx: ToolContext = {
    session_id: sessionId,
    channel: 'chat',
    db: getDatabase() as unknown as ToolContext['db'],
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const emit: Emit = (event, data) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      try {
        await runTurn({ emit, ctx, sessionId, isNewSession, userText, fallbackHistory: parseHistory(body.history) })
      } catch (err) {
        emit('error', { message: GUEST_SAFE_FAILURE })
        console.error('[chat] unhandled', err instanceof Error ? err.message : String(err))
        emit('done', { message_id: newUuid(), latency_ms: null, first_token_ms: null })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          // already closed by the client disconnecting
        }
      }
    },
  })

  return new Response(stream, { headers: { ...SSE_HEADERS, 'access-control-allow-origin': '*' } })
}

// ------------------------------------------------------------------------------- inbox
//
// GET /api/chat/inbox?session_id=<uuid>&after=<iso>
//   -> { session_id, status, taken_over, messages: [{ id, content, created_at, attachment }] }
//
// The guest's widget polls this while it is open, so that a supervisor typing in the admin console
// appears in the guest's chat. There is no websocket here on purpose: the guest side is anonymous,
// Supabase Realtime would mean handing an unauthenticated browser a database subscription, and a
// four-second poll on an open widget is both cheaper to reason about and impossible to leak with.
//
// WHY THIS IS SAFE WITHOUT A LOGIN, WHICH IS THE ONLY INTERESTING THING ABOUT IT.
//
//   1. The session id is a v4 uuid minted server-side and handed to exactly one browser. It is the
//      same bearer-shaped secret POST /api/chat already trusts to continue a conversation, so this
//      route grants nothing that route did not already grant.
//   2. It returns ONLY `role = 'supervisor'` rows. Not the guest's own turns, not Sol's, and
//      emphatically not `system` -- system messages carry operational text like "ANTHROPIC_API_KEY
//      is not configured", which belongs to the supervisor console and never in front of a guest.
//      Everything this route can return was written by a signed-in member of staff *to* this guest.
//   3. `status` is a single enum, and the banner the widget draws from it is the one thing the
//      guest is entitled to know: whether they are talking to a person.
//
// So the worst an attacker with a stolen session id learns is what a supervisor typed to that
// guest -- which they could already read by continuing the conversation through POST /api/chat.

async function inbox(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const sessionId = (url.searchParams.get('session_id') ?? '').trim()
  if (!UUID_RE.test(sessionId)) {
    return jsonResponse({ error: 'session_id must be a uuid' }, 400)
  }

  const db = getDatabase()
  // Not an error. With no database configured the widget is running against the mock agent, and
  // "nobody has said anything" is the truthful answer rather than a failure to report.
  if (!db) return jsonResponse({ session_id: sessionId, status: null, taken_over: false, messages: [] })

  try {
    const session = await db.from('sessions').select('status, ended_at').eq('id', sessionId).maybeSingle()
    const status = typeof session.data?.status === 'string' ? session.data.status : null
    const endedAt = typeof session.data?.ended_at === 'string' ? session.data.ended_at : null

    let query = db
      .from('messages')
      .select('id, content, created_at, attachment')
      .eq('session_id', sessionId)
      .eq('role', 'supervisor')
      .order('created_at', { ascending: true })
      .limit(50)

    const after = url.searchParams.get('after')
    if (after && !Number.isNaN(new Date(after).getTime())) query = query.gt('created_at', after)

    let rows = (await query).data as Array<Record<string, unknown>> | null
    if (rows === null) {
      // `attachment` only exists once supabase/migrations/005_message_attachments.sql is applied.
      // Selecting a column that is not there fails the whole query, so retry without it rather
      // than leave the guest unable to receive a plain text message on an unmigrated database.
      let retry = db
        .from('messages')
        .select('id, content, created_at')
        .eq('session_id', sessionId)
        .eq('role', 'supervisor')
        .order('created_at', { ascending: true })
        .limit(50)
      if (after && !Number.isNaN(new Date(after).getTime())) retry = retry.gt('created_at', after)
      rows = ((await retry).data as Array<Record<string, unknown>> | null) ?? []
    }

    return jsonResponse({
      session_id: sessionId,
      status,
      taken_over: status === 'taken_over' && !endedAt,
      messages: (rows ?? []).map((r) => ({
        id: String(r.id),
        content: String(r.content ?? ''),
        created_at: String(r.created_at),
        attachment: (r.attachment as Record<string, unknown> | null) ?? null,
      })),
    })
  } catch (err) {
    console.warn('[chat] inbox failed', err instanceof Error ? err.message : String(err))
    // A failed poll must never break an open chat. Report nothing new and let the next poll retry.
    return jsonResponse({ session_id: sessionId, status: null, taken_over: false, messages: [] })
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  })
}

/** `/api/chat/inbox` arrives as `/.netlify/functions/chat/inbox`, and in `netlify dev` sometimes
 *  with a trailing slash. Take the last non-empty segment either way. */
function lastSegment(pathname: string): string {
  const parts = pathname.split('/').filter((p) => p.length > 0)
  return parts[parts.length - 1] ?? ''
}

// ------------------------------------------------------------------------------- turn

interface TurnInput {
  emit: Emit
  ctx: ToolContext
  sessionId: string
  isNewSession: boolean
  userText: string
  fallbackHistory: Anthropic.MessageParam[]
}

async function runTurn({ emit, ctx, sessionId, isNewSession, userText, fallbackHistory }: TurnInput): Promise<void> {
  const turnStarted = Date.now()

  // 1. The client gets the session id before anything can be slow.
  emit('session', { session_id: sessionId })

  // 2. Writes are fire-and-forget, but ORDERED: `messages.session_id` has a foreign key onto
  //    `sessions`, so racing the two inserts loses the guest's message. Chaining keeps the
  //    ordering without putting either round trip on the path the guest is waiting on.
  const sessionReady: Promise<unknown> = ensureSession(sessionId, undefined) // unconditional: see ensureSession
  void sessionReady.then(() => persistGuestMessage(sessionId, userText, isNewSession))

  // Safety, medical and legal reach a human whatever the model does next, including failing: the
  // guest's words are classified in code and escalated before the model is asked. A create_escalation
  // from the model later in the turn merges into the same row.
  const urgent = mustEscalate(intentOf(await classifyIntent({ utterance: userText }, ctx)))
  if (urgent) await escalateInCode(emit, ctx, urgent, userText, sessionReady)

  // 3. History and the session's bound identity are the only reads on the critical path, they
  //    only happen on a continuing conversation, and they happen together.
  const [history, saved] = isNewSession
    ? [fallbackHistory, null as SessionState | null]
    : await Promise.all([loadHistory(sessionId, fallbackHistory), loadSessionState(sessionId)])

  // Identity survives the turn boundary. Without this, Sol re-verifies the same guest on every
  // message, because the transcript records what it SAID, not what it KNOWS.
  if (!ctx.guest_id && saved?.guest_id) ctx.guest_id = saved.guest_id
  let verifiedLabel = saved?.guest_label ?? null

  // A HUMAN HAS THE CONVERSATION. Sol does not get a turn.
  //
  // `sessions.status = 'taken_over'` is set by POST /api/supervisor/join, or implicitly by a
  // supervisor sending their first message. This check is the entire mechanism behind that button:
  // without it, "take over" would change a chip in the admin console while Sol carried on
  // answering over the supervisor's shoulder, and the guest would get two replies to one question
  // from two different authorities. The guest's message is still recorded above -- the supervisor
  // needs to read it -- we simply do not generate against it.
  if (saved?.status === 'taken_over') {
    emit('handoff', { message: HANDOFF_NOTICE })
    emit('done', { message_id: newUuid(), latency_ms: Date.now() - turnStarted, first_token_ms: null })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    emit('error', { message: GUEST_SAFE_FAILURE })
    const id = await persistMessage(sessionId, 'system', 'ANTHROPIC_API_KEY is not configured; the chat runtime could not answer.')
    emit('done', { message_id: id, latency_ms: Date.now() - turnStarted, first_token_ms: null })
    return
  }

  const client = new Anthropic({ apiKey, maxRetries: 1 })
  const tools = anthropicTools()
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: userText }]

  let firstTokenAt: number | null = null
  // The guest sees the first tool chip long before the first word, so we measure both: the chip
  // is when the UI stops looking dead, the token is when the answer starts.
  let firstEventAt: number | null = null
  /** tool_use block ids whose "running" chip has already gone out mid-stream. */
  const announced = new Set<string>()
  let assistantText = ''
  /** Text from different tool rounds is separate utterances, never concatenated character-to-character. */
  let roundHasEmittedText = false
  let toolCalls = 0
  let failure: string | null = null
  // Cache accounting, summed across the rounds in this turn. If cache_read stays at zero across
  // repeated turns something is silently invalidating the prefix, or the prefix is below the
  // model's minimum cacheable size, and we are paying full price for the prompt every time.
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 }
  /** Cleared for the rest of the turn the first time the model rejects a tuning parameter. */
  let tuningEnabled = SEND_TUNING
  /** Urgency the model's own classify_intent found, which the guest's exact words may not carry. */
  let modelUrgent: EscalationCategory | null = null

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let message: Anthropic.Message
    roundHasEmittedText = false
    let roundEmittedAnything = false

    const openStream = (tuned: boolean) =>
      client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Adaptive thinking is the on-mode on the current models; effort and this switch, not a
        // token budget, are the latency dials. Models that reject them get a plain request.
        ...(tuned ? { thinking: THINKING, output_config: { effort: EFFORT } } : {}),
        system: systemBlocks(ctx.guest_id, verifiedLabel),
        tools,
        messages,
      })

    const consume = async (stream: ReturnType<typeof openStream>): Promise<Anthropic.Message> => {
      for await (const event of stream) {
        // A tool_use block announces its name the moment it opens, well before the message
        // finishes. Emitting the chip here rather than after finalMessage() is the difference
        // between a UI that looks alive at ~700ms and one that looks dead for two seconds.
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          announced.add(event.content_block.id)
          if (firstEventAt === null) firstEventAt = Date.now()
          roundEmittedAnything = true
          emit('tool', { name: event.content_block.name, status: 'running', summary: runningLabel(event.content_block.name), citations: [] as Citation[] })
        }
        // Thinking blocks stream too; we only forward visible text, and we never assume
        // content[0] is the text block.
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
          if (firstTokenAt === null) firstTokenAt = Date.now()
          if (firstEventAt === null) firstEventAt = Date.now()
          if (!roundHasEmittedText && assistantText.trim() !== '') {
            // A new round is speaking after an earlier one already did. Separate them.
            assistantText += PARAGRAPH_BREAK
            emit('delta', { text: PARAGRAPH_BREAK })
          }
          roundHasEmittedText = true
          roundEmittedAnything = true
          assistantText += event.delta.text
          emit('delta', { text: event.delta.text })
        }
      }

      return await stream.finalMessage()
    }

    try {
      message = await consume(openStream(tuningEnabled))
    } catch (err) {
      // A model that rejects `effort` or adaptive thinking fails the request outright, before
      // anything has been streamed, so retrying plain is safe and invisible to the guest. This
      // is what makes "swap ANTHROPIC_MODEL live" a real option rather than a broken endpoint.
      if (tuningEnabled && !roundEmittedAnything && isUnsupportedParameterError(err)) {
        console.warn(`[chat] ${MODEL} rejected the tuning parameters; retrying without them.`)
        tuningEnabled = false
        try {
          message = await consume(openStream(false))
        } catch (retryErr) {
          failure = retryErr instanceof Error ? retryErr.message : String(retryErr)
          console.error('[chat] model call failed after retry:', failure)
          emit('error', { message: GUEST_SAFE_FAILURE })
          break
        }
      } else {
        failure = err instanceof Error ? err.message : String(err)
        console.error('[chat] model call failed:', failure)
        emit('error', { message: GUEST_SAFE_FAILURE })
        break
      }
    }

    usage.input += message.usage.input_tokens ?? 0
    usage.output += message.usage.output_tokens ?? 0
    usage.cache_read += message.usage.cache_read_input_tokens ?? 0
    usage.cache_write += message.usage.cache_creation_input_tokens ?? 0

    if (message.stop_reason === 'refusal') {
      emit('error', { message: GUEST_SAFE_FAILURE })
      failure = 'model refusal'
      break
    }

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) break

    if (message.stop_reason === 'max_tokens') {
      // A tool input cut off at max_tokens can still parse, so never run it.
      emit('error', { message: GUEST_SAFE_FAILURE })
      failure = 'tool input truncated at max_tokens'
      break
    }

    // Replayed unchanged, thinking blocks included: the model needs its own turn back intact.
    messages.push({ role: 'assistant', content: message.content })

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of toolUses) {
      toolCalls++
      const args = (typeof use.input === 'object' && use.input !== null ? use.input : {}) as ToolArgs

      if (!announced.has(use.id)) {
        if (firstEventAt === null) firstEventAt = Date.now()
        emit('tool', { name: use.name, status: 'running', summary: runningLabel(use.name), citations: [] as Citation[] })
      }

      const result = await runTool(use.name, args, ctx)
      void recordToolInvocation(ctx, use.name, args, result)
      // The classified intent is the supervisor console's label for this conversation. Persist it
      // here, where the result is already in hand, fire-and-forget like every write on this path.
      if (use.name === 'classify_intent' && result.ok) {
        const classified = intentOf(result)
        if (typeof classified === 'string' && classified) void bindSessionIntent(sessionId, classified)
        modelUrgent ??= mustEscalate(classified)
      }

      // A successful verification is session state, not just a tool result.
      if (use.name === 'identify_guest' && result.ok) {
        const data = result.data as { verified?: boolean; guest?: { guest_id?: string; first_name?: string; last_name?: string } } | undefined
        if (data?.verified === true && data.guest?.guest_id) {
          ctx.guest_id = data.guest.guest_id
          verifiedLabel = [data.guest.first_name, data.guest.last_name].filter(Boolean).join(' ') || null
          void bindSessionGuest(sessionId, data.guest.guest_id, verifiedLabel)
        }
      }

      emit('tool', doneEvent(use.name, result))

      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        // The envelope goes back whole: `grounded` and `citations` are how the prompt's rules
        // bind. A tool that could not answer is a business outcome, not an execution error, so
        // it is NOT marked is_error.
        content: JSON.stringify(result),
      })
    }

    messages.push({ role: 'user', content: results })
  }

  // The model's classify_intent found urgency the guest's words did not show. Unless the model filed
  // that category itself, the runtime does: a transfer_to_human or another category does not count.
  if (modelUrgent && modelUrgent !== urgent) await escalateInCode(emit, ctx, modelUrgent, userText, sessionReady, assistantText)

  const totalMs = Date.now() - turnStarted
  const firstTokenMs = firstTokenAt === null ? null : firstTokenAt - turnStarted
  const firstEventMs = firstEventAt === null ? null : firstEventAt - turnStarted

  await sessionReady
  const messageId = assistantText.trim().length > 0 ? await persistMessage(sessionId, 'assistant', assistantText) : newUuid()

  void recordTurnMetrics(sessionId, {
    model: MODEL,
    effort: EFFORT,
    thinking: THINKING.type,
    narration: NARRATE_BEFORE_TOOLS ? 'on' : 'off',
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: usage.cache_read,
    cache_write_tokens: usage.cache_write,
    first_token_ms: firstTokenMs,
    first_event_ms: firstEventMs,
    total_ms: totalMs,
    tool_calls: toolCalls,
    failure,
  })

  emit('done', { message_id: messageId, latency_ms: totalMs, first_token_ms: firstTokenMs, first_event_ms: firstEventMs })
}

// ------------------------------------------------------------------------ system blocks

/**
 * Two blocks, in this order on purpose. The prompt and tool definitions are identical on every
 * turn and carry the cache breakpoint; anything that changes per conversation goes AFTER it, so
 * it never invalidates the cached prefix.
 */
function systemBlocks(guestId: string | undefined, label: string | null): Anthropic.TextBlockParam[] {
  // The channel line is constant for this runtime, so it lives INSIDE the cached prefix rather
  // than after the breakpoint. agent/sol.md branches on it under SPEAKING AROUND A TOOL CALL.
  const channel = [
    'CHANNEL',
    NARRATE_BEFORE_TOOLS
      ? 'This conversation is in the chat channel.'
      : 'This conversation is in the chat channel. Apart from the 911 line in an emergency, say nothing before a tool call: give one answer once the tools have returned, and never restate something you have already said in this reply.',
  ].join('\n')
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: [SYSTEM_PROMPT, channel].join(PARAGRAPH_BREAK), cache_control: { type: 'ephemeral' } },
  ]
  if (guestId) {
    blocks.push({
      type: 'text',
      text:
        `Identity already verified on this conversation: ${label ?? 'the guest'}. ` +
        'Do not ask them to verify again. The verified guest is applied to every tool automatically; ' +
        'do not pass a guest id. If they start asking about a different booking, verify that one before ' +
        'answering about it.',
    })
  }
  return blocks
}

// ------------------------------------------------------------------------ tool plumbing

let cachedTools: Anthropic.Tool[] | null = null

function anthropicTools(): Anthropic.Tool[] {
  if (cachedTools) return cachedTools
  cachedTools = toolDefinitions().map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: {
      type: 'object' as const,
      properties: def.input_schema.properties,
      required: def.input_schema.required,
    },
  }))
  return cachedTools
}

// ------------------------------------------------------------------------- enforcement

/**
 * Files a safety, medical or legal escalation through the same create_escalation handler the model
 * uses, once per session and category, and emits the chip the UI already renders, marked
 * `enforced: true`.
 */
async function escalateInCode(
  emit: Emit,
  ctx: ToolContext,
  category: EscalationCategory,
  guestText: string,
  sessionReady: Promise<unknown>,
  reply = '',
): Promise<void> {
  await sessionReady // escalations.session_id references the sessions row
  if (await hasOpenEscalation(ctx.session_id, category)) return

  const guest = redactText(guestText)
  const args: ToolArgs = {
    category,
    summary: `Raised by the chat runtime (${category}): "${guest.slice(0, 300)}"`,
    transcript_excerpt: `Guest: ${guest}${reply ? `\nSol: ${redactText(reply)}` : ''}`.slice(0, 1200),
    attempted_resolutions: ['Raised automatically by the chat runtime from the guest message; Sol may add detail.'],
  }
  emit('tool', { name: 'create_escalation', status: 'running', summary: runningLabel('create_escalation'), citations: [] as Citation[], enforced: true })
  const result = await runTool('create_escalation', args, ctx)
  await recordToolInvocation(ctx, 'create_escalation', args, result)
  emit('tool', { ...doneEvent('create_escalation', result), enforced: true })
}

/** The `tool` done event: the chip, plus the envelope fields a reader of the stream checks it against. */
function doneEvent(name: string, result: ToolResult): Record<string, unknown> {
  const data = result.data as { may_promise?: boolean; authority_required?: string } | undefined
  return {
    name,
    status: 'done',
    summary: summarize(name, result),
    citations: result.citations ?? [],
    grounded: result.grounded,
    may_promise: data?.may_promise ?? null,
    ...(name === 'create_escalation' ? { authority_required: data?.authority_required ?? null } : {}),
  }
}

function intentOf(result: { data?: unknown }): unknown {
  return (result.data as { intent?: unknown } | undefined)?.intent
}

/** Same rule as create_escalation's own merge: an open row of this category already covers it. */
async function hasOpenEscalation(sessionId: string | undefined, category: EscalationCategory): Promise<boolean> {
  try {
    const db = getDatabase()
    if (!db || !sessionId) return false
    const { data } = await db.from('escalations').select('id,category,status').eq('session_id', sessionId)
    return mergeTargetFor(data as Array<{ id: string; category: string; status: string }> | null, category) !== null
  } catch {
    return false
  }
}

// ------------------------------------------------------------------------- persistence
//
// Every write below is best effort. AGENTS.md is explicit that the schema may not be applied
// yet, and a missing table must degrade the dashboard, never the conversation.

/**
 * The `sessions` row every other write depends on, attempted on every turn: a well-formed uuid the
 * caller invented has no row, and without one every child insert fails its foreign key silently.
 * A duplicate key is success, so a continuing conversation pays one rejected insert nothing awaits.
 */
async function ensureSession(sessionId: string, guestId: string | undefined): Promise<void> {
  try {
    const db = getDatabase()
    if (!db) return
    const { error } = await db.from('sessions').insert({
      id: sessionId,
      channel: 'chat',
      guest_id: guestId ?? null,
      guest_label: null,
      status: 'active',
    })
    if (error && !/duplicate key/i.test(error.message)) console.warn('[chat] session insert:', error.message)
  } catch (err) {
    console.warn('[chat] session insert failed:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * The guest's own turn, written once even when the client retries.
 *
 * A dropped SSE stream makes the browser re-POST the same { session_id, message }, and an
 * unconditional insert then shows the guest saying the same thing twice on the supervisor's
 * split screen. There is no idempotency column on `messages` to key off, so we look for an
 * identical turn in the last DEDUPE_WINDOW_MS and skip the insert if one is already there.
 *
 * The tradeoff, stated plainly: a guest who genuinely types "yes" twice inside the window loses
 * the second one from the transcript. A duplicated turn is the more visible failure, and the
 * conversation itself is unaffected either way. If the client ever sends a per-turn id, key on
 * that instead and delete this.
 */
const DEDUPE_WINDOW_MS = 30_000

async function persistGuestMessage(sessionId: string, content: string, isNewSession: boolean): Promise<string> {
  if (!isNewSession) {
    try {
      const db = getDatabase()
      if (db) {
        const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
        const { data, error } = await db
          .from('messages')
          .select('id')
          .eq('session_id', sessionId)
          .eq('role', 'user')
          .eq('content', content)
          .gte('created_at', since)
          .limit(1)
        if (!error && Array.isArray(data) && data.length > 0) {
          const existing = data[0] as { id?: unknown }
          return typeof existing.id === 'string' ? existing.id : newUuid()
        }
      }
    } catch {
      // If the check itself fails, fall through and insert: losing the guest's message is worse
      // than showing it twice.
    }
  }
  return persistMessage(sessionId, 'user', content)
}

async function persistMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): Promise<string> {
  const localId = newUuid()
  try {
    const db = getDatabase()
    if (!db) return localId
    const { data, error } = await db.from('messages').insert({ session_id: sessionId, role, content }).select('id').single()
    if (error) {
      console.warn('[chat] message insert:', error.message)
      return localId
    }
    return typeof data?.id === 'string' ? data.id : localId
  } catch (err) {
    console.warn('[chat] message insert failed:', err instanceof Error ? err.message : String(err))
    return localId
  }
}

interface SessionState {
  guest_id: string | null
  guest_label: string | null
  /** 'taken_over' means a human is answering and Sol must not. See standDown() above. */
  status: string | null
}

async function loadSessionState(sessionId: string): Promise<SessionState | null> {
  try {
    const db = getDatabase()
    if (!db) return null
    // `status` rides along on a read that was already happening, so the takeover check costs no
    // extra round trip on the guest's critical path.
    const { data, error } = await db.from('sessions').select('guest_id, guest_label, status').eq('id', sessionId).maybeSingle()
    if (error || !data) return null
    return {
      guest_id: typeof data.guest_id === 'string' ? data.guest_id : null,
      guest_label: typeof data.guest_label === 'string' ? data.guest_label : null,
      status: typeof data.status === 'string' ? data.status : null,
    }
  } catch {
    return null
  }
}

/** Writes the verified identity onto the session so the next turn, and the supervisor console,
 *  both know who this is. Best effort, like every other write here. */
async function bindSessionGuest(sessionId: string, guestId: string, label: string | null): Promise<void> {
  try {
    const db = getDatabase()
    if (!db) return
    await db.from('sessions').update({ guest_id: guestId, guest_label: label }).eq('id', sessionId)
  } catch {
    // the conversation matters more than the label
  }
}

/** Writes the classified intent onto the session, which is what the supervisor console labels the
 *  conversation with. Best effort: a label is not worth failing a turn for. */
async function bindSessionIntent(sessionId: string, intent: string): Promise<void> {
  try {
    const db = getDatabase()
    if (!db) return
    await db.from('sessions').update({ intent }).eq('id', sessionId)
  } catch {
    // the conversation matters more than the label
  }
}

async function loadHistory(sessionId: string, fallback: Anthropic.MessageParam[]): Promise<Anthropic.MessageParam[]> {
  try {
    const db = getDatabase()
    if (!db) return fallback
    const { data, error } = await db
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: true })
      .limit(HISTORY_LIMIT)
    if (error || !data) return fallback
    const rows = data as Array<{ role: string; content: string }>
    // A session whose rows have not landed yet (or whose schema is not applied) must still hold
    // a conversation if the client carried one.
    if (rows.length === 0) return fallback
    const out: Anthropic.MessageParam[] = []
    for (const row of rows) {
      if (row.role !== 'user' && row.role !== 'assistant') continue
      if (typeof row.content !== 'string' || row.content.trim() === '') continue
      // Consecutive same-role rows would be rejected by the API; fold them.
      const last = out[out.length - 1]
      if (last && last.role === row.role) {
        last.content = `${String(last.content)}\n${row.content}`
        continue
      }
      out.push({ role: row.role, content: row.content })
    }
    // A conversation replayed to the model must start with a user turn.
    while (out.length > 0 && out[0].role !== 'user') out.shift()
    return out
  } catch {
    return fallback
  }
}

/**
 * Turn latency lands in `tool_invocations` rather than a table of its own, so the supervisor
 * sees it inline with the tool trace and no schema change is needed. Filter on
 * `tool = 'turn_metrics'` to separate it from the guest-facing chips.
 */
async function recordTurnMetrics(sessionId: string, metrics: Record<string, unknown>): Promise<void> {
  // Always emit to the function log too: it is the only place these numbers exist when Supabase
  // is not configured, and in production it is what you grep after a slow demo.
  console.log('[chat] turn_metrics', JSON.stringify({ session_id: sessionId, ...metrics }))
  try {
    const db = getDatabase()
    if (!db) return
    const first = metrics.first_token_ms
    const firstEvent = metrics.first_event_ms
    await db.from('tool_invocations').insert({
      session_id: sessionId,
      tool: 'turn_metrics',
      args_masked: metrics,
      result_summary:
        typeof first === 'number'
          ? `first event ${String(firstEvent)}ms, first token ${first}ms, turn ${String(metrics.total_ms)}ms, ${String(metrics.tool_calls)} tool calls`
          : `turn ${String(metrics.total_ms)}ms, no text produced`,
      grounded: metrics.failure === null,
      latency_ms: typeof metrics.total_ms === 'number' ? metrics.total_ms : null,
    })
  } catch {
    // observability is never worth a dropped turn
  }
}

// ----------------------------------------------------------------------------- helpers

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** The column is `uuid`; anything else is rejected by Postgres, not coerced. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A malformed session id is treated as an absent one. Postgres rejects a non-uuid, and on these
 * fire-and-forget writes that rejection would leave a conversation with nothing recorded.
 */
export function resolveSessionId(raw: string | null | undefined): {
  sessionId: string
  isNewSession: boolean
} {
  if (raw && UUID_RE.test(raw)) return { sessionId: raw, isNewSession: false }
  return { sessionId: newUuid(), isNewSession: true }
}

function newUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  // Fallback for a runtime without WebCrypto. Shape matters (the column is uuid), not entropy.
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

/** Only used when Supabase is not configured, so a local demo still holds a conversation. */
function parseHistory(raw: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(raw)) return []
  const out: Anthropic.MessageParam[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const role = row.role
    const content = row.content
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim() !== '') {
      out.push({ role, content })
    }
  }
  while (out.length > 0 && out[0].role !== 'user') out.shift()
  return out.slice(-HISTORY_LIMIT)
}
