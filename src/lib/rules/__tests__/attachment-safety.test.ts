/**
 * The one genuinely untrusted input in supervisor intervention.
 *
 * A supervisor can hand a guest a file. Everything about that is authenticated — the role is checked
 * against the same rule RLS enforces, and the write goes through a serverless function because the
 * browser has no insert policy on `messages` — except one thing: **the filename comes from whatever
 * the operating system's file picker handed the browser, and it ends up in a URL path.**
 *
 * So these cases are about the two ways that can go wrong, and neither is hypothetical:
 *
 *   1. A path in a name. `../../../etc/passwd` in an object path is a traversal attempt, and the
 *      right answer is to keep a filename and drop the path, not to reject and make a concierge
 *      rename a file mid-conversation.
 *   2. A type nobody meant to allow. The allowlist is short on purpose: the point is not to
 *      enumerate what is dangerous, which is a list that is never finished, but to name the handful
 *      of things a concierge actually sends. `.exe` is not on it, and neither is anything else.
 *
 * What is NOT tested here, deliberately, because it is not built: virus scanning, and any path for a
 * guest to send a file back. docs/where-this-goes.md carries both. An upload path in both directions
 * with no scanning is a malware relay with a hotel's logo on it, and half-building it would be worse
 * than the honest gap.
 */
import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  safeFilename,
} from '../../../../netlify/functions/supervisor/attachments'

describe('a filename from a file picker', () => {
  it('keeps an ordinary one unchanged', () => {
    expect(safeFilename('booking-confirmation.pdf')).toBe('booking-confirmation.pdf')
  })

  it('drops the directory from a traversal attempt rather than rejecting the send', () => {
    expect(safeFilename('../../../etc/passwd')).toBe('passwd')
    expect(safeFilename('..\\..\\windows\\system32\\config')).toBe('config')
  })

  it('cannot produce a leading dot, which would make a hidden file or an empty path segment', () => {
    expect(safeFilename('.env')).toBe('env')
    expect(safeFilename('...')).toBeNull()
  })

  it('strips characters that would change the meaning of a URL', () => {
    // A `?` or `#` in an object path truncates it at the query or fragment; a quote breaks out of the
    // attribute it is rendered into. None of them belong in a name a guest will download.
    expect(safeFilename('permit?token=1#frag.pdf')).toBe('permittoken1frag.pdf')
    expect(safeFilename('in"voice\'.pdf')).toBe('invoice.pdf')
  })

  it('rejects a name that is nothing but punctuation, rather than inventing one', () => {
    expect(safeFilename('///')).toBeNull()
    expect(safeFilename('')).toBeNull()
    expect(safeFilename(undefined)).toBeNull()
  })

  it('keeps a name short enough to stay inside a path, and keeps its extension', () => {
    const long = 'a'.repeat(300) + '.pdf'
    const out = safeFilename(long) ?? ''
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.endsWith('.pdf')).toBe(true)
  })
})

describe('the limits a supervisor is held to', () => {
  /**
   * This case found a real defect on its first run, which is the reason it is written as arithmetic
   * rather than as a number. The cap was 5 MB, chosen so that a too-large file would be refused here
   * with a readable message instead of failing in the platform -- and 5 MB of base64 is 6.9 MB, over
   * Netlify's 6 MB request limit. The cap meant to prevent an unexplainable failure was itself large
   * enough to cause one. Asserting `=== 5 * 1024 * 1024` would have passed happily.
   */
  it('caps an attachment small enough that its base64 body still fits in a request', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(4 * 1024 * 1024)
    const NETLIFY_REQUEST_LIMIT = 6 * 1024 * 1024
    // base64 is 4 bytes per 3, plus a little for the JSON envelope and the filename.
    const onTheWire = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 1024
    expect(onTheWire).toBeLessThan(NETLIFY_REQUEST_LIMIT)
  })

  it('names the bucket the same way the migration and the docs do', () => {
    expect(ATTACHMENT_BUCKET).toBe('attachments')
  })

  it('reports a size a person can read', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB')
  })
})
