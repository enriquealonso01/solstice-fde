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

/** The .drawio stores node labels as doubly-escaped HTML inside an XML attribute, and the tags carry
 *  no text, so a plain-text read has to unescape twice and then strip the markup. */
const decode = (xml: string): string =>
  xml
    .replace(/&amp;lt;/g, '<')
    .replace(/&amp;gt;/g, '>')
    .replace(/&amp;quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')

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
 * The three promises `docs/README-diagram.md` makes about `architecture.svg`, checked against the file.
 *
 * The SVG matters more than its size suggests: it is the diagram a reviewer actually opens, because an
 * `.svg` renders in any browser and a `.drawio` needs diagrams.net. Its guide says, in one sentence:
 *
 *   > a hand-authored render of the *Future state* page, **sized for a projector. Nothing under 12px,
 *   > black-on-white contrast, and no meaning carried by colour alone.**
 *
 * Two of those were true when measured at iteration 136. Every text fill clears 4.5:1 against white by a
 * wide margin, and the TODAY/FUTURE distinction is carried by border shape as well as colour -- 31
 * dashed node borders against 31 FUTURE tags, exactly.
 *
 * The font size was not. `viewBox="0 0 2500 1670"` with a matching `width`, so the units are 1:1
 * pixels, and **52 `<text>` elements sat at `font-size="11"`**. They were not incidental: 31 FUTURE and
 * 21 TODAY, and nothing else in the file was under 12. So the smallest text in a diagram "sized for a
 * projector" was the text doing the accessibility work -- the tags are the reason the distinction is not
 * colour-only, and they were the hardest thing on the page to read. Raised to 12 rather than lowering
 * the claim, because the tags are the labels that most deserve to be legible and there is 380px of
 * clear space beside each one.
 */
describe('the SVG against the three promises its guide makes', () => {
  const svg = readFileSync(join(repoRoot, 'docs/architecture.svg'), 'utf8')

  /** Both spellings, so a switch to CSS-style attributes cannot slip under the floor. */
  const fontSizes = [
    ...[...svg.matchAll(/font-size="([0-9.]+)"/g)].map((m) => Number(m[1])),
    ...[...svg.matchAll(/font-size:\s*([0-9.]+)/g)].map((m) => Number(m[1])),
  ]

  const textFills = [...svg.matchAll(/<text [^>]*fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase())

  /** WCAG relative luminance, so the contrast claim is computed rather than eyeballed. */
  const contrastWithWhite = (hex: string): number => {
    const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255))
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return 1.05 / (lum + 0.05)
  }

  it('has text and sizes to measure, so the floors below are not vacuous', () => {
    expect(fontSizes.length, 'no font-size attributes found in the SVG').toBeGreaterThan(100)
    expect(textFills.length, 'no <text> fills found in the SVG').toBeGreaterThan(100)
    expect(guide, 'the guide no longer promises a size floor').toContain('Nothing under 12px')
    expect(guide, 'the guide no longer promises the contrast').toContain('black-on-white contrast')
    expect(guide, 'the guide no longer promises shape over colour').toContain(
      'no meaning carried by colour alone',
    )
  })

  it('puts nothing under 12px, which is what the guide promises', () => {
    const under = fontSizes.filter((n) => n < 12).sort((a, b) => a - b)
    expect(
      under,
      `docs/architecture.svg has ${under.length} text size(s) below 12: ${[...new Set(under)].join(', ')}. ` +
        `The guide promises "Nothing under 12px" and the viewBox is 1:1 with the declared width, so these ` +
        `are real pixels. The 52 that were at 11 were the TODAY/FUTURE tags -- the smallest text was the ` +
        `text carrying the distinction.`,
    ).toEqual([])
  })

  it('keeps every text colour above the WCAG AA floor against the page', () => {
    // The page is white and no <text> uses a light fill, so white is the backdrop for all of them.
    // If that ever stops being true this case would be measuring the wrong pair, so it is asserted.
    const light = textFills.filter((f) => contrastWithWhite(f) < 3)
    expect(
      light,
      `these text fills are too light to be sitting on white: ${light.join(', ')}. Either the SVG gained ` +
        `reversed text on a dark band, in which case this case needs to pair text with its backdrop, or ` +
        `something is genuinely unreadable.`,
    ).toEqual([])

    const failing = [...new Set(textFills)]
      .map((f) => ({ fill: f, ratio: Number(contrastWithWhite(f).toFixed(2)) }))
      .filter((c) => c.ratio < 4.5)
    expect(
      failing,
      `these text colours fall below 4.5:1 on white: ${JSON.stringify(failing)}. The guide promises ` +
        `"black-on-white contrast", and this file is meant to survive a projector.`,
    ).toEqual([])
  })

  it('carries the TODAY/FUTURE distinction in the border shape, not only the colour', () => {
    // A FUTURE node is dashed and a TODAY node is solid. The tag counts and the border counts have to
    // agree, or some node reads FUTURE and draws as TODAY -- which is exactly the mismatch that made
    // the .drawio's Today page wrong for a day.
    const futureTags = [...svg.matchAll(/<text [^>]*font-size="12"[^>]*>FUTURE</g)].length
    const dashedNodes = [...svg.matchAll(/stroke-dasharray="9 5"/g)].length
    const solidNodes = [...svg.matchAll(/<rect [^>]*stroke="#[0-9A-Fa-f]{6}"[^>]*\/>/g)].filter(
      (m) => !m[0].includes('stroke-dasharray'),
    ).length

    expect(futureTags, 'no FUTURE node tags found; the correspondence below would be vacuous').toBeGreaterThan(0)
    expect(
      dashedNodes,
      `${futureTags} nodes are tagged FUTURE but ${dashedNodes} have the dashed border. A FUTURE node ` +
        `drawn solid says one thing in text and the opposite in shape, and a reader who cannot see the ` +
        `colour gets the wrong one.`,
    ).toBe(futureTags)
    expect(solidNodes, 'no solid-bordered nodes left, so the shape carries no contrast').toBeGreaterThan(0)
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

  /**
   * T52. Every other error found on this page understated the build. This one overstated it, and it
   * overstated a **security** property: the Storage node said proposal PDFs are handed out as
   * *"time-limited signed URLs"*.
   *
   * Measured with no credentials of any kind at iteration 135 — `/object/public/proposals/PRP-2011/
   * <32 chars>/<file>.pdf` returns **200, 2,570 bytes, application/pdf**, with no `token=` and no
   * `/sign/`. `store.ts` calls `getPublicUrl`, not `createSignedUrl`. So nothing is signed and nothing
   * expires; the protection is an unguessable path that never stops working.
   *
   * `README.md` already says that correctly, which is the part that made it worth stopping for: the
   * package volunteered the weakness in one deliverable and claimed the stronger mechanism in another,
   * and a reviewer reading both would have had to decide which to believe.
   *
   * The Future-state node says "signed" correctly, marked FUTURE with an explicit "Today: Supabase
   * Storage" contrast. So the guard cannot simply ban the phrase; it bans the claim on the Today page
   * unless the code actually signs, which leaves the real improvement open and fails only if the
   * wording runs ahead of it again.
   */
  it('does not claim signed or expiring PDF links while the code serves public ones', () => {
    const store = readFileSync(join(repoRoot, 'netlify/functions/group/store.ts'), 'utf8')
    const signsForReal = store.includes('createSignedUrl')

    if (!signsForReal) {
      for (const overclaim of ['time-limited', 'signed URL', 'signed url']) {
        expect(
          todayPage,
          `the Today page says "${overclaim}" about storage while store.ts still calls getPublicUrl. ` +
            `A public capability URL has no signature and no expiry, so that wording claims revocation ` +
            `the system does not have -- and README.md states the real limit, so the two deliverables ` +
            `would disagree about a security property.`,
        ).not.toContain(overclaim)
      }
    }

    expect(
      store,
      'store.ts no longer calls getPublicUrl. If PDFs are genuinely signed now, say so on the Today ' +
        'page and in README.md, and delete this branch.',
    ).toContain(signsForReal ? 'createSignedUrl' : 'getPublicUrl')
  })

  it('names the capability-URL model on the Today page, in the same terms as the README', () => {
    expect(
      todayPage,
      'the Today page no longer describes the PDF link as a capability URL. That is the honest name for ' +
        'it and the one README.md uses; leaving it unnamed is how "signed" got back in last time.',
    ).toContain('capability URL')

    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')
    expect(
      readme,
      'README.md no longer states the capability-URL limit. The diagram now points at the same claim, ' +
        'so if the README drops it the two disagree again -- in the other direction.',
    ).toContain('capability URL, not an authenticated download')
  })

  it('keeps the future-state node saying signed, because it is the contrast', () => {
    // Deleting the Future node would "fix" the case above and lose the point: signed URLs are the
    // recommendation, and the Today node borrowed their language a page early.
    expect(
      drawio,
      'the future-state Object storage node no longer offers signed URLs. It is the recommendation and ' +
        'the thing the Today page must not pretend to be.',
    ).toContain('Amazon S3 with time-limited signed URLs for proposal PDFs. Today: Supabase Storage.')
  })

  /**
   * T54. The `/api/telnyx/events` node said *"Six calls transcribed."* There were nine, and all nine had
   * transcripts — and the six was the `limit=6` on the query I measured it with at iteration 133. The
   * figure reported was the one typed into the request, which is the most embarrassing way to be wrong
   * and the hardest to notice, because a number that came out of a query feels measured.
   *
   * The shape is the fix rather than the number. Iteration 131 converted every count in `README.md` into
   * a floor, a command and a test; **the diagram was not part of that pass**, and this was the one figure
   * on the page that moves the same way — every time anyone dials the number. Worse, *"calls"* is not even
   * well defined here: two of the nine sessions are `taken_over` followed a minute later by an `ended`
   * one, so nine sessions are seven, eight or nine calls depending on how a takeover is counted. The node
   * states the invariant now — every voice session has a transcript — with a dated snapshot beside it.
   *
   * `25 tools` stays a bare number, and the contrast is the argument: it changes only on a re-provision,
   * and the export-parity test holds it still. The case below ties it to the export so that claim is
   * checked here too rather than asserted.
   */
  const QUANTITY = String.raw`(?:calls?|sessions?|conversations?|transcripts?|messages?|turns?)`
  const NUMBER = String.raw`(?:[0-9][0-9,]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`

  it('states no bare count of anything that moves when someone dials', () => {
    const flat = decode(todayPage).replace(/\s+/g, ' ')
    const hits = [...flat.matchAll(new RegExp(String.raw`\b${NUMBER}\s+${QUANTITY}\b`, 'gi'))]
      .map((m) => m[0])
      // A figure that dates itself, or one attached to an invariant, is not the failure mode.
      .filter((phrase) => {
        const at = flat.indexOf(phrase)
        const sentence = flat.slice(Math.max(0, at - 160), at + 160)
        return !/as of|at the time of writing|every |all nine|nine of nine/i.test(sentence)
      })

    expect(
      hits,
      `the Today page states ${hits.join(', ')} as a bare count. Calls, sessions and transcripts change ` +
        `every time anyone uses the system, so a number is wrong by the time it is read — and the last ` +
        `one was wrong on the day it was written, because it was the query's limit rather than its result. ` +
        `State the invariant and date the snapshot.`,
    ).toEqual([])
  })

  it('still states the transcription invariant, so it cannot revert to a count', () => {
    const flat = decode(todayPage).replace(/\s+/g, ' ')
    expect(
      flat,
      'the /api/telnyx/events node no longer claims that every voice session has a transcript. That is ' +
        'the claim worth making about a transcript webhook; a tally of calls is not.',
    ).toContain('Every voice session to date has a transcript')
  })

  /**
   * It141 swept all 25 Today-page nodes rather than one claim, because three passes had each found
   * exactly one wrong thing here — statuses at 133, storage at 135, the call count at 140 — and each had
   * found only what it went looking for.
   *
   * Twenty-two held. Five that had never been checked were verified: the secret boundary against 1.09 MB
   * of deployed JavaScript (one JWT in it, `role: anon`, and zero occurrences of every server-side
   * secret), the Realtime table list against the five `useRealtimeMerge` call sites, the net-new tool's
   * `simulated_inventory_service` stamp, the RLS refusal the Tester measured as a 403, and the build
   * description against `package.json` and `netlify.toml`.
   *
   * One was an overclaim. The ToolResult node said *"ok, grounded, citations, masked_fields, latency_ms
   * **on every tool without exception**"* — but `shared/types.ts` marks `citations?`, `masked_fields?` and
   * `latency_ms?` optional, and `availability.ts` and `lookups.ts` return no citations at all. Two of the
   * five were not universal. `latency_ms` turned out to be, because the registry wrapper stamps it on the
   * success, error and spread paths alike, so the honest sentence keeps "without exception" for the three
   * that earn it and says "where there is something to cite or mask" for the two that do not.
   *
   * The envelope's whole value is that you can always tell whether an answer was grounded. Claiming more
   * than that weakens it, because a reviewer who finds one tool without citations stops believing the rest.
   */
  it('claims universality only for the envelope fields that have it', () => {
    const flat = decode(todayPage).replace(/\s+/g, ' ')
    const envelope = flat.match(/ok, grounded[^.]*\./)
    expect(envelope, 'the ToolResult envelope node is gone; update or remove this case').toBeTruthy()

    const sentence = (envelope as RegExpMatchArray)[0]
    const types = readFileSync(join(repoRoot, 'shared/types.ts'), 'utf8')

    // Whatever the node claims is universal must not be optional in the type it describes.
    for (const field of ['citations', 'masked_fields']) {
      const optional = new RegExp(`\\b${field}\\?:`).test(types)
      if (!optional) continue
      const universal = new RegExp(`${field}[^.]{0,60}without exception`).test(sentence)
      expect(
        universal,
        `the Today page says ${field} is on every tool "without exception", and shared/types.ts declares ` +
          `it as ${field}?: — optional. availability.ts and lookups.ts return none. Claiming more than the ` +
          `envelope guarantees is how a reviewer stops believing the part that is guaranteed.`,
      ).toBe(false)
    }

    expect(
      sentence,
      'the node no longer claims ok, grounded and latency_ms without exception. Those three are ' +
        'guaranteed — the first two by the type, latency_ms by the registry wrapper — and the claim is ' +
        'worth making.',
    ).toMatch(/ok, grounded and latency_ms on every tool without exception/)
  })

  it('keeps the one bare count on the page tied to the export that fixes it', () => {
    // "25 tools" is allowed to be a number because it only moves on a re-provision. That is only an
    // argument if it is true, so it is checked against the committed export rather than trusted.
    const flat = decode(drawio).replace(/\s+/g, ' ')
    const stated = flat.match(/\b(\d+) tools\b/)
    expect(stated, 'the diagram no longer states a tool count; drop this case or re-point it').toBeTruthy()

    const parsed = JSON.parse(readFileSync(join(repoRoot, 'exports/telnyx-assistant.json'), 'utf8')) as {
      tools?: unknown[]
      data?: { tools?: unknown[] }
    }
    const actual = (parsed.tools ?? parsed.data?.tools ?? []).length
    expect(
      Number((stated as RegExpMatchArray)[1]),
      `the diagram says ${(stated as RegExpMatchArray)[1]} tools and exports/telnyx-assistant.json has ` +
        `${actual}. This number is allowed to be a number only because it is pinned; if the two disagree ` +
        `it is just another stale figure.`,
    ).toBe(actual)
  })
})
