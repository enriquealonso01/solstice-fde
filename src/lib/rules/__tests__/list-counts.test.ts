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
