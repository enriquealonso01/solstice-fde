/**
 * Wire client for `POST /api/chat`.
 *
 * Request  : { session_id?: string, message: string }
 * Response : text/event-stream carrying named events
 *
 *   event: session   data: { "session_id": "..." }
 *   event: delta     data: { "text": "..." }
 *   event: tool      data: { "name": "...", "status": "running"|"done",
 *                            "summary": "...", "citations": [...] }
 *   event: done      data: { "message_id": "..." }
 *   event: error     data: { "message": "..." }
 *
 * The server side is built by another agent. This file is the only place that
 * knows the wire format; everything above it consumes `ChatStreamEvent`.
 */
import type { Citation } from '../../shared/types'

export interface ChatRequest {
  session_id?: string
  message: string
}

/* ------------------------------------------------------------------ *
 * Wire events (exactly the five the server emits)                      *
 * ------------------------------------------------------------------ */

export interface SessionEvent {
  type: 'session'
  session_id: string
}
export interface DeltaEvent {
  type: 'delta'
  text: string
}
export interface ToolEvent {
  type: 'tool'
  name: string
  status: 'running' | 'done'
  summary: string
  /** Normalised to [] when the server omits it. */
  citations: Citation[]
}
export interface DoneEvent {
  type: 'done'
  message_id: string
}
export interface ErrorEvent {
  type: 'error'
  message: string
}

export type ChatWireEvent = SessionEvent | DeltaEvent | ToolEvent | DoneEvent | ErrorEvent

/* ------------------------------------------------------------------ *
 * Local lifecycle events (never sent by the server)                    *
 * ------------------------------------------------------------------ */

/** Emitted before a retry so the UI can discard the half-streamed reply. */
export interface ReconnectEvent {
  type: 'reconnect'
  attempt: number
  delay_ms: number
}
/** Emitted once per turn so the UI can say whether it reached a real server. */
export interface TransportEvent {
  type: 'transport'
  mode: 'live' | 'mock'
  reason?: string
}

export type ChatStreamEvent = ChatWireEvent | ReconnectEvent | TransportEvent

export type TransportErrorKind = 'network' | 'http' | 'protocol' | 'truncated'

export class ChatTransportError extends Error {
  readonly kind: TransportErrorKind
  readonly status?: number

  constructor(message: string, kind: TransportErrorKind, status?: number) {
    super(message)
    this.name = 'ChatTransportError'
    this.kind = kind
    this.status = status
  }
}

export interface StreamChatOptions {
  endpoint?: string
  signal?: AbortSignal
  /** Transport retries after a dropped stream. Not retries of a server `error` event. */
  maxRetries?: number
  retryBaseMs?: number
  /**
   * Used when `/api/chat` is not reachable yet (dev server, 404, or an HTML
   * response), so the panel is demonstrable before the server lands.
   */
  fallback?: (request: ChatRequest) => AsyncIterable<ChatWireEvent>
  /** Skip the network entirely. Wired to `?mock=1` by the widget. */
  forceMock?: boolean
}

const DEFAULT_ENDPOINT = '/api/chat'

/**
 * Streams one assistant turn.
 *
 * Reconnect semantics: if the transport drops before `done`, the same
 * `{ session_id, message }` is POSTed again. The server must therefore treat a
 * repeat of the same message on the same session within a few seconds as a
 * resume rather than a second guest turn. Consumers reset the in-flight reply
 * when they see a `reconnect` event.
 */
export async function* streamChat(
  request: ChatRequest,
  options: StreamChatOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const {
    endpoint = DEFAULT_ENDPOINT,
    signal,
    maxRetries = 2,
    retryBaseMs = 600,
    fallback,
    forceMock = false,
  } = options

  let sessionId = request.session_id

  if (forceMock) {
    if (!fallback) {
      yield { type: 'error', message: 'Mock transport requested but no fallback was supplied.' }
      return
    }
    yield { type: 'transport', mode: 'mock', reason: 'forced' }
    yield* fallback({ session_id: sessionId, message: request.message })
    return
  }

  for (let attempt = 0; ; ) {
    let sawAnyEvent = false
    let closedCleanly = false

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ session_id: sessionId, message: request.message }),
        signal,
      }).catch((cause: unknown) => {
        throw new ChatTransportError(describeCause(cause, 'Could not reach the chat service.'), 'network')
      })

      if (!response.ok) {
        throw new ChatTransportError(
          'The chat service answered ' + String(response.status) + '.',
          'http',
          response.status,
        )
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().includes('text/event-stream')) {
        throw new ChatTransportError(
          'The chat service answered with "' +
            (contentType || 'no content type') +
            '" instead of an event stream.',
          'protocol',
        )
      }

      yield { type: 'transport', mode: 'live' }

      for await (const event of readEventStream(response)) {
        sawAnyEvent = true
        if (event.type === 'session') sessionId = event.session_id
        if (event.type === 'done' || event.type === 'error') closedCleanly = true
        yield event
      }

      if (closedCleanly) return

      throw new ChatTransportError('The reply ended before Sol finished.', 'truncated')
    } catch (cause: unknown) {
      if (signal?.aborted) return

      const error =
        cause instanceof ChatTransportError
          ? cause
          : new ChatTransportError(describeCause(cause, 'The chat stream failed.'), 'network')

      // No server yet? Show the scripted agent instead of an error wall.
      if (fallback && attempt === 0 && !sawAnyEvent && looksLikeMissingEndpoint(error)) {
        yield { type: 'transport', mode: 'mock', reason: error.message }
        yield* fallback({ session_id: sessionId, message: request.message })
        return
      }

      attempt += 1
      if (attempt > maxRetries) {
        yield { type: 'error', message: guestFacingMessage(error) }
        return
      }

      const delayMs = retryBaseMs * 2 ** (attempt - 1)
      yield { type: 'reconnect', attempt, delay_ms: delayMs }
      await sleep(delayMs, signal)
      if (signal?.aborted) return
    }
  }
}

