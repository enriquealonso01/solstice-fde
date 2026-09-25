/**
 * One conversation must not put the same guest in the supervisor's queue twice.
 *
 * Found by reading production after a prompt change, not from a report: a two-turn group request
 * created two escalation rows 5.4 seconds apart, and five of thirty-one sessions carried a
 * duplicate. The model calls `create_escalation` when it has the gist and again when the guest
 * gives an email, which is reasonable behaviour — the first row is simply the one missing the
 * detail, so on screen the *more complete* row is the one that looks like the repeat.
 *
 * The important half of this test is not the merging. It is that a SECOND, DIFFERENT escalation
 * still opens its own row. A dedupe keyed only on session would fold a safety report into a group
 * enquiry — different authority, different urgency, immediate rather than same-day — and that is a
 * far worse bug than the duplicate it fixes. So every case below that must NOT merge is asserted
 * explicitly.
 */
import { describe, expect, it } from 'vitest'
import { mergeTargetFor } from '../../../../netlify/functions/tools/escalation'

const open = (id: string, category: string) => ({ id, category, status: 'open' })

describe('mergeTargetFor', () => {
  it('merges a repeat of the same category in the same conversation', () => {
    expect(mergeTargetFor([open('esc-1', 'other')], 'other')).toBe('esc-1')
  })

  it('reproduces the real case: the group turn, then the email turn', () => {
    // Both turns classify as `other`, which is what the matrix gives a group request.
    const afterFirstTurn = [open('esc-group', 'other')]
    expect(mergeTargetFor(afterFirstTurn, 'other')).toBe('esc-group')
  })

  it.each([
    ['safety after a group enquiry', 'safety'],
    ['medical after a group enquiry', 'medical'],
    ['legal after a group enquiry', 'legal'],
    ['refund after a group enquiry', 'refund'],
    ['dispute after a group enquiry', 'dispute'],
    ['authority_exceeded after a group enquiry', 'authority_exceeded'],
  ])('opens a NEW row for %s, because the authority and urgency differ', (_label, category) => {
    expect(mergeTargetFor([open('esc-group', 'other')], category)).toBeNull()
  })

  it('does not reopen an escalation a supervisor has already closed', () => {
    const closed = [{ id: 'esc-1', category: 'other', status: 'closed' }]
    expect(mergeTargetFor(closed, 'other')).toBeNull()
  })

  it('picks the open one when a closed row of the same category exists alongside it', () => {
    const rows = [
      { id: 'esc-old', category: 'refund', status: 'closed' },
      open('esc-live', 'refund'),
    ]
    expect(mergeTargetFor(rows, 'refund')).toBe('esc-live')
  })

  it('treats an empty or absent history as nothing to merge into', () => {
    expect(mergeTargetFor([], 'other')).toBeNull()
    expect(mergeTargetFor(null, 'other')).toBeNull()
    expect(mergeTargetFor(undefined, 'other')).toBeNull()
  })

  it('never returns an id for a category that is not present', () => {
    expect(mergeTargetFor([open('esc-1', 'refund'), open('esc-2', 'dispute')], 'safety')).toBeNull()
  })

  it('matches on the row it was given rather than on order', () => {
    const rows = [open('esc-a', 'dispute'), open('esc-b', 'safety'), open('esc-c', 'refund')]
    expect(mergeTargetFor(rows, 'safety')).toBe('esc-b')
    expect(mergeTargetFor(rows, 'refund')).toBe('esc-c')
  })
})
