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
import { compileInstructions } from '../../../../scripts/telnyx/provision.mjs'

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

/**
 * The refusals a walkthrough promises must be the refusals the code returns, with their status codes.
 *
 * `docs/role-walkthroughs.md` has a section called *"Proving the boundary, in ten seconds"*. It is the
 * answer the document gives when a panel member asks whether the security is real or just the UI, and
 * it works by quoting two exact responses: a **403** with a sentence about row level security when a
 * concierge token asks `/api/group/proposals`, and a **401** with
 * `Authorization: Bearer <supabase access token> is required.` when the header is dropped. Its point
 * is that these are *two different refusals*, because "who are you" and "you are not allowed" are two
 * different questions.
 *
 * Both strings are literals in `netlify/functions/group/auth.ts`, each sitting beside its status code.
 * Reword either, or swap a code, and the walkthrough is wrong in the one place it invites a reviewer
 * to check it with a command — and nothing would have said so. The Tester had already caught the
 * earlier version of this section promising a 403 where the browser only produced a redirect
 * (iteration 60), which is how the section came to be written around the API in the first place.
 *
 * Verified live in iteration 101 before pinning: the deployed function returns exactly these two
 * bodies and codes, and underneath them a concierge token reading `inquiries` through PostgREST gets
 * 0 rows of 13 while `group_sales` reading `sessions` gets 0 of 180.
 */
describe('refusals the walkthrough quotes', () => {
  const doc = 'docs/role-walkthroughs.md'
  const source = 'netlify/functions/group/auth.ts'
  const flat = (s: string) => s.replace(/\s+/g, ' ')

  const CASES = [
    {
      label: 'the 403 a concierge gets from the group lane',
      status: 403,
      message:
        'This role cannot see group sales. Group sales inquiries are readable by group_sales and ' +
        'admin only, which is what row level security enforces in the database as well.',
    },
    {
      label: 'the 401 for a request with no token',
      status: 401,
      message: 'Authorization: Bearer <supabase access token> is required.',
    },
  ]

  it.each(CASES)('$label is still the text the doc quotes', ({ message }) => {
    expect(flat(readFileSync(join(repoRoot, doc), 'utf8'))).toContain(flat(message))
  })

  it.each(CASES)('$label is still what $source returns', ({ message }) => {
    expect(
      flat(readFileSync(join(repoRoot, source), 'utf8')),
      `${doc} tells a reviewer to run a curl and shows this exact body. ${source} no longer ` +
        `contains it, so the command a panel member is invited to paste prints something else.`,
    ).toContain(flat(message))
  })

  it.each(CASES)('$label keeps its status code, which is the whole point', ({ message, status }) => {
    // The two refusals are only evidence because they differ. Matching the message and the code
    // together is what stops one of them quietly becoming the other.
    const text = flat(readFileSync(join(repoRoot, source), 'utf8'))
    const at = text.indexOf(flat(message))
    expect(at, `${message} is not in ${source}`).toBeGreaterThan(-1)
    const window = text.slice(at, at + flat(message).length + 60)
    expect(
      window,
      `${source} returns that message with a different status than the ${status} ${doc} shows. ` +
        `The section's argument is that "who are you" and "you are not allowed" answer differently.`,
    ).toContain(`status: ${status}`)
  })
})

/**
 * The fabricated policy quotation, banned by name and across line breaks.
 *
 * Iteration 93 found `README.md` attributing *"subject to same-day availability"* to Policies 1 and 6
 * when that phrase appears **zero** times in the policy document the brief supplied, and fixed it
 * there. It was in two more places, and the sweep that should have found them could not:
 *
 *   - `agent/sol.md` — wrapped across a line break, `same-day` ending one line and `availability`
 *     starting the next, so a line-oriented `grep` reported nothing. **And that copy reached the
 *     compiled voice prompt**, so the live phone agent was carrying an invented quotation of the
 *     interviewers' own document.
 *   - `netlify/functions/tools/availability.ts` — the header comment of the very service the
 *     quotation exists to justify.
 *
 * That is the third time this session a line wrap has defeated a check. The lesson is in the shape of
 * this test rather than its subject: **normalise whitespace before searching a document for a
 * phrase**, because prose wraps and the thing you are looking for does not care where.
 *
 * The positive cases above pin the two real phrases. This one bans the invented one, which no
 * "quote must exist in the source" rule can catch — an invented quotation has no source to check it
 * against. It also checks the compiled prompt directly, because that is the artifact the phone agent
 * actually runs on, and it is the only one of the three copies that a guest could be told.
 */
