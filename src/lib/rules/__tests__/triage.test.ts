/**
 * The auto-triage sweep — `POST /api/group/triage` — had no test at all.
 *
 * `BACKLOG.md` carried it as *"verified by the session that built it, not yet re-checked"*, and
 * `plans/06-master-plan.md` calls it **the largest unverified surface in the package**: it is the
 * agentic group workflow, which is a named brief deliverable. Nothing in 52 test files mentioned it.
 *
 * It could not be re-verified against production, and that is not squeamishness — measured at
 * iteration 129 with the service-role key, four of the thirteen inquiries in the live inbox are
 * bare (INQ-2003, INQ-2010, INQ-2012, INQ-2013), so a sweep there writes four draft rows onto the
 * board the panel opens on, two of them onto inquiries that are queued for deletion.
 *
 * It does not need production. The suite runs with credentials stripped, so `tryGetDb()` returns
 * null and both stores fall back to their in-memory maps — which means the real `triageInbox` can
 * be run here, twice, against the real generated dataset, and the thing everybody actually cares
 * about can be asserted rather than asserted about:
 *
 *   1. it decides the right branch for every inquiry the challenge shipped;
 *   2. a second run produces nothing, because a rep clicking twice must not double-message anyone;
 *   3. it sends nothing, ever.
 *
 * Order matters in this file: the second run's expectations depend on the first run having
 * happened, exactly as they would for a rep clicking the button twice.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { triageInbox, type TriageResult } from '../../../../netlify/functions/group/triage'
import { loadInquiries } from '../../../../netlify/functions/group/_deps'
import type { GroupInquiry } from '../../../../shared/types'

let inquiries: GroupInquiry[]
let first: TriageResult
let second: TriageResult

beforeAll(async () => {
  inquiries = await loadInquiries()
  first = await triageInbox('vitest')
  second = await triageInbox('vitest')
}, 60_000)

const by = (r: TriageResult, id: string) => r.outcomes.find((o) => o.inquiry_id === id)

describe('the inbox the sweep runs over', () => {
  it('is the dataset the challenge shipped, not a fixture', () => {
    expect(inquiries.length).toBeGreaterThanOrEqual(10)
    expect(inquiries.map((i) => i.inquiry_id)).toEqual(expect.arrayContaining(['INQ-2001', 'INQ-2009']))
  })

  it('has exactly one inquiry the parser could not complete, and it is INQ-2004', () => {
    // The whole follow-up branch hangs off this one row. If the dataset ever completes it, the
    // branch stops being exercised and this test says so rather than going quietly green.
    const incomplete = inquiries.filter((i) => (i.missing_fields ?? []).length > 0).map((i) => i.inquiry_id)
    expect(incomplete).toEqual(['INQ-2004'])
  })
})

describe('the first sweep over an untouched inbox', () => {
  it('considers every inquiry, not a subset', () => {
    expect(first.considered).toBe(inquiries.length)
    expect(first.outcomes).toHaveLength(inquiries.length)
  })

  it('drafts a follow-up for the incomplete one, naming what is missing', () => {
    const o = by(first, 'INQ-2004')
    expect(o?.action).toBe('follow_up_drafted')
    expect(o?.artifact_id, 'a drafted follow-up must come back with an id to open').toBeTruthy()
    expect(o?.missing_fields?.length, 'the follow-up must say what it is asking for').toBeGreaterThan(0)
    expect(o?.detail).toContain('Waiting for a human to approve and send.')
  })

  it('refuses the two inside a blackout window, and says which window', () => {
    // The claim in BACKLOG.md is that the sweep "refuses the two inquiries inside blackout
    // windows". These are the two, and refusing is the whole point: a complete, priceable-looking
    // inquiry that the property will not take is exactly where an eager agent would quote anyway.
    for (const [id, property] of [
      ['INQ-2003', 'Solstice Austin Congress Ave'],
      ['INQ-2010', 'Solstice Sacramento Capitol'],
    ]) {
      const o = by(first, id)
      expect(o?.action, `${id} should be refused, not priced`).toBe('skipped_blocked')
      expect(o?.detail).toContain(property)
      expect(o?.detail).toContain('does not take group blocks between')
      expect(o?.artifact_id, `${id} was refused but still produced an artifact`).toBeUndefined()
    }
  })

  it('prices every other complete one instead of asking it questions', () => {
    const blocked = new Set(['INQ-2003', 'INQ-2010'])
    const complete = inquiries
      .filter((i) => (i.missing_fields ?? []).length === 0)
      .map((i) => i.inquiry_id)
      .filter((id) => !blocked.has(id))

    expect(complete.length, 'no inquiry is left to exercise the pricing branch').toBeGreaterThan(0)
    for (const id of complete) {
      const o = by(first, id)
      expect(o?.action, `${id} is complete and unblocked, so the sweep should price it`).toBe('proposal_drafted')
      expect(o?.artifact_id, `${id} was drafted without a proposal id`).toBeTruthy()
    }
  })

  it('separates a flagged proposal from a clean one in what it says, not just in the data', () => {
    // INQ-2009 asks 17% against a 15% ceiling. The sweep must not describe it as ready to send.
    const flagged = by(first, 'INQ-2009')
    expect(flagged?.action).toBe('proposal_drafted')
    expect(flagged?.detail).toBe('Priced, but flagged: it needs a decision before it can go out.')

    const clean = by(first, 'INQ-2001')
    expect(clean?.detail).toBe('Priced and within every rule. Ready for a human to send.')
  })

  it('says plainly that nothing was sent', () => {
    expect(first.nothing_was_sent).toBe(true)
    expect(first.summary).toContain('Nothing was sent; everything is waiting for a human.')
  })
})

describe('the second sweep, which is a rep clicking the button twice', () => {
  it('produces no new artifact for any inquiry', () => {
    const drafted = second.outcomes.filter(
      (o) => o.action === 'follow_up_drafted' || o.action === 'proposal_drafted',
    )
    expect(
      drafted.map((o) => `${o.inquiry_id}:${o.action}`),
      'a second sweep drafted something. That is a customer being messaged twice.',
    ).toEqual([])
  })

  it('recognises everything it worked, and says which artifact already exists', () => {
    expect(second.outcomes).toHaveLength(inquiries.length)
    const blocked = new Set(['INQ-2003', 'INQ-2010'])
    for (const o of second.outcomes) {
      if (blocked.has(o.inquiry_id)) continue
      expect(o.action, `${o.inquiry_id} was not recognised as already worked`).toBe('skipped_existing')
      expect(o.detail, `${o.inquiry_id} skipped without naming what is already on it`).toMatch(
        /Already has (proposal|follow-up) \S+\./,
      )
    }
  })

  it('refuses the blacked-out two again, identically, rather than relenting', () => {
    // A refusal that softens on the second attempt is worse than one that never happened: the
    // board would gain a quote for dates the property will not take, and nobody would see it land.
    for (const id of ['INQ-2003', 'INQ-2010']) {
      expect(by(second, id)?.action, `${id} was refused once and then not refused`).toBe('skipped_blocked')
      expect(by(second, id)?.detail).toBe(by(first, id)?.detail)
    }
  })

  it('recognises the follow-up branch too, not only proposals', () => {
    // Both stores are consulted before a write. Proposals alone passing would hide half the guard.
    expect(by(second, 'INQ-2004')?.detail).toContain('Already has follow-up')
    expect(by(second, 'INQ-2001')?.detail).toContain('Already has proposal')
  })

  it('reports an inbox with nothing left to draft', () => {
    expect(second.summary).toBe(
      '8 already had work on them, 2 could not be progressed. Nothing was sent; everything is waiting for a human.',
    )
    expect(second.nothing_was_sent).toBe(true)
  })
})

describe('the boundary the sales team is being asked to trust', () => {
  it('never reports an outcome outside the four it declares', () => {
    const allowed = new Set(['follow_up_drafted', 'proposal_drafted', 'skipped_existing', 'skipped_blocked'])
    for (const o of [...first.outcomes, ...second.outcomes]) {
      expect(allowed.has(o.action), `unexpected action ${o.action} on ${o.inquiry_id}`).toBe(true)
    }
  })

  it('has no path from the sweep to a send', () => {
    // Checked in the source rather than by observation: a delivery call that is merely never
    // reached today is one refactor away from being reached, and the claim in the file header is
    // that the agent does the typing and never decides what reaches a customer.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../netlify/functions/group/triage.ts'),
      'utf8',
    )
    for (const forbidden of ['send_proposal', 'sendEmail', 'sendSms', '_delivery/telnyx', '_delivery/email']) {
      expect(src, `triage.ts references ${forbidden}; the sweep must never be able to send`).not.toContain(
        forbidden,
      )
    }
  })
})
