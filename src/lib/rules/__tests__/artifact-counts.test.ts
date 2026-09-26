/**
 * Counts in the deliverables that count something in the repository.
 *
 * `list-counts.test.ts` pins the other kind: a sentence that claims a number and then lists that many
 * items, where the list itself is the evidence. This is the kind where the evidence is elsewhere --
 * *"25 tools"*, *"seven tabs"*, *"ten inquiries"* -- and the document is asserting a fact about a
 * committed artifact a reviewer can open.
 *
 * `diagram-guide.test.ts` already makes the argument, for one file:
 *
 *   > "25 tools" is allowed to be a number because it only moves on a re-provision. That is only an
 *   > argument if it is true, so it is checked against the committed export rather than trusted.
 *
 * Exactly right -- and applied to `docs/architecture.drawio` alone. Measured at iteration 164, the same
 * three counts appear **six times across five documents**, and five of the six were pinned by nothing:
 *
 *   25 tools     README.md:28, docs/README-diagram.md:43, docs/README-diagram.md:50
 *   seven tabs   docs/demo-runbook.md:244, docs/role-walkthroughs.md:244
 *   ten inquiries README.md:40
 *
 * All six are correct today. None of them had to stay that way. A re-provision that changes the tool
 * count would turn the diagram's case red and leave three documents quietly disagreeing with it, which
 * is worse than none of them being checked: the suite would be green on the file nobody reads the number
 * from and wrong in the README.
 *
 * Sources are read, not restated: the export's own `tools` array, `MAP_TABS` imported from the model the
 * screen renders, and `listInquiries()` as the app calls it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAP_TABS } from '../../../components/admin/backendMapModel'
import { listInquiries } from '../../../../netlify/functions/_lib/data'

const repoRoot = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

/** Everything a reviewer reads, derived so a new document is covered because it exists. */
const SURFACES = [
  'README.md',
  'SUBMISSION.md',
  'AGENTS.md',
  ...readdirSync(resolve(repoRoot, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
]

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

/** A count written either as digits or as a word, because the documents use both. */
const toNumber = (raw: string): number | undefined =>
  /^\d+$/.test(raw) ? Number(raw) : WORDS[raw.toLowerCase()]

const NUMBER = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'

interface Claim {
  /** What the documents are counting, as it appears after the number. */
  noun: string
  /** The count, from the artifact itself. */
  actual: () => number
  /** Where a reader would go to check it. */
  source: string
}

const CLAIMS: Claim[] = [
  {
    noun: 'tools',
    actual: () => {
      const parsed = JSON.parse(read('exports/telnyx-assistant.json')) as {
        tools?: unknown[]
        data?: { tools?: unknown[] }
      }
      return (parsed.tools ?? parsed.data?.tools ?? []).length
    },
    source: 'exports/telnyx-assistant.json',
  },
  {
    noun: 'tabs',
    actual: () => MAP_TABS.length,
    source: 'MAP_TABS in src/components/admin/backendMapModel.ts',
  },
  {
    noun: 'inquiries',
    actual: () => listInquiries().length,
    source: 'listInquiries(), from the compiled dataset',
  },
]

interface Found {
  doc: string
  line: number
  text: string
  stated: number | undefined
}

function occurrences(noun: string): Found[] {
  const re = new RegExp(`\\b${NUMBER}\\s+${noun}\\b`, 'gi')
  const out: Found[] = []
  for (const doc of SURFACES) {
    const text = read(doc)
    for (const m of text.matchAll(re)) {
      out.push({
        doc,
        line: text.slice(0, m.index).split('\n').length,
        text: m[0],
        stated: toNumber(m[1]),
      })
    }
  }
  return out
}

describe('counts in the deliverables that count something in the repository', () => {
  it('parses a count written as a word as well as one written in digits', () => {
    // The whole sweep rests on this. "seven tabs" is a word and "25 tools" is not; a parser that
    // handled only digits would find four of the six and call the rest absent.
    expect(toNumber('seven')).toBe(7)
    expect(toNumber('25')).toBe(25)
    expect(toNumber('Seven')).toBe(7)
    expect(toNumber('twenty-five'), 'unsupported spellings must come back undefined, not zero').toBeUndefined()
  })

  it('reads every source, so no claim below is compared against nothing', () => {
    for (const claim of CLAIMS) {
      expect(claim.actual(), `${claim.source} reports no ${claim.noun}`).toBeGreaterThan(0)
    }
  })

  it('finds the claims it means to check', () => {
    const total = CLAIMS.reduce((sum, c) => sum + occurrences(c.noun).length, 0)
    expect(
      total,
      `${total} artifact counts were found across the deliverables. There were six at iteration 164, and ` +
        `a sweep that finds fewer is a sweep to re-point rather than a package that stopped making claims.`,
    ).toBeGreaterThanOrEqual(5)
  })

  for (const claim of CLAIMS) {
    it(`every "${claim.noun}" count matches ${claim.source}`, () => {
      const actual = claim.actual()
      const wrong = occurrences(claim.noun).filter((f) => f.stated !== actual)

      expect(
        wrong.map((f) => `${f.doc}:${f.line} says "${f.text}"`),
        `${claim.source} has ${actual} ${claim.noun}, and these documents disagree:\n` +
          `${wrong.map((f) => `  ${f.doc}:${f.line} "${f.text}"`).join('\n')}\n\n` +
          `A number in a deliverable is only allowed to be a number because something keeps it true. ` +
          `Update the documents, or state the figure as a floor.`,
      ).toEqual([])
    })
  }

  it('would notice a document drifting, which is the point', () => {
    // A positive control on the comparison itself: the same text with the number changed must be
    // rejected by the same logic the cases above use.
    const actual = CLAIMS[0].actual()
    const drifted = { doc: 'README.md', line: 1, text: `${actual + 1} tools`, stated: actual + 1 }
    expect([drifted].filter((f) => f.stated !== actual)).toHaveLength(1)
  })
})
