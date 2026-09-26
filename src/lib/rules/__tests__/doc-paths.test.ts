/**
 * A path named in a deliverable must resolve to something real.
 *
 * This test exists because I was wrong, and it is the thing that proved it.
 *
 * Auditing `docs/how-this-was-built.md` — the document `SUBMISSION.md` points at for the "build it
 * with agents" ask — I checked its ownership table with `test -e voice` from the repository root, saw
 * nothing, confirmed with `git log --all -- voice`, saw nothing again, and concluded a named
 * deliverable listed a directory that had never existed. Both commands are root-relative. The
 * directory is `netlify/functions/voice/`, and the table was using the same shorthand as the row two
 * above it, which writes `tools/` for `netlify/functions/tools/`.
 *
 * The guard resolves a reference from the repository root, from beside the document, **or** as an
 * unambiguous suffix of exactly one path in the tree — and under that third rule `voice/` resolves.
 * Reinstating the phantom as a red-check is what surfaced the mistake, before the edit shipped.
 *
 * The third rule is not laxity, it is how these documents write: A3's row lists `tools/` beside
 * `netlify/functions/chat.ts`, and `docs/README-diagram.md` names `architecture.svg`, its own
 * sibling. A first version resolved only from the root and called six such references dead ends. All
 * six were false positives, which is the failure that teaches people to ignore a guard.
 *
 * What it still catches is a genuine dead end: a path that matches nothing from any angle. The
 * existing guards cover `file.ts:NN` citations and markdown links; a bare backticked path is the
 * third shape, and nothing covered it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

const DOCS = [
  'docs/how-this-was-built.md',
  'docs/integration-recommendation.md',
  'docs/where-this-goes.md',
  'docs/README-diagram.md',
  'README.md',
  'SUBMISSION.md',
]

/** Looks like a repository path rather than prose: has a slash, or a source-file extension. */
const PATHISH = /^(?:[A-Za-z0-9_@.-]+\/)+[A-Za-z0-9_.-]*$|^[A-Za-z0-9_.-]+\.(?:ts|tsx|mjs|json|sql|md|svg|drawio|csv)$/

/** Paths that are patterns or examples rather than a file on disk, each for a stated reason. */
const NOT_ON_DISK = new Set([
  'data/generated/*.json', // a glob, written as one
  'netlify/functions/tools/<tool_name>', // a URL template
  'src/pages/admin/', // exists, but listed here only if a rename ever makes it a pattern
])

/**
 * A path that is deliberately not in the repository is not a dead end -- but only when the document
 * says so.
 *
 * `README.md` and `SUBMISSION.md` both point at `DEMO_LOGINS.md`, which `npm run seed:users` writes and
 * `.gitignore` excludes on purpose: it holds a working password for the demo admin account and the
 * repository is public. In this working tree the file exists, so this test passed. **Cloned fresh, as a
 * reviewer does, it failed** -- found at iteration 112 by running the suite in an LF clone of the public
 * repo rather than here.
 *
 * So the exemption has to earn itself twice: `.gitignore` must name the path, and the document naming it
 * must say so nearby -- `gitignored` or `not committed` -- so no genuine dead end can hide behind this
 * rule. Both files already do
 * : SUBMISSION.md says *"gitignored, on Enrique's machine"*, README.md says *"which is deliberately
 * not committed"*. The first version of this predicate accepted only the word `gitignored`, so it
 * would have had me reword a perfectly clear README sentence to satisfy a regex -- the same
 * tail-wagging-the-dog mistake as iteration 106. Widen the predicate, not the document.
 */
const GITIGNORED = new Set(
  readFileSync(join(repoRoot, '.gitignore'), 'utf8')
    .split('\n')  // trim() below removes a carriage return, so no escape is needed here
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')),
)

function deliberatelyAbsent(candidate: string, docText: string): boolean {
  if (!GITIGNORED.has(candidate)) return false
  const flat = docText.replace(/\s+/g, ' ')
  const at = flat.indexOf(candidate)
  if (at === -1) return false
  return /gitignored|not committed|not in this repository|never in this repository/i.test(flat.slice(at, at + 160))
}

