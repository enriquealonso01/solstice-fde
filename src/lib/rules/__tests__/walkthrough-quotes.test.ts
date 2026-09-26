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
import { existsSync, readFileSync } from 'node:fs'
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
  // Added after sweeping every backticked span in the walkthrough rather than the handful I
  // remembered changing. The first pass in It73 checked a list of strings I knew I had reworded --
  // a predicted enumeration, which is the mistake this session keeps paying for. Of 24 UI-looking
  // quotes, 19 are literals in source and are pinned here; the other five are assembled at
  // runtime and were verified by hand instead (see the log for It75).
  { doc: 'docs/role-walkthroughs.md', quote: 'Clarifying questions out', source: 'src/pages/admin/GroupInbox.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'Full transcript retained', source: 'src/pages/admin/SupervisorDashboard.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'Needs decision', source: 'src/components/admin/ui.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'Supervisor took the call', source: 'src/pages/admin/SupervisorDashboard.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'audio failed', source: 'src/components/admin/SupervisorLadder.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'audio live', source: 'src/components/admin/SupervisorLadder.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'audio ready', source: 'src/components/admin/SupervisorAudioStatus.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'audio unavailable', source: 'src/components/admin/SupervisorLadder.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'browser unsupported', source: 'src/components/admin/SupervisorLadder.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'connecting audio', source: 'src/components/admin/SupervisorLadder.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'conversations, messages and actions, live', source: 'src/pages/admin/SupervisorDashboard.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'none yet', source: 'src/pages/admin/GroupInbox.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'not permitted', source: 'src/components/admin/SupervisorLadder.tsx' },
  { doc: 'docs/role-walkthroughs.md', quote: 'ready to price', source: 'src/pages/admin/GroupInbox.tsx' },
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

/**
 * Code that a demo document tells someone to type must still be in the file it names.
 *
 * `docs/live-modification.md` is the rehearsed answer to the one thing the brief says the panel will
 * ask — *"modify the system while we watch"* — and it quotes a block from `src/lib/rules/thresholds.ts`
 * with a `// <- change to 12` marker on the line to edit. PR #97 put that document in the README's
 * main table, so it is now signposted rather than buried.
 *
 * It is currently exact, checked line for line against `thresholds.ts:102-106`. The risk is not that
 * it is wrong; it is that a rename of `max_discount_auto_approve_pct`, or a reshuffle of that object,
 * breaks it silently — and the person who finds out is standing in front of the panel with the file
 * open. That is the worst possible moment for a stale snippet, which is what makes this worth one
 * pass over one file.
 *
 * Pinned as separate fragments rather than one blob so a failure says which line moved, and because
 * the document indents its copy differently from the source.
 */
describe('code the demo documents tell you to type', () => {
  const doc = 'docs/live-modification.md'
  const source = 'src/lib/rules/thresholds.ts'

  it.each([
    "'SOL-PHX': {",
    "property_code: 'SOL-PHX',",
    "property_name: 'Solstice Phoenix Camelback',",
    'group_block_auto_approve_max_rooms: 35,',
    'max_discount_auto_approve_pct: 15,',
  ])('%s appears in both the runbook snippet and thresholds.ts', (fragment) => {
    const docText = readFileSync(join(repoRoot, doc), 'utf8')
    const sourceText = readFileSync(join(repoRoot, source), 'utf8')

    expect(docText, `${doc} no longer quotes ${JSON.stringify(fragment)}; update or remove this case`).toContain(fragment)
    expect(
      sourceText,
      `${doc} tells the presenter to edit ${JSON.stringify(fragment)} in ${source}, and it is not there. ` +
        `The live-modification demo would fail with the file open in front of the panel.`,
    ).toContain(fragment)
  })

  it('names a file that exists, because the first step is opening it', () => {
    const docText = readFileSync(join(repoRoot, doc), 'utf8')
    expect(docText).toContain(source)
    expect(existsSync(join(repoRoot, source))).toBe(true)
  })
})

/**
 * When a deliverable quotes the provided policy document, the policy document must say that.
 *
 * `README.md` justified building `netlify/functions/tools/availability.ts` by asserting that
 * *"Policies 1 and 6 both hinge on `subject to same-day availability`"*. That phrase is not in
 * `data/SOLSTICE HOTEL GROUP — FRONT DESK POLICY REFERENCE.md` at all — zero occurrences. Policy 1
 * says *"based on same-day room availability"*, Policy 6 says *"based on same-day inventory"*, and
 * the nearest real phrase, *"subject to availability"*, belongs to the Gold 1:00 PM clause, where it
 * marks a benefit as conditional — the opposite of the guaranteed benefit the README was arguing
 * about. So the one quotation in the package that a reviewer can check against the material they
 * supplied was invented, in the paragraph defending the only net-new service.
 *
 * Quoting the brief's own document is a different risk from quoting our UI: nobody here can reword
 * the source to make a stale quote true again, and a reviewer holds the original. Wrong here is
 * always our error and always visible.
 *
 * Pinned as an explicit list for the same reason as the block above — most quoted spans in these
 * documents are things a *guest* says, not policy text, and a parser that guessed would fail on
 * every one of them. A sweep of all twelve deliverables at the time of writing found exactly these
 * two spans that appear in the policy reference; a new one must be added here deliberately.
 */
describe('quotations of the provided policy document', () => {
  const policy = 'data/SOLSTICE HOTEL GROUP — FRONT DESK POLICY REFERENCE.md'

  /** Whitespace-insensitive: the documents wrap these quotes across lines, the policy file does not. */
  const flatten = (s: string) => s.replace(/\s+/g, ' ')

  it.each([
    { doc: 'README.md', quote: 'based on same-day room availability' },
    { doc: 'README.md', quote: 'based on same-day inventory' },
  ])('$doc quotes "$quote", which the policy reference must actually say', ({ doc, quote }) => {
    const docText = flatten(readFileSync(join(repoRoot, doc), 'utf8'))
    expect(docText, `${doc} no longer contains the quote this case pins; update or remove the case`).toContain(quote)

    const policyText = flatten(readFileSync(join(repoRoot, policy), 'utf8'))
    expect(
      policyText,
      `${doc} presents ${JSON.stringify(quote)} as a quotation from the policy reference the brief ` +
        `supplied, and that document does not contain it. A reviewer has the original open.`,
    ).toContain(quote)
  })

  it('reads a policy reference that is actually there, so a rename cannot make this vacuous', () => {
    expect(existsSync(join(repoRoot, policy))).toBe(true)
    expect(readFileSync(join(repoRoot, policy), 'utf8').length).toBeGreaterThan(1000)
  })
})
