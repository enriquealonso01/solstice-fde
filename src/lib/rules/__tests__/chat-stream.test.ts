// The /api/chat contract the widget and the guardrail eval both parse: a session event first, and a
// turn that cannot reach the model ends in a guest-safe error followed by done, never in silence.
import { describe, expect, it } from 'vitest'
import type { Context } from '@netlify/functions'
import handler from '../../../../netlify/functions/chat'

const post = (body: unknown) =>
  handler(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) }), {} as Context)

async function events(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => ({
      event: /^event: (.+)$/m.exec(frame)?.[1] ?? '',
      data: JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] ?? '{}') as Record<string, unknown>,
    }))
}

describe('/api/chat', () => {
  it('refuses a GET with 405, so a health check opens no session', async () => {
    const res = await handler(new Request('http://localhost/api/chat'), {} as Context)
    expect(res.status).toBe(405)
  })

  it('refuses a body with no message', async () => {
    expect((await post({ session_id: null })).status).toBe(400)
  })

  it('without a model key, streams session, a guest-safe error, then done', async () => {
    const res = await post({ message: 'What time is check-in?' })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const stream = await events(res)
    expect(stream.map((e) => e.event)).toEqual(['session', 'error', 'done'])
    expect(stream[0].data.session_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(String(stream[1].data.message)).not.toMatch(/ANTHROPIC|api key|stack/i)
  })
})
