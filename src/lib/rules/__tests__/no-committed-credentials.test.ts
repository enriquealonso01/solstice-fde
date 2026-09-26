// No tracked file may carry a real credential.
//
// Found at iteration 51: `netlify/functions/telnyx/_lib/legs.test.ts` hard-coded the live Telnyx SIP
// credential username and URI, and the live SIP connection id, as test fixtures — copied in from a
// real outage. The same SIP target is deliberately redacted in `exports/telnyx-assistant.json` as
// `REDACTED_TRANSFER_TARGET`, so the repo was redacting a value in the deliverable and committing it
// one directory away.
//
// This guard is SHAPE-based rather than value-based on purpose: `vitest.setup.ts` strips every
// credential from the environment before tests load, which is the right thing for the DB tests and
// means a test cannot compare against `.env` even if it wanted to. So it looks for the shapes these
// secrets have, and exempts strings that announce themselves as fake.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { shippedFiles } from './shippedFiles'

/**
 * Every file that ships. This used to be `git ls-files` alone, which threw during collection for anyone
 * reviewing a ZIP download — and a credential guard that fails to collect is a credential guard that is
 * not running. `shippedFiles` prefers git and falls back to a `.gitignore`-aware walk.
 */
function trackedFiles(): string[] {
  return shippedFiles(process.cwd()).files
}

/** A value that says "I am a placeholder" is allowed to look like anything. */
function announcesItselfFake(line: string): boolean {
  return /EXAMPLE|FIXTURE|REDACTED|NotAReal|PLACEHOLDER|your-|xxxx|<[a-z_]+>/i.test(line)
}

const SHAPES: { name: string; re: RegExp }[] = [
  // Telnyx generated SIP credential usernames: "gencred" + a long opaque tail.
  { name: 'Telnyx SIP credential username', re: /\bgencred[A-Za-z0-9]{24,}/ },
  // Telnyx API keys.
  { name: 'Telnyx API key', re: /\bKEY[0-9A-F]{16,}/ },
  // Supabase / JWT-shaped service keys: three base64url segments, the middle one long.
  { name: 'JWT-shaped key', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}/ },
  // Anthropic keys.
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
]

/** Text files only: a binary match would be noise, and none of these live in one. */
const SKIP = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|mp3|wav|zip)$/i

describe('no real credential is committed', () => {
  const files = trackedFiles().filter((f) => !SKIP.test(f))

  it('is actually looking at the repo — the file list is real', () => {
    // Guard the guard: if `git ls-files` ever returns nothing, every case below passes vacuously.
    // This is the fourth instrument in this repo to need that check.
    expect(files.length).toBeGreaterThan(150)
    expect(files).toContain('netlify/functions/telnyx/_lib/legs.test.ts')
  })

  it('carries no value shaped like a credential, except ones marked fake', () => {
    const problems: string[] = []
    for (const file of files) {
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const lines = text.split(String.fromCharCode(10))
      for (let i = 0; i < lines.length; i += 1) {
        for (const shape of SHAPES) {
          if (shape.re.test(lines[i]) && !announcesItselfFake(lines[i])) {
            problems.push(`${file}:${i + 1} looks like a ${shape.name}`)
          }
        }
      }
    }
    expect(problems, problems.join(String.fromCharCode(10))).toEqual([])
  })

  it('.env is not tracked', () => {
    expect(trackedFiles()).not.toContain('.env')
  })

  it('the Telnyx export still redacts the shared secret and the transfer target', () => {
    // The other half of the same standard: the export is generated from live, so if the redaction
    // step is ever dropped the real values land here instead.
    const exp = readFileSync('exports/telnyx-assistant.json', 'utf8')
    expect(exp).toMatch(/REDACTED_INJECTED_FROM_TOOL_WEBHOOK_SECRET/)
    expect(exp).toMatch(/REDACTED_TRANSFER_TARGET/)
    expect(exp).not.toMatch(/\bgencred[A-Za-z0-9]{24,}/)
  })
})

