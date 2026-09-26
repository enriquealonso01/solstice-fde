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

/**
 * A documented `npx <tool>` whose tool is not a project dependency has to say so.
 *
 * `SUBMISSION.md`'s last pre-send step runs `npx netlify api listSiteDeploys` to prove production is serving
 * the latest commit. `netlify-cli` is not in `package.json` — deliberately, because it is a large install and
 * adding it would slow the `npm ci` a reviewer runs first. So on a machine without the CLI, `npx` fetches it
 * before doing anything: minutes, in the one command whose job is to say *"safe to send."*
 *
 * Filed as T44 on the assumption that Enrique would hit that wait. **Measured instead:** `netlify-cli@26.0.2`
 * is installed globally here and `npx netlify --version` returns in **1.8s** against the global binary's
 * 1.3s, so `npx` resolves it from `PATH` and downloads nothing. The wait is real for a reviewer and not for
 * him — and telling him to expect minutes would have been a warning about a non-event.
 *
 * So the clause covers both, and this test keeps the pairing honest: every `npx` tool named in a deliverable
 * is either a project dependency, or the document says the first run installs it. The other two documented
 * ones, `npx vitest` and `npx vite-node`, resolve out of `node_modules`.
 */
describe('documented npx commands', () => {
  const DOCS = ['README.md', 'SUBMISSION.md', 'docs/demo-runbook.md', 'docs/live-modification.md']

  /** `npx <tool>` -> the package that provides it, where the names differ. */
  const PROVIDER: Record<string, string> = { 'vite-node': 'vite', tsc: 'typescript' }

  function projectDeps(): Set<string> {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
  }

  it('finds npx commands to judge, so this cannot pass by matching nothing', () => {
    let found = 0
    for (const doc of DOCS) {
      if (!existsSync(join(repoRoot, doc))) continue
      found += [...readFileSync(join(repoRoot, doc), 'utf8').matchAll(/npx ([a-z0-9@/-]+)/g)].length
    }
    expect(found).toBeGreaterThanOrEqual(3)
  })

  it.each(DOCS)('%s discloses the install cost of any npx tool it does not depend on', (doc) => {
    const full = join(repoRoot, doc)
    if (!existsSync(full)) return
    const text = readFileSync(full, 'utf8')
    const flat = text.replace(/\s+/g, ' ')
    const deps = projectDeps()

    const undisclosed: string[] = []
    for (const m of new Set([...text.matchAll(/npx ([a-z0-9@/-]+)/g)].map((x) => x[1]))) {
      const pkg = PROVIDER[m] ?? m
      if (deps.has(pkg)) continue
      // Not a dependency: the document has to warn that the first run installs it.
      const warns = /first run installs|installs the .{0,20}CLI|installs it first/i.test(flat)
      if (!warns) undisclosed.push(m)
    }

    expect(
      undisclosed,
      `${doc} tells the reader to run "npx ${undisclosed.join(', npx ')}", and that tool is not in ` +
        `package.json, so the first run downloads it. Say so where the command is introduced, or add the ` +
        `dependency. Unannounced, a multi-minute install reads as a hang.`,
    ).toEqual([])
  })
})
