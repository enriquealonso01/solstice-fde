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
import { join, resolve } from 'node:path'
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
