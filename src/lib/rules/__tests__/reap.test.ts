/**
 * The sweep that closes conversations nobody hung up.
 *
 * A phone call ends with an event. A web chat ends with a closed tab, and a closed tab sends nothing,
 * so every chat session ever opened stayed `active` for ever: 308 of them by the morning of the demo,
 * all counted in the supervisor's "Active now" tile. `npm run demo:tidy` fixed that by hand, from a
 * laptop, when somebody remembered — which is the wrong shape for the first number a panel reads.
 *
 * These cases pin the two decisions in `reapStaleSessions` that are judgement rather than mechanics,
 * because both could reasonably have gone the other way and both are wrong in a way no type can
 * catch:
 *
 *   1. `ended_at` is the last thing that actually happened, never the sweep time. A transcript saying
 *      a guest was in conversation until a cron job ran is a fabricated record, and the argument this
 *      whole system makes is that its audit trail can be trusted.
 *   2. `status` is left alone on a conversation a human took over. Who handled it and whether it is
 *      finished are different facts; collapsing them is exactly the bug in session-liveness.test.ts.
 *
 * The database is a stub rather than a mock library: the thing under test is a rule about time and
 * about which column carries which fact, and a stub makes the patches it writes readable as data.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_IDLE_MINUTES, normaliseIdleMinutes, reapStaleSessions } from '../../../../netlify/functions/_lib/reap'

const NOW = Date.parse('2026-09-26T14:00:00.000Z')
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString()

interface StubSession {
  id: string
  channel: string
  status: string
  started_at: string
  ended_at?: string | null
}

interface Written {
  id: string
  patch: Record<string, unknown>
}

/**
 * The narrow slice of the Supabase client this function uses, and nothing else. Written by hand so
 * the assertions below read as "what landed in the database" rather than as mock bookkeeping.
 */
function stubDb(sessions: StubSession[], messages: Record<string, string[]>) {
  const writes: Written[] = []
  const audits: Record<string, unknown>[] = []

  const client = {
    from(table: string) {
      if (table === 'audit_log') {
        return {
          insert(row: Record<string, unknown>) {
            audits.push(row)
            // The real client is a thenable; reapStaleSessions chains .then() on this one.
            return Promise.resolve({ error: null })
          },
        }
      }

      if (table === 'messages') {
        let sessionId = ''
        const chain = {
          select: () => chain,
          eq: (_col: string, value: string) => {
            sessionId = value
            return chain
          },
          order: () => chain,
          limit: () =>
            Promise.resolve({
              data: (messages[sessionId] ?? [])
                .slice()
                .sort()
                .reverse()
                .slice(0, 1)
                .map((created_at) => ({ created_at })),
              error: null,
            }),
        }
        return chain
      }

      // sessions: either the open-session read or a close.
      let target = ''
      const chain = {
        select: () => chain,
        is: () =>
          Object.assign(chain, {
            order: () => chain,
            limit: () =>
              Promise.resolve({
                data: sessions.filter((s) => (s.ended_at ?? null) === null),
                error: null,
              }),
          }),
        order: () => chain,
        limit: () =>
          Promise.resolve({ data: sessions.filter((s) => (s.ended_at ?? null) === null), error: null }),
        update(patch: Record<string, unknown>) {
          return {
            eq: (_col: string, id: string) => {
              target = id
              return {
                is: () => {
                  writes.push({ id: target, patch })
                  return Promise.resolve({ error: null })
                },
              }
            },
          }
        },
      }
      return chain
    },
  }

  return { client: client as never, writes, audits }
}

