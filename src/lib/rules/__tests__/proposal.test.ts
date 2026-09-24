// Proposal artifacts and the approval gate.
//
// The gate is the one the panel will try to break: a flagged proposal must not be sendable
// until a named human has approved it, and that must be true however the send is triggered.

import { beforeEach, describe, expect, it } from 'vitest'
import { clearAuditMemory, recentAudit } from '../../../../netlify/functions/_delivery/audit'
import {
  renderProposalHtml,
  renderProposalPdf,
  buildProposalDocument,
  pdfFilename,
} from '../../../../netlify/functions/group/proposal'
import {
  canSend,
  durabilityNote,
  findProposalByInquiry,
  getProposal,
  listProposals,
  markSent,
  proposalCodeFor,
  resetProposalStore,
} from '../../../../netlify/functions/group/store'
import {
  approve,
  create_inquiry,
  generate_proposal,
  materialiseProposal,
  override_proposal,
  parse_inquiry,
  price_block,
  reject,
  resetCreatedInquiries,
  send_proposal,
  submit_for_approval,
} from '../../../../netlify/functions/group/tools'

beforeEach(() => {
  resetProposalStore()
  resetCreatedInquiries()
  clearAuditMemory()
})

describe('the proposal artifacts', () => {
  it('produces a real PDF, not an HTML file with a .pdf name', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    expect(generated.ok).toBe(true)

    const stored = (await getProposal(generated.data!.proposal_id))!
    const bytes = (await materialiseProposal(stored))!.pdfBytes!
    expect(bytes.length).toBeGreaterThan(1000)

    // PDF magic number, and a trailer, which an HTML file would not have.
    const header = String.fromCharCode(...bytes.slice(0, 5))
    expect(header).toBe('%PDF-')
    const tail = Buffer.from(bytes.slice(-1024)).toString('latin1')
    expect(tail).toContain('%%EOF')
  })

  it('names the PDF after the customer, not after a uuid', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const stored = (await getProposal(generated.data!.proposal_id))!
    const { document } = (await materialiseProposal(stored))!
    expect(pdfFilename(document)).toContain('Harlow')
    expect(pdfFilename(document)).toMatch(/\.pdf$/)
  })

  it('renders branded HTML carrying the same number as the PDF', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const html = generated.data!.html
    expect(html).toContain('Harlow &amp; Vance Consulting')
    expect(html).toContain('Solstice Chicago Riverwalk')
    expect(html).toContain('Group Sales')
    expect(html).toContain(generated.data!.total_display)
    // Escaped, so a company name with an ampersand cannot break the markup.
    expect(html).not.toContain('Harlow & Vance')
  })

  it('keeps money as integer cents on the pricing payload', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const pricing = (await getProposal(generated.data!.proposal_id))!.pricing
    expect(Number.isInteger(pricing.subtotal_cents)).toBe(true)
    expect(Number.isInteger(pricing.total_cents)).toBe(true)
    expect(Number.isInteger(pricing.discount_cents)).toBe(true)
    expect(pricing.subtotal_cents - pricing.discount_cents).toBe(pricing.total_cents)
    // 18 rooms x 2 nights x $219 less 10%
    expect(pricing.subtotal_cents).toBe(788_400)
    expect(pricing.total_cents).toBe(709_560)
  })

  it('survives a document with no follow-ups and no notes', async () => {
    const doc = buildProposalDocument({
      proposal_id: 'PRP-EMPTY',
      inquiry: {
        inquiry_id: 'INQ-X',
        source: 'manual',
        company_name: 'Test Co',
        contact_name: 'Test Person',
        contact_email: null,
        contact_phone: null,
        event_type: 'Conference',
        preferred_property_code: 'SOL-CHI',
        alternate_property_ok: false,
        arrival_date: '2026-09-14',
        departure_date: '2026-09-16',
        rooms_requested: 2,
        room_type_preference: 'Standard King',
        requested_discount_pct: 0,
        meeting_capacity_needed: null,
        special_requests: null,
        missing_fields: [],
      },
      property: {
        property_code: 'SOL-CHI',
        property_name: 'Solstice Chicago Riverwalk',
        city: 'Chicago',
        state: 'IL',
        market_type: 'Urban',
        total_rooms: 220,
        inventory: {},
        base_rate_standard: 219,
        base_rate_deluxe: 259,
        base_rate_suite: 379,
        meeting_space_sqft: 8500,
        max_meeting_capacity: 300,
        group_block_auto_approve_max_rooms: 25,
        max_discount_auto_approve_pct: 12,
        blackout_dates: [],
        general_manager: 'Renee Okafor',
        notes: '',
        data_quality_flags: [],
      },
      block: {
        ok: true,
        property_code: 'SOL-CHI',
        room_type: 'Standard King',
        rooms: 2,
        nights: 2,
        rate_field: 'base_rate_standard',
        nightly_rack_cents: 21_900,
        nightly_net_cents: 21_900,
        discount_pct: 0,
        subtotal_cents: 87_600,
        discount_cents: 0,
        total_cents: 87_600,
        line_items: [],
        subtotal: 876,
        total: 876,
      },
      verdicts: [],
      required_follow_ups: [],
    })

    await expect(renderProposalPdf(doc)).resolves.toBeInstanceOf(Uint8Array)
    expect(renderProposalHtml(doc, null)).toContain('Test Co')
  })
})