/**
 * The one credential this repo creates itself must stay out of it.
 *
 * `npm run seed:users` writes `DEMO_LOGINS.md`, and its second line is
 * `Password for all three: <the real password>` — a working password for the demo **admin** account,
 * which sees every screen, the backend map and the cost page. `SUBMISSION.md` points Enrique at that
 * file to paste the password into the email, and is explicit that it must never be in the repository,
 * which is **public**.
 *
 * Today the whole protection is one line of `.gitignore`. Nothing asserted it. This repo has already
 * lost that bet twice: a live SIP credential was committed as a test fixture (iteration 51, the
 * finding this file was written for), and `inq.json` arrived via `git add -A`. A `git add -f`, a
 * rebased `.gitignore`, or a tidy-up that "fixes" the ignore list are all one command away from
 * publishing it.
 *
 * Shape-based like the rest of this file: `vitest.setup.ts` strips credentials from the environment,
 * so no test here can know the password's value. What it can do is refuse the file and refuse the
 * line the generator writes.
 */
describe('the demo login card', () => {
  const CARD = 'DEMO_LOGINS.md'

  it('is not tracked by git, because it holds a working admin password', () => {
    expect(
      trackedFiles(),
      `${CARD} is tracked. It contains a plaintext password for admin@solsticehotels.com and this ` +
        `repository is public. Remove it with "git rm --cached ${CARD}" and keep it ignored.`,
    ).not.toContain(CARD)
  })

  it('is named in .gitignore, which is the only thing keeping it out', () => {
    const ignore = readFileSync('.gitignore', 'utf8')
    expect(
      ignore.split(String.fromCharCode(10)).map((l) => l.trim()),
      `.gitignore no longer lists ${CARD}. That single line is the entire protection; ` +
        `scripts/seed-users.mjs rewrites the file with a live password every time it runs.`,
    ).toContain(CARD)
  })

  it('has its password line nowhere in the tracked tree', () => {
    // Only a line that carries an actual value. A first pass matched any non-space after the
    // colon and flagged three innocent files: the email draft's `<paste from DEMO_LOGINS.md>`,
    // the plan quoting it, and this test's own comment. A guard that fires on prose about the
    // secret teaches people to ignore it, so this wants what a password looks like -- one token,
    // eight characters or more, running to the end of the line -- and never an angle-bracket
    // placeholder or the generator's own `${PASSWORD}`.
    const filled = /Password for all three:[ \t]*(?![<$])(\S{8,})[ \t]*$/m
    const problems: string[] = []
    for (const file of trackedFiles().filter((f) => !SKIP.test(f))) {
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const hit = text.split(String.fromCharCode(10)).find((l) => filled.test(l))
      if (hit && !announcesItselfFake(hit)) problems.push(file)
    }
    expect(
      problems,
      `These tracked files carry the filled password line from ${CARD}: ${problems.join(', ')}`,
    ).toEqual([])
  })
})

/**
 * Somebody else's document does not belong in our public repository.
 *
 * `FDE_Project_Challenge.pdf` is the hiring brief the interviewers wrote. It was tracked, not ignored, and
 * this repository is **public** — so their private interview challenge was published on the internet under
 * our name, where any future candidate could find it. Found at iteration 117 while checking the deliverables
 * against the brief.
 *
 * It is not a secret in the sense the rest of this file guards: nothing authenticates with it. It is a
 * question of whose material it is, and of what a reviewer concludes about how this team handles a
 * confidential document belonging to someone else — which for this role is not a small thing.
 *
 * The agents read it locally as ground truth, so it stays on disk and out of git, exactly like
 * `DEMO_LOGINS.md`. It remains in one commit of history; rewriting that is Enrique's call and is written up
 * in `HUMAN_INTERVENTION.md`, because the same reasoning that protects the SIP credential from a rewrite
 * applies here: the deliverables cite commit ids.
 */
