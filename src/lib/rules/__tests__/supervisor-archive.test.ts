/**
 * The supervisor Archive must not read as empty because of the fetch window.
 *
 * Measured against production on 2026-09-26, before this change: the `sessions` table held **180**
 * rows — 155 `active`, 23 `ended`, 2 `taken_over` — and the supervisor dashboard rendered
 * **"Archived 0"** under the empty state **"No ended sessions yet"**. Twenty-three ended
 * conversations were in the database at the time.
 *
 * The cause is a window nobody could see. `useSessions` fetched the 100 most recent rows by
 * `started_at`, and the newest 100 were *all* active: nothing closes a chat session on the web, so
 * `active` rows pile up with every test conversation anyone runs, while the ended ones age out of
 * the window. The page then drew a conclusion — "nothing has ended" — from a slice it never
 * mentioned applying. The Archive is a beat in `docs/demo-runbook.md`.
 *
 * `npm run demo:tidy` remains the operational cure and closes anything idle for 30 minutes. This
 * test exists because the Archive should not be one skipped command away from reading as empty, and
 * because the failure was silent in both directions: no error, no warning, and a plausible empty
 * state that a presenter would explain away.
 *
 * So it reproduces the real distribution rather than asserting a number. Change
 * `SESSION_FETCH_LIMIT` back to 100 and the first case fails with the screen it produced.
 */
import { describe, expect, it } from 'vitest'
// Imported from the leaf module, not from useAdminData: that file loads the Supabase browser client
// at module scope, which throws without VITE_SUPABASE_URL -- so this suite collected fine here and
// not at all in a fresh clone. Iteration 112.
import { SESSION_FETCH_LIMIT, sessionViewIsTruncated } from '../../../components/admin/fetchLimits'

type Row = { id: string; status: 'active' | 'ended' | 'taken_over'; started_at: string }

/** The production distribution on the morning this was found: the ended rows are the oldest. */
function productionShape(): Row[] {
  const rows: Row[] = []
  const at = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 26, 12, 0) - minutesAgo * 60_000).toISOString()
  for (let i = 0; i < 155; i++) rows.push({ id: `a${i}`, status: 'active', started_at: at(i) })
  for (let i = 0; i < 2; i++) rows.push({ id: `t${i}`, status: 'taken_over', started_at: at(155 + i) })
  for (let i = 0; i < 23; i++) rows.push({ id: `e${i}`, status: 'ended', started_at: at(157 + i) })
  return rows.sort((x, y) => Date.parse(y.started_at) - Date.parse(x.started_at))
}

/** Exactly what SupervisorDashboard does with what it fetched. */
const split = (fetched: Row[]) => ({
  live: fetched.filter((s) => s.status !== 'ended').length,
  archived: fetched.filter((s) => s.status === 'ended').length,
})

describe('the window the supervisor grid fetches', () => {
  it('is wide enough that the ended conversations are in it', () => {
    const all = productionShape()
    const { archived } = split(all.slice(0, SESSION_FETCH_LIMIT))

    expect(
      archived,
      `With ${all.length} sessions and a window of ${SESSION_FETCH_LIMIT}, the Archive renders ` +
        `"No ended sessions yet" while ${all.filter((r) => r.status === 'ended').length} ended ` +
        `conversations sit in the database. That is the demo-runbook Archive beat showing nothing.`,
    ).toBeGreaterThan(0)
  })

  it('reproduces the failure at the old window of 100, so this is pinned to the cause', () => {
    // Not a hypothetical: this is the screen that was live before the change.
    expect(split(productionShape().slice(0, 100))).toEqual({ live: 100, archived: 0 })
  })

  it('clears the observed table by a margin, not by a row or two', () => {
    // 180 is what production held when this was found. The window is not set to "180 plus a bit":
    // it has to survive a night of testing without anyone thinking about it. 500 is comfortably
    // above that while keeping the grid's render bounded -- every non-ended row becomes a card.
    const OBSERVED = 180
    expect(SESSION_FETCH_LIMIT).toBeGreaterThanOrEqual(2 * OBSERVED)
  })

  it('says it is a window only when it actually is one', () => {
    expect(sessionViewIsTruncated(0)).toBe(false)
    expect(sessionViewIsTruncated(180)).toBe(false)
    expect(sessionViewIsTruncated(SESSION_FETCH_LIMIT - 1)).toBe(false)
    // At the limit the fetch cannot tell a full page from a truncated one, so it must assume
    // truncated -- claiming completeness is the error that costs something.
    expect(sessionViewIsTruncated(SESSION_FETCH_LIMIT)).toBe(true)
    expect(sessionViewIsTruncated(SESSION_FETCH_LIMIT + 50)).toBe(true)
  })
})
