// The inbox's Rules chip must not tell a rep an inquiry is ready to price when pricing has already
// refused it.
//
// The defect this guards, found on live data: PR #51 replaced "0 missing" with a green
// "ready to price" chip whenever missing_fields was empty and no proposal existed. On production the
// only two rows without a proposal were INQ-2003 and INQ-2010 — and they have no proposal *because*
// the rules engine fails them on GRP-BLACKOUT:
//
//   "Solstice Austin Congress Ave does not take group blocks between March 10, 2027 through
//    March 19, 2027, and these dates fall…"
//
// So the green chip appeared on exactly the two inquiries that cannot be priced, and nowhere else.
// Completeness and priceability are different questions, and the set of complete-but-unpriced rows is
// dominated by the ones pricing already refused — which is why the proxy failed on every row it was
// visible on.
//
// The row already carries status 'blocked' (statusFor, tools.ts:1300), so this is about asking rather
// than plumbing.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NL = String.fromCharCode(10)
const src = readFileSync(join(process.cwd(), 'src/pages/admin/GroupInbox.tsx'), 'utf8')

/** Drop `//` lines. See the note below for why this is required rather than convenient. */
function stripComments(text: string): string {
  return text
    .split(NL)
    .filter((line) => !line.trim().startsWith('//'))
    .join(NL)
}

const cellStart = src.indexOf('<SeverityChip severity={severity} />')

/**
 * The Rules cell, isolated so these assertions cannot be satisfied by another part of the file, and
 * with comments removed.
 *
 * The comment stripping is load-bearing. The cell carries a long explanation that necessarily quotes
 * "ready to price", "cannot be priced" and "0 missing" in order to explain the defect. The first
 * version of this test matched those quotes in the prose rather than the code, and failed while the
 * fix was correct — the same trap as the prompt test in iteration 8. Assert on code, never on prose
 * that mentions the code.
 */
const rulesCell = stripComments(src.slice(cellStart, src.indexOf('</td>', cellStart)))
const srcNoComments = stripComments(src)

describe('the inbox Rules chip', () => {
  it('is reachable — the cell was located and still offers the green state', () => {
    expect(rulesCell.length).toBeGreaterThan(120)
    expect(rulesCell).toContain('ready to price')
  })

  it('checks the blocked status before offering "ready to price"', () => {
    expect(rulesCell).toMatch(/status === 'blocked'/)
    expect(rulesCell.indexOf("status === 'blocked'")).toBeLessThan(rulesCell.indexOf('ready to price'))
  })

  it('says something truthful when pricing has refused, and not in the go-colour', () => {
    expect(rulesCell).toMatch(/cannot be priced/)
    const from = rulesCell.indexOf("status === 'blocked'")
    const to = rulesCell.indexOf('cannot be priced')
    expect(to).toBeGreaterThan(from)
    const blockedBranch = rulesCell.slice(from, to)
    // rose, not emerald: a rep scanning by colour must not read this as go
    expect(blockedBranch).toMatch(/rose/)
    expect(blockedBranch).not.toMatch(/emerald/)
  })

  it('still shows the missing-field count, which was already clear', () => {
    expect(rulesCell).toMatch(/\{inquiry\.missing_fields\.length\} missing/)
  })

  it('does not reintroduce "0 missing"', () => {
    expect(srcNoComments).not.toMatch(/['"`]0 missing/)
  })
})
