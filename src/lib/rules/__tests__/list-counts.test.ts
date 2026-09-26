/**
 * "Two things:" must be followed by two things.
 *
 * `SUBMISSION.md` — the first file a reviewer opens — said *"Two things they did not ask for, which
 * answer their email rather than the PDF:"* and then listed **three**. A reader counts that list
 * against the sentence without trying, and the first impression of a submission should not be that
 * its author cannot count to three.
 *
 * It was found by sweeping for the pattern rather than by reading, which matters: I had read that
 * file several times without noticing, and the error had survived every human pass in the repo.
 *
 * The discriminator is deliberately narrow — a count word, then a colon ending the line, then
 * bullets on the following lines. A looser rule flagged prose like *"excluded for two reasons. A
 * guest on a call has no use for it, and …"*, where both reasons are given inline and the next
 * bullets belong to something else entirely. One false positive in a guard is enough to teach people
 * to ignore it, so this one only fires on the shape it can actually judge.
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
  // Added at iteration 106. The deliverables were covered; the files the *agents* read, and the one
  // Enrique reads before he submits, were not -- and that is where the next miscount landed. Mine:
  // "Three items remain his" followed by four, in completed.log.md, written an hour after I shipped
  // a guard for this exact class.
  'agents/README.md',
  'agents/implementer.status.md',
  // NOT HUMAN_INTERVENTION.md, though it is the file Enrique actually reads. Every entry there is
  // nested under a top-level bullet, so a counted list's items are indented and so is the sentence
  // that ends them -- and bulletsAfter() treats an indented non-bullet line as a continuation, then
  // runs on into the next entry's bullet. Adding the file produced one false positive on a list that
  // is correctly counted, and I spent two edits reformatting the document to satisfy the test before
  // reading the test. That is the tail wagging the dog: this rule only fires on a shape it can judge,
  // and a document written entirely in nested bullets is not that shape.
  // NOT agents/completed.log.md. It is append-only narrative that deliberately quotes the wrong
  // text it fixed -- "148 chat sessions to 9 calls" appears there as history, and the ban below
  // fired on it the moment I added the file. Guarding a log that records old mistakes verbatim
  // either fails forever or stops it recording them, and the second is the worse outcome.
]

const NUMBER: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

/** A counted list: "<count> <noun> …:" on one line, bullets immediately below. */
const CLAIM = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(things|items|files|documents|reasons|options|places|ways|deliverables)\b[^:\n]*:\s*$/i

function bulletsAfter(lines: string[], start: number): number {
  let i = start + 1
  let count = 0
  while (i < lines.length && lines[i].trim() === '') i++
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*(?:[-*]|\d+\.)\s+\S/.test(line)) count++
    else if (line.trim() === '') { /* blank lines inside a loose list */ }
    else if (/^\s+\S/.test(line)) { /* continuation of the previous bullet */ }
    else break
    i++
  }
  return count
}

describe('counted lists in the deliverable', () => {
  it('finds counted lists at all, so this cannot pass by matching nothing', () => {
    let found = 0
    for (const doc of DOCS) {
      const full = join(repoRoot, doc)
      if (!existsSync(full)) continue
      found += readFileSync(full, 'utf8').split(/\r?\n/).filter((l) => CLAIM.test(l)).length
    }
    expect(found).toBeGreaterThan(0)
  })

  it('lists exactly as many items as the sentence above them claims', () => {
    const problems: string[] = []

    for (const doc of DOCS) {
      const full = join(repoRoot, doc)
      if (!existsSync(full)) continue
      const lines = readFileSync(full, 'utf8').split(/\r?\n/)

      lines.forEach((line, i) => {
        const m = CLAIM.exec(line)
        if (!m) return
        const claimed = NUMBER[m[1].toLowerCase()]
        const actual = bulletsAfter(lines, i)
        if (actual === 0) return // not a bulleted list; nothing to judge
        if (actual !== claimed) {
          problems.push(
            `${doc}:${i + 1} says "${m[1]} ${m[2]}" and lists ${actual}: ${line.trim().slice(0, 80)}`,
          )
        }
      })
    }

    expect(problems, `Counted lists that do not match their count:\n\n${problems.join('\n')}\n`).toEqual([])
  })
})

/**
 * A document must not stake a claim on an exact count of something that changes while you present.
 *
 * `docs/demo-runbook.md` told the presenter our traffic is *"about 148 chat sessions to 9 calls"*, in
 * the sentence that goes on to warn **"a sceptic who reads the split while you claim telephony
 * dominates has caught you."** Measured at iteration 97 the split was **172 to 9**: wrong by 24 in
 * the one place the document invites the audience to check the number.
 *
 * The asymmetry is the whole point. A chat session is created whenever anyone opens the widget — the
 * Tester alone adds roughly 25 an hour — while a call costs money, so the voice side barely moves.
 * An exact pair was therefore wrong within hours of being written and would have been wrong again by
 * the time it was read aloud. This is the third live-quantity claim in three iterations: the
 * supervisor Archive (PR #127), the voice compile margin (PR #128), and this.
 *
 * A test cannot check the live figure — the suite is hermetic and must stay that way. What it can do
 * is refuse the *form*. A floor or a ratio stays true as chat grows; two exact counts cannot. That is
 * the same move PR #77 made for the README's file counts, which have since survived thirteen new
 * files without rotting.
 */
describe('claims about quantities that change while nobody is looking', () => {
  const runbook = 'docs/demo-runbook.md'
  const text = () => readFileSync(join(repoRoot, runbook), 'utf8')

  it('states the chat-to-voice split as a bound, not as two counts', () => {
    expect(
      text(),
      `${runbook} should express the split as a floor or ratio. An exact pair goes stale between ` +
        `writing it and reading it out, in the sentence that dares the audience to check it.`,
    ).toMatch(/one call in every \w+ sessions/)
  })

  // Deliverables only: the coordination files quote the old pair as history on purpose.
  const DELIVERABLES = DOCS.filter((d) => !d.startsWith('agents/') && d !== 'HUMAN_INTERVENTION.md')

  it.each(DELIVERABLES)('%s states no exact chat-to-call pair', (doc) => {
    const full = join(repoRoot, doc)
    if (!existsSync(full)) return
    expect(
      readFileSync(full, 'utf8'),
      `${doc} pins an exact chat-session-to-call count. Chat sessions accumulate whenever anyone ` +
        `opens the widget and calls do not, so that pair is wrong by the time it is read. Use a ` +
        `floor -- "fewer than one call in every fifteen sessions" -- which stays true as chat grows.`,
    ).not.toMatch(/\d+\s*chat\s*sessions?\s*to\s*\d+\s*calls?/i)
  })
})
