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