describe('generation is idempotent per inquiry', () => {
  it('a rep clicking generate twice gets one proposal, not two', async () => {
    const first = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const second = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const third = await generate_proposal({ inquiry_id: 'INQ-2001' })

    expect(second.data!.proposal_id).toBe(first.data!.proposal_id)
    expect(third.data!.proposal_id).toBe(first.data!.proposal_id)
    expect(second.data!.replaced_existing).toBe(true)

    const all = await listProposals()
    expect(all.filter((p) => p.inquiry_id === 'INQ-2001')).toHaveLength(1)
  })

  it('derives the reference from the inquiry rather than a counter', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2009' })
    // A counter gives PRP-0001 on one instance and PRP-0007 on another for the same inquiry.
    expect(generated.data!.proposal_id).toBe('PRP-2009')
    expect(proposalCodeFor('INQ-2009')).toBe('PRP-2009')
  })

  it('says so when it replaced an earlier draft', async () => {
    await generate_proposal({ inquiry_id: 'INQ-2001' })
    const again = await generate_proposal({ inquiry_id: 'INQ-2001' })
    expect(again.data!.human_summary).toContain('replaces the earlier draft')
  })

  it('re-prices the existing draft rather than leaving a stale one behind', async () => {
    await generate_proposal({ inquiry_id: 'INQ-2009' })
    const revised = await generate_proposal({ inquiry_id: 'INQ-2009', discount_pct: 16 })
    const stored = (await getProposal(revised.data!.proposal_id))!
    expect(stored.pricing.discount_pct).toBe(16)

    const all = await listProposals()
    expect(all.filter((p) => p.inquiry_id === 'INQ-2009')).toHaveLength(1)
  })

  it('opens a new revision rather than rewriting one the customer already has', async () => {
    const first = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const proposal = (await getProposal(first.data!.proposal_id))!
    await markSent(proposal, 'email', 'a sales rep', 'b***@harlowvance.com')

    const second = await generate_proposal({ inquiry_id: 'INQ-2001' })
    expect(second.data!.proposal_id).not.toBe(first.data!.proposal_id)
    expect(second.data!.proposal_id).toBe('PRP-2001-2')
    expect(second.data!.replaced_existing).toBe(false)

    // The sent one is untouched history.
    const sent = (await getProposal(first.data!.proposal_id))!
    expect(sent.status).toBe('sent')
  })
})