/**
 * A reference resolves if it names something real from any angle a reader would try: from the repo
 * root, from beside the document, or as an unambiguous suffix of exactly one path in the tree.
 *
 * The third case is not laxity, it is how these documents actually write. A3's row says
 * `netlify/functions/chat.ts`, `tools/`, `agent/sol.md` — `tools/` is obviously the directory next to
 * chat.ts. `docs/README-diagram.md` names `architecture.svg`, its own sibling. A first version of this
 * test resolved only from the root and reported six of those as dead ends; every one was a false
 * positive, which is the failure that teaches people to ignore a guard.
 */
function allPaths(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(repoRoot, dir))) {
    if (['node_modules', '.git', 'dist', '.netlify', 'coverage'].includes(name)) continue
    const rel = dir ? `${dir}/${name}` : name
    out.push(rel)
    if (statSync(join(repoRoot, rel)).isDirectory()) allPaths(rel, out)
  }
  return out
}

const EVERY_PATH = allPaths('')

function resolves(candidate: string, doc: string): boolean {
  const clean = candidate.replace(/\/$/, '')
  if (existsSync(join(repoRoot, clean))) return true
  if (existsSync(resolve(dirname(join(repoRoot, doc)), clean))) return true
  const suffix = EVERY_PATH.filter((p) => p === clean || p.endsWith(`/${clean}`))
  return suffix.length === 1
}

describe('paths named in the deliverables', () => {
  it('finds paths to check, so a regex change cannot make this vacuous', () => {
    let found = 0
    for (const doc of DOCS) {
      if (!existsSync(join(repoRoot, doc))) continue
      const text = readFileSync(join(repoRoot, doc), 'utf8')
      found += [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((c) => PATHISH.test(c)).length
    }
    expect(found).toBeGreaterThan(20)
  })

  it.each(DOCS)('every path %s names exists on disk', (doc) => {
    const full = join(repoRoot, doc)
    if (!existsSync(full)) return

    const text = readFileSync(full, 'utf8')
    const missing = [...text.matchAll(/`([^`\n]+)`/g)]
      .map((m) => m[1])
      .filter((c) => PATHISH.test(c))
      .filter((c) => !c.includes('*') && !c.includes('<'))
      .filter((c) => !NOT_ON_DISK.has(c))
      .filter((c) => !deliberatelyAbsent(c, text))
      .filter((c) => !resolves(c, doc))

    expect(
      [...new Set(missing)],
      `${doc} names paths that do not exist: ${[...new Set(missing)].join(', ')}. A reviewer reading ` +
        `this is being pointed at the repository's structure; a path that is not there is a dead end.`,
    ).toEqual([])
  })
})

/**
 * `AGENTS.md` sits at the top of a public repository and had never been checked by anything.
 *
 * It is the working agreement the build started under, and at iteration 119 three of its statements were no
 * longer true: the "Known blockers" section still asserted a **$0.00** Telnyx balance, an Anthropic key that
 * **400s**, and a Supabase schema that **may not be applied** — measured that morning as $3.03 with a number
 * on the account, `/api/chat` returning 200, and a service-role read of `sessions` returning 200. And
 * non-negotiable 2, *"Do not run git. The orchestrator commits"*, is contradicted by a git history of
 * agent-opened PRs and by `agents/README.md`, which documents the ship sequence each agent now runs.
 *
 * A reviewer reading a root-level file that says the Anthropic key does not work concludes something about
 * the system that is not true, and a stated non-negotiable contradicted by the commit log is the kind of
 * internal inconsistency that takes seconds to spot.
 *
 * The original text was left intact — it is honest history, and the same append-only reasoning applies as to
 * `HUMAN_INTERVENTION.md`'s 15:30 list. What this pins is that the correction stays attached to it, and that
 * the four plan files its first line sends a reader to keep existing. Those four were checked and all four
 * are there, which is the part of the file that was fine.
 */
