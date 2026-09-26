/**
 * Every percentile in the latency deliverable must carry the sample it came from.
 *
 * `docs/latency-target.md` is a named brief deliverable, and it has now been wrong twice in opposite
 * directions for exactly the same reason:
 *
 *   - A p95 of **950ms** from **20** calls said the 300ms voice target was missed by 650ms. Sixty calls
 *     gave p95 135ms. The doc already carries that confession: *"a tail statistic from twenty samples is
 *     the worst of twenty, not a p95."*
 *   - A p50 of **1545ms** from **six** turns said the 1500ms first-signal target was missed by 45ms. The
 *     population — every `turn_metrics` row production has written, n=338 — gives **1079ms**, which makes
 *     it by 421ms.
 *
 * One error flattered nobody and one undersold the build, and both came from a percentile published with
 * no `n` beside it. So that is what this pins: a section that reports percentiles has to say how many
 * samples they came from.
 *
 * What it deliberately does not pin is the measurements themselves. They are supposed to change when
 * something is re-measured — `doc-citations.test.ts` pins the three published *targets* (300ms, 1.5s, 4s)
 * because those are commitments, and a guard that froze the medians would make an honest re-measurement
 * fail.
 *
 * Measured at iteration 144, both percentile conventions, because the first-signal p90 lands on the line:
 * nearest-rank 1502ms, linear interpolation 1492ms, 10.1% of turns over 1500ms. The doc says "met at p50,
 * level at p90" rather than picking the side that reads better, and the last case here keeps it that way.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const DOC = 'docs/latency-target.md'
const doc = () => readFileSync(join(repoRoot, DOC), 'utf8').replace(/\r\n/g, '\n')

/** `### heading` … up to the next heading of the same or higher level. */
const sections = (): { heading: string; body: string }[] => {
  const text = doc()
  const out: { heading: string; body: string }[] = []
  const parts = text.split(/\n(?=#{2,3} )/)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    out.push({ heading: nl === -1 ? part : part.slice(0, nl), body: part })
  }
  return out
}

/**
 * A percentile stated as an **observation** — `p50 1545ms` — rather than as a commitment (`p50 ≤ 1.5s`)
 * or a back-reference (`the ≤300ms p95 published above`).
 *
 * The first version of this matched the bare word and flagged three sections that only state targets,
 * which is the over-broad-condition mistake this suite keeps finding in its own guards. A target has no
 * sample size by definition; only a measurement does.
 */
const PERCENTILE = /\bp(?:50|90|95|99)\b(?!\s*(?:≤|<=))[^.\n]{0,12}?\b\d{2,5}ms\b/
/** Anything that tells a reader how big the sample was. */
const SAMPLE_SIZE =
  /\bn\s*=\s*\d|\b\d{1,4}\s+(?:turns?|calls?|rows?|samples?|sessions?)\b|\b(?:six|twenty|sixty|two)\s+(?:turns?|calls?|passes)\b/i

describe('percentiles in the latency deliverable', () => {
  it('finds sections that report percentiles, so this cannot pass by matching nothing', () => {
    const reporting = sections().filter((s) => PERCENTILE.test(s.body))
    expect(
      reporting.length,
      `no section of ${DOC} reports a measured percentile any more. If the doc was restructured, re-point ` +
        `this rather than letting it go quiet — the tightened pattern is easy to make inert.`,
    ).toBeGreaterThanOrEqual(2)
  })

  it('never reports a percentile without saying how many samples it came from', () => {
    const naked = sections()
      .filter((s) => PERCENTILE.test(s.body) && !SAMPLE_SIZE.test(s.body))
      .map((s) => s.heading.trim())

    expect(
      naked,
      `these sections of ${DOC} give percentiles with no sample size: ${naked.join(' | ')}. This document ` +
        `has been wrong twice for exactly that reason — a p95 from 20 calls that said the voice target was ` +
        `missed by 650ms, and a p50 from 6 turns that said the signal target was missed by 45ms. Put the n ` +
        `next to the number.`,
    ).toEqual([])
  })

  it('publishes the population, not only the samples', () => {
    const text = doc()
    expect(
      text,
      `${DOC} no longer reports the full turn_metrics population. Every chat turn writes one, so a median ` +
        `of six published beside an available census is a choice, and it was the wrong one.`,
    ).toMatch(/n=338|n = 338/)
    expect(text, `${DOC} no longer states the measurement window for the population`).toContain('2026-09-24T17:30:11Z')
    expect(
      text,
      `${DOC} no longer shows the query behind the population, so a reviewer has to trust it instead of ` +
        `re-deriving it.`,
    ).toContain("tool = 'turn_metrics'")
  })

  it('keeps the three published targets exactly as committed', () => {
    // Correcting a measurement is free; softening a target is not. Named separately from
    // doc-citations.test.ts so the distinction is stated where the measurements are edited.
    const text = doc()
    for (const target of ['300ms', '1500ms', '4000ms']) {
      expect(text, `${DOC} no longer states the ${target} target`).toContain(target)
    }
  })

  it('does not claim the first-signal target is met at p90, which it is not', () => {
    // Nearest-rank 1502ms, interpolated 1492ms, 10.1% of turns over 1500ms: the p90 is on the boundary,
    // so "met at p90" is true only under the convention that happens to flatter us.
    const flat = doc().replace(/\s+/g, ' ')
    expect(
      flat,
      `${DOC} claims the first-signal target is met at p90. Measured over 338 turns it is 1492-1502ms ` +
        `depending on the percentile convention, with 10.1% of turns over 1500ms — the honest form is ` +
        `"met at p50, level at p90", and picking the convention that clears the target is the same error ` +
        `as publishing a median of six.`,
    ).not.toMatch(/first signal[^.]{0,80}met at p90|met at p90[^.]{0,40}first signal/i)
    expect(flat, `${DOC} no longer states the p90 straddle at all`).toMatch(/level at p90|straddl/i)
  })
})