describe('durability is never quietly assumed', () => {
  it('reports persisted:false and says so in words when there is no database', async () => {
    // These tests run with no SUPABASE_URL, which is exactly the in-memory case that used to
    // masquerade as persistence: generate_proposal returned an id and the next request had
    // never heard of it.
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    expect(generated.data!.persisted).toBe(false)
    expect(generated.data!.human_summary).toContain('only held in memory')

    const stored = (await getProposal(generated.data!.proposal_id))!
    expect(stored.persisted).toBe(false)
    expect(durabilityNote(stored)).toContain('disappear')
  })

  it('still finds a proposal it generated, so the send path works in the fallback too', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2002' })
    const found = await getProposal(generated.data!.proposal_id)
    expect(found?.proposal_id).toBe(generated.data!.proposal_id)
    expect((await findProposalByInquiry('INQ-2002'))?.proposal_id).toBe(generated.data!.proposal_id)
  })

  it('rebuilds the letter from stored pricing, so a send can happen on another instance', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const stored = (await getProposal(generated.data!.proposal_id))!

    const materialised = await materialiseProposal(stored)
    expect(materialised).not.toBeNull()
    expect(materialised!.document.company_name).toBe('Harlow & Vance Consulting')
    expect(materialised!.document.total_cents).toBe(stored.pricing.total_cents)
    expect(materialised!.document.rooms).toBe(18)
    expect(materialised!.pdfBytes).not.toBeNull()
  })
})

describe('the approval gate', () => {
  it('lets a clean proposal through without an approval', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const proposal = (await getProposal(generated.data!.proposal_id))!
    expect(proposal.status).toBe('draft')
    expect(canSend(proposal).allowed).toBe(true)
  })

  it('refuses to send a flagged proposal before it is approved', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2002' })
    expect(generated.data!.requires_approval).toBe(true)
    expect(generated.data!.status).toBe('awaiting_approval')

    const proposalId = generated.data!.proposal_id
    const gate = canSend((await getProposal(proposalId))!)
    expect(gate.allowed).toBe(false)
    expect(gate.blocking.map((v) => v.rule_id).sort()).toEqual([
      'GRP-DISCOUNT-CEILING',
      'GRP-ROOMS-CAP',
    ])

    const sent = await send_proposal({ proposal_id: proposalId, actor: 'a sales rep' })
    expect(sent.ok).toBe(false)
    expect(sent.error).toContain('cannot go out yet')
    expect((await getProposal(proposalId))!.status).toBe('awaiting_approval')
    expect((await getProposal(proposalId))!.sent_at).toBeNull()
  })

  it('records the refusal so the panel can see the guard fire', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2002' })
    await send_proposal({ proposal_id: generated.data!.proposal_id, actor: 'a sales rep' })

    const blocked = recentAudit().find((e) => e.action === 'proposal.send_blocked')
    expect(blocked).toBeDefined()
    expect(blocked!.detail.blocking_rules).toEqual(
      expect.arrayContaining(['GRP-ROOMS-CAP', 'GRP-DISCOUNT-CEILING']),
    )
  })

  it('opens once a named human approves, and records who', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2002' })
    const proposalId = generated.data!.proposal_id

    await submit_for_approval({ proposal_id: proposalId, submitted_by: 'a sales rep' })
    const approved = await approve({
      proposal_id: proposalId,
      approved_by: 'Andrea Lin',
      note: 'Repeat sports-team business, worth the extra rooms.',
    })
    expect(approved.ok).toBe(true)

    const proposal = (await getProposal(proposalId))!
    expect(proposal.status).toBe('approved')
    expect(proposal.approved_by).toBe('Andrea Lin')
    expect(canSend(proposal).allowed).toBe(true)

    const row = recentAudit().find((e) => e.action === 'proposal.approved')
    expect(row!.detail.approved_by).toBe('Andrea Lin')
    expect(row!.detail.overrode_rules).toEqual(
      expect.arrayContaining(['GRP-ROOMS-CAP', 'GRP-DISCOUNT-CEILING']),
    )
  })

  it('refuses an anonymous approval', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2002' })
    const result = await approve({ proposal_id: generated.data!.proposal_id, approved_by: '   ' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('attributed to a person')
  })

  it('stays shut on a rejected proposal', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2002' })
    await reject({
      proposal_id: generated.data!.proposal_id,
      rejected_by: 'Andrea Lin',
      reason: 'Too much discount for October.',
    })
    const gate = canSend((await getProposal(generated.data!.proposal_id))!)
    expect(gate.allowed).toBe(false)
    expect(gate.human_reason).toContain('turned down')
  })
})

