/**
 * A command a document tells someone to run must exist.
 *
 * `docs/demo-runbook.md` is followed under time pressure, minutes before a panel joins. Its tidy step
 * read *"Run it with no flag first to see the count, then `npm run demo:tidy` to close them"* — and
 * `demo:tidy` **is** the `--delete` run. There was no flagless script, so the instruction could not be
 * followed: the reader either runs the destructive command blind or reconstructs a raw `node`
 * invocation with an audience waiting. `demo:preview` now exists and the runbook names it.
 *
 * This pins the general case. Every `npm run X` in a document a reviewer or presenter follows must be
 * a real script — a documented command that does not exist fails at the worst possible moment, and
 * nothing else in the suite would notice, because scripts are data in `package.json` rather than code
 * anything imports.
 *
 * It checks the direction that matters. An unused script is housekeeping; a documented command that
 * does not exist is a dead end in front of an audience.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const scripts = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts as Record<string, string>

const DOCS = [
  'README.md',
  'SUBMISSION.md',
  'docs/demo-runbook.md',
  'docs/demo-cheatsheet.md',
  'docs/live-modification.md',
  'docs/role-walkthroughs.md',
  'docs/integration-recommendation.md',
]

function documentedCommands(): { doc: string; script: string }[] {
  const out: { doc: string; script: string }[] = []
  for (const doc of DOCS) {
    const full = join(repoRoot, doc)
    if (!existsSync(full)) continue
    const text = readFileSync(full, 'utf8')
    for (const m of text.matchAll(/\bnpm run ([a-z0-9:_-]+)/g)) out.push({ doc, script: m[1] })
  }
  return out
}

describe('npm commands named in the deliverables', () => {
  it('finds commands to check, so a rename cannot make this vacuous', () => {
    expect(documentedCommands().length).toBeGreaterThan(5)
  })

  it('every documented command is a real script', () => {
    const missing = documentedCommands()
      .filter(({ script }) => !(script in scripts))
      .map(({ doc, script }) => `${doc}: npm run ${script}`)

    expect(
      [...new Set(missing)],
      `A document tells someone to run a script that does not exist:\n\n${[...new Set(missing)].join('\n')}\n\n` +
        `Available: ${Object.keys(scripts).join(', ')}`,
    ).toEqual([])
  })

  it('keeps the preview separate from the destructive tidy', () => {
    // The pair is the point: demo:tidy deletes and closes, demo:preview does neither. If they ever
    // became the same command the runbook's "see the count first" step would silently start deleting.
    expect(scripts['demo:preview'], 'demo:preview is missing').toBeDefined()
    expect(scripts['demo:preview']).not.toContain('--delete')
    expect(scripts['demo:tidy']).toContain('--delete')
  })
})
