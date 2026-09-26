/**
 * "Active now" must mean active now.
 *
 * Observed on production on 2026-09-26: the supervisor dashboard showed two phone calls in the
 * "Active now" tile with their timers reading **2 days**, and both had genuinely finished — one on
 * the 24th after 46 seconds, one on the 25th after 18 seconds. Nothing was wrong with the data. Both
 * rows carried a correct `ended_at`.
 *
 * The cause is two facts sharing one column in the reader's head. `netlify/functions/telnyx/index.ts`
 * deliberately does NOT overwrite `status = 'taken_over'` when a caller hangs up, because the archive
 * should still record that a human, not Sol, finished that call; it stamps `ended_at` instead. Every
 * admin screen then asked `status !== 'ended'` and got the wrong answer, for ever, because the status
 * it was reading answers *who handled this* and not *is this over*.
 *
 * So `isLive` reads `ended_at`, and this suite pins the four combinations that can occur, including
 * the one that caused the bug. It also pins the clock: a session's timer has to stop when the session
 * stopped, not when the page happened to render.
 */
import { describe, expect, it } from 'vitest'
import { duration, isLive, sessionClockEnd } from '../../../components/admin/mockData'

type Row = { status: 'active' | 'ended' | 'taken_over'; ended_at: string | null }

const AT = (iso: string) => Date.parse(iso)
const NOW = AT('2026-09-26T14:00:00.000Z')

describe('is this conversation still happening', () => {
  it('a live call Sol is handling is live', () => {
    expect(isLive({ status: 'active', ended_at: null })).toBe(true)
  })

  it('a live call a supervisor took over is live', () => {
    expect(isLive({ status: 'taken_over', ended_at: null })).toBe(true)
  })

  it('a finished call is not live', () => {
    expect(isLive({ status: 'ended', ended_at: '2026-09-26T13:00:00.000Z' })).toBe(false)
  })

  /**
   * THE REGRESSION. This exact row was on screen for two days. `status` says a human took it,
   * `ended_at` says it is over, and only the second question is about liveness.
   */
  it('a FINISHED call that a supervisor had taken over is not live', () => {
    const theBug: Row = { status: 'taken_over', ended_at: '2026-09-24T18:58:42.502Z' }
    expect(isLive(theBug)).toBe(false)
  })

  /**
   * Defence in depth rather than duplication. If a future writer ever sets `status = 'ended'` and
   * forgets `ended_at`, the honest answer is still "not live": a row that claims to be finished is
   * finished, and the alternative is another two-day-old call on the tile.
   */
  it('treats an ended status with no timestamp as finished, not as live', () => {
    expect(isLive({ status: 'ended', ended_at: null })).toBe(false)
  })
})

describe('when the clock stops', () => {
  it('counts up to now while the conversation is live', () => {
    const started = '2026-09-26T13:58:30.000Z'
    expect(duration(started, sessionClockEnd({ status: 'active', ended_at: null }, NOW))).toBe('1:30')
  })

  it('freezes at ended_at once it is over, whatever the status says', () => {
    const started = '2026-09-24T18:57:56.306Z'
    const ended = '2026-09-24T18:58:42.502Z'
    // 46 seconds, which is how long that call actually lasted. Read against `now` it printed 2 days.
    expect(duration(started, sessionClockEnd({ status: 'taken_over', ended_at: ended }, NOW))).toBe('0:46')
  })

  it('falls back to now when ended_at is unparseable rather than printing a negative timer', () => {
    const started = '2026-09-26T13:59:00.000Z'
    expect(duration(started, sessionClockEnd({ status: 'ended', ended_at: 'not a date' }, NOW))).toBe('1:00')
  })
})
