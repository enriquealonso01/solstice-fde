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

/**
 * `.env.example` must ship the configuration production actually runs, not the one we rejected.
 *
 * `README.md`'s step 2 is `cp .env.example .env # then fill it in`, and that file shipped
 * `SOL_THINKING=` — blank — under the comment *"Latency dial: 'disabled' turns off extended thinking on the
 * chat brain."*
 *
 * **Blank is not neutral.** `chat.ts` reads `process.env.SOL_THINKING === 'disabled' ? disabled : adaptive`,
 * so an empty value is **adaptive**, and `docs/latency-target.md` records adaptive as the configuration where
 * *"Sol created a real escalation and then failed to tell the guest it had done so"* — the exact guardrail
 * `transcripts/honest-handoff.md` is offered as proof of, and the first transcript the package tells a
 * reviewer to read. Production runs `disabled`; verified at iteration 120 against the Netlify environment
 * and the local `.env`, both `disabled`.
 *
 * The comment was the more misleading half. Calling it a *"latency dial"* invites a reader to leave it blank
 * to go faster, when the reason for the setting is behaviour and the **cost** is latency. `chat.ts` carried
 * the same framing and now does not.
 *
 * Pinned against `docs/latency-target.md` rather than against a remembered value: the doc states what
 * production runs, and the example file has to agree with it.
 */
describe('the thinking configuration a reviewer would copy', () => {
  const VAR = 'SOL_THINKING'

  /** What docs/latency-target.md says production runs. */
  function documentedValue(): string {
    const doc = readFileSync(join(repoRoot, 'docs/latency-target.md'), 'utf8')
    const m = doc.match(/`SOL_THINKING=([a-z]+)` is set in production/)
    expect(m, 'docs/latency-target.md no longer states which SOL_THINKING production runs').toBeTruthy()
    return m![1]
  }

  it('is shipped with a value, because blank resolves to the rejected setting', () => {
    const example = readFileSync(join(repoRoot, '.env.example'), 'utf8')
    const m = example.match(/^SOL_THINKING=(.*)$/m)
    expect(m, `.env.example no longer mentions ${VAR}`).toBeTruthy()
    expect(
      (m![1] ?? '').trim(),
      `.env.example ships "${VAR}=${m?.[1]}". Blank is not neutral -- chat.ts treats anything other than ` +
        `'disabled' as adaptive, which is the configuration docs/latency-target.md records as letting Sol ` +
        `create an escalation without telling the guest.`,
    ).toBe(documentedValue())
  })

  it('does not call it a latency dial in the file a reviewer copies', () => {
    // `.env.example` is 2KB of configuration and the phrase has no other use there, so a whole-file ban is
    // safe. A window around the variable is not: the first version of this case took 400 characters either
    // side of `SOL_THINKING`, and red-checking it by restoring the old one-line comment left it GREEN,
    // because the shorter comment moved the offsets and the phrase fell outside the window.
    expect(
      readFileSync(join(repoRoot, '.env.example'), 'utf8').replace(/\s+/g, ' '),
      `.env.example calls ${VAR} a latency dial. The reason for the setting is behaviour; latency is what ` +
        `it costs. Describing it the other way round invites someone to turn a guardrail off to go faster.`,
    ).not.toMatch(/latency dial/i)
  })

  it('explains the behavioural reason where the code reads the variable', () => {
    // Anchored on the declaration, not on a phrase count. `chat.ts` legitimately uses "latency dials"
    // elsewhere, about effort and token budget, which genuinely are latency dials -- banning the words
    // across the file would fail on correct prose two hundred lines away.
    const src = readFileSync(join(repoRoot, 'netlify/functions/chat.ts'), 'utf8')
    const decl = src.indexOf('const THINKING')
    expect(decl, 'chat.ts no longer declares THINKING; update this case with whatever replaced it').toBeGreaterThan(0)
    const comment = src.slice(Math.max(0, src.lastIndexOf('/**', decl)), decl).replace(/\s+/g, ' ')
    expect(
      comment,
      `The comment above chat.ts's THINKING declaration has to say why production ships 'disabled'. It is ` +
        `a behaviour setting: adaptive is the configuration where Sol created an escalation and did not ` +
        `tell the guest. Left as a performance note, the next reader turns it off to go faster.`,
    ).toMatch(/behavioural violations|NOT as a latency dial/i)
  })

  it('agrees with the row in agent/sol.md, which a reviewer reads beside it', () => {
    // The row said *"`SOL_THINKING=adaptive` (default) or `disabled`. Measured: disabling it does not speed
    // up the first token, it improves tool selection"* until iteration 122. Two problems: it presented
    // adaptive as the operative setting when production ships disabled, and "it improves tool selection" has
    // an ambiguous antecedent -- chat.ts credits *adaptive* with better tool choice. This case used to pin
    // that exact sentence, so the fix to the row would have failed it. What matters is not the phrasing but
    // that the row names what production runs and gives the behavioural reason, so that is what it checks.
    const sol = readFileSync(join(repoRoot, 'agent/sol.md'), 'utf8').replace(/\s+/g, ' ')
    expect(sol).toContain(VAR)
    const row = sol.slice(sol.indexOf('Thinking on the chat channel'))
    expect(
      row.slice(0, 400),
      `agent/sol.md's row must say production ships 'disabled'. It is the live voice prompt and a named ` +
        `deliverable, so a reviewer reading adaptive as the operative setting reads the wrong system.`,
    ).toMatch(/ships `disabled`/)
    expect(
      row.slice(0, 400),
      `and it must give the behavioural reason, not a latency one -- the whole point of the setting.`,
    ).toMatch(/behavioural violations/)
  })
})

