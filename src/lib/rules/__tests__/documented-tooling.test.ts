/**
 * A tool a document tells someone to run with `npx` must already be installed, or the document must say
 * it is not.
 *
 * `documented-commands.test.ts` pins the sibling case -- every `npm run X` in a followed document must be
 * a real script -- and says so in its own scope note. It does not look at `npx`, and `npx` is the riskier
 * form: an `npm run` that does not exist fails in a second with a clear error, while an `npx <tool>` that
 * is not installed **succeeds after downloading it**, which needs the network and takes minutes rather
 * than seconds.
 *
 * Measured at iteration 154, three `npx` tools across the reader-facing documents:
 *
 *   npx vitest      declared in package.json, binary present
 *   npx vite-node   binary present -- but ONLY as a transitive dependency of vitest@2.1.9
 *   npx netlify     not present, and SUBMISSION.md says so, with the cost
 *
 * The middle one is why this file exists. `docs/live-modification.md` is the live-modification beat, the
 * one edit the brief says the panel will ask to watch, and the sentence under its command promises **no
 * network**. That promise holds today because `vitest` happens to ship `vite-node` in its dependency tree.
 * If a vitest upgrade ever stopped doing so, `npx vite-node` would quietly change from running a local
 * binary to fetching a package from the registry -- mid-demo, on the machine in front of the panel, and
 * with nothing in the repository to notice. This turns that into a failed test instead.
 *
 * `npx netlify` shows the exemption working as intended rather than as a hole: SUBMISSION.md's pre-send
 * checklist states *"`netlify-cli` is deliberately not a project dependency, so on a machine without it
 * the first run installs it first, which is minutes rather than seconds."* That is the honest form, so the
 * rule is satisfied by saying so, not only by installing.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

/** Everything a reviewer or a presenter is handed. */
const DOCS = ['README.md', 'SUBMISSION.md', 'AGENTS.md', ...readdirSync(join(repoRoot, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)]

/** How a document may admit that a tool is not installed. */
const DISCLOSED = /not a project dependency|not installed|installs it first|downloads? it first/i

interface Mention {
  doc: string
  tool: string
  at: number
}

function mentions(): Mention[] {
  const out: Mention[] = []
  for (const doc of DOCS) {
    const text = read(doc)
    for (const m of text.matchAll(/\bnpx\s+([a-z0-9@/._-]+)/g)) {
      out.push({ doc, tool: m[1], at: m.index ?? 0 })
    }
  }
  return out
}

/** What `npx <tool>` resolves to without touching the network: a binary npm already linked. */
function installedLocally(tool: string): boolean {
  const base = tool.split('/').pop() as string
  const bin = join(repoRoot, 'node_modules', '.bin')
  // Windows gets .cmd and .ps1 shims beside the POSIX one; any of them means npm linked it.
  return ['', '.cmd', '.ps1'].some((ext) => existsSync(join(bin, base + ext)))
}

describe('tools the documents tell someone to run with npx', () => {
  it('finds the mentions it means to check, so a reworded document cannot make this vacuous', () => {
    const found = mentions()
    expect(
      found.length,
      'no npx invocations found across the deliverables. There were five, naming three tools, at ' +
        'iteration 154 -- if the documents stopped using npx, remove this file rather than leaving it green.',
    ).toBeGreaterThanOrEqual(3)
    expect(new Set(found.map((m) => m.tool)).size).toBeGreaterThanOrEqual(2)
  })

  it('are installed already, or the document says they are not', () => {
    const undisclosed = mentions().filter((m) => {
      if (installedLocally(m.tool)) return false
      const doc = read(m.doc)
      // The disclosure has to be near the instruction, not merely somewhere in the file.
      return !DISCLOSED.test(doc.slice(Math.max(0, m.at - 400), m.at + 400))
    })

    expect(
      undisclosed.map((m) => `${m.doc}: npx ${m.tool}`),
      `these documents invoke a tool that is not installed and do not say so: ` +
        `${undisclosed.map((m) => `${m.doc} (npx ${m.tool})`).join(', ')}.\n\n` +
        `An npx call for a missing package does not fail -- it downloads it, which needs the network and ` +
        `takes minutes. Either add it to package.json or say plainly that the first run installs it, the ` +
        `way SUBMISSION.md does for netlify-cli.`,
    ).toEqual([])
  })

  it('resolves vitest locally, which is the positive case proving the check can pass', () => {
    // Without this, "everything resolved" would be indistinguishable from a broken resolver.
    expect(installedLocally('vitest'), 'vitest is not linked in node_modules/.bin, so the resolver above is wrong').toBe(true)
  })

  it('does not fire on a tool that is genuinely absent and genuinely disclosed', () => {
    // netlify is the known absent-and-disclosed case. If it ever becomes installed, this case should be
    // re-pointed rather than deleted: the exemption path needs one live example or it rots untested.
    const netlify = mentions().find((m) => m.tool === 'netlify')
    expect(netlify, 'no npx netlify mention left; re-point this case at whatever the absent-and-disclosed case is now').toBeDefined()
    if (!installedLocally('netlify')) {
      const doc = read(netlify!.doc)
      expect(
        DISCLOSED.test(doc.slice(Math.max(0, netlify!.at - 400), netlify!.at + 400)),
        `${netlify!.doc} invokes npx netlify without netlify-cli installed and no longer says so nearby.`,
      ).toBe(true)
    }
  })
})

/**
 * The sentence under the live-modification command, both halves of it.
 *
 * It is the one edit the brief says the panel will ask to watch, so what the page promises about the
 * command matters as much as the command working. It said *"No network, no model, under a second."*
 *
 * **Two of those three were true.** Timed three runs at iteration 154: **1334ms, 2213ms, 1252ms** -- never
 * under a second, and once over two. A presenter who repeats that line gets contradicted by the screen on
 * the highest-attention beat in the demo, over a detail that buys nothing: nobody minds a second and a
 * half. The page now gives the measured range and says not to promise it is instant.
 *
 * The no-network half is pinned by the case above, because it is the half that could stop being true
 * without anyone editing this page.
 */
describe('what the live-modification page promises about its command', () => {
  const DOC = 'docs/live-modification.md'

  it('keeps the claims that are true and verifiable', () => {
    const text = read(DOC)
    expect(text, `${DOC} no longer says the command makes no network call`).toMatch(/[Nn]o network/)
    expect(text, `${DOC} no longer says the command calls no model`).toMatch(/no model/)
  })

  // One pattern, one pass, and each match judged by ITS OWN offset. The first draft of this case
  // collected `m[0]` and then re-ran matchAll inside the filter to look the offset up by index --
  // correlating two passes positionally, which is the shape agents/README.md bans and iteration 150
  // removed from three other guards. It worked, and it was one edit away from not working.
  const SUB_SECOND = /under a second|sub-second|instantly|in an instant|under 1 ?s\b/gi

  it('claims no sub-second runtime, because it is not one', () => {
    const text = read(DOC)
    const overclaims = [...text.matchAll(SUB_SECOND)]
      // Saying "do not promise it is instant" is the correction, not the claim.
      .filter((m) => {
        const at = m.index ?? 0
        return !/do not promise|not instant|rather than instant/i.test(text.slice(Math.max(0, at - 60), at + 60))
      })
      .map((m) => m[0])

    expect(
      overclaims,
      `${DOC} claims ${overclaims.join(', ')} for a command measured at 1334ms, 2213ms and 1252ms. State ` +
        `the range; a presenter repeats this line to a panel watching the screen.`,
    ).toEqual([])
  })

  it('states a measured figure for how long it does take', () => {
    // A corrected claim that gives no number at all is weaker than the wrong one: the presenter then has
    // nothing to say, and the next person to time it has nothing to compare against.
    const text = read(DOC)
    expect(
      text,
      `${DOC} no longer gives a measured duration for the command. The point of correcting "under a ` +
        `second" was to replace it with something true, not to delete the figure.`,
    ).toMatch(/\d+(?:\.\d+)?\s*s\b|\d{3,4}\s*ms/)
  })
})
