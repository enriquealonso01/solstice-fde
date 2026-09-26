/**
 * Anything the documented setup needs must be in the file the README tells you to copy.
 *
 * `README.md` ("Running it locally") is six lines a reviewer pastes in order:
 *
 *   npm install · cp .env.example .env · npm run db:schema · npm run db:seed ·
 *   npm run seed:users · npm run dev
 *
 * Step 5 could not work. `scripts/seed-users.mjs` requires `DEMO_PASSWORD` and deliberately has no
 * default -- it refuses rather than create demo logins with a guessable password -- and
 * `DEMO_PASSWORD` appeared nowhere: not in `.env.example`, not in the README, not in `docs/`. A
 * reviewer who filled in every key the example lists still hit a wall, on a variable they had no way
 * to know existed. `.env.example` listed its two siblings, `DEMO_EMAIL` and `DEMO_PHONE`, which is
 * what made the gap invisible to a human pass. `SUPABASE_DB_URL` was missing the same way, though
 * step 3 degrades gracefully: without it `apply-schema.mjs` prints the SQL-editor instructions and
 * exits 0.
 *
 * Found by running the documented commands rather than checking they exist --
 * `documented-commands.test.ts` pins that every `npm run` named in a deliverable is in
 * `package.json`, which a broken command satisfies perfectly.
 *
 * The list is derived from the scripts, not typed out here, so a new `env.SOMETHING` in a setup
 * script fails this test until it is documented. That is the point: the next person to add one is
 * the person who knows what it is for.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

/** The scripts README's "Running it locally" block invokes, in order. */
const SETUP_SCRIPTS = ['scripts/data/apply-schema.mjs', 'scripts/data/seed.mjs', 'scripts/seed-users.mjs']

const declared = () =>
  new Set(
    Array.from(
      readFileSync(join(repoRoot, '.env.example'), 'utf8').matchAll(/^([A-Z_][A-Z0-9_]*)=/gm),
      (m) => m[1],
    ),
  )

function requiredBySetup(): { name: string; script: string }[] {
  const out: { name: string; script: string }[] = []
  const seen = new Set<string>()
  for (const script of SETUP_SCRIPTS) {
    const text = readFileSync(join(repoRoot, script), 'utf8')
    for (const m of text.matchAll(/\benv\.([A-Z_][A-Z0-9_]{2,})\b/g)) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      out.push({ name: m[1], script })
    }
  }
  return out
}

describe('the documented local setup', () => {
  it('names scripts that exist, because the README pastes them in order', () => {
    for (const s of SETUP_SCRIPTS) expect(existsSync(join(repoRoot, s)), `${s} is missing`).toBe(true)
    expect(existsSync(join(repoRoot, '.env.example'))).toBe(true)
  })

  it('reads enough variables for this test to be checking something', () => {
    // Guards against the regex silently matching nothing -- the failure mode that lets a guard pass
    // while broken, which has happened four times in this repo.
    expect(requiredBySetup().length).toBeGreaterThanOrEqual(4)
  })

  it.each(requiredBySetup())('$name, which $script needs, is in .env.example', ({ name, script }) => {
    expect(
      declared(),
      `${script} reads ${name}, and .env.example does not mention it. A reviewer copies that file, ` +
        `fills in what it lists, and the documented setup fails on a variable they were never told ` +
        `about. Add it with a one-line comment saying which step needs it.`,
    ).toContain(name)
  })

  it('still lists the keys the app itself cannot start without', () => {
    // vite.config.ts maps these to the VITE_ names the front end reads, so the un-prefixed key is
    // the one a person fills in. Checked because I nearly filed the VITE_ names as missing.
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TELNYX_PHONE_NUMBER', 'TELNYX_ASSISTANT_ID']) {
      expect(declared(), `.env.example dropped ${k}, which vite.config.ts maps to a VITE_ name`).toContain(k)
    }
  })
})

/**
 * No script may carry a hard-coded site host as a fallback.
 *
 * `scripts/telnyx/provision.mjs` resolved the base URL for every webhook it bakes into the assistant as
 * `flags.baseUrl || env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || env.URL ||
 * 'https://solstice-fde.netlify.app'`. That last host **does not exist** — fetching it returns 404. The
 * site is `solstice-hotel-group.netlify.app`, and the discrepancy surfaced at iteration 114 by requesting
 * every absolute URL in the repository instead of reading them.
 *
 * It never fired, because `.env` carries `PUBLIC_BASE_URL` and `.env.example` lists it — which is precisely
 * what made it dangerous. Provisioning without that key would have written a dead host into
 * `TOOLS_BASE_URL`, `GROUP_TOOL_URL`, the call-control webhook and the SIP connection's event URL, printed
 * its usual green summary, and left the phone agent with 23 tools pointing nowhere.
 *
 * A wrong default is worse than no default, so the script now refuses. This keeps any host literal from
 * coming back as a convenience: the value has to be configured or passed, and `.env.example` documents it.
 */
describe('hard-coded site hosts in scripts', () => {
  const SCRIPTS = [
    'scripts/telnyx/provision.mjs',
    'scripts/telnyx/export-assistant.mjs',
    'scripts/cleanup-phantom-sessions.mjs',
    'scripts/data/build.mjs',
    'scripts/capture-transcripts.mjs',
  ]

  it.each(SCRIPTS)('%s names no site host outside a comment', (script) => {
    const full = join(repoRoot, script)
    if (!existsSync(full)) return
    const offending = readFileSync(full, 'utf8')
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
      .filter(({ line }) => /['"`]https?:\/\/[a-z0-9-]+\.netlify\.app/i.test(line))

    expect(
      offending.map((o) => `${script}:${o.n}  ${o.line.slice(0, 90)}`),
      `A site host written into a script is a default that is wrong the moment the site is renamed, and ` +
        `it hides a missing configuration behind a plausible value. Take it from PUBLIC_BASE_URL, or ` +
        `refuse. ${script} had one that 404s.`,
    ).toEqual([])
  })

  it('still resolves the base URL from somewhere, so provisioning is not simply broken', () => {
    const src = readFileSync(join(repoRoot, 'scripts/telnyx/provision.mjs'), 'utf8')
    expect(src).toContain('PUBLIC_BASE_URL')
    expect(src, 'the resolver must refuse rather than guess').toMatch(/No base URL/)
  })
})
