/**
 * Every `file:line` a reviewer can check must point at what the sentence says it does.
 *
 * `README.md` and `agent/sol.md` both cited `netlify/functions/chat.ts:256` for the line that
 * restores a verified identity onto a later turn. It was correct when it was written — I argued for
 * that exact number against a proposed correction in T14 and was right at the time. PRs #28 and #41
 * then inserted lines above it, and by tonight line 256 was an `interface TurnInput` declaration.
 *
 * Nothing failed. Nothing could: a line number is prose to every tool in this repo. But it is the
 * single cheapest claim in the package for a reviewer to test, it appears beside an honest statement
 * of a real security limit, and a stale pointer there reads as carelessness about the very thing the
 * paragraph is being careful about.
 *
 * So each citation is pinned to a substring the cited line must actually contain. The map is the
 * point: a new citation with no entry fails and makes the author say what the line is for, which is
 * the check a line number cannot perform on itself.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

const DOCS = [
  'README.md',
  'SUBMISSION.md',
  'agent/sol.md',
  'docs/demo-runbook.md',
  'docs/demo-cheatsheet.md',
  'docs/latency-target.md',
  'docs/role-walkthroughs.md',
  'docs/live-modification.md',
  'docs/integration-recommendation.md',
  'docs/where-this-goes.md',
  'docs/how-this-was-built.md',
]

/** Where a bare filename in a citation actually lives. */
const RESOLVE: Record<string, string> = {
  'chat.ts': 'netlify/functions/chat.ts',
  'cleanup-phantom-sessions.mjs': 'scripts/cleanup-phantom-sessions.mjs',
  'provision.mjs': 'scripts/telnyx/provision.mjs',
  'tools.ts': 'netlify/functions/group/tools.ts',
  'rules.ts': 'netlify/functions/tools/rules.ts',
  'useAdminData.ts': 'src/components/admin/useAdminData.ts',
  'escalation.ts': 'netlify/functions/tools/escalation.ts',
  'schema.sql': 'supabase/schema.sql',
}

/**
 * What each cited line must contain. Keyed by the citation exactly as the documents write it, so
 * moving a line forces both the number and this entry to be updated together.
 */
const EXPECTED: Record<string, string> = {
  // Shifted from 283 and 146 at iteration 46: the chat channel note grew a comment block recording
  // why it no longer promises the guest that Sales will follow up. The substrings are unchanged, so
  // this guard still checks the citation means what the document says it means.
  'netlify/functions/chat.ts:303': 'saved?.guest_id',
  'chat.ts:303': 'saved?.guest_id',
  'netlify/functions/chat.ts:160': 'create_escalation',
  'cleanup-phantom-sessions.mjs:84': 'STALE_MINUTES',
  // Added with the proposal-link disclosure in iteration 102. I then "corrected" 158 to 157 off a
  // `sed -n '156,160p'` reading and this guard refused it: 158 is the function, 157 its comment.
  // The instrument was right and I was not, which is the fourth off-by-one of this kind here.
  'netlify/functions/group/store.ts:158': 'tokenMatches',
}

function citations(): { doc: string; citation: string; path: string; line: number }[] {
  const out: { doc: string; citation: string; path: string; line: number }[] = []
  for (const doc of DOCS) {
    const full = join(repoRoot, doc)
    if (!existsSync(full)) continue
    const text = readFileSync(full, 'utf8')
    for (const m of text.matchAll(/([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|sql))[:](\d+)/g)) {
      const cited = m[1]
      const path = RESOLVE[cited] ?? cited
      out.push({ doc, citation: `${cited}:${m[2]}`, path, line: Number(m[2]) })
    }
  }
  return out
}

