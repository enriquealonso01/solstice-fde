/**
 * The guide to the architecture diagram must describe the diagram that exists.
 *
 * `docs/README-diagram.md` is how a reviewer navigates `architecture.drawio` — it names the three
 * pages and says what each one shows. Nothing checked the guide against the file, and the two drift
 * independently: renaming a page or adding a failover row leaves the guide describing a diagram
 * nobody has any more.
 *
 * Both are accurate today, verified by hand before this was written. It is here because they are the
 * last doc-and-artifact pair in the package with no link between them, and because the diagram is a
 * named brief deliverable a reviewer is told to open.
 *
 * A note on reading the `.drawio`: it is uncompressed XML, so page names are plain attributes and
 * cell text is plain `value=`. That is not guaranteed — draw.io can deflate the body — so the first
 * assertion checks the file is still readable this way rather than letting a compressed save turn
 * every later check into a silent pass.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')
const guide = readFileSync(join(repoRoot, 'docs/README-diagram.md'), 'utf8')
const drawio = readFileSync(join(repoRoot, 'docs/architecture.drawio'), 'utf8')

const pageNames = [...drawio.matchAll(/<diagram[^>]*name="([^"]+)"/g)].map((m) => m[1])

describe('the diagram guide against the diagram', () => {
  it('can still read the .drawio as plain XML, or every check below is meaningless', () => {
    expect(pageNames.length, 'no page names found — has the .drawio been saved compressed?').toBeGreaterThan(0)
    expect(drawio).toContain('value=')
  })

  it.each(['Future state (production)', 'Today (MVP)', 'Degradation and failover'])(
    'the guide names page "%s" and the diagram has it',
    (name) => {
      expect(guide, `docs/README-diagram.md no longer mentions the page "${name}"`).toContain(name)
      expect(
        pageNames,
        `docs/README-diagram.md tells a reviewer to open the "${name}" page and architecture.drawio ` +
          `has no page by that name. Its pages are: ${pageNames.join(', ')}`,
      ).toContain(name)
    },
  )

  it('has as many failover rows as the guide claims', () => {
    const page = drawio.slice(drawio.indexOf('<diagram id="degrade"'))
    // Count row TITLES, which the diagram marks with font-weight:700, not every cell whose body
    // happens to contain a failure word. A first version matched on text alone and counted 8 --
    // two of them were the 'what the guest sees' descriptions beside a row, not rows.
    const rows = [...page.matchAll(/value="([^"]*font-weight:700[^"]*)"/g)]
      .map((m) => m[1])
      .filter((v) => /unreachable|down or|drops|fails|outage|degraded/i.test(v))

    expect(guide, 'the guide no longer says "Six rows"; update this case with it').toContain('Six rows')
    expect(
      rows.length,
      `The guide says the failover page has six rows; the diagram has ${rows.length}. ` +
        `Either a row was added without updating docs/README-diagram.md, or this filter missed one.`,
    ).toBe(6)
  })

  it('describes the SVG as a render of the page it actually renders', () => {
    expect(guide).toContain('Future state')
    const svg = readFileSync(join(repoRoot, 'docs/architecture.svg'), 'utf8')
    // The exported page carries the TODAY/FUTURE bands; the separate failover page does not appear.
    expect(svg).toContain('FUTURE')
    expect(svg).toContain('TODAY')
  })
})

/**
 * The Today page's status markings, against what actually runs.
 *
 * This page exists to say *"what actually runs at the demo"*, and at iteration 133 six of its nodes
 * said the opposite of the truth — every one of them understating the build. `Claude (Anthropic API)`
 * was **BLOCKED**, annotated *"Key is not workspace-scoped and currently 400s. Code is written against
 * the contract."* The chat brain, in a named brief deliverable, described as a stub. The phone number,
 * the voice assistant, `/api/chat`, the transcript webhook and email were PENDING or BLOCKED beside it.
 *
 * Verified against the live systems before promoting any of them: the Anthropic API answered on
 * `claude-sonnet-5`; `+13057866217` came back `active`; the assistant carried 29,784 instruction
 * characters and 25 tools; six voice sessions in Postgres held 3-9 transcript messages each, one of
 * them `taken_over`; the sending domain `enriquecodes.com` was `status: verified`; four proposals were
 * `sent` via email.
 *
 * Two things are pinned here. The counts the guide now states out loud, so the page and its guide
 * cannot drift apart again. And the promise the guide makes about *how* status is shown — "the tag is
 * backed by a shape, not a colour" — because this fix had to change a label and a border together,
 * and the next person to change one and not the other would leave a node that reads LIVE and draws
 * as blocked, which is the failure this whole class started as.
 */
