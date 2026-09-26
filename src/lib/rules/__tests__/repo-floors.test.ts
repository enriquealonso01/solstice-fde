/**
 * Every count `README.md` states about this repository, checked against the repository.
 *
 * The "What this cost to build" section has now rotted twice. First the elapsed figure (T51, fixed at
 * iteration 130: *"about 24 hours"* against a real 37.9). Then, one paragraph below it, the line-count
 * split — and that one had been wrong for longer and by more:
 *
 *   stated                                    measured at iteration 131
 *   about 35,100 lines of source              38,850
 *   3,500 of deliverable documents             4,682
 *   13,800 of the agents' coordination record 26,706   <- understated by 93%
 *
 * The third is the one the paragraph itself argues is *"arguably the more interesting"* number, so the
 * page was underselling its own best statistic. And the sentence directly under it claimed *"figures
 * are given as floors or rounded, deliberately"* — two of the three were neither, which is the part
 * worth remembering: a document asserting that it has solved rot is not evidence that it has.
 *
 * So the figures are floors now, the README prints the command behind each one, and this file runs
 * those commands. A floor cannot go stale by the repository growing; it can only be broken by being
 * set too high, and that fails here rather than in front of a reviewer.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { shippedFiles } from './shippedFiles'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
// Normalised, because README.md is CRLF in this checkout and LF in others. The first version of the
// paragraph case below matched on "The line\ncount splits" and found nothing at all -- a guard that
// passes by looking in the wrong place, which is the failure this whole file exists to catch.
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8').replace(/\r\n/g, '\n')

/**
 * The files that ship, so the counts match what a reviewer sees. Git when this is a clone, a
 * `.gitignore`-aware walk when it is not — because the floors exist so a reviewer can check the
 * README's numbers, and until iteration 137 this threw during collection for anyone who downloaded
 * the ZIP instead of cloning.
 */
const tracked: string[] = shippedFiles(repoRoot).files

/** `wc -l` counts newlines, so a file with no trailing newline is one short. Match that. */
const lines = (rel: string): number => {
  const text = readFileSync(join(repoRoot, rel), 'utf8')
  let n = 0
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++
  return n
}

const totalLines = (paths: string[]) => paths.reduce((sum, p) => sum + lines(p), 0)

const isSource = (p: string) => /\.(ts|tsx|mjs|sql|css)$/.test(p)
const isDeliverableDoc = (p: string) =>
  p.endsWith('.md') && !p.startsWith('agents/') && !p.startsWith('plans/')
const COORDINATION = [
  'plans/06-master-plan.md',
  'agents/planner.status.md',
  'agents/implementer.status.md',
  'agents/tester.status.md',
  'agents/completed.log.md',
  'agents/tested.log.md',
]

interface Floor {
  label: string
  /** The exact words in README.md, so a reworded claim cannot leave this checking a ghost. */
  phrase: string
  claimed: number
  measure: () => number
}

const FLOORS: Floor[] = [
  {
    label: 'tracked files',
    phrase: 'over 250 files',
    claimed: 250,
    measure: () => tracked.length,
  },
  {
    label: 'TypeScript files',
    phrase: 'more than 160 of them TypeScript',
    claimed: 160,
    measure: () => tracked.filter((p) => /\.tsx?$/.test(p)).length,
  },
  {
    label: 'test files',
    phrase: 'more than 50 test files',
    claimed: 50,
    measure: () => tracked.filter((p) => /\.test\.tsx?$/.test(p)).length,
  },
  {
    label: 'lines of source',
    phrase: 'over 38,000 lines of source',
    claimed: 38_000,
    measure: () => totalLines(tracked.filter(isSource)),
  },
  {
    label: 'lines of deliverable documents',
    phrase: 'over 4,500',
    claimed: 4_500,
    measure: () => totalLines(tracked.filter(isDeliverableDoc)),
  },
  {
    label: "lines of the agents' coordination record",
    phrase: "over 26,000 of the agents' own coordination record",
    claimed: 26_000,
    measure: () => totalLines(COORDINATION),
  },
  {
    label: 'lines in total',
    phrase: 'over 80,000',
    claimed: 80_000,
    measure: () => totalLines(tracked),
  },
  {
    label: 'lines of the tester log',
    phrase: 'over 5,400 lines of it',
    claimed: 5_400,
    measure: () => lines('agents/tested.log.md'),
  },
]

describe('the counts README.md states about this repository', () => {
  it.each(FLOORS)('$label — README still makes the claim', ({ phrase }) => {
    expect(
      readme,
      `README.md no longer says "${phrase}". If the wording changed, change it here too; a floor ` +
        `nobody states is a floor nobody can be misled by, but it is also not what this is checking.`,
    ).toContain(phrase)
  })

  it.each(FLOORS)('$label — the floor is still a floor', ({ label, phrase, claimed, measure }) => {
    const actual = measure()
    expect(
      actual,
      `README.md says "${phrase}" and there are ${actual.toLocaleString()} ${label}. A floor that is ` +
        `above the real number is a false claim in the first file a reviewer opens. Lower the figure ` +
        `in README.md, or work out why the repository shrank.`,
    ).toBeGreaterThanOrEqual(claimed)
  })

  it('states no line count without a floor word in front of it', () => {
    // The previous two revisions of this paragraph failed here: "about 35,100 lines of source" and
    // "13,800 of the agents' own coordination record" both read as measurements and both rotted.
    const paragraph = readme
      .split(/\n\s*\n/)
      .find((p) => p.includes('The line\ncount splits') || p.includes('The line count splits'))

    expect(paragraph, 'the line-count paragraph is gone; update or remove this case').toBeTruthy()

    const flat = (paragraph as string).replace(/\s+/g, ' ')
    const bare = [...flat.matchAll(/(?:^|[^a-z])((?:about|roughly|around|some)\s+[0-9][0-9,]*)/gi)].map(
      (m) => m[1],
    )
    expect(
      bare,
      `the line-count paragraph gives ${bare.join(', ')} as an approximation rather than a floor. ` +
        `"about 35,100" was 38,850 within a day. Use "over N", which only becomes truer.`,
    ).toEqual([])
  })

  it('keeps the floors comfortably below the real numbers, not one commit above them', () => {
    // A floor set to the exact current value is a tripwire, not a claim: the next merge breaks it.
    // This does not fail on a tight floor, it fails on an impossible one -- claimed above measured is
    // already covered -- so it only reports how much headroom each has, and fails if any is negative.
    const tight = FLOORS.map((f) => ({ label: f.label, headroom: f.measure() - f.claimed })).filter(
      (f) => f.headroom < 0,
    )
    expect(tight, `floors below the measured value: ${JSON.stringify(tight)}`).toEqual([])
  })
})