describe('file:line citations in the deliverable', () => {
  it('finds the citations at all, so a rename cannot make this pass by scanning nothing', () => {
    expect(citations().length).toBeGreaterThanOrEqual(4)
  })

  it('points every citation at a line that exists and says what the document claims', () => {
    const problems: string[] = []

    for (const c of citations()) {
      const full = join(repoRoot, c.path)
      if (!existsSync(full)) {
        problems.push(`${c.doc}: cites ${c.citation}, but ${c.path} does not exist`)
        continue
      }

      const expected = EXPECTED[c.citation]
      if (expected === undefined) {
        problems.push(
          `${c.doc}: cites ${c.citation}, which has no entry in EXPECTED. Add one naming a ` +
            `substring that line must contain, so the citation can be checked when the file moves.`,
        )
        continue
      }

      const lines = readFileSync(full, 'utf8').split(/\r?\n/)
      const actual = lines[c.line - 1]
      if (actual === undefined) {
        problems.push(`${c.doc}: cites ${c.citation}, but that file has only ${lines.length} lines`)
      } else if (!actual.includes(expected)) {
        const moved = lines.findIndex((l) => l.includes(expected)) + 1
        problems.push(
          `${c.doc}: cites ${c.citation} for ${JSON.stringify(expected)}, but line ${c.line} is ` +
            `${JSON.stringify(actual.trim().slice(0, 70))}` +
            (moved > 0 ? ` — it looks like line ${moved} now.` : ' — and it is not in that file at all.'),
        )
      }
    }

    expect(problems, `Stale file:line citations:\n\n${problems.join('\n')}\n`).toEqual([])
  })
})

/**
 * A precise test count in a document is a claim that rots on the next commit.
 *
 * `README.md` said "308 tests" while the suite stood at 443, and "a test suite in the low 300s" in
 * two other places. The same README already explains why that happens — *"three precise counts went
 * stale inside an hour"* — and then states one anyway, a hundred lines further down.
 *
 * This does not check the number, on purpose. Counting tests from inside the suite is unreliable
 * (`it.each` expands to many, and any count would include this file), and a check that is wrong in
 * a subtle direction is worse than none. What it checks is the **shape of the claim**: state a floor
 * that stays true as tests are added, and point at the command that prints the live figure. That is
 * the README's own stated policy, enforced rather than merely written down.
 *
 *
 * **It had one exemption, and the exemption lasted one commit.** The first version skipped any count
 * followed by "across", on the argument that "443 tests across 32 test files" was a dated snapshot in
 * a paragraph that admitted as much. Two things were wrong with that. The paragraph says figures are
 * "floors or rounded", and 443 was neither — it was exact, undated, and already wrong when it was
 * committed, under-counting by exactly the two tests that same commit added to enforce this rule.
 * So the carve-out was removed rather than defended: the guard now applies with no exception, which
 * is what its first commit message claimed it did.
 * What it does NOT catch, stated so nobody trusts it further than it goes: a **band** that has
 * been outgrown. "a test suite in the low 300s" passes this check and was wrong by 140 tests.
 * Verified by restoring that exact phrase and watching it go green. Catching that needs a real
 * count, which is the thing this file deliberately does not try to produce.
 */
describe('counts stated in the README', () => {
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')

  it('never states an exact test count, because it goes stale within the hour', () => {
    const exact = [...readme.matchAll(/(?<!over\s)\b\d{2,5}\s+tests?\b(?!\s+files)/gi)]
      .map((m) => m[0])

    expect(
      exact,
      `README states an exact test count: ${exact.join(', ')}. Say "over N tests" instead and let ` +
        `\`npx vitest run\` print the live figure — the README already argues for this itself.`,
    ).toEqual([])
  })

  it('never states an exact file count either, for the same reason', () => {
    // T31 said to leave "236 files, 146 of them TypeScript" alone because both were verified correct.
    // They were. PR #74 added one test file about an hour later and all three numbers in that sentence
    // were off by one. The instruction to keep accurate figures was falsified the same way the
    // exemption above was, and by the same mechanism: three agents merging into one tree.
    const exact = [...readme.matchAll(/(?<!over\s)(?<!than\s)\b\d{2,5}\s+(?:files|test files)\b/gi)].map((m) => m[0])

    expect(
      exact,
      `README states an exact file count: ${exact.join(', ')}. Use "over N" or "more than N" — ` +
        `\`git ls-files | wc -l\` is the live answer and the same paragraph already says so.`,
    ).toEqual([])
  })

  it('still points the reader at the command that gives the live number', () => {
    expect(readme).toContain('npx vitest run')
  })
})