describe('the Today page says what actually runs', () => {
  const todayPage = (() => {
    const start = drawio.indexOf('<diagram id="today"')
    const from = start >= 0 ? start : drawio.indexOf('Today (MVP)')
    const end = drawio.indexOf('</diagram>', from)
    return drawio.slice(from, end === -1 ? undefined : end)
  })()

  /** Status nodes carry the tag in a 9px letter-spaced div, then a title, then a detail line. */
  const statusCells = [
    ...todayPage.matchAll(
      /<mxCell id="([^"]+)" value="([^"]*letter-spacing:1px[^"]*&gt;(LIVE|PENDING|BLOCKED)&lt;[^"]*)" style="([^"]*)"/g,
    ),
  ].map((m) => ({ id: m[1], value: m[2], tag: m[3], style: m[4] }))

  it('has status nodes to check at all', () => {
    expect(statusCells.length, 'found no LIVE/PENDING/BLOCKED nodes on the Today page').toBeGreaterThan(10)
  })

  it.each([
    ['LIVE', 24],
    ['PENDING', 0],
    ['BLOCKED', 1],
  ])('has the %s count the guide states: %i', (tag, expected) => {
    const actual = statusCells.filter((c) => c.tag === tag).length
    expect(
      actual,
      `the Today page has ${actual} ${tag} nodes and docs/README-diagram.md says ${expected}. Whichever ` +
        `is wrong, a status page that disagrees with its own guide is worse than either one alone.`,
    ).toBe(expected)
    expect(
      guide,
      `docs/README-diagram.md no longer states the ${tag} count; it is what makes the case above real`,
    ).toContain(`${expected} ${tag}`)
  })

  it('backs every tag with the border shape the guide promises', () => {
    // LIVE is solid, PENDING and BLOCKED are dashed with different patterns. The guide says the tag is
    // "backed by a shape, not a colour", so a mismatch makes the deliverable's own claim false.
    const wrong = statusCells
      .map((c) => {
        const solid = c.style.includes('dashed=0')
        const blocked = c.style.includes('dashPattern=2 3')
        const pending = c.style.includes('dashPattern=8 4')
        const shape = solid ? 'LIVE' : blocked ? 'BLOCKED' : pending ? 'PENDING' : 'unknown'
        return { id: c.id, tag: c.tag, shape }
      })
      .filter((c) => c.tag !== c.shape)

    expect(
      wrong,
      `these nodes are labelled one status and drawn as another: ${JSON.stringify(wrong)}. The guide ` +
        `promises the tag is backed by a shape, so a reader who cannot see colour gets the wrong answer.`,
    ).toEqual([])
  })

  it('no longer says the chat brain is blocked', () => {
    // The exact sentence that was on the page, kept as the thing being guarded against.
    expect(
      todayPage,
      'the Today page again claims the Anthropic key is not workspace-scoped. It answers on ' +
        'claude-sonnet-5; a diagram saying otherwise tells a reviewer the centerpiece is a mock.',
    ).not.toContain('not workspace-scoped')
    expect(
      drawio,
      'the diagram legend again explains BLOCKED with the Anthropic key, which is not blocked',
    ).not.toContain('the Anthropic key is not workspace-scoped')
  })

  it('gives the one blocked node the reason that is actually true', () => {
    const sms = statusCells.find((c) => c.value.includes('10DLC'))
    expect(sms, 'the SMS node is gone; it is the honest exception and worth keeping').toBeTruthy()
    expect((sms as { tag: string }).tag).toBe('BLOCKED')
    expect(
      (sms as { value: string }).value,
      'the SMS node blames timing again. The brief allows five business days, so "cannot clear before ' +
        'submission" was never the binding fact -- nothing was ever registered.',
    ).not.toContain('cannot clear before submission')
  })
})
