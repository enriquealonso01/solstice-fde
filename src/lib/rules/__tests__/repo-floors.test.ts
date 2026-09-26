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

/**
 * The one count in that paragraph that is NOT in FLOORS above, and why it cannot be.
 *
 * README.md states **"over 700 tests"** three times -- in the result paragraph, beside the suite
 * description, and in the command block -- and it is the number a reviewer is most likely to check,
 * because the README tells them to: *"`npx vitest run` for the live number"*. It is also the only
 * claim in that paragraph with no floor above.
 *
 * **It cannot be floored the way the others are, and the measurement says so.** A test count is not a
 * property of the files; it is the result of running them, and a suite cannot run itself to count.
 * Counting declaration sites statically gives a LOWER bound, because 23 `it.each` sites expand to many
 * tests at runtime: measured at iteration 153, **629 sites against 898 actual tests**. A guard built on
 * that number would fail the README's true claim of 700. Writing one would mean lowering an honest floor
 * to satisfy a guard -- the same trap as the group-approval sweep that wanted three Policy 15 citations
 * scrubbed.
 *
 * So this guards the half that is checkable, which is the half that actually rots: the claim must stay a
 * FLOOR rather than becoming an exact figure, the three copies must agree, and the command that produces
 * the live number must stay beside it. Nothing checked any of that before: the approximation ban above
 * reads one paragraph and only bans "about"/"roughly", so `898 tests` in any of the three would pass it
 * today and be wrong by the next merge.
 */
describe("the README's test count, which is a floor that cannot be measured from inside", () => {
  const CLAIM = /(over|more than|at least|about|roughly|around|some|exactly|~)?\s*([0-9][0-9,]*)\+?\s+tests\b/gi

  const claims = () =>
    [...readme.matchAll(CLAIM)].map((m) => ({
      qualifier: (m[1] ?? '').toLowerCase().trim(),
      count: Number(m[2].replace(/,/g, '')),
      text: m[0].replace(/\s+/g, ' ').trim(),
      at: m.index ?? 0,
    }))

  /** Declaration sites in the shipped test files. A lower bound: `it.each` counts once and yields many. */
  const staticLowerBound = () => {
    const DECL = /(?:^|[\s;{(])(?:it|test)(?:\.each|\.skipIf|\.skip|\.only|\.concurrent|\.todo|\.fails)?\s*(?:\(|`)/g
    return tracked
      .filter((f) => /\.test\.tsx?$/.test(f))
      .reduce((sum, f) => sum + [...readFileSync(join(repoRoot, f), 'utf8').matchAll(DECL)].length, 0)
  }

  it('finds the claims it means to check, so a reworded README cannot make this vacuous', () => {
    const found = claims()
    expect(
      found.length,
      `README.md states a test count ${found.length} time(s); it said "over 700 tests" in three places at ` +
        `iteration 153. If the wording changed, re-point this case rather than deleting it -- the reason it ` +
        `exists is that the three copies drift apart when only one is edited.`,
    ).toBeGreaterThanOrEqual(3)
  })

  it('states it as a floor every time, never as an exact number', () => {
    const bare = claims().filter((c) => !['over', 'more than', 'at least'].includes(c.qualifier))
    expect(
      bare.map((c) => c.text),
      `README.md gives a test count without a floor word: ${bare.map((c) => c.text).join(', ')}. An exact ` +
        `count is wrong the next time anyone adds a test, and this suite gains tests most hours. "over N" ` +
        `only becomes truer. The command beside it gives the live figure.`,
    ).toEqual([])
  })

  it('keeps the three copies on the same number', () => {
    const counts = [...new Set(claims().map((c) => c.count))]
    expect(
      counts,
      `README.md claims ${counts.join(' and ')} tests in different places. Someone edited one of the three ` +
        `and not the others, so the file now contradicts itself in front of a reviewer.`,
    ).toHaveLength(1)
  })

  it('does not understate below what can be counted without running anything', () => {
    // One-directional and sound: if a static lower bound already beats the claim, the claim is needless
    // understatement. It can never confirm the claim -- that is the point of the comment above.
    const claimed = claims()[0]?.count ?? 0
    const bound = staticLowerBound()
    expect(bound, 'no test declaration sites found, so this bound proves nothing').toBeGreaterThan(200)
    expect(
      claimed,
      `README.md claims over ${claimed} tests and ${bound} declaration sites are visible without running ` +
        `anything -- and each of the ${
          tracked.filter((f) => /\.test\.tsx?$/.test(f)).length
        } test files can expand further at runtime. The claim undersells work that is already on disk.`,
    ).toBeGreaterThanOrEqual(bound)
  })

  it('keeps the command that produces the live number beside the claim', () => {
    // The floor is only honest because the reader is told how to get the real figure. Two of the three
    // copies carry the command; requiring both keeps the invitation attached to the number.
    const withCommand = claims().filter((c) => {
      const window = readme.slice(Math.max(0, c.at - 120), c.at + 160)
      return /npx vitest run/.test(window)
    })
    expect(
      withCommand.length,
      `only ${withCommand.length} of the test-count claims in README.md sit near "npx vitest run". A floor ` +
        `with no way to get the live number is just a vague number.`,
    ).toBeGreaterThanOrEqual(2)
  })
})