/**
 * Every credential a reviewer is told to fill in is stripped before any test runs.
 *
 * `no-committed-credentials.test.ts` explains why its checks are shape-based rather than
 * value-based: *"`vitest.setup.ts` strips credentials from the environment, so no test here can know
 * the password's value."* At iteration 161 that was **false** -- `DEMO_PASSWORD`, the working admin
 * password `DEMO_LOGINS.md` holds, was not on the strip list. Nothing read it, nothing leaked, and
 * hermeticity was never at risk: every vendor path the setup file was written for was covered. What was
 * wrong is the sentence built on top, inside the one file whose job is to be trusted about credentials.
 *
 * That is the "assertion holding its own copy of the answer" family one level up: **a justification
 * holding a copy of a guarantee the code does not give.** Prose cannot be kept true by being careful, so
 * this checks it.
 *
 * Scoped to `.env.example` on purpose -- the file `README.md` tells a reviewer to copy, and the only one
 * of the two that is tracked. Reading `.env` would fail for anyone reviewing a clone or a ZIP, which is
 * the failure iteration 152 spent an iteration removing from a different guard.
 */
describe('credentials a reviewer fills in are stripped before tests run', () => {
  /** The strip list, read from the setup file rather than restated here. */
  const strippedNames = (): string[] => {
    const src = readFileSync(join(repoRoot, 'vitest.setup.ts'), 'utf8')
    const block = /const STRIPPED = \[([\s\S]*?)\n\]/.exec(src)
    expect(block, 'vitest.setup.ts no longer declares STRIPPED as a list; re-point this rather than deleting it').toBeTruthy()
    return [...(block as RegExpExecArray)[1].matchAll(/^\s*'([A-Z_][A-Z0-9_]*)',/gm)].map((m) => m[1])
  }

  /** Anything whose name says it is a secret. */
  const CREDENTIAL_SHAPED = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/

  /**
   * Empty on purpose, and kept as a mechanism rather than a habit. If a test ever genuinely needs to
   * read one of these, put it here with the reason instead of quietly dropping it from STRIPPED -- the
   * point of this file is that the reason is written down where the next reader looks.
   */
  const EXEMPT: Record<string, string> = {}

  it('parses both lists, so nothing below is compared against nothing', () => {
    expect(strippedNames().length, 'STRIPPED parsed empty').toBeGreaterThanOrEqual(8)
    const shaped = [...declared()].filter((k) => CREDENTIAL_SHAPED.test(k))
    expect(
      shaped.length,
      '.env.example lists no credential-shaped keys, so this check has no subject. Eight were listed at ' +
        'iteration 161.',
    ).toBeGreaterThanOrEqual(6)
  })

  it('strips every credential-shaped key the README tells a reviewer to fill in', () => {
    const stripped = new Set(strippedNames())
    const missing = [...declared()]
      .filter((k) => CREDENTIAL_SHAPED.test(k))
      .filter((k) => !stripped.has(k) && !(k in EXEMPT))

    expect(
      missing,
      `.env.example asks a reviewer for ${missing.join(', ')}, and vitest.setup.ts does not strip ` +
        `${missing.length === 1 ? 'it' : 'them'}. A test can then read the real value, which is exactly ` +
        `what no-committed-credentials.test.ts tells its reader is impossible. Add the name to STRIPPED, ` +
        `or to EXEMPT here with the reason a test needs it.`,
    ).toEqual([])
  })

  /**
   * Two independent things make the claim true, and this file says which is which.
   *
   * The first draft of the two cases below asserted `process.env.DEMO_PASSWORD` is undefined and called
   * itself *"the mechanism that makes that true"*. It is not. Measured: vite does not load `.env` into
   * `process.env`, so variables that are **never** stripped -- `TELNYX_TELEPHONY_CREDENTIAL_ID`,
   * `DEMO_EMAIL`, `PUBLIC_BASE_URL` -- read `undefined` in a test as well. The cases passed for a reason
   * they did not state and would have passed with the strip loop deleted, which a mutation proved.
   *
   * So: the **property** is checked at runtime, where it is what actually matters and holds for either
   * reason, and the **mechanism** is checked at source level, because a loop that deletes keys nothing
   * set is invisible from inside the run. The loop is not redundant -- a shell that has sourced `.env`
   * populates the environment, and `SUBMISSION.md`'s own pre-send check begins `set -a; . ./.env` -- so
   * it is the belt to the braces, and worth keeping honest.
   */
  it('lets no credential-shaped variable be read in a test, for whichever reason', () => {
    const readable = [...declared()]
      .filter((k) => CREDENTIAL_SHAPED.test(k))
      .filter((k) => process.env[k] !== undefined)

    expect(
      readable,
      `${readable.join(', ')} can be read inside a test. no-committed-credentials.test.ts tells its ` +
        `reader that no test here can know the password's value; that is what this asserts.`,
    ).toEqual([])
  })

  it('still deletes every name on the list, which is unobservable when the environment is empty', () => {
    // The mechanism, at source level, because nothing in a normal run populates these to begin with.
    const src = readFileSync(join(repoRoot, 'vitest.setup.ts'), 'utf8')
    expect(
      src,
      'vitest.setup.ts no longer deletes the names in STRIPPED. Nothing in this suite would notice, ' +
        'because vite does not load .env into process.env -- but a shell that has sourced .env does, ' +
        "and SUBMISSION.md's pre-send check starts with `set -a; . ./.env`.",
    ).toMatch(/for \(const key of STRIPPED\) delete process\.env\[key\]/)
  })
})
