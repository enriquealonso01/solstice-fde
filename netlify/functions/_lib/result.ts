// Builders for the ToolResult envelope (shared/types.ts). Every tool in the system returns
// one of these, and the agent's contract is simple:
//
//   grounded: true   -> there is data AND at least one citation behind it. Say it.
//   grounded: false  -> we could not confirm it. Escalate or ask. NEVER improvise.
//
// The invariant is enforced here in code, not in a prompt: `grounded()` downgrades itself to
// an ungrounded result if you hand it an empty citation list. A tool physically cannot claim
// to be grounded without naming its source.

import type { Citation, ToolResult } from '../../../shared/types'
import { maskArgs } from './mask'

export interface ResultOpts {
  /** Milliseconds. Usually supplied by `withTiming` / `runTool`. */
  latency_ms?: number
  /** Dotted field paths that were masked before leaving the tool layer. */
  masked_fields?: string[]
}

/** Starts a stopwatch. `const done = timer(); ... done() // => 42` */
export function timer(): () => number {
  const t0 = Date.now()
  return () => Date.now() - t0
}

export function cite(source: Citation['source'], ref: string, label: string): Citation {
  return { source, ref, label }
}

/** Citation builders, so refs are spelled identically everywhere they are produced. */
export const citations = {
  policy: (section: number | string, title?: string): Citation =>
    cite(
      'policy',
      typeof section === 'number' ? `policy:${section}` : section,
      title ? `Front Desk Policy ${String(section).replace('policy:', '')}: ${title}` : `Front Desk Policy ${String(section).replace('policy:', '')}`,
    ),
  property: (code: string, name?: string): Citation =>
    cite('property', `property:${code}`, name ? `${name} (property record)` : `Property ${code}`),
  reservation: (id: string): Citation => cite('reservation', `reservation:${id}`, `Reservation ${id}`),
  guest: (id: string): Citation => cite('guest', `guest:${id}`, `Guest profile ${id}`),
  inquiry: (id: string): Citation => cite('inquiry', `inquiry:${id}`, `Group inquiry ${id}`),
  rule: (ruleId: string, label?: string): Citation =>
    // Rules are derived from the property record, so they cite as `property`.
    cite('property', `property:${ruleId.split('.')[0]}`, label ? `${label} (${ruleId})` : ruleId),
}

/** A confirmed answer with its sources. An empty `sources` array is a bug, and is treated as
 *  one: the result comes back ungrounded so the agent escalates instead of asserting. */
export function grounded<T>(data: T, sources: Citation[], opts: ResultOpts = {}): ToolResult<T> {
  if (!sources || sources.length === 0) {
    return {
      ok: true,
      grounded: false,
      error:
        'Tool produced data but named no source, so it cannot be treated as confirmed. Escalate or ask the guest rather than stating this.',
      ...opts,
    }
  }
  return { ok: true, data, grounded: true, citations: sources, ...opts }
}

/** The tool ran fine but cannot confirm the answer: no match, quarantined data, out of scope.
 *  `ok: true` because nothing broke; `grounded: false` because the agent must not assert it. */
export function ungrounded<T = never>(
  reason: string,
  opts: ResultOpts & { citations?: Citation[] } = {},
): ToolResult<T> {
  const { citations: sources, ...rest } = opts
  return { ok: true, grounded: false, error: reason, ...(sources?.length ? { citations: sources } : {}), ...rest }
}

/** The tool itself failed: bad input, missing table, upstream outage. */
export function toolError<T = never>(message: string, opts: ResultOpts = {}): ToolResult<T> {
  return { ok: false, grounded: false, error: message, ...opts }
}

/** Runs a tool body, stamping latency and converting any throw into a clean envelope.
 *  Nothing below this line is allowed to reach the model as a stack trace. */
export async function runTool<T>(
  name: string,
  body: () => ToolResult<T> | Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  const done = timer()
  try {
    const result = await body()
    return { ...result, latency_ms: result.latency_ms ?? done() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return toolError(`${name} failed: ${message}`, { latency_ms: done() })
  }
}

// ------------------------------------------------------------- A3 compatibility surface
// `netlify/functions/tools/_deps.ts` declares the contract it expects from this module:
//   ok(data, { citations?, masked_fields? })   fail(error, { citations? })
// Both are implemented here so that boundary file never has to change.

export interface EnvelopeOptions extends ResultOpts {
  citations?: Citation[]
}

/** Success with data. NOTE: `grounded` is derived, not assumed. Calling `ok(data)` with no
 *  citations yields `grounded: false` and an explanatory `error`, because a tool that cannot
 *  name its source has not grounded anything. Pass citations whenever the answer came from
 *  policy, property, reservation, guest or inquiry data. */
export function ok<T>(data: T, opts: EnvelopeOptions = {}): ToolResult<T> {
  const sources = opts.citations ?? []
  return {
    ok: true,
    data,
    grounded: sources.length > 0,
    ...(sources.length > 0 ? { citations: sources } : {}),
    ...(opts.masked_fields?.length ? { masked_fields: opts.masked_fields } : {}),
    ...(opts.latency_ms !== undefined ? { latency_ms: opts.latency_ms } : {}),
    ...(sources.length === 0
      ? {
          error:
            'No citation was supplied, so this result is not grounded and the agent must not assert it. Pass `citations` to ok().',
        }
      : {}),
  }
}

/** Hard failure. The agent says so and escalates; it never fills the gap itself. */
export function fail<T = never>(error: string, opts: EnvelopeOptions = {}): ToolResult<T> {
  const sources = opts.citations ?? []
  return {
    ok: false,
    grounded: false,
    error,
    ...(sources.length > 0 ? { citations: sources } : {}),
    ...(opts.masked_fields?.length ? { masked_fields: opts.masked_fields } : {}),
    ...(opts.latency_ms !== undefined ? { latency_ms: opts.latency_ms } : {}),
  }
}

/** Shapes a tool call for `tool_invocations`, with arguments masked on the way in.
 *  The admin trace renders this, so it must never carry raw PII. */
export function toInvocationRow(
  sessionId: string | null,
  tool: string,
  args: unknown,
  result: ToolResult<unknown>,
): {
  session_id: string | null
  tool: string
  args_masked: unknown
  result_summary: string
  grounded: boolean
  latency_ms: number | null
} {
  const { masked } = maskArgs(args)
  return {
    session_id: sessionId,
    tool,
    args_masked: masked,
    result_summary: summarize(result),
    grounded: result.grounded,
    latency_ms: result.latency_ms ?? null,
  }
}

function summarize(result: ToolResult<unknown>): string {
  if (!result.ok) return `error: ${result.error ?? 'unknown'}`
  if (!result.grounded) return `ungrounded: ${result.error ?? 'no confirmed answer'}`
  const refs = (result.citations ?? []).map((c) => c.ref).join(', ')
  return refs ? `grounded via ${refs}` : 'grounded'
}
