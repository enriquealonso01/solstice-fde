/**
 * Supervisor session tags must be derivable, not vibes.
 *
 * The complaint this pins: the board's badges said "Active"/"Classifying…" on rows that had been
 * over for a day, and an urgent escalation looked identical to a chat Sol had answered perfectly.
 * A supervisor triaging thirty conversations needs to know which ones need a human first.
 *
 * Every rule is a pure function of `sessions` + `escalations` (see sessionTags.ts); this file
 * holds the board to it, including the two shapes production actually produces — severity values
 * from netlify/functions/tools/rules.ts ('critical'|'high'|'normal'|'low') and status values from
 * the schema ('active'|'ended'|'taken_over').
 */
import { describe, expect, it } from 'vitest'
import {
  ATTENTION_AFTER_MS,
  deriveSessionTags,
  mostPressingEscalation,
  sessionMatchesTags,
  TAG_LABELS,
  URGENT_SEVERITIES,
  type EscalationTagRow,
  type SessionTag,
} from '../../../components/admin/sessionTags'
import type { SessionRow } from '../../../components/admin/mockData'

const NOW = Date.parse('2026-09-26T14:00:00.000Z')
const HOUR = 60 * 60 * 1000

type SessionLike = Pick<SessionRow, 'id' | 'status' | 'ended_at'>

const session = (over: Partial<SessionLike> = {}): SessionLike => ({
  id: 'ses-1',
  status: 'active',
  ended_at: null,
  ...over,
})

const esc = (over: Partial<EscalationTagRow> = {}): EscalationTagRow => ({
  session_id: 'ses-1',
  severity: 'normal',
  status: 'open',
  created_at: new Date(NOW - 2 * HOUR).toISOString(),
  ...over,
})

describe('supervisor requested', () => {
  it('an open escalation row IS the request', () => {
    expect(deriveSessionTags(session(), [esc()], NOW)).toEqual(['requested'])
  })

  it('a closed escalation is not a request — the session moves on', () => {
    expect(
      deriveSessionTags(
        session({ status: 'ended', ended_at: new Date(NOW - HOUR).toISOString() }),
        [esc({ status: 'closed' })],
        NOW,
      ),
    ).toEqual(['finished'])
  })

  it('escalations for other sessions do not tag this one', () => {
    expect(deriveSessionTags(session(), [esc({ session_id: 'ses-other' })], NOW)).toEqual(['handled'])
  })
})

describe('supervisor attention needed', () => {
  it('an urgent-severity open escalation gets attention on top of the request', () => {
    expect(deriveSessionTags(session(), [esc({ severity: 'critical' })], NOW)).toEqual(['requested', 'attention'])
  })

  it("'high' is urgent too — that is what the routing matrix actually writes", () => {
    expect(deriveSessionTags(session(), [esc({ severity: 'high' })], NOW)).toContain('attention')
  })

  it('an escalation with no severity at all still tags, but only as requested', () => {
    // The schema default is 'normal', but a null-tolerant read must not crash the board.
    expect(deriveSessionTags(session(), [esc({ severity: null })], NOW)).toEqual(['requested'])
  })

  it('an open escalation older than 24h is attention even at normal severity', () => {
    const stale = esc({ created_at: new Date(NOW - ATTENTION_AFTER_MS - 60 * 1000).toISOString() })
    expect(deriveSessionTags(session(), [stale], NOW)).toEqual(['requested', 'attention'])
  })

  it('a 23-hour-old normal escalation is still just a request', () => {
    const fresh = esc({ created_at: new Date(NOW - ATTENTION_AFTER_MS + HOUR).toISOString() })
    expect(deriveSessionTags(session(), [fresh], NOW)).toEqual(['requested'])
  })

  it('a live conversation a supervisor took over awaits follow-up, with or without an escalation', () => {
    const taken = session({ status: 'taken_over' })
    expect(deriveSessionTags(taken, [], NOW)).toEqual(['attention'])
    expect(deriveSessionTags(taken, [esc({ severity: 'normal' })], NOW)).toEqual(['requested', 'attention'])
  })

  it('a FINISHED call a supervisor had taken over is finished, not attention', () => {
    // The exact row shape that once sat live on the board for two days (see session-liveness.test).
    const over = session({ status: 'taken_over', ended_at: new Date(NOW - 2 * 24 * HOUR).toISOString() })
    expect(deriveSessionTags(over, [], NOW)).toEqual(['finished'])
  })
})

describe('handled by Sol / finished', () => {
  it('a live session with nothing open is Sol handling it', () => {
    expect(deriveSessionTags(session(), [], NOW)).toEqual(['handled'])
  })

  it('an ended session with no open escalation is finished', () => {
    expect(
      deriveSessionTags(session({ status: 'ended', ended_at: new Date(NOW - HOUR).toISOString() }), [], NOW),
    ).toEqual(['finished'])
  })

  it('an ended session still owing an open escalation is still requested', () => {
    // Ending a conversation does not answer an escalation; the ask survives the hangup.
    const over = session({ status: 'ended', ended_at: new Date(NOW - HOUR).toISOString() })
    expect(deriveSessionTags(over, [esc({ severity: 'critical' })], NOW)).toEqual(['requested', 'attention'])
  })
})

describe('mostPressingEscalation', () => {
  it('urgent beats stale beats fresh', () => {
    const fresh = esc({ severity: 'normal' })
    const stale = esc({ severity: 'normal', created_at: new Date(NOW - ATTENTION_AFTER_MS - HOUR).toISOString() })
    const urgent = esc({ severity: 'critical' })
    expect(mostPressingEscalation([fresh, stale, urgent], NOW)).toBe(urgent)
    expect(mostPressingEscalation([fresh, stale], NOW)).toBe(stale)
    expect(mostPressingEscalation([fresh], NOW)).toBe(fresh)
  })

  it('an empty queue is null, not a crash', () => {
    expect(mostPressingEscalation([], NOW)).toBeNull()
  })
})

describe('filter matching', () => {
  it('an empty selection means show everything', () => {
    expect(sessionMatchesTags(['handled'], new Set())).toBe(true)
  })

  it('any overlap matches', () => {
    expect(sessionMatchesTags(['requested', 'attention'], new Set<SessionTag>(['attention']))).toBe(true)
    expect(sessionMatchesTags(['finished'], new Set<SessionTag>(['attention']))).toBe(false)
  })
})

describe('the tag table is complete', () => {
  it('every tag has a label, and the urgent set is the top severities', () => {
    for (const tag of ['attention', 'requested', 'handled', 'finished'] as const) {
      expect(TAG_LABELS[tag]).toBeTruthy()
    }
    expect([...URGENT_SEVERITIES].sort()).toEqual(['critical', 'high'])
  })
})