describe('the invented policy phrase stays gone', () => {
  const PHRASE = 'subject to same-day availability'
  const flat = (s: string) => s.replace(/\s+/g, ' ')

  /** This file has to name the phrase to explain itself; nothing else may. */
  const SELF = 'src/lib/rules/__tests__/walkthrough-quotes.test.ts'

  const FILES = [
    'README.md',
    'SUBMISSION.md',
    'agent/sol.md',
    'netlify/functions/tools/availability.ts',
    'docs/demo-runbook.md',
    'docs/demo-cheatsheet.md',
    'docs/role-walkthroughs.md',
    'docs/how-this-was-built.md',
    'docs/integration-recommendation.md',
    'docs/where-this-goes.md',
    'docs/live-modification.md',
    'docs/latency-target.md',
  ]

  it('is genuinely absent from the policy document, which is why it may not be quoted', () => {
    const policy = readFileSync(
      join(repoRoot, 'data/SOLSTICE HOTEL GROUP — FRONT DESK POLICY REFERENCE.md'),
      'utf8',
    )
    expect(flat(policy)).not.toContain(PHRASE)
  })

  it.each(FILES)('%s does not attribute it to the policy document', (file) => {
    const full = join(repoRoot, file)
    if (!existsSync(full)) return
    expect(
      flat(readFileSync(full, 'utf8')),
      `${file} quotes ${JSON.stringify(PHRASE)} as policy language. It is in no policy. Policy 1 ` +
        `says "based on same-day room availability" and Policy 6 "based on same-day inventory". ` +
        `Compared with whitespace flattened, because the copy in agent/sol.md hid across a line break ` +
        `from the sweep that was meant to catch it.`,
    ).not.toContain(PHRASE)
  })

  it('never reaches the compiled voice prompt, which is what a caller hears from', () => {
    const compiled = compileInstructions(readFileSync(join(repoRoot, 'agent/sol.md'), 'utf8'))
    expect(
      flat(compiled.instructions),
      'The live phone agent is carrying an invented quotation of the policy document the ' +
        'interviewers wrote. This is the copy that can reach a guest.',
    ).not.toContain(PHRASE)
  })

  it('keeps this file the only place the phrase is written down', () => {
    // If the ban ever has to be lifted, the exemption should be a deliberate edit here.
    expect(flat(readFileSync(join(repoRoot, SELF), 'utf8'))).toContain(PHRASE)
  })
})

/**
 * The cheat sheet's $45 row must not promise what the reservation's own data forbids.
 *
 * `docs/demo-cheatsheet.md` told Enrique that a disputed $45 minibar charge is inside the $50
 * per-stay front-desk authority *"so Sol actions it without a manager and says why."* Run against
 * production it does the opposite: it calls `check_comp_authority`, then `create_escalation`, and says
 * *"I'm getting the property's AGM to review that $45 charge -- I can't adjust the folio myself."*
 *
 * The agent is right and the row was wrong. R55006's `internal_notes`, in the data the brief supplied,
 * read *"Do not adjust folio directly -- escalate to property AGM for review"*, and the tool passes that
 * through as a staff directive. So a per-reservation operational instruction overrides a generic
 * threshold — which is a better beat than the row claimed, and it is the interviewers' own data doing
 * the overriding.
 *
 * The Tester found this row wrong once before (iteration 59, *"the $45 minibar beat does the opposite of
 * what the line promises"*). It came back. That is what earns it a guard rather than a third correction:
 * while the note says escalate, no document may say the charge is actioned without a manager.
 *
 * Verified against production before pinning: $45 and $50 return `front_desk` with
 * `escalation_required: false`, $55 returns `agm`, and $45 + $25 returns `agm` with Policy 7's sum
 * printed. Those numbers are what make the row's "measured" clause true, so they stay in it.
 */
