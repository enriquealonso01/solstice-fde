/**
 * When a walkthrough quotes what is on screen, that text must still be on screen.
 *
 * `docs/role-walkthroughs.md` walks a reviewer through the admin console click by click and quotes
 * the UI as it goes. I reworded a lot of that UI in PRs #50 and #54 (T29, removing engineering
 * vocabulary) and did not go back to the walkthrough. Two quotes went stale:
 *
 *   `· written to audit_log`          → the screen now says `· written to the audit trail`
 *   `scoped by role in the database`  → the screen now says `each one sees only its own work`
 *
 * The second was the worse one: the sentence around it says *"note the wording"*, drawing a
 * reviewer's attention to wording that had been gone for hours.
 *
 * PR #97 then promoted this document into the README's main deliverable table — so the exposure was
 * something I raised myself, one iteration before finding it.
 *
 * This pins the quotes that are assertions about the screen. It is an explicit list rather than a
 * parser: a doc quotes plenty of things that are not UI text (schema names, tool names, its own
 * prose in backticks), and guessing which is which produces false positives, which is how a guard
 * teaches people to ignore it. Adding a quote here is a deliberate act, and that is the point.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

/** Each: the doc that quotes it, and a source file that must still contain it verbatim. */
const QUOTED_UI: { doc: string; quote: string; source: string }[] = [
  {
    doc: 'docs/role-walkthroughs.md',
    quote: '· written to the audit trail',
    source: 'src/pages/admin/InquiryDetail.tsx',
  },
  {
    doc: 'docs/role-walkthroughs.md',
    quote: 'each one sees only its own work',
    source: 'src/pages/admin/AdminHome.tsx',
  },
  {
    doc: 'docs/role-walkthroughs.md',
    quote: 'voice and chat, right now',
    source: 'src/pages/admin/AdminHome.tsx',
  },
  {
    doc: 'docs/role-walkthroughs.md',
    quote: 'group inquiries',
    source: 'src/pages/admin/AdminHome.tsx',
  },
  {
    doc: 'docs/role-walkthroughs.md',
    quote: 'proposals delivered',
    source: 'src/pages/admin/AdminHome.tsx',
  },
]

describe('UI text quoted by the walkthroughs', () => {
  it.each(QUOTED_UI)('$doc quotes "$quote", which $source must still contain', ({ doc, quote, source }) => {
    const docText = readFileSync(join(repoRoot, doc), 'utf8')
    expect(docText, `${doc} no longer contains the quote this case pins; update or remove the case`).toContain(quote)

    const sourceText = readFileSync(join(repoRoot, source), 'utf8')
    expect(
      sourceText,
      `${doc} tells a reviewer the screen says "${quote}", and ${source} no longer contains that text. ` +
        `Either the UI was reworded and the walkthrough was not, or this case is pinned to the wrong file.`,
    ).toContain(quote)
  })
})
