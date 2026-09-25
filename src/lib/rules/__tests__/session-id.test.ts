/**
 * A malformed `session_id` must not buy an untraced conversation.
 *
 * `/api/chat` accepted any string as a session id. The column is `uuid`, so Postgres rejected a
 * non-uuid with `22P02` — and because every write on that path is fire-and-forget for latency, the
 * rejection was swallowed. The caller got a fully working answer, the tools really ran, and
 * nothing at all was written: no session, no messages, no `tool_invocations`.
 *
 * Reproduced in production before fixing: one turn with `session_id: "i-am-not-a-uuid"` streamed
 * four tool events while the row count stayed at 308. That contradicts the guarantee that every
 * tool call is recorded, which is what the supervisor screen and the audit trail both rest on.
 *
 * The fix treats a malformed id exactly like an absent one. These tests pin the two halves that
 * matter: a good id is still honoured, so continuity is not broken for real clients, and anything
 * else is replaced rather than trusted.
 */
import { describe, expect, it } from 'vitest'
import { resolveSessionId } from '../../../../netlify/functions/chat'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REAL = '258e7a7c-dfc9-4ec1-b308-120d308d135e'

describe('resolveSessionId', () => {
  it('honours a real uuid, so an ongoing conversation keeps its thread', () => {
    expect(resolveSessionId(REAL)).toEqual({ sessionId: REAL, isNewSession: false })
  })

  it('accepts an uppercase uuid rather than starting a new session over casing', () => {
    const upper = REAL.toUpperCase()
    expect(resolveSessionId(upper)).toEqual({ sessionId: upper, isNewSession: false })
  })

  it('mints a fresh session when the field is absent, as it always did', () => {
    for (const absent of [null, undefined, '']) {
      const { sessionId, isNewSession } = resolveSessionId(absent)
      expect(sessionId).toMatch(UUID)
      expect(isNewSession).toBe(true)
    }
  })

  it.each([
    ['plain text', 'i-am-not-a-uuid'],
    ['a number', '12345'],
    ['nearly a uuid, one character short', '258e7a7c-dfc9-4ec1-b308-120d308d135'],
    ['a uuid with a trailing space', `${REAL} `],
    ['sql-ish', "'; drop table sessions; --"],
    ['a uuid wrapped in other text', `prefix-${REAL}-suffix`],
  ])('replaces %s rather than trusting it', (_label, raw) => {
    const { sessionId, isNewSession } = resolveSessionId(raw)

    expect(sessionId).not.toBe(raw)
    expect(sessionId).toMatch(UUID)
    // A replaced id must be reported as a new session, or the turn would be appended to a
    // conversation the caller never actually had.
    expect(isNewSession).toBe(true)
  })

  it('never echoes caller-controlled text back in the id it returns', () => {
    const hostile = '<script>alert(1)</script>'
    expect(resolveSessionId(hostile).sessionId).not.toContain('script')
  })

  it('mints a different id each time, so two bad callers do not share a session', () => {
    const a = resolveSessionId('nonsense').sessionId
    const b = resolveSessionId('nonsense').sessionId
    expect(a).not.toBe(b)
  })
})