describe("the interviewers' brief", () => {
  const BRIEF = 'FDE_Project_Challenge.pdf'

  it('is not tracked, because the repository is public and the document is theirs', () => {
    expect(
      trackedFiles(),
      `${BRIEF} is tracked. It is the interviewers' own hiring brief and this repository is public. ` +
        `Remove it with "git rm --cached ${BRIEF}" -- it stays on disk, which is all the agents need.`,
    ).not.toContain(BRIEF)
  })

  it('is named in .gitignore, so it cannot drift back in with a git add -A', () => {
    const ignore = readFileSync('.gitignore', 'utf8')
    expect(
      ignore.split(String.fromCharCode(10)).map((l) => l.trim()),
      `.gitignore no longer lists ${BRIEF}. That line is what keeps a wildcard add from republishing it.`,
    ).toContain(BRIEF)
  })

  it('no other pdf is tracked either, since the same reasoning applies to any of theirs', () => {
    const pdfs = trackedFiles().filter((f) => f.toLowerCase().endsWith('.pdf'))
    expect(
      pdfs,
      `Tracked PDFs: ${pdfs.join(', ')}. Nothing in this package needs to ship a PDF -- the proposals are ` +
        `generated at runtime -- so a committed one is most likely someone else's document.`,
    ).toEqual([])
  })
})

/**
 * A real person's email address does not belong in a public repository.
 *
 * `plans/00-requirements.md` opened by naming the hiring contact's work address in full -- the address
 * itself is deliberately not repeated here, since this file is tracked and that is the point. It appeared
 * four times: that file,
 * `plans/04-unlock-checklist.md`, `plans/archive/01-concierge-agent.md` and the master plan. Found at
 * iteration 124 by reading the plans `AGENTS.md`'s first line sends a reader to, one hop on from iteration
 * 119.
 *
 * It is not a credential and nothing authenticates with it. It is the same question as the interviewers'
 * brief at iteration 117: whose material is this, and what does publishing it say about how we handle a
 * third party's details. The cost lands on them — a harvestable address — and it is free to avoid.
 *
 * The allowlist is **derived**, not typed: every domain that appears in `data/` is fictional by
 * construction, because the interviewers wrote that sample data. Anything else outside `data/` has to be a
 * fixture domain or be listed here with a reason, which is the same shape as "no PDF may be tracked".
 */
describe('email addresses in the tracked tree', () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
  const SKIP = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|svg)$/i

  /** Domains in the supplied sample data. Fictional because they wrote them. */
  function dataDomains(): Set<string> {
    const out = new Set<string>()
    for (const f of trackedFiles().filter((f) => f.startsWith('data/'))) {
      let text: string
      try {
        text = readFileSync(f, 'utf8')
      } catch {
        continue
      }
      for (const m of text.matchAll(EMAIL)) out.add(m[1].toLowerCase())
    }
    return out
  }

  /** Fixture and infrastructure domains, each here for a stated reason. */
  const ALLOWED = new Set([
    'solsticehotels.com', // the fictional hotel group's staff logins
    'solsticehotels.demo', // admin mock rows
    'solsticehotels.example', // delivery test fixtures
    'sip.telnyx.com', // the SIP transfer target, redacted by pattern in the export
    'sip.example.com', // a redaction example in the Tester's log
    'b.com', // a deliberately minimal address in a delivery unit test
    'northwindlogistics.com', // the demo group-inquiry company used in transcripts
    'cypressridge.example.com', // same, and already an example.com subdomain
    'msgtelnyx.com', // a Telnyx sending domain in a requirements note, not a person
    // Enrique's own address, in the master plan's email-delivery check. His address and his call --
    // flagged to him in HUMAN_INTERVENTION.md rather than redacted on his behalf.
    'provensolved.com',
  ])

  it('reads the sample data, so the derived allowlist is not empty', () => {
    expect(dataDomains().size).toBeGreaterThanOrEqual(5)
  })

  it('names no real person outside the supplied sample data', () => {
    const fromData = dataDomains()
    const offenders: string[] = []
    for (const file of trackedFiles().filter((f) => !f.startsWith('data/') && !SKIP.test(f))) {
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      for (const m of text.matchAll(EMAIL)) {
        const domain = m[1].toLowerCase()
        if (fromData.has(domain) || ALLOWED.has(domain)) continue
        offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(
      [...new Set(offenders)],
      `An email address on a domain that is neither in the supplied sample data nor an allowlisted ` +
        `fixture is most likely a real person's. This repository is public. Use a neutral reference, or ` +
        `add the domain above with the reason it is safe.`,
    ).toEqual([])
  })
})
