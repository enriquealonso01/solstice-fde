// "Will I be charged if I cancel?" must be answerable without inferring anything.
//
// The regression this guards, observed twice in production on R55003 (Corporate Negotiated,
// check-in 2026-07-18, free-cancellation deadline 2026-07-15, asked on 2026-09-25):
//
//   run A: "cancelling would cost you one night's room and tax … you're inside the 72-hour free
//           cancellation window, which runs until July 15 at 3pm. If you cancel before that
//           deadline, it's free."          <- self-contradictory
//   run B: "Since it's currently outside that window … you're fine to cancel now with no charge."
//                                          <- flatly wrong; the truth is one night room and tax
//
// The tool data was correct both times (`inside_free_cancellation_window: false`,
// `penalty_if_cancelled_now: "one night room and tax…"`). What was missing is that
// `human_summary` stated only the GENERAL rule, so the guest's actual position had to be derived
// from a negated boolean. A fact the model must derive is a fact it can get backwards.

import { describe, expect, it } from 'vitest'
import { cancellationTerms } from '../../../../netlify/functions/tools/identity'
import type { Reservation } from '../../../../shared/types'

const reservation = (over: Partial<Reservation> = {}): Reservation =>
  ({
    reservation_id: 'R55003',
    guest_id: 'G10003',
    property_code: 'SOL-AUS',
    check_in_date: '2026-07-18',
    check_out_date: '2026-07-21',
    room_type: 'Deluxe King',
    rate_plan: 'Corporate Negotiated',
    nightly_rate: 219,
    nights: 3,
    status: 'Confirmed',
    ...over,
  }) as Reservation

const AFTER_DEADLINE = new Date('2026-09-25T12:00:00.000Z') // the real conditions of the bug
const BEFORE_DEADLINE = new Date('2026-07-01T12:00:00.000Z')

describe('cancellation terms state the guest position, not just the rule', () => {
  it('says plainly that it is too late when the deadline has passed', () => {
    const terms = cancellationTerms(reservation(), AFTER_DEADLINE)
    expect(terms.inside_free_cancellation_window).toBe(false)
    expect(terms.penalty_if_cancelled_now).toBe('one night room and tax, charged to the card on file')
    // The summary itself must resolve it, because that is the field the answer is written from.
    expect(terms.human_summary).toMatch(/PAST that deadline/)
    expect(terms.human_summary).toMatch(/too late to cancel free/i)
    expect(terms.human_summary).not.toMatch(/STILL INSIDE/)
  })

  it('says plainly that it is still free when the deadline has not passed', () => {
    const terms = cancellationTerms(reservation(), BEFORE_DEADLINE)
    expect(terms.inside_free_cancellation_window).toBe(true)
    expect(terms.penalty_if_cancelled_now).toBe('none')
    expect(terms.human_summary).toMatch(/STILL INSIDE the free window/)
    expect(terms.human_summary).toMatch(/costs nothing/)
    expect(terms.human_summary).not.toMatch(/PAST that deadline/)
  })

  it('never claims both things at once — the exact shape of run A', () => {
    // Check the VERDICT sentence only. The general rule that precedes it legitimately mentions
    // both outcomes ("free up to 72 hours … inside 72 hours the guest forfeits"), which is why
    // the guest's position has to be stated separately rather than left to be inferred from it.
    for (const now of [AFTER_DEADLINE, BEFORE_DEADLINE]) {
      const summary = cancellationTerms(reservation(), now).human_summary
      const verdict = summary.slice(summary.indexOf('This booking is'))
      expect(verdict).not.toBe('')
      const saysFree = /costs nothing|too late to cancel free/.test(verdict) && /costs nothing/.test(verdict)
      const saysCharged = /forfeits/.test(verdict)
      expect(saysFree && saysCharged).toBe(false)
    }
  })

  it('still carries the general rule, so the reasoning is auditable', () => {
    const summary = cancellationTerms(reservation(), AFTER_DEADLINE).human_summary
    expect(summary).toMatch(/72 hours before check-in/)
  })

  it('leaves non-refundable and no-show rate plans alone', () => {
    const advance = cancellationTerms(reservation({ rate_plan: 'Advance Purchase' }), AFTER_DEADLINE)
    expect(advance.human_summary).not.toMatch(/PAST that deadline|STILL INSIDE/)

    const noShow = cancellationTerms(reservation({ status: 'No-show' }), AFTER_DEADLINE)
    expect(noShow.no_show_charge_applied).toBe(true)
    expect(noShow.human_summary).toMatch(/no-show/i)
  })
})
