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

/**
 * T55. The case above resolves pointers written *inside* `HUMAN_INTERVENTION.md`. The pointers that
 * actually route Enrique are in `plans/06-master-plan.md`, and nothing checked those.
 *
 * Measured at the Planner's iteration before this one: of its eight pointers into this file, **six had
 * rotted by exactly +13** — thirteen lines had been inserted above them and everything below shifted. The
 * two that survived were the two inside the opening region the case above covers. **The guard had learned
 * the lesson about the file it lives next to and not about the file that cites it.**
 *
 * The one that mattered was under Enrique's number-one item: *"the SQL to paste is at 596"*, where line
 * 596 had become prose about GM sign-off. The single most important instruction in the package aimed at
 * the wrong text for three hours, and he would have followed it at 10:00.
 *
 * Two details this had to get right, both found by checking rather than by reading the task:
 *
 * - **The region boundary must anchor at line start.** The string `## 0. Verification log` appears at plan
 *   line 597, inside the task describing this work, before the real heading at 1962. A first probe used
 *   `indexOf` and silently checked 7 of the 12 pointers.
 * - **Emphasis has to be stripped before comparing.** The plan quotes `:27` as *"Neither the Tester nor I
 *   **will** delete production rows"* — bolding the word that carries the argument. The source line says
 *   plain `will`, so a literal comparison fails on a faithful quotation.
 */
describe("the master plan's pointers into HUMAN_INTERVENTION.md", () => {
  const PLAN = 'plans/06-master-plan.md'
  const plan = () => readFileSync(join(repoRoot, PLAN), 'utf8').replace(/\r\n/g, '\n')

  /** Markdown emphasis is presentation, not content: a quote that bolds a word is still the quote. */
  const plain = (s: string) => s.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim()

  /** Everything above the verification log, which quotes stale numbers on purpose. */
  const split = () => {
    const text = plan()
    const heading = /^## 0\. Verification log/m.exec(text)
    return { text, heading, open: heading ? text.slice(0, heading.index) : text, log: heading ? text.slice(heading.index) : '' }
  }

  interface Pointer {
    line: number
    quote: string | null
  }

  const pointersIn = (region: string): Pointer[] => {
    const out: Pointer[] = []
    for (const m of region.matchAll(/HUMAN_INTERVENTION\.md:(\d+)/g)) {
      const tail = region.slice(m.index + m[0].length, m.index + m[0].length + 130)
      const q = /\*\*\*"([^"]+)"\*\*\*|\*"([^"]+)"\*/.exec(tail)
      out.push({ line: Number(m[1]), quote: q ? (q[1] ?? q[2]) : null })
    }
    // One entry per (line, quote), so the same pointer repeated is checked once.
    return [...new Map(out.map((p) => [`${p.line}|${p.quote}`, p])).values()]
  }

  it('finds the open region by a heading at line start, not by the string anywhere', () => {
    const { text, heading } = split()
    expect(heading, `${PLAN} has no "## 0. Verification log" heading; this whole describe is inert`).toBeTruthy()

    // The trap, asserted rather than remembered: the phrase occurs before the heading does.
    const firstMention = text.indexOf('## 0. Verification log')
    expect(
      firstMention,
      'the phrase no longer appears before the heading, so the line-start anchor is untested here. It did ' +
        'at iteration 142, and an indexOf boundary checked 7 of 12 pointers while looking thorough.',
    ).toBeLessThan((heading as RegExpExecArray).index)
  })

  const open = pointersIn(split().open)

  it('finds pointers to resolve, so this cannot pass by matching nothing', () => {
    expect(
      open.length,
      `no HUMAN_INTERVENTION.md pointers found in ${PLAN}'s open region. If the form changed, change the ` +
        'pattern with it rather than letting this go quiet.',
    ).toBeGreaterThanOrEqual(4)
    expect(open.filter((p) => p.quote !== null).length, 'no pointer carries a quote to resolve').toBeGreaterThanOrEqual(3)
  })

  it.each(open.map((p) => [p.line, p.quote] as const))(
    'HUMAN_INTERVENTION.md:%d is where the plan says it is',
    (line, quote) => {
      const all = lines()
      expect(
        line > 0 && line <= all.length,
        `${PLAN} cites HUMAN_INTERVENTION.md:${line} and the file has ${all.length} lines.`,
      ).toBe(true)
      if (quote === null) return

      expect(
        plain(all[line - 1] ?? ''),
        `${PLAN} sends Enrique to HUMAN_INTERVENTION.md:${line} for "${quote}" and that line says something ` +
          `else. Six of these shifted by +13 in three hours, including the one under his item 1, where the ` +
          `SQL pointer had become prose about GM sign-off. Search the quoted heading and re-point it.`,
      ).toContain(plain(quote))
    },
  )

  it('exempts the verification log, and the exemption is doing real work', () => {
    // Not decoration: the log deliberately quotes pointers as they were, so several do not resolve. If
    // none of them failed, the exemption would be untested and could be removed without anything noticing.
    const all = lines()
    const stale = pointersIn(split().log).filter(
      (p) => p.quote !== null && !plain(all[p.line - 1] ?? '').includes(plain(p.quote)),
    )
    expect(
      stale.length,
      'no pointer in the verification log is stale, so nothing proves the log needs exempting. Either the ' +
        'log was rewritten — in which case it stopped being a dated record — or the split is wrong.',
    ).toBeGreaterThan(0)
  })
})
