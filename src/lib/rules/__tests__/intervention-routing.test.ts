/**
 * Enrique has to be able to reach every decision that is his, from the page he is told to read.
 *
 * `HUMAN_INTERVENTION.md` opens with a short list dated **2026-09-25 15:30** that says *"read this block;
 * the rest is history and evidence."* Two of the four things he must decide were found after 15:30 — the
 * RLS `drop policy` paste (PR #62, 17:52) and the SIP credential rotation (~22:30) — and the list was never
 * reopened. Neither appears in `SUBMISSION.md`'s **Before sending** checklist or the runbook's **Before
 * they join**, so a correctly-written entry further down the file was the only record, on a page whose own
 * opening tells him he does not need to read that far. The Planner filed it as T45 and could not fix it:
 * the file is appended to by the shipping agents.
 *
 * Two properties are pinned, and the second one caught me.
 *
 * **1. The opening region names both decisions.** Not the wording — the fact that they are reachable.
 *
 * **2. Every `line N` pointer in that region lands on what it claims.** This file has no `doc-citations`
 * cover, and it is where a stale pointer costs the most: someone following it at 08:00 on submission
 * morning. Writing the update **shifted every line below it by 37**, so the numbers I had just verified
 * against the old file were wrong by the time I saved it — the exact failure the task is about, committed
 * while fixing it. The pointers are now checked here rather than by hand.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const FILE = 'HUMAN_INTERVENTION.md'

function lines(): string[] {
  return readFileSync(join(repoRoot, FILE), 'utf8').split(/\r?\n/)
}

/** The part he is actually told to read: everything before the first entry under "Open". */
function openingRegion(): string {
  const all = lines()
  const end = all.findIndex((l) => l.startsWith('## Open'))
  expect(end, `${FILE} no longer has an "## Open" section; this test needs to know where the top ends`).toBeGreaterThan(0)
  return all.slice(0, end).join('\n')
}

describe('the decisions the short list routes to', () => {
  it('reads a file that is there and has the expected shape', () => {
    expect(existsSync(join(repoRoot, FILE))).toBe(true)
    expect(openingRegion()).toContain('the short list, 2026-09-25 15:30')
  })

  it.each([
    { label: 'the RLS paste', needle: 'drop policy' },
    { label: 'the project it is pasted into', needle: 'bcrivjgqrxahgxyiqlpr' },
    { label: 'the SIP credential decision', needle: 'SIP credential' },
    { label: 'the Telnyx top-up', needle: 'Top up Telnyx' },
    { label: 'the two junk inquiries', needle: 'INQ-2012' },
  ])('$label is reachable from the opening region', ({ needle }) => {
    expect(
      openingRegion(),
      `${FILE}'s opening tells the reader the rest is "history and evidence", so a decision that is only ` +
        `described further down is a decision he will not see. ${needle} is not in the part he reads.`,
    ).toContain(needle)
  })

  it('points every "line N" at what it says is there', () => {
    const all = lines()
    const region = openingRegion()
    // `**line 596**, under *"### What to run"*` -> check line 596 contains "### What to run".
    const cited = [...region.matchAll(/\*\*line (\d+)\*\*,? (?:under|—|-)?\s*\*"([^"]{6,80})"\*/g)]
    expect(
      cited.length,
      'No checkable "line N" pointers found in the opening region. Either they were removed, or their ' +
        'shape changed and this test is now watching nothing.',
    ).toBeGreaterThanOrEqual(3)

    const wrong: string[] = []
    for (const m of cited) {
      const n = Number(m[1])
      const claim = m[2].replace(/\s+/g, ' ')
      const actual = (all[n - 1] ?? '').replace(/\s+/g, ' ')
      if (!actual.includes(claim)) wrong.push(`line ${n} should contain "${claim}" but is "${actual.slice(0, 70)}"`)
    }
    expect(
      wrong,
      `${FILE} sends the reader to a line that says something else. Appending anywhere above a pointer ` +
        `shifts it, which is how these went stale in the first place:\n${wrong.join('\n')}`,
    ).toEqual([])
  })
})
