// POST /api/chat — Sol's chat channel.
//
// A Claude tool-use loop streamed to the browser as Server-Sent Events. The event names are a
// contract with the browser client (A2) and with the supervisor console:
//
//   session  { session_id }
//   delta    { text }
//   tool     { name, status: "running" | "done", summary, citations }
//   done     { message_id, latency_ms, first_token_ms, first_event_ms }
//   error    { message }
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
// Be honest about which number is which. Measured against the live API on a turn that calls one
// tool: first chip lands well inside the budget; the first WORD of prose lands afterwards,
// because the model has to see the tool result before it can answer. `done` carries both, and
// both are written to `tool_invocations` as a `turn_metrics` row, so the dashboard shows the
// number the guest actually experienced rather than one from a load test.
//
// THE KEY MAY FAIL. If the Anthropic call errors, we emit `error` with a guest-safe line and
// then `done`, so the client re-enables input instead of hanging. We never fabricate a reply.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { Context } from '@netlify/functions'
import type { Citation } from '../../shared/types'
import { getDatabase } from './tools/_deps'
import type { ToolArgs, ToolContext } from './tools/helpers'
import { recordToolInvocation, runningLabel, runTool, summarize, toolDefinitions } from './tools/registry'
import { SOL_SYSTEM_BEGIN, SOL_SYSTEM_END, SOL_SYSTEM_PROMPT } from './tools/solPrompt'

// ------------------------------------------------------------------------------ config

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number.parseInt(process.env.SOL_MAX_TOKENS ?? '4096', 10)
/** Concierge turns are short. Low effort keeps time-to-first-token inside the budget; raise it
 *  with SOL_EFFORT if the panel wants to see the tradeoff live. */