describe('the judgment moment, acted on', () => {
  it('prices at the compliant ceiling by default rather than at the number they asked for', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2009' })
    expect(generated.data!.discount_pct).toBe(15)
    const pricing = (await getProposal(generated.data!.proposal_id))!.pricing
    expect(pricing.requested_discount_pct).toBe(17)
  })

  it('records an override with a reason, and still keeps the gate shut', async () => {
    const first = await generate_proposal({ inquiry_id: 'INQ-2009' })
    const overridden = await override_proposal({
      proposal_id: first.data!.proposal_id,
      actor: 'Diego Fuentes',
      justification: 'Third year of this retreat and they fill the low season.',
      discount_pct: 17,
    })

    expect(overridden.ok).toBe(true)
    expect(overridden.data!.discount_pct).toBe(17)

    const fresh = (await getProposal(overridden.data!.proposal_id))!
    expect(fresh.pricing.discount_pct).toBe(17)
    expect(fresh.status).toBe('awaiting_approval')
    expect(canSend(fresh).allowed).toBe(false)

    const row = recentAudit().find((e) => e.action === 'proposal.override')
    expect(row!.detail.actor).toBe('Diego Fuentes')
    expect(row!.detail.justification).toContain('low season')
    expect(row!.detail.override_discount_pct).toBe(17)
  })

  it('refuses an override with no reason on it', async () => {
    const first = await generate_proposal({ inquiry_id: 'INQ-2009' })
    const result = await override_proposal({
      proposal_id: first.data!.proposal_id,
      actor: 'Diego Fuentes',
      justification: '',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('needs a reason')
  })
})

describe('inquiries that arrive by phone', () => {
  it('opens a real inquiry from what the voice agent heard', async () => {
    const created = await create_inquiry({
      company_name: 'Cypress Ridge Reunion',
      contact_name: 'Dana Alvarez',
      contact_phone: '+13055557788',
      event_type: 'Reunion',
      preferred_property_code: 'SOL-TPA',
      arrival_date: '2026-10-09',
      departure_date: '2026-10-11',
      rooms_requested: 20,
      room_type_preference: 'Standard King',
      requested_discount_pct: 10,
      source: 'voice',
    })

    expect(created.ok).toBe(true)
    const inquiry = created.data!.inquiry
    expect(inquiry.source).toBe('voice')
    expect(inquiry.contact_email).toBeNull()
    expect(inquiry.contact_phone).toBe('+13055557788')
    expect(created.data!.human_summary).toContain('text')
  })

  it('refuses to open one against a hotel that does not exist', async () => {
    const created = await create_inquiry({
      company_name: 'Nowhere Group',
      preferred_property_code: 'SOL-BOS',
    })
    expect(created.ok).toBe(false)
    expect(created.error).toContain('SOL-BOS')
  })

  it('turns an approximate room count into a question, not a number', async () => {
    const parsed = await parse_inquiry({
      raw: {
        company_name: 'Approximate Group',
        preferred_property_code: 'SOL-CHI',
        contact_phone: '+13055551111',
        rooms_requested: 'around 25',
        arrival_date: '2026-10-09',
        departure_date: '2026-10-11',
      },
    })
    expect(parsed.data!.inquiry.rooms_requested).toBeNull()
    expect(parsed.data!.raw_rooms).toBe('around 25')
    expect(parsed.data!.questions.join(' ')).toContain('around 25')
  })
})

describe('pricing never touches a quarantined rate', () => {
  it('refuses a suite block at SOL-PVD rather than quoting off -395', async () => {
    const result = await price_block({
      property_code: 'SOL-PVD',
      rooms: 4,
      nights: 2,
      room_type: 'Suite',
      discount_pct: 0,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/quarantined|failed validation/i)
    expect(result.error).not.toMatch(/-?\$?395\b.*per night quoted/i)
  })

  it('still prices a standard block at the same hotel', async () => {
    const result = await price_block({
      property_code: 'SOL-PVD',
      rooms: 4,
      nights: 2,
      room_type: 'Standard King',
      discount_pct: 0,
    })
    expect(result.ok).toBe(true)
    expect(result.data!.total_cents).toBe(127_200) // 4 x 2 x $159
  })
})
