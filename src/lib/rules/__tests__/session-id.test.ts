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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

/**
 * The half the validation did not cover, and the line that covers it now.
 *
 * Validating the id closed the case that fails on TYPE. A **well-formed uuid the caller invented** fails
 * on REFERENCE instead: it passes `UUID_RE`, so it was treated as a continuation, no `sessions` row
 * existed for it, and every child insert failed its foreign key on the same fire-and-forget path.
 * Measured on production at iteration 166's filing -- a real `get_policy` call, a correct answer, and
 * `tool_invocations` unchanged -- while `agent/sol.md`'s G17 promises every tool call is recorded.
 *
 * The hazard is asserted here as behaviour, because it really is behaviour: an id nobody issued comes
 * back as `isNewSession: false`, and that is correct. It is not `resolveSessionId`'s job to know which
 * uuids exist, and a database lookup on the critical path is exactly what this endpoint avoids.
 *
 * The mitigation is asserted at source, because a write that never happens cannot be observed from a
 * suite with no database: `tryGetDb()` returns null here, so `ensureSession` returns before its insert.
 * What can be pinned is that the call is not gated on the flag, and that the insert still treats a
 * duplicate key as success -- the fix depends on that, since a continuing conversation now runs it every
 * turn and the guest's message insert is chained behind it.
 */
describe('a uuid nobody issued', () => {
  const chatSource = readFileSync(resolve(__dirname, '../../../../netlify/functions/chat.ts'), 'utf8')

  const INVENTED = '11111111-2222-4333-a444-555555555555'

  it('is accepted as a continuation, which is the hazard rather than the bug', () => {
    expect(INVENTED, 'the fixture must be a well-formed uuid or it proves nothing').toMatch(UUID)
    expect(
      resolveSessionId(INVENTED),
      'an invented uuid is indistinguishable from a real one here, deliberately: resolveSessionId does ' +
        'not query the database, so the write path has to cope rather than the parser.',
    ).toEqual({ sessionId: INVENTED, isNewSession: false })
  })

  it('still gets a sessions row, because the ensure is not gated on isNewSession', () => {
    expect(
      chatSource,
      'the sessions row is created only when isNewSession, so an invented uuid writes nothing again: a ' +
        'real tool call, a real answer, and no row in tool_invocations. Call ensureSession every turn.',
    ).toMatch(/const sessionReady: Promise<unknown> = ensureSession\(sessionId, undefined\)/)
    expect(
      chatSource,
      'ensureSession is back behind a conditional on isNewSession',
    ).not.toMatch(/isNewSession \? ensureSession/)
  })

  it('keeps the duplicate-key tolerance the unconditional call depends on', () => {
    // Every continuing turn now attempts an insert that Postgres rejects. If that stopped being treated
    // as success, the chained guest-message insert would never run and the fix would cost more than the
    // defect did.
    //
    // Asserted against the CODE, with comments stripped. The first version of this case matched
    // /duplicate key/i anywhere in the file -- and the JSDoc added to ensureSession in the same iteration
    // says "treats a duplicate key as success", so removing the tolerance from the code left the phrase
    // in place and the case passed. Found by the mutation that was supposed to prove it.
    const code = chatSource
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
    expect(code.length, 'stripping comments left nothing to check').toBeGreaterThan(5000)
    expect(
      code,
      'ensureSession no longer swallows a duplicate key. It runs on every turn now, so a continuing ' +
        'conversation would log a warning per turn and, worse, the write chained behind it could stop.',
    ).toMatch(/!\/duplicate key\/i\.test\(error\.message\)/)
  })

  it('still chains the guest message behind the session row, in that order', () => {
    // The foreign key is the reason the two writes are ordered at all. Unconditional or not, the chain
    // is what keeps the message from racing the row it depends on.
    expect(chatSource).toMatch(/void sessionReady\.then\(\(\) => persistGuestMessage\(/)
  })
})