const EFFORT = (process.env.SOL_EFFORT ?? 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/**
 * Adaptive thinking costs roughly a second before the first token and buys better tool choice.
 * It is on by default and SOL_THINKING=disabled turns it off, which is the latency dial we can
 * move live if the room is unforgiving about the pause.
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

// -------------------------------------------------------------------------- the prompt
//
// The agent definition is agent/sol.md. We read it at request time so the .md really is the
// source of truth rather than documentation written after the fact, and fall back to the
// compiled copy when the markdown is not in the deployed bundle.

let cachedPrompt: string | null = null

function systemPrompt(): string {
  if (cachedPrompt) return cachedPrompt
  cachedPrompt = readPromptFromMarkdown() ?? SOL_SYSTEM_PROMPT
  return cachedPrompt
}

function readPromptFromMarkdown(): string | null {
  // A bundled function may not ship the markdown, which is exactly why solPrompt.ts exists.
  const candidates = [
    join(process.cwd(), 'agent', 'sol.md'),
    join(process.cwd(), '..', 'agent', 'sol.md'),
    join(process.cwd(), '..', '..', 'agent', 'sol.md'),
  ]
  for (const path of candidates) {
    try {
      const md = readFileSync(path, 'utf8')
      const start = md.indexOf(SOL_SYSTEM_BEGIN)
      const end = md.indexOf(SOL_SYSTEM_END)
      if (start >= 0 && end > start) {
        const body = md.slice(start + SOL_SYSTEM_BEGIN.length, end).trim()
        if (body.length > 0) return body
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

// ------------------------------------------------------------------------------- SSE

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Netlify's edge and most proxies buffer by default, which would defeat the whole point.
  'x-accel-buffering': 'no',
}

type Emit = (event: 'session' | 'delta' | 'tool' | 'done' | 'error', data: unknown) => void

// ------------------------------------------------------------------------------ handler

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' },
    })
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
  const ctx: ToolContext = { session_id: sessionId, channel: 'chat' }

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
  const sessionReady: Promise<unknown> = isNewSession ? ensureSession(sessionId, undefined) : Promise.resolve()
  void sessionReady.then(() => persistGuestMessage(sessionId, userText, isNewSession))

  // 3. History and the session's bound identity are the only reads on the critical path, they
  //    only happen on a continuing conversation, and they happen together.
  const [history, saved] = isNewSession
    ? [fallbackHistory, null as SessionState | null]
    : await Promise.all([loadHistory(sessionId, fallbackHistory), loadSessionState(sessionId)])

  // Identity survives the turn boundary. Without this, Sol re-verifies the same guest on every
  // message, because the transcript records what it SAID, not what it KNOWS.
  if (!ctx.guest_id && saved?.guest_id) ctx.guest_id = saved.guest_id
  let verifiedLabel = saved?.guest_label ?? null

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
  /**
   * The model can speak in more than one round: a phrase before a tool call, the answer after
   * it. Those are separate utterances and must never be concatenated character-to-character,
   * which is what produced "...review it for you.This is now with our AGM...". Belt and braces
   * behind the prompt-level fix: whatever the model does, the transcript stays readable.
   */
  let roundHasEmittedText = false
  let toolCalls = 0
  let failure: string | null = null
  // Cache accounting, summed across the rounds in this turn. If cache_read stays at zero across
  // repeated turns something is silently invalidating the prefix, or the prefix is below the
  // model's minimum cacheable size, and we are paying full price for the prompt every time.
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 }
  /** Cleared for the rest of the turn the first time the model rejects a tuning parameter. */
  let tuningEnabled = SEND_TUNING

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

      // A successful verification is session state, not just a tool result.
      if (use.name === 'identify_guest' && result.ok) {
        const data = result.data as { verified?: boolean; guest?: { guest_id?: string; first_name?: string; last_name?: string } } | undefined
        if (data?.verified === true && data.guest?.guest_id) {
          ctx.guest_id = data.guest.guest_id
          verifiedLabel = [data.guest.first_name, data.guest.last_name].filter(Boolean).join(' ') || null
          void bindSessionGuest(sessionId, data.guest.guest_id, verifiedLabel)
        }
      }

      emit('tool', {
        name: use.name,
        status: 'done',
        summary: summarize(use.name, result),
        citations: result.citations ?? [],
      })

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
      : 'This conversation is in the chat channel. Say nothing before a tool call: give one answer once the tools have returned, and never restate something you have already said in this reply.',
  ].join('\n')
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: [systemPrompt(), channel].join(PARAGRAPH_BREAK), cache_control: { type: 'ephemeral' } },
  ]
  if (guestId) {
    blocks.push({
      type: 'text',
      text:
        `Identity already verified on this conversation: ${label ?? 'the guest'} (guest id ${guestId}). ` +
        'Do not ask them to verify again. Pass this guest id to any tool that takes one, and if they ' +
        'start asking about a different booking, verify that one before answering about it.',
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

// ------------------------------------------------------------------------- persistence
//
// Every write below is best effort. AGENTS.md is explicit that the schema may not be applied
// yet, and a missing table must degrade the dashboard, never the conversation.

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
}

async function loadSessionState(sessionId: string): Promise<SessionState | null> {
  try {
    const db = getDatabase()
    if (!db) return null
    const { data, error } = await db.from('sessions').select('guest_id, guest_label').eq('id', sessionId).maybeSingle()
    if (error || !data) return null
    return {
      guest_id: typeof data.guest_id === 'string' ? data.guest_id : null,
      guest_label: typeof data.guest_label === 'string' ? data.guest_label : null,
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
 * A caller-supplied session id is only usable if Postgres will accept it.
 *
 * Every write on this path is fire-and-forget so a turn is never held up by the database. That is
 * the right trade for latency and the wrong one for trust: a non-uuid id is rejected with `22P02`
 * and the rejection is swallowed, so the caller gets a fully working conversation that writes no
 * session, no messages and **no `tool_invocations` at all**. The agent answers, the tools run, and
 * nothing is recorded — which contradicts the guarantee that every tool call is traced, the thing
 * the supervisor screen and the audit story both rest on.
 *
 * So a malformed id is treated exactly as an absent one: mint a fresh session rather than trust it.
 * A client that sends rubbish loses continuity, which is its own fault and is visible to it in the
 * `session` event; it does not get to opt out of being recorded. This also stops that event
 * echoing caller-controlled text straight back.
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
