/**
 * The cheat sheet's R55006 beat, checked against the code that produces it.
 *
 * `docs/demo-cheatsheet.md` is the document read aloud on stage, and its row-one comp-authority beat
 * quotes the product word for word in five places. `docs-quote-drift.test.ts` pins the one
 * rules-derived sentence two *other* documents quote -- `live-modification.md` and
 * `role-walkthroughs.md` -- and says so in its own scope note. **The cheat sheet was in neither list.**
 *
 * What it quotes, and why each one is the presenter's problem if it drifts:
 *
 *  - **Two chip labels**, `"$45.00 — inside front desk authority"` and `"$70.00 — needs AGM or GM"`. The
 *    beat's own instruction is *"Point at the chips, not at the sentence"*, so these are the words on
 *    screen while he is pointing at them.
 *  - **The Policy 7 arithmetic**, *"minibar charge $45.00 + late housekeeping $25.00 = $70.00"*, which the
 *    cheat sheet correctly says lives in the tool's reason rather than the chat bubble.
 *  - **The threshold boundary** it states in parentheses: $45 and $50 return `front_desk`, $55 returns
 *    `agm`.
 *  - **The reservation's own directive** from the supplied data, which is the whole point of the beat: a
 *    per-reservation instruction overriding a generic threshold.
 *
 * All five are deterministic -- compiled data, no model, no network -- and none of them was guarded.
 * Measured at iteration 159 and all five hold today; this keeps them holding. Sol's own sentences are
 * deliberately NOT pinned: those are model output, and a test that demanded exact wording from a model
 * would fail on a paraphrase that is just as good.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkCompAuthority } from '../../../../netlify/functions/tools/recovery'
import { summarize } from '../../../../netlify/functions/tools/registry'
import { findReservationById } from '../../../../netlify/functions/tools/lookups'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

const repoRoot = resolve(__dirname, '../../../..')
const DOC = 'docs/demo-cheatsheet.md'

/** The document, flattened, with dash styles normalised so a typographic change is not a failure. */
const doc = (): string =>
  readFileSync(join(repoRoot, DOC), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/[–—]/g, '--')
    .replace(/\s+/g, ' ')

const normalise = (s: string) => s.replace(/[–—]/g, '--').replace(/\s+/g, ' ').trim()

const ctx = { channel: 'chat', session_id: 'test-cheatsheet' } as ToolContext
const RESERVATION = 'R55006'

const comp = (items: { label: string; amount: number }[]) =>
  checkCompAuthority({ reservation_id: RESERVATION, items }, ctx)

const MINIBAR = { label: 'minibar charge', amount: 45 }
const HOUSEKEEPING = { label: 'late housekeeping', amount: 25 }

