// Response helpers shared by the telnyx webhook and the voice endpoints.

export function json<T = unknown>(body: T, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

export function noContent(status = 204): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Telnyx retries any non-2xx webhook response. Once we have decided an event is ours and have
 * done what we can with it, we acknowledge even if a downstream write failed, and surface the
 * problem in logs instead. A retry storm during a live demo is worse than a lost trace row.
 */
export function ack(note: string, detail?: Record<string, unknown>): Response {
  return json({ ok: true, note, ...(detail ?? {}) }, 200)
}

export async function readJsonBody<T>(req: Request): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let text: string
  try {
    text = await req.text()
  } catch (err) {
    return { ok: false, error: `could not read request body: ${(err as Error).message}` }
  }
  if (!text.trim()) return { ok: false, error: 'request body is empty' }
  try {
    return { ok: true, value: JSON.parse(text) as T }
  } catch {
    return { ok: false, error: 'request body is not valid JSON' }
  }
}
