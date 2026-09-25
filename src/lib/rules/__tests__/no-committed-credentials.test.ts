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
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Every file git tracks, which is exactly the set that ships. */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files'], { cwd: process.cwd(), encoding: 'utf8' })
  return out.split(String.fromCharCode(10)).filter(Boolean)
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
