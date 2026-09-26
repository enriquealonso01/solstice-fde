/**
 * "Assumption 3 in the README" must be the assumption the sentence is about.
 *
 * Two files carry numbered assumption lists — `README.md` and `agent/sol.md` §6 — and three documents
 * cite them **by number**. `docs/role-walkthroughs.md` does it twice in one sentence: *"It is assumption
 * 3 in the README and assumption 13 in `agent/sol.md`."* A numbered cross-reference is the classic thing
 * that shifts when somebody inserts an item above it, and nothing about the citing sentence looks wrong
 * afterwards — the number is still a number, and it now points at a different claim.
 *
 * All four citations were checked by hand at iteration 111 and every one was right, which is the cheapest
 * moment to pin them: the mapping below records what each number currently means, so an insertion fails
 * here instead of quietly re-pointing a sentence a reviewer is invited to follow.
 *
 * Pinned by **number and keyword**, not number alone. Asserting that "assumption 3 exists" is satisfied
 * by any third item; asserting that the thing cited for approval authority says *named human* is the check
 * that has content. The list is explicit for the same reason the other guards here are: a parser that
 * guessed which sentence a citation belonged to would be wrong often enough to be ignored.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

/**
 * The numbered `1. **Bold lead**` items of a document, by number, with the lead's whitespace
 * flattened.
 *
 * `[\s\S]+?` rather than `.+?`, because README assumption 4's bold lead wraps across a line --
 * *"A phone-taken group inquiry is persisted and rehydrated into the inbox, contact still

 * masked."* -- and the first version of this function silently found 8 of the 9 items. The
 * can-it-see-anything case below caught it, which is the only reason I know. Fourth time in this
 * repo that a line wrap has defeated a pattern over prose; the standing rule is to flatten
 * whitespace before matching, never to assume a sentence lives on one line.
 */
function numberedAssumptions(doc: string): Map<number, string> {
  const text = readFileSync(join(repoRoot, doc), 'utf8')
  const out = new Map<number, string>()
  for (const m of text.matchAll(/^(\d+)\.\s+\*\*([\s\S]+?)\*\*/gm)) {
    const n = Number(m[1])
    if (!out.has(n)) out.set(n, m[2].replace(/\s+/g, ' '))
  }
  return out
}

/** Each: the document that cites, the list it cites into, the number, and what that item must be about. */
const CITATIONS = [
  {
    from: 'docs/demo-runbook.md',
    into: 'README.md',
    n: 3,
    mustSay: 'named human',
    about: 'approval authority',
  },
  {
    from: 'docs/role-walkthroughs.md',
    into: 'README.md',
    n: 3,
    mustSay: 'named human',
    about: 'approval authority',
  },
  {
    from: 'docs/role-walkthroughs.md',
    into: 'agent/sol.md',
    n: 13,
    mustSay: 'named human',
    about: 'approval authority',
  },
  {
    from: 'agent/sol.md',
    into: 'agent/sol.md',
    n: 16,
    mustSay: 'Sales will follow up',
    about: "the chat runtime's prompt",
  },
]

describe('numbered assumptions cited across documents', () => {
  it('finds both numbered lists, so nothing below passes by reading an empty map', () => {
    expect(numberedAssumptions('README.md').size).toBeGreaterThanOrEqual(9)
    expect(numberedAssumptions('agent/sol.md').size).toBeGreaterThanOrEqual(16)
  })

  it.each(CITATIONS)('$from cites assumption $n of $into, which must still be about $about', ({ from, into, n, mustSay, about }) => {
    const citing = readFileSync(join(repoRoot, from), 'utf8')
    expect(
      citing.toLowerCase(),
      `${from} no longer cites an assumption by number; update or remove this case`,
    ).toContain('ssumption')

    const item = numberedAssumptions(into).get(n)
    expect(item, `${into} has no numbered assumption ${n}, but ${from} points at one`).toBeTruthy()
    expect(
      item,
      `${from} points a reader at assumption ${n} of ${into} for ${about}, and item ${n} is now ` +
        `"${item}". Something was inserted above it, so the citation quietly re-pointed.`,
    ).toContain(mustSay)
  })

  it('keeps the two approval-authority assumptions saying the same thing', () => {
    // The walkthrough's sentence claims both lists agree. If they ever diverge, that sentence is the
    // one that becomes false, and it is the sentence a reviewer checks when asking who can approve.
    const readme = numberedAssumptions('README.md').get(3) ?? ''
    const sol = numberedAssumptions('agent/sol.md').get(13) ?? ''
    for (const [label, text] of [['README 3', readme], ['sol.md 13', sol]] as const) {
      expect(text.toLowerCase(), `${label} no longer says approval authority is a named human`).toContain(
        'named human',
      )
    }
  })
})
