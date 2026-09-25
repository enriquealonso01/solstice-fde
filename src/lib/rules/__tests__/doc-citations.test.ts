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
  'netlify/functions/chat.ts:283': 'saved?.guest_id',
  'chat.ts:283': 'saved?.guest_id',
  'netlify/functions/chat.ts:146': 'create_escalation',
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