/**
 * A relative link in a deliverable must resolve to a file that exists.
 *
 * `README.md` and `SUBMISSION.md` are routing tables — most of their value is that a reviewer clicks
 * through them. T37 existed because two documents had no inbound link at all; the mirror of that is a
 * link pointing at a file that has moved, and a rename breaks it silently in a file nobody re-reads.
 *
 * Checked when the T37 rows were added and nothing was broken, so this starts green on purpose. It is
 * here because the cost of a dead link is paid by the reviewer, in the first file they open, and the
 * cost of the check is one pass over two documents.
 */
describe('relative links in the deliverable index', () => {
  it.each(['README.md', 'SUBMISSION.md', 'transcripts/README.md'])('every relative link in %s resolves', (doc) => {
    const full = join(repoRoot, doc)
    const text = readFileSync(full, 'utf8')

    // Markdown links to repository paths. Bare URLs and anchors are not this test's business.
    const targets = [...text.matchAll(/\]\(((?!https?:|mailto:|#)[^)]+)\)/g)].map((m) => m[1])
    // Relative links resolve against the DOCUMENT's directory, not the repo root. Extending this to
    // transcripts/README.md exposed that: its links are bare filenames beside it, and resolving them
    // from the root reported all six as broken. Unchanged for README.md and SUBMISSION.md, which sit
    // at the root, so the old behaviour was right by accident rather than by construction.
    const docDir = dirname(join(repoRoot, doc))
    const broken = targets.filter((t) => !existsSync(resolve(docDir, t.split('#')[0])))

    expect(
      broken,
      `${doc} links to ${broken.length} path(s) that do not exist: ${broken.join(', ')}. ` +
        `A reviewer clicks these; a rename breaks them without touching the document.`,
    ).toEqual([])
  })

  it('checks a meaningful number of links, so a regex change cannot make it vacuous', () => {
    const text = readFileSync(join(repoRoot, 'README.md'), 'utf8')
    const targets = [...text.matchAll(/\]\(((?!https?:|mailto:|#)[^)]+)\)/g)]
    expect(targets.length).toBeGreaterThan(10)
  })
})

/**
 * If the customer's proposal link is a public-bucket URL, the README has to say so.
 *
 * `netlify/functions/group/store.ts` builds the link a group organiser receives as
 * `${base}/storage/v1/object/public/proposals/<code>/<32 random chars>/<file>.pdf`. The bucket really
 * is public — `GET /storage/v1/bucket/proposals` returns `"public": true` — so the URL is the whole
 * credential: no login, no expiry, no revocation, and forwarding the email forwards the access.
 *
 * That is a defensible design and the same model as any share link; a proposal emailed to an
 * organiser cannot require an account on our system. What was wrong was that **no deliverable said
 * it.** This package discloses the session-identity limit, the approval gate, the supervisor audio
 * gap and the idle-session count, all in the same section, and then left out the one limit that
 * touches an outside party's pricing.
 *
 * Measured in iteration 102 before writing the disclosure, so it claims only what was tested: a
 * storage `list` on the bucket returns **zero entries** with the public anon key and with a
 * signed-in concierge token, so it cannot be walked; the real URL returns 200 `application/pdf` with
 * no credentials at all; and one altered path segment returns **400**, not another customer's
 * document.
 *
 * This guard ties the two together. While the code ships a public-bucket link, the README must carry
 * the disclosure — so removing the paragraph fails, and so does quietly moving to a signed URL
 * without updating the prose that says we do not use one.
 */
describe('the customer proposal link disclosure', () => {
  const source = 'netlify/functions/group/store.ts'
  const doc = 'README.md'
  // The code's marker is the call, not the path: Supabase builds `object/public/...` inside
  // getPublicUrl, so store.ts never contains that string. My first draft pinned the path and
  // failed immediately, which is the guard earning its keep on its own author.
  const PUBLIC_CALL = 'getPublicUrl'

  it('is only required because the code still builds a public-bucket URL', () => {
    const text = readFileSync(join(repoRoot, source), 'utf8')
    expect(
      text,
      `${source} no longer calls ${PUBLIC_CALL}. If it moved to a signed URL, the ` +
        `README paragraph saying the link never expires is now wrong -- update it and this case ` +
        `together.`,
    ).toContain(PUBLIC_CALL)
  })

  it.each([
    ['names the mechanism', 'capability URL'],
    ['says the bucket is public', 'public'],
    ['says no login is needed', 'no login'],
    ['admits there is no expiry', 'no expiry'],
    ['records that the bucket cannot be enumerated', 'zero'],
  ])('%s', (_label, needle) => {
    const limits = readFileSync(join(repoRoot, doc), 'utf8')
    const at = limits.indexOf('capability URL, not an authenticated download')
    expect(at, `${doc} no longer discloses the proposal-link model at all`).toBeGreaterThan(-1)
    // Only the disclosure paragraph, so a stray "public" elsewhere in a 300-line README cannot
    // satisfy this. The first blank-line-separated block after the heading sentence.
    const para = limits.slice(at, at + 1600).replace(/\s+/g, ' ')
    expect(para, `the disclosure no longer ${_label}`).toContain(needle)
  })
})

/**
 * A target one document publishes and another quotes must be the same number.
 *
 * `docs/latency-target.md` is the only place the commitments are set, and two of them are quoted
 * elsewhere: `docs/demo-runbook.md` justifies the pre-demo warm-up as *"about 6× the published p95 of
 * ≤300ms"*, and the same document's own argument section restates the chat signal figure. Change a
 * target in one place and the other becomes a confident quotation of a number nobody holds any more —
 * and a latency target is exactly the sort of thing that gets softened under pressure.
 *
 * Latency itself cannot be tested here; the suite is hermetic and a test that timed production would
 * fail whenever the network hiccuped. What a test can do is keep the published figures consistent with
 * each other, which is the part that rots silently.
 *
 * Measured at iteration 109, for the record rather than as an assertion: chat first-signal p50 905ms
 * then 1009ms over two passes of six turns, against the ≤1500ms committed; first prose token 2589ms
 * then 2246ms against ≤4000ms; and the tool webhook, properly sampled at 60 warm calls, p50 102ms and
 * p95 135ms against the ≤300ms committed.
 */
describe('latency targets quoted across documents', () => {
  const source = 'docs/latency-target.md'

  const TARGETS = [
    { label: 'the voice webhook p95', text: '300ms', quotedIn: ['docs/demo-runbook.md'] },
    { label: 'the chat first-signal p50', text: '1500ms', quotedIn: [] },
    { label: 'the chat first-token p50', text: '4000ms', quotedIn: [] },
  ]

  it.each(TARGETS)('$label is still published as $text', ({ text }) => {
    const doc = readFileSync(join(repoRoot, source), 'utf8')
    // Either spelling: the doc writes "300ms" in the commitment and "≤ 1.5s" in prose.
    const alt = text === '1500ms' ? '1.5s' : text === '4000ms' ? '4s' : text
    expect(
      doc.includes(text) || doc.includes(alt),
      `${source} no longer publishes ${text}. If a target moved, every document quoting it moved too.`,
    ).toBe(true)
  })

  it.each(TARGETS.filter((t) => t.quotedIn.length > 0))('$label is quoted consistently', ({ text, quotedIn }) => {
    for (const doc of quotedIn) {
      expect(
        readFileSync(join(repoRoot, doc), 'utf8'),
        `${doc} quotes a latency target published in ${source}, and no longer contains ${text}.`,
      ).toContain(text)
    }
  })
})