/* ------------------------------------------------------------------ *
 * SSE parsing                                                          *
 * ------------------------------------------------------------------ */

async function* readEventStream(response: Response): AsyncGenerator<ChatWireEvent> {
  const body = response.body
  if (!body) throw new ChatTransportError('The chat stream carried no body.', 'protocol')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break

      // Re-normalising the whole buffer each pass is self-healing when a CRLF
      // is split across two network chunks.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')

      for (;;) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary === -1) break
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = toWireEvent(parseBlock(block))
        if (event) yield event
      }
    }

    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n')
    const tail = toWireEvent(parseBlock(buffer))
    if (tail) yield tail
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

interface RawEvent {
  name: string
  data: string
}

function parseBlock(block: string): RawEvent | null {
  if (!block.trim()) return null

  let name = 'message'
  const data: string[] = []

  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
    // `id` and `retry` are accepted and ignored: a POST stream cannot be
    // resumed with Last-Event-ID, so we re-POST instead.
  }

  if (data.length === 0) return null
  return { name, data: data.join('\n') }
}

function toWireEvent(raw: RawEvent | null): ChatWireEvent | null {
  if (!raw) return null

  let payload: unknown
  try {
    payload = JSON.parse(raw.data)
  } catch {
    // A malformed frame should not kill the turn; skip it.
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as Record<string, unknown>

  switch (raw.name) {
    case 'session':
      return typeof body.session_id === 'string' ? { type: 'session', session_id: body.session_id } : null

    case 'delta':
      return typeof body.text === 'string' ? { type: 'delta', text: body.text } : null

    case 'tool': {
      const name = typeof body.name === 'string' ? body.name : null
      const status = body.status === 'running' || body.status === 'done' ? body.status : null
      if (!name || !status) return null
      return {
        type: 'tool',
        name,
        status,
        summary: typeof body.summary === 'string' ? body.summary : '',
        citations: normaliseCitations(body.citations),
      }
    }

    case 'done':
      return { type: 'done', message_id: typeof body.message_id === 'string' ? body.message_id : '' }

    case 'error':
      return {
        type: 'error',
        message: typeof body.message === 'string' ? body.message : 'The chat service reported an error.',
      }

    default:
      // Unknown event names are forward-compatible no-ops.
      return null
  }
}

function normaliseCitations(input: unknown): Citation[] {
  if (!Array.isArray(input)) return []
  const out: Citation[] = []
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue
    const candidate = item as Record<string, unknown>
    const ref = typeof candidate.ref === 'string' ? candidate.ref : null
    if (!ref) continue
    out.push({
      source: isCitationSource(candidate.source) ? candidate.source : 'policy',
      ref,
      label: typeof candidate.label === 'string' && candidate.label ? candidate.label : ref,
    })
  }
  return out
}

function isCitationSource(value: unknown): value is Citation['source'] {
  return (
    value === 'policy' ||
    value === 'property' ||
    value === 'reservation' ||
    value === 'guest' ||
    value === 'inquiry'
  )
}

/* ------------------------------------------------------------------ *
 * Helpers                                                              *
 * ------------------------------------------------------------------ */

function looksLikeMissingEndpoint(error: ChatTransportError): boolean {
  if (error.kind === 'network') return true
  // `vite dev` with no functions runtime serves index.html for /api/chat.
  if (error.kind === 'protocol') return true
  if (error.kind === 'http') return error.status === 404 || error.status === 405 || error.status === 501
  return false
}

function guestFacingMessage(error: ChatTransportError): string {
  switch (error.kind) {
    case 'network':
      return 'Sol lost the connection. Check your network and try again.'
    case 'truncated':
      return 'Sol was cut off mid-answer. Try that once more.'
    case 'http':
      return error.status !== undefined && error.status >= 500
        ? 'Sol is having trouble on our side. Please try again in a moment.'
        : 'Sol could not start that conversation.'
    default:
      return 'Sol could not complete that reply.'
  }
}

function describeCause(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message
  return fallback
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
