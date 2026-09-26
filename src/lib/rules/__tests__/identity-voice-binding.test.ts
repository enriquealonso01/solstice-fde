/**
 * The voice webhook (/api/tools) takes the verified guest from the session the call leg belongs to,
 * never from the request body. A verified identify_guest binds the guest to that session; an
 * unverified one binds nothing; a guest_id or a clock in the body changes nothing.
 */
import type { Context } from '@netlify/functions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../../../netlify/functions/tools/index'

type Row = Record<string, unknown>

/** In-memory `sessions`, recording every update. Other tables read empty and swallow writes. */
const db = vi.hoisted(() => ({
  sessions: [] as Row[],
  updates: [] as Array<{ table: string; patch: Row }>,
}))

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let patch: Row | null = null
      const rows = () => (table === 'sessions' ? db.sessions : []).filter((r) => filters.every(([k, v]) => r[k] === v))
      const settle = () => {
        if (patch) {
          db.updates.push({ table, patch })
          for (const row of rows()) Object.assign(row, patch)
          return { data: null, error: null }
        }
        return { data: rows(), error: null }
      }
      // A chainable query: unknown calls (select, order, limit, insert, ...) return the same builder.
      const builder: Row = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(settle())
            if (prop === 'maybeSingle' || prop === 'single') {
              return async () => ({ data: rows()[0] ?? null, error: null })
            }
            if (prop === 'eq') return (key: string, value: unknown) => (filters.push([key, value]), builder)
            if (prop === 'update') return (value: Row) => ((patch = value), builder)
            return () => builder
          },
        },
      )
      return builder
    },
  }
}

vi.mock('../../../../netlify/functions/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../netlify/functions/_lib/db')>()),
  tryGetDb: () => fakeClient(),
}))

const CALL = 'v3:call-under-test'
const SESSION = 'session-under-test'

beforeEach(() => {
  db.sessions.length = 0
  db.updates.length = 0
  db.sessions.push({ id: SESSION, call_control_id: CALL, guest_id: null, guest_label: 'Unknown caller ***-***-0148' })
  delete process.env.DEMO_NOW
})

afterEach(() => {
  delete process.env.DEMO_NOW
})

async function call(tool: string, body: Row): Promise<Row> {
  const res = await handler(
    new Request(`https://example.test/.netlify/functions/tools/${tool}`, { method: 'POST', body: JSON.stringify(body) }),
    {} as Context,
  )
  return (await res.json()) as Row
}

const session = () => db.sessions.find((r) => r.id === SESSION)!
const sessionWrites = () => db.updates.filter((u) => u.table === 'sessions' && 'guest_id' in u.patch)

describe('a guest_id in the body', () => {
  it('does not verify the call: the tool sees it as an argument and refuses it', async () => {
    const result = await call('get_reservation', { call_control_id: CALL, guest_id: 'G10012', reservation_id: 'R55012' })
    expect(result.ok).toBe(false)
    expect(result.data).toBeUndefined()
    expect(JSON.stringify(result)).not.toMatch(/Kalinski|SOL-PVD|2026-06-20/)
  })

  it('does not stand in for the verified guest once one is bound', async () => {
    session().guest_id = 'G10004'
    const result = await call('get_reservation', { call_control_id: CALL, guest_id: 'G10012', reservation_id: 'R55012' })
    expect(result.ok).toBe(false)
    expect(result.data).toBeUndefined()
  })
})

describe("'now' in the body", () => {
  it('does not move the clock the tools read', async () => {
    process.env.DEMO_NOW = '2026-09-01T12:00:00Z'
    session().guest_id = 'G10004'
    const onServerClock = await call('get_reservation', { call_control_id: CALL, reservation_id: 'R55015' })
    const withBodyClock = await call('get_reservation', { call_control_id: CALL, reservation_id: 'R55015', now: '2020-01-01T00:00:00Z' })

    expect(onServerClock.ok).toBe(true)
    const timing = (r: Row) => (r.data as { timing: Row }).timing
    expect(timing(withBodyClock)).toEqual(timing(onServerClock))
    // 2026-09-01 12:00 to R55015's 15:00 check-in on 2026-09-05.
    expect(timing(onServerClock).hours_until_check_in).toBe(99)
  })
})

describe('identify_guest on a call', () => {
  it('binds the verified guest to the session, and later tools on the call run as that guest', async () => {
    const before = await call('get_reservation', { call_control_id: CALL, reservation_id: 'R55012' })
    expect(before.ok).toBe(false)

    const verified = await call('identify_guest', { call_control_id: CALL, confirmation_number: 'R55012', last_name: 'Kalinski' })
    expect((verified.data as Row).verified).toBe(true)
    expect(session().guest_id).toBe('G10012')
    expect(session().guest_label).toBe('Robert Kalinski')

    const after = await call('get_reservation', { call_control_id: CALL, reservation_id: 'R55012' })
    expect(after.ok).toBe(true)
    expect(((after.data as Row).reservation as Row).reservation_id).toBe('R55012')
  })

  it('binds nothing when the factors do not verify', async () => {
    const result = await call('identify_guest', { call_control_id: CALL, confirmation_number: 'R55012', last_name: 'Webb' })
    expect((result.data as Row).verified).toBe(false)
    expect(sessionWrites()).toEqual([])
    expect(session().guest_id).toBeNull()

    const after = await call('get_reservation', { call_control_id: CALL, reservation_id: 'R55012' })
    expect(after.ok).toBe(false)
  })

  it('binds nothing without a call leg to bind to', async () => {
    const result = await call('identify_guest', { confirmation_number: 'R55012', last_name: 'Kalinski' })
    expect((result.data as Row).verified).toBe(true)
    expect(sessionWrites()).toEqual([])
  })
})