describe('the disputed-charge row against the reservation it names', () => {
  const RES = 'R55006'
  const flat = (s: string) => s.replace(/\s+/g, ' ')

  function internalNotes(): string {
    const raw = readFileSync(join(repoRoot, 'data/generated/reservations.json'), 'utf8')
    const rows = JSON.parse(raw) as { reservation_id?: string; internal_notes?: string | null }[]
    const row = (Array.isArray(rows) ? rows : []).find((r) => r.reservation_id === RES)
    expect(row, `${RES} is not in data/generated/reservations.json`).toBeTruthy()
    return row?.internal_notes ?? ''
  }

  it('reads the directive the demo data actually carries', () => {
    expect(flat(internalNotes()).toLowerCase()).toContain('escalate to property agm')
  })

  it('does not tell the presenter the charge is actioned without a manager', () => {
    // Only meaningful while the directive is there; if the data changes, the first case fails first.
    const sheet = flat(readFileSync(join(repoRoot, 'docs/demo-cheatsheet.md'), 'utf8'))
    for (const claim of ['actions it without a manager', 'without manager approval', 'no manager needed']) {
      expect(
        sheet,
        `docs/demo-cheatsheet.md claims the ${RES} charge is handled without a manager, and that ` +
          `reservation's internal_notes say "escalate to property AGM for review". The Tester caught ` +
          `this row saying the opposite of what happens once already, at iteration 59.`,
      ).not.toContain(claim)
    }
  })

  it('still tells the presenter the escalation is what to expect', () => {
    const sheet = flat(readFileSync(join(repoRoot, 'docs/demo-cheatsheet.md'), 'utf8'))
    expect(sheet.toLowerCase()).toContain('escalate to property agm')
  })

  /**
   * Rehearsed end to end on production at iteration 143 — the Tester's iteration 59 left this row
   * FIXED-PENDING and nobody had driven the replacement wording. Three chips appear: `get_reservation`,
   * `check_comp_authority` reading *"$45.00 — inside front desk authority"*, and **`create_escalation` to
   * `agm`**. So the row's central claim is true and now measured: the threshold returns
   * `escalation_required: false` and an escalation is created anyway, from R55006's own directive.
   *
   * Two things it promised were not on screen. Sol's prose named **neither** figure — *"I can't remove
   * that myself … I've flagged it for the AGM at Solstice Tampa Bayshore today"* — while the row said
   * *"Sol confirms the amount is inside the $50 per-stay front-desk authority."* And the itemised
   * arithmetic the row said *"the tool prints"* is real but lives in `human_reason`: the model reads it and
   * the supervisor trace shows it, while `chat.ts` sends only `summary` and `citations` to the bubble.
   *
   * Same distinction as iteration 128's *"cites Policy 1"* — true via the chip, not the prose. A presenter
   * pointing at the wrong part of the screen is worse than a wrong sentence, because the panel is looking
   * where he points.
   */
  const chatFn = () => readFileSync(join(repoRoot, 'netlify/functions/chat.ts'), 'utf8')

  /** Does the chat stream actually hand the browser the tool's reasoning field? */
  const bubbleShowsReasoning = () => {
    const src = chatFn()
    const at = src.indexOf("status: 'done'")
    if (at === -1) return false
    return /human_reason/.test(src.slice(at, at + 400))
  }

  it('finds the chat tool event, so the cases below are not vacuous', () => {
    expect(chatFn(), 'chat.ts no longer emits a done tool event; re-point these cases').toContain("status: 'done'")
  })

  it('does not promise the bubble shows what only the trace shows', () => {
    if (bubbleShowsReasoning()) return // Implemented for real: the row is then free to say so.
    const sheet = flat(readFileSync(join(repoRoot, 'docs/demo-cheatsheet.md'), 'utf8'))
    for (const claim of ['the tool prints the arithmetic', 'tool prints the sum']) {
      expect(
        sheet,
        `docs/demo-cheatsheet.md says "${claim}", and chat.ts's done event carries only summary and ` +
          `citations — the arithmetic is in human_reason, which the model reads and the supervisor trace ` +
          `shows. Told this, Enrique points at the bubble for a sentence that is not in it, with the panel ` +
          `following his hand.`,
      ).not.toContain(claim)
    }
  })

  it('does not claim Sol says a figure it does not say', () => {
    const sheet = flat(readFileSync(join(repoRoot, 'docs/demo-cheatsheet.md'), 'utf8'))
    expect(
      sheet,
      'docs/demo-cheatsheet.md again claims Sol confirms the amount is inside the $50 authority. Measured ' +
        'on production, Sol names neither $45 nor $50 — the check_comp_authority chip carries both. Say ' +
        'which part of the screen holds the number.',
    ).not.toContain('Sol confirms the amount is inside the $50')
  })

  it('points the presenter at the chips, which is where the numbers are', () => {
    const sheet = flat(readFileSync(join(repoRoot, 'docs/demo-cheatsheet.md'), 'utf8'))
    expect(
      sheet,
      'the row no longer tells the presenter where to look. The beat only lands if the panel sees the ' +
        'authority finding and the escalation next to each other, and both are chips.',
    ).toMatch(/chip/i)
  })
})

