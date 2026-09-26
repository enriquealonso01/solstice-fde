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