describe("the cheat sheet's comp-authority beat quotes what the tool produces", () => {
  it('reaches the reservation the beat is built on', async () => {
    const reservation = await findReservationById(RESERVATION)
    expect(reservation, `${RESERVATION} is not in the shipped data, so this whole beat has no subject`).toBeTruthy()
    expect(doc().length, `${DOC} came back empty`).toBeGreaterThan(2000)
    expect(doc(), `${DOC} no longer mentions ${RESERVATION}`).toContain(RESERVATION)
  })

  it('shows the chip label a single $45 item actually produces', async () => {
    const result = await comp([MINIBAR])
    expect(result.ok, `check_comp_authority failed: ${result.error}`).toBe(true)
    const chip = normalise(summarize('check_comp_authority', result))
    expect(chip.length, 'the chip summary came back empty').toBeGreaterThan(10)
    expect(
      doc(),
      `${DOC} does not show the chip a single $45 item produces. The tool summarises it as ${JSON.stringify(chip)}, ` +
        `and the beat's instruction is "Point at the chips, not at the sentence" -- so this is the text on ` +
        `screen while he is pointing at it.`,
    ).toContain(chip)
  })

  it('shows the chip label the aggregated $70 produces', async () => {
    const result = await comp([MINIBAR, HOUSEKEEPING])
    expect(result.ok, `check_comp_authority failed: ${result.error}`).toBe(true)
    const chip = normalise(summarize('check_comp_authority', result))
    expect(
      doc(),
      `${DOC} does not show the chip the aggregated total produces. The tool summarises it as ` +
        `${JSON.stringify(chip)}. This is the Policy 7 half of the beat, added live by typing a second charge.`,
    ).toContain(chip)
  })

  it('quotes the aggregation sentence verbatim, dashes aside', async () => {
    const result = await comp([MINIBAR, HOUSEKEEPING])
    const note = normalise(String((result.data as Record<string, unknown>).aggregation_note ?? ''))
    expect(note, 'the tool no longer returns an aggregation_note').toMatch(/Policy 7/)
    expect(
      doc(),
      `${DOC} quotes the Policy 7 arithmetic and the tool now words it differently.\n\nTool says:\n  ${note}\n\n` +
        `The cheat sheet is explicit that this sentence lives in the tool's reason and is not rendered in the ` +
        `chat bubble, so a presenter who promises it must be able to find it in the trace.`,
    ).toContain(note.replace(/\.$/, ''))
  })

  it('states a threshold boundary that is where the code puts it', async () => {
    // The cheat sheet says, in parentheses: $45 and $50 return front_desk, $55 returns agm. That is the
    // arithmetic the contrast rests on -- an escalation happening while authority says it need not.
    const at = async (amount: number) => {
      const r = await comp([{ label: 'minibar charge', amount }])
      const d = r.data as Record<string, unknown>
      return { authority: d.authority_required, escalation: d.escalation_required }
    }

    expect(await at(45), '$45 should sit inside front-desk authority').toMatchObject({
      authority: 'front_desk',
      escalation: false,
    })
    expect(await at(50), '$50 is the limit itself and Policy 7 includes it').toMatchObject({
      authority: 'front_desk',
      escalation: false,
    })
    expect(await at(55), '$55 is over the limit and belongs to the AGM').toMatchObject({
      authority: 'agm',
      escalation: true,
    })

    for (const figure of ['$45', '$50', '$55']) {
      expect(doc(), `${DOC} no longer names ${figure} in the boundary it states`).toContain(figure)
    }
  })

  it('quotes the reservation directive that makes the beat what it is', async () => {
    // A per-reservation instruction overriding a generic threshold is the point being made. If the
    // directive left the data, the beat would still run and would prove nothing.
    //
    // Checked in the direction that can actually drift: whatever the document CLAIMS the note says must
    // appear in the note. The reverse -- asserting the document contains the whole note -- is what the
    // first draft did, and it failed on a correct document: `internal_notes` is two sentences and the
    // cheat sheet quotes only the directive, which is the right thing for it to quote.
    const reservation = (await findReservationById(RESERVATION)) as { internal_notes?: string | null }
    const notes = normalise(String(reservation.internal_notes ?? ''))
    expect(notes, `${RESERVATION} no longer carries an internal note, so the override has nothing to come from`).toMatch(
      /folio/i,
    )

    const quoted = /\*"([^"]*folio[^"]*)"\*/.exec(doc())
    expect(
      quoted,
      `${DOC} no longer quotes ${RESERVATION}'s folio directive. That quotation is the evidence for the ` +
        `beat's whole claim -- a per-reservation instruction overriding a generic threshold.`,
    ).toBeTruthy()

    const claim = normalise((quoted as RegExpExecArray)[1]).replace(/\.$/, '')
    expect(claim.length, 'the quoted directive came back too short to be the sentence').toBeGreaterThan(30)
    expect(
      notes,
      `${DOC} says ${RESERVATION}'s note reads ${JSON.stringify(claim)}, and the shipped data says ` +
        `${JSON.stringify(notes)}. The presenter reads that quotation aloud as coming from the data you sent.`,
    ).toContain(claim)
  })
})
