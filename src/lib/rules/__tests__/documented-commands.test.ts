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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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

/**
 * A script a reviewer is told to run must refuse, not crash.
 *
 * `README.md`'s "Running it locally" block used to be six steps in one list, and a reviewer cannot do
 * step two — `cp .env.example .env  # then fill it in` — because there is nothing in this repository to
 * fill it in with. Following it in order, iteration 138 measured what they hit:
 *
 *   npm run db:schema   prints the three ways to apply the schema        fine
 *   npm run db:seed     "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set" + where to get them
 *   npm run seed:users  an unhandled ENOENT on .env, with a stack trace and an absolute path
 *
 * The third had the right checks waiting two lines below the crash: it read `.env` with an unguarded
 * `readFileSync`, so it never reached them. `scripts/telnyx/export-assistant.mjs` had the same bug, in a
 * file whose own header says it exists "so a reviewer can see the actual agent configuration".
 *
 * `scripts/data/lib/env.mjs` already solved this — `loadEnv()` returns quietly when `.env` is absent and
 * falls back to the shell. The rule is to use it.
 */
describe('scripts that read .env', () => {
  const mjs = (function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (entry.name.endsWith('.mjs')) out.push(full)
    }
    return out
  })(join(repoRoot, 'scripts'))

  const readsEnvFile = mjs.filter((f) => /['"`]\.env['"`]/.test(readFileSync(f, 'utf8')))

  it('finds scripts that touch .env, so this cannot pass by matching nothing', () => {
    expect(mjs.length, 'no .mjs scripts found at all').toBeGreaterThan(5)
    expect(
      readsEnvFile.length,
      'no script mentions .env any more; if the loader changed, update this case',
    ).toBeGreaterThan(0)
  })

  it.each(readsEnvFile.map((f) => relative(repoRoot, f).split('\\').join('/')))(
    '%s survives .env being absent',
    (rel) => {
      const src = readFileSync(join(repoRoot, rel), 'utf8')
      const unguardedRead = /readFileSync\(\s*(?:resolve|join)\([^)]*['"`]\.env['"`]\s*\)/.test(src)
      // Matched as code, not as prose. The first version tested `src.includes('loadEnv')`, which the
      // comment explaining loadEnv satisfies all by itself — so a red-check that removed the import and
      // the call still passed, defeated by the sentence describing the fix.
      const guarded =
        /from\s+['"][^'"]*env\.mjs['"]/.test(src) || /existsSync\(/.test(src) || /\btry\s*\{/.test(src)

      expect(
        unguardedRead && !guarded,
        `${rel} reads .env with an unguarded readFileSync. A reviewer has no .env, so this throws ` +
          `ENOENT before any of the script's own checks can say what is missing — and a stack trace ` +
          `with an absolute path is a worse answer than "SUPABASE_URL is not set". Import loadEnv from ` +
          `scripts/data/lib/env.mjs, which returns quietly when the file is not there.`,
      ).toBe(false)
    },
  )

  /**
   * Fixing the unguarded read got these three as far as their own checks — which then `throw`, so the
   * answer was still a stack trace, just one with the variable name in it. `demo:tidy` is
   * `cleanup-phantom-sessions.mjs`, named in `SUBMISSION.md`'s pre-send checklist and run minutes before
   * submitting; a stack trace is the wrong thing to hand someone at that moment.
   */
  const documentedScriptFiles = [...new Set(documentedCommands().map(({ script }) => script))]
    .map((name) => scripts[name])
    .filter(Boolean)
    .flatMap((cmd) => [...cmd.matchAll(/scripts\/[A-Za-z0-9/_-]+\.mjs/g)].map((m) => m[0]))

  it('finds documented scripts to judge, so the case below is not vacuous', () => {
    expect(
      [...new Set(documentedScriptFiles)].length,
      'no documented npm script resolves to a .mjs file any more',
    ).toBeGreaterThan(0)
  })

  it.each([...new Set(documentedScriptFiles)])('%s exits rather than throwing on missing config', (rel) => {
    const full = join(repoRoot, rel)
    if (!existsSync(full)) return
    const src = readFileSync(full, 'utf8')
    // Deliberately loose. The first version required a quoted '.env' or `process.env.` with a trailing
    // dot, and `cleanup-phantom-sessions.mjs` matched neither after its reader became
    // `const env = process.env` — so it exempted itself and a red-check that removed every
    // `process.exit` still passed. A condition written from one example, again.
    if (!/\.env\b/.test(src) && !/process\.env/.test(src)) return

    expect(
      /process\.exit\(|process\.exitCode/.test(src),
      `${rel} is named in a deliverable and reads configuration, but has no process.exit path — so a ` +
        `missing variable surfaces as an uncaught throw. Someone following the pre-send checklist at ` +
        `10:55 should get a sentence naming the variable, not a stack trace.`,
    ).toBe(true)
  })
})

describe('what README.md says works without credentials', () => {
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8').replace(/\r\n/g, '\n')
  const bareBlock = readme.slice(
    readme.indexOf('## Running it locally'),
    readme.indexOf('cp .env.example .env'),
  )

  it('promises only commands that genuinely need none', () => {
    // Measured in a copy of the tracked tree with no .env and no .git: all three exit 0.
    for (const cmd of ['npm run typecheck', 'npx vitest run', 'npm run data:check']) {
      expect(bareBlock, `README.md no longer offers "${cmd}" as a no-credential command`).toContain(cmd)
    }
  })

  it('keeps the credential-dependent steps out of that list', () => {
    for (const cmd of ['db:seed', 'seed:users', 'db:schema']) {
      expect(
        bareBlock,
        `README.md lists "${cmd}" among the commands that work on a bare checkout. It needs a Supabase ` +
          `project, so a reviewer would follow the instruction and watch it refuse.`,
      ).not.toContain(cmd)
    }
  })
})
