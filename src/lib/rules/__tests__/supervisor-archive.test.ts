// The supervisor grid fetches a window of sessions; it must say so rather than render "No ended
// sessions yet" from a slice that happens to hold only active rows.
import { describe, expect, it } from 'vitest'
import { SESSION_FETCH_LIMIT, sessionViewIsTruncated } from '../../../components/admin/fetchLimits'

describe('sessionViewIsTruncated', () => {
  it('reports a window only when the fetch hit its limit', () => {
    expect(sessionViewIsTruncated(0)).toBe(false)
    expect(sessionViewIsTruncated(SESSION_FETCH_LIMIT - 1)).toBe(false)
    // At the limit a full page and a truncated one look the same, so assume truncated.
    expect(sessionViewIsTruncated(SESSION_FETCH_LIMIT)).toBe(true)
    expect(sessionViewIsTruncated(SESSION_FETCH_LIMIT + 50)).toBe(true)
  })
})