/**
 * The one guest with two reservations must be flagged wherever the demo uses him.
 *
 * `G10004`, Michael Chen, is the **only** guest in the supplied data with more than one reservation — Denver
 * 20–23 July (`R55004`) and Austin 5–7 September (`R55015`) — and he is the guest the cheat sheet's showpiece
 * beat uses. `identify_guest` returns both and marks the nearer one, Austin, as `most_relevant_reservation_id`.
 *
 * On the **upgrade** question the two stays give opposite answers, measured against production at iteration
 * 126:
 *
 *     check_upgrade_eligibility {"guest_id":"G10004"}        may_promise TRUE   Austin has suite inventory
 *     check_upgrade_eligibility {"reservation_id":"R55004"}  may_promise FALSE  Denver has none, escalates
 *
 * So the refusal the cheat sheet calls *"the better moment of the two"* becomes a confirmation if the wrong
 * stay resolves. It is not broken today — Sol uses the confirmation number a guest gives, verified on two live
 * runs — but nothing written down made it correct, and two runs is evidence rather than reliability.
 *
 * A prompt clause was considered and **declined**: the margin is 216 characters and a usable clause is ~130,
 * which is the wrong trade nine hours before a demo. The fix is that the presenter is told, so this pins the
 * telling: while the data has a guest with two reservations, the cheat sheet must name the second one.
 */
describe('the guest with two reservations', () => {
  const GUEST = 'G10004'

  function reservationsFor(guest: string): string[] {
    const raw = readFileSync(join(repoRoot, 'data/generated/reservations.json'), 'utf8')
    const rows = JSON.parse(raw) as { reservation_id?: string; guest_id?: string }[]
    return (Array.isArray(rows) ? rows : []).filter((r) => r.guest_id === guest).map((r) => r.reservation_id ?? '')
  }

  it('is still the only guest with more than one, or this case needs rewriting', () => {
    const raw = readFileSync(join(repoRoot, 'data/generated/reservations.json'), 'utf8')
    const rows = JSON.parse(raw) as { guest_id?: string }[]
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.guest_id ?? '', (counts.get(r.guest_id ?? '') ?? 0) + 1)
    const multi = [...counts].filter(([, n]) => n > 1).map(([g]) => g)
    expect(
      multi,
      `The set of guests with two reservations has changed. The cheat sheet warns about ${GUEST} by name; ` +
        `any other such guest needs the same warning wherever the demo uses them.`,
    ).toEqual([GUEST])
  })

  it('has both of its reservations named in the cheat sheet', () => {
    const sheet = readFileSync(join(repoRoot, 'docs/demo-cheatsheet.md'), 'utf8')
    for (const id of reservationsFor(GUEST)) {
      expect(
        sheet,
        `docs/demo-cheatsheet.md does not mention ${id}. ${GUEST} has two stays that answer the upgrade ` +
          `question oppositely, so the presenter has to be told to give the confirmation number.`,
      ).toContain(id)
    }
  })

  it('tells the presenter why the number matters, not just that there are two', () => {
    const sheet = readFileSync(join(repoRoot, 'docs/demo-cheatsheet.md'), 'utf8').replace(/\s+/g, ' ')
    expect(sheet).toMatch(/[Aa]lways give the confirmation number/)
  })

  it('explains the second reservation where the transcripts cite it', () => {
    // Two committed captures cite R55015 for a guest the cheat sheet calls "Denver". Neither is wrong --
    // a late checkout is a tier guarantee either way -- but unexplained it reads as a mismatch.
    const readme = readFileSync(join(repoRoot, 'transcripts/README.md'), 'utf8').replace(/\s+/g, ' ')
    const cites = ['platinum-late-checkout.md', 'voice-call.md']
      .map((f) => readFileSync(join(repoRoot, 'transcripts', f), 'utf8'))
      .some((t) => t.includes('R55015'))
    if (!cites) return
    expect(
      readme,
      `A capture cites R55015 while the cheat sheet calls this guest "Denver". transcripts/README.md has to ` +
        `say why, or a reviewer who notices has found something unexplained in a named deliverable.`,
    ).toContain('R55015')
  })
})
