/**
 * `SUBMISSION.md`'s pre-send checklist is the last gate in front of the package, and at iteration
 * 128 nobody had ever run it. Rehearsing it end to end turned up one hole and one habit.
 *
 * The hole: the checklist's `demo:tidy` step is only durable once the agent loop has stopped, and
 * it said so in a subordinate clause rather than as a step. A sweep run before the loop stops is
 * undone by the next iteration. Stopping the loop is now its own line, above the sweep.
 *
 * The habit was mine. "Verify your own deploy" had been a `POST /api/chat` every iteration, and a
 * POST opens a `sessions` row marked `active`, which `demo:tidy`'s thirty-minute default leaves on
 * screen — while beat 3 of the demo opens by putting the supervisor dashboard up and calling it
 * empty. Measured at 06:20Z: 257 active sessions, three of them from the iteration that noticed.
 * `agents/README.md` now says to verify with a GET, and that only works while the method guard in
 * `chat.ts` keeps running before anything is written.
 *
 * So this file pins the two things that make the rehearsal's conclusions survive: the checklist
 * still orders those steps correctly, and `GET /api/chat` still writes nothing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8')

describe('the pre-send checklist', () => {
  const FILE = 'SUBMISSION.md'

  it('still has a checklist to guard', () => {
    const text = read(FILE)
    expect(text, `${FILE} no longer has a "Before sending, check" section`).toContain('## Before sending, check')
    expect(text, `${FILE} no longer names demo:tidy in it`).toContain('npm run demo:tidy')
  })

  it('tells Enrique to stop the agent loop, and says it before the sweep', () => {
    const text = read(FILE)
    const stop = text.indexOf('Stop the agent loop')
    const tidy = text.indexOf('`npm run demo:tidy` —')

    expect(
      stop,
      `${FILE} does not list stopping the agent loop as a step. The sweep below it is not durable ` +
        `until the loop is stopped: each iteration deploys, verifies, and can leave a fresh active ` +
        `session that a thirty-minute sweep will not close.`,
    ).toBeGreaterThan(-1)
    expect(
      stop,
      `${FILE} lists stopping the agent loop after the demo:tidy step. In that order the sweep runs ` +
        `first and the next iteration undoes it, which is the exact failure the step exists to prevent.`,
    ).toBeLessThan(tidy)
  })

  it('keeps the sweep as the last thing done, in the step that names it', () => {
    const text = read(FILE).replace(/\s+/g, ' ')
    expect(text, `${FILE}'s demo:tidy step no longer says to do it last`).toContain('**Do this last.**')
  })
})

/**
 * `agents/README.md` tells every agent to verify a deploy with `GET /api/chat` because it reaches
 * the same warm container and writes nothing. That is only true while the method guard runs before
 * the session work, so the ordering is the guarantee, not the status code.
 */
describe('GET /api/chat writes nothing', () => {
  const FILE = 'netlify/functions/chat.ts'

  it('rejects a non-POST before resolving a session or inserting one', () => {
    const lines = read(FILE).split('\n')
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle))

    const guard = at("req.method !== 'POST'")
    const resolveCall = at('resolveSessionId(str(body.session_id))')
    const insert = at("from('sessions').insert(")

    expect(guard, `${FILE} no longer rejects non-POST requests`).toBeGreaterThan(-1)
    expect(resolveCall, `${FILE} no longer resolves a session id from the body`).toBeGreaterThan(-1)
    expect(insert, `${FILE} no longer inserts a sessions row`).toBeGreaterThan(-1)

    expect(
      guard,
      `${FILE} resolves a session id before rejecting non-POST requests. agents/README.md tells every ` +
        `agent to verify a deploy with GET /api/chat precisely because it writes nothing; that stops ` +
        `being true here, and every iteration starts leaving a phantom "active" card on the demo's ` +
        `supervisor dashboard.`,
    ).toBeLessThan(resolveCall)
    expect(guard, `${FILE} can insert a sessions row before the method guard runs`).toBeLessThan(insert)
  })

  it('still answers 405 rather than something a caller would retry', () => {
    const text = read(FILE)
    expect(text, `${FILE} no longer returns 405 for a non-POST`).toContain('status: 405')
  })

  // The two files that send a reader to those lines. Both are edited often enough that a citation
  // into them rots quietly, and a wrong line number here reads as a claim nobody checked.
  const CITED: Array<[string, number, string]> = [
    ['netlify/functions/chat.ts', 227, "req.method !== 'POST'"],
    ['netlify/functions/chat.ts', 243, 'resolveSessionId'],
    ['netlify/functions/chat.ts', 579, "from('sessions').insert("],
    ['docs/demo-runbook.md', 60, 'Do not warm it by sending a real chat message'],
  ]

  it.each(CITED)('%s:%d still says what agents/README.md cites it for', (file, line, needle) => {
    const lines = read(file).split('\n')
    expect(
      lines[line - 1] ?? '',
      `${file}:${line} no longer contains "${needle}". agents/README.md sends an agent to that exact ` +
        `line for the rule about verifying a deploy without opening a session.`,
    ).toContain(needle)
  })

  it('quotes each of those citations, so none of them guards nothing', () => {
    const readme = read('agents/README.md')
    for (const [file, line] of CITED) {
      expect(readme, `agents/README.md no longer cites ${file}:${line}; drop it from CITED`).toContain(
        `${file}:${line}`,
      )
    }
  })
})