describe('closing conversations that ended without an event', () => {
  it('closes a chat idle past the window and leaves a chat that is still talking', () => {
    const { client, writes } = stubDb(
      [
        { id: 'stale', channel: 'chat', status: 'active', started_at: minutesAgo(120) },
        { id: 'fresh', channel: 'chat', status: 'active', started_at: minutesAgo(10) },
      ],
      { stale: [minutesAgo(95)], fresh: [minutesAgo(2)] },
    )

    return reapStaleSessions({ db: client, now: () => NOW }).then((result) => {
      expect(result.ok).toBe(true)
      expect(writes.map((w) => w.id)).toEqual(['stale'])
    })
  })

  it('writes ended_at as the last real activity, not as the moment the sweep ran', async () => {
    const lastMessage = minutesAgo(95)
    const { client, writes } = stubDb(
      [{ id: 'stale', channel: 'chat', status: 'active', started_at: minutesAgo(120) }],
      { stale: [minutesAgo(118), lastMessage] },
    )

    await reapStaleSessions({ db: client, now: () => NOW })

    expect(writes[0].patch.ended_at).toBe(lastMessage)
    // The distinction that matters: not 14:00, which is when the sweep happened to run.
    expect(writes[0].patch.ended_at).not.toBe(new Date(NOW).toISOString())
  })

  it('keeps taken_over on a conversation a human handled, and still closes it', async () => {
    const { client, writes } = stubDb(
      [{ id: 'human', channel: 'chat', status: 'taken_over', started_at: minutesAgo(200) }],
      { human: [minutesAgo(180)] },
    )

    await reapStaleSessions({ db: client, now: () => NOW })

    expect(writes[0].patch).not.toHaveProperty('status')
    expect(writes[0].patch.ended_at).toBe(minutesAgo(180))
  })

  it('sets status to ended on a conversation Sol handled alone', async () => {
    const { client, writes } = stubDb(
      [{ id: 'sol', channel: 'chat', status: 'active', started_at: minutesAgo(200) }],
      { sol: [minutesAgo(180)] },
    )

    await reapStaleSessions({ db: client, now: () => NOW })

    expect(writes[0].patch.status).toBe('ended')
  })

  it('treats a session with no messages as idle from the moment it started', async () => {
    const { client, writes } = stubDb(
      [{ id: 'silent', channel: 'voice', status: 'active', started_at: minutesAgo(90) }],
      {},
    )

    await reapStaleSessions({ db: client, now: () => NOW })

    expect(writes[0].patch.ended_at).toBe(minutesAgo(90))
  })

  it('reports what it would close without writing anything on a dry run', async () => {
    const { client, writes, audits } = stubDb(
      [{ id: 'stale', channel: 'chat', status: 'active', started_at: minutesAgo(200) }],
      { stale: [minutesAgo(180)] },
    )

    const result = await reapStaleSessions({ db: client, now: () => NOW, dryRun: true })

    expect(result.closed.map((c) => c.id)).toEqual(['stale'])
    expect(writes).toEqual([])
    expect(audits).toEqual([])
  })

  it('records the sweep in the audit log, like any other action that changed a row', async () => {
    const { client, audits } = stubDb(
      [{ id: 'stale', channel: 'chat', status: 'active', started_at: minutesAgo(200) }],
      { stale: [minutesAgo(180)] },
    )

    await reapStaleSessions({ db: client, now: () => NOW, actor: 'system:reaper' })

    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe('sessions.reaped')
  })

  it('does not fail when there is no database, and says so rather than throwing', async () => {
    // Nothing is stubbed and vitest.setup.ts strips SUPABASE_URL, so tryGetDb() returns null. A
    // sweep on an unconfigured deploy has to report, not throw: it runs on a timer with no user.
    const result = await reapStaleSessions({ now: () => NOW })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not configured/i)
    expect(result.closed).toEqual([])
  })
})

describe('the idle window', () => {
  it('defaults to thirty minutes', () => {
    expect(normaliseIdleMinutes(undefined)).toBe(DEFAULT_IDLE_MINUTES)
    expect(DEFAULT_IDLE_MINUTES).toBe(30)
  })

  it('refuses zero and negatives, which would close a conversation mid-sentence', () => {
    expect(normaliseIdleMinutes(0)).toBe(DEFAULT_IDLE_MINUTES)
    expect(normaliseIdleMinutes(-5)).toBe(DEFAULT_IDLE_MINUTES)
    expect(normaliseIdleMinutes('nonsense')).toBe(DEFAULT_IDLE_MINUTES)
  })

  it('accepts a shorter window typed on purpose, which is the rehearsal case', () => {
    expect(normaliseIdleMinutes(5)).toBe(5)
  })

  it('caps at a day, so a caller cannot ask for a sweep that never closes anything', () => {
    expect(normaliseIdleMinutes(100_000)).toBe(24 * 60)
  })
})