describe('AGENTS.md, the root working agreement', () => {
  const FILE = 'AGENTS.md'

  it('still names plan files that exist, since its first line sends a reader to them', () => {
    const text = readFileSync(join(repoRoot, FILE), 'utf8')
    const referenced = [...text.matchAll(/`(plans\/[A-Za-z0-9_.-]+\.md)`/g)].map((m) => m[1])
    expect(referenced.length, 'AGENTS.md no longer references any plan file; update or remove this case').toBeGreaterThanOrEqual(4)
    const missing = referenced.filter((p) => !existsSync(join(repoRoot, p)))
    expect(missing, `${FILE} sends a reader to plans that are not there: ${missing.join(', ')}`).toEqual([])
  })

  it('does not assert its resolved blockers without the correction attached', () => {
    const flat = readFileSync(join(repoRoot, FILE), 'utf8').replace(/\s+/g, ' ')
    const stale = [
      'Telnyx balance is $0.00',
      'currently 400s',
      'schema may not be applied yet',
    ].filter((claim) => flat.includes(claim))

    if (stale.length === 0) return // the section was rewritten rather than annotated; also fine

    expect(
      flat,
      `${FILE} still states ${stale.length} blocker(s) that are resolved — ${stale.join('; ')} — and this ` +
        `file is at the top of a public repository. Keeping the original text is fine, but the dated ` +
        `correction has to stay with it, or a reviewer reads a live claim that the system does not work.`,
    ).toMatch(/Update, \d{4}-\d{2}-\d{2} — what below is superseded/)
  })

  it('points at the protocol that is actually in force', () => {
    const flat = readFileSync(join(repoRoot, FILE), 'utf8').replace(/\s+/g, ' ')
    if (!flat.includes('Do not run git')) return
    expect(
      flat,
      `${FILE} still carries "Do not run git" as a non-negotiable. Every agent branches, commits and ` +
        `deploys now, so the correction must point at agents/README.md, which documents that sequence.`,
    ).toContain('agents/README.md')
  })
})

/**
 * A dated audit may keep its verdicts, but not silently.
 *
 * `plans/05-requirements-audit.md` states **verdicts** — DONE, PARTIAL, MISSING — against the brief's
 * requirements, and `AGENTS.md`'s first line routes a reader into that family of files. It was written
 * 2026-09-24 and by iteration 125 eight of its rows had moved, every one of them in the direction of
 * understating the package: the latency target it records as missed is met, the live modification it calls
 * unrehearsed is rehearsed and written up, the 7 assumptions are 9, the 5 transcripts are 6, the flaky-test
 * risk is closed by `vitest.setup.ts`, and the net-new tool is named by a name a test now bans.
 *
 * A reviewer reading *"PARTIAL — never been rehearsed"* concludes the work stopped short. That is the same
 * failure as iteration 106's runbook, where our own notes claimed a defect we had fixed, and iteration 119's
 * `AGENTS.md`, which asserted a dead API key.
 *
 * The original stays: it is an honest snapshot and reads as one. What this pins is that the correction stays
 * attached to it — the same shape as the `AGENTS.md` case above, and for the same reason.
 */
describe('the requirements audit', () => {
  const FILE = 'plans/05-requirements-audit.md'

  it('still states verdicts, which is why the correction matters', () => {
    const text = readFileSync(join(repoRoot, FILE), 'utf8')
    expect(text, `${FILE} no longer records PARTIAL verdicts; update or remove this case`).toMatch(/\*\*PARTIAL\*\*/)
  })

  it('carries a dated correction while those verdicts stand', () => {
    const text = readFileSync(join(repoRoot, FILE), 'utf8')
    expect(
      text,
      `${FILE} states 2026-09-24 verdicts with no dated update. Eight of them had moved by iteration 125, ` +
        `all understating the package -- a reviewer reads "PARTIAL, never rehearsed" as work that stopped ` +
        `short. Rewriting the rows instead of annotating them also satisfies this, once the PARTIALs are gone.`,
    ).toMatch(/Update, \d{4}-\d{2}-\d{2} —/)
  })

  it('does not name the net-new tool by the name a test bans', () => {
    // `availability_service` was renamed at PR #9 and tool-naming.test.ts exists to keep it gone from code.
    // The audit named it as current; the correction says what it is now. Planning files may recall the old
    // name as history, so this checks only that the correction is present to explain it.
    const text = readFileSync(join(repoRoot, FILE), 'utf8')
    if (!text.includes('availability_service')) return
    expect(
      text.replace(/\s+/g, ' '),
      `${FILE} names availability_service without the correction that says the name is gone from the code.`,
    ).toContain('that name no longer exists in the code')
  })
})
