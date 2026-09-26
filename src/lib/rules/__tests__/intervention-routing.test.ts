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
 * **1. Every decision is reachable from the opening region.** Not the wording — the fact that they are
 * reachable.
 *
 * That case shipped at iteration 116 as a list of the **five** needles that existed then, and a sixth
 * decision walked straight past it: iteration 117 found the interviewers' own brief published in the
 * public repo, wrote it up correctly at the **end of a 990-line file**, and the guard stayed green. One
 * iteration after fixing exactly this. A test whose opening sentence says *every decision* and whose body
 * checks a hardcoded list will pass for every decision that arrives after it is written, so the list is
 * now **derived from the file**: each `## Your call:` heading has to be reachable.
 *
 * The five explicit needles stay, because they pin wording a heading scan cannot see — the Supabase
 * project id, the `drop policy` statement, `INQ-2012`.
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

  it('reaches every "Your call" heading in the file, not just the ones I listed', () => {
    const all = lines()
    const region = openingRegion()

    /** `## Your call: <subject>` -> its subject, unless a later `## RESOLVED:` closes it. */
    const open: { line: number; subject: string }[] = []
    for (let i = 0; i < all.length; i++) {
      const m = all[i].match(/^## Your call:\s*(.+)$/)
      if (!m) continue
      const subject = m[1].replace(/\s*\(20\d\d-\d\d-\d\d[^)]*\)\s*$/, '').trim()
      // A "## RESOLVED:" anywhere after it that shares a distinctive phrase closes the item. The bare
      // pet question is exactly this shape: raised at one heading, resolved at another, and the opening
      // region already says it needs no decision. Flagging it would be a false positive.
      // No regex here on purpose: this line went through a heredoc twice and came back with its newline
      // escape expanded, which esbuild rejected outright. startsWith and includes need no escaping.
      const key = subject.split(/[,—-]/)[0].trim().slice(0, 28).toLowerCase()
      const resolved = all
        .slice(i + 1)
        .some((l) => l.startsWith('## RESOLVED:') && l.toLowerCase().includes(key))
      if (!resolved) open.push({ line: i + 1, subject })
    }

    expect(
      open.length,
      'No open "Your call:" headings found at all. Either they were renamed, or this scan is watching ' +
        'nothing -- which is how the sixth decision got past the five hardcoded needles.',
    ).toBeGreaterThan(0)

    /**
     * Reachable if the opening region points at its line, or quotes three consecutive words of its
     * heading.
     *
     * The first version counted single words longer than four characters and called two a match. Appending
     * a fake seventh decision -- *"whether to rotate the Anthropic key before sending"* -- left it GREEN,
     * because *whether*, *rotate*, *before* and *sending* all appear in the block already, about other
     * things. A three-word shingle is specific enough that only a deliberate mention matches.
     */
    const flat = region.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    const unreachable = open.filter(({ line, subject }) => {
      if (region.includes(`line ${line}`)) return false
      const words = subject.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
      for (let k = 0; k + 2 < words.length; k++) {
        if (flat.includes(words.slice(k, k + 3).join(' '))) return false
      }
      return true
    })

    expect(
      unreachable.map((u) => `line ${u.line}: ${u.subject}`),
      `${FILE}'s opening says the rest is "history and evidence", so a "Your call:" heading it does not ` +
        `mention is a decision Enrique will not see. Add it to the update block with a line pointer, or ` +
        `resolve it with a "## RESOLVED:" heading.`,
    ).toEqual([])
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
