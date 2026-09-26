// Separation of duties on group approvals, and the limits no approval can lift.
//
// Driven through the real /api/group routes with only the token check replaced: `authorizeStaff`
// is mocked to say which verified user is calling, and everything after it is the production code.
// The side-chat cases also script the model's replies, so no network is involved.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../netlify/functions/group/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../netlify/functions/group/auth')>()
  return { ...real, authorizeStaff: vi.fn() }
})

/** What the side chat's model "says", one response per call. */
const model = vi.hoisted(() => ({ replies: [] as unknown[] }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => model.replies.shift() }
  },
}))

import handler from '../../../../netlify/functions/group/index'
import { authorizeStaff, type AuthOk } from '../../../../netlify/functions/group/auth'
import { clearAuditMemory, recentAudit } from '../../../../netlify/functions/_delivery/audit'
import {
  actingAs,
  approveProposal,
  canSend,
  getProposal,
  reserveProposalSlot,
  resetProposalStore,
  saveProposal,
  setClock,
} from '../../../../netlify/functions/group/store'
import {
  edit_proposal,
  evaluate_group_rules,
  generate_proposal,
  override_proposal,
  resetCreatedInquiries,
  update_inquiry,
} from '../../../../netlify/functions/group/tools'
import { listProperties } from '../../../../netlify/functions/_lib/data'
import { effectiveRole } from '../types'
import { priceBlock } from '../pricing'

const GM: AuthOk = { ok: true, actor: 'user-gm', role: 'gm', name: 'Olivia Grant' }
const SALES: AuthOk = { ok: true, actor: 'user-sales', role: 'group_sales', name: 'Marcus Feld' }
const ADMIN: AuthOk = { ok: true, actor: 'user-admin', role: 'admin', name: 'Enrique Alonso' }
const OTHER_GM: AuthOk = { ok: true, actor: 'user-gm-2', role: 'gm', name: 'Priya Natarajan' }

/** Mid-July 2026: every inquiry has arrived, none has travelled. */
const JULY = new Date('2026-07-15T12:00:00Z')
/** The day this was written, when four of the dataset's arrivals are already behind us. */
const SEPTEMBER = new Date('2026-09-26T12:00:00Z')

// `Context` is a Netlify runtime object none of these routes touch.
const CTX = {} as never

function signIn(user: AuthOk): void {
  vi.mocked(authorizeStaff).mockResolvedValue(user)
}

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handler(
    new Request(`https://solstice.example${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify(body),
    }),
    CTX,
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** A flagged proposal, drafted by `actorId` when given (as a staff request would record it). */
async function flagged(inquiryId = 'INQ-2009', actorId?: string): Promise<string> {
  const draft = () => generate_proposal({ inquiry_id: inquiryId })
  const generated = await (actorId ? actingAs(actorId, draft) : draft())
  expect(generated.data?.requires_approval, `${inquiryId} should need an approval`).toBe(true)
  return generated.data!.proposal_id
}

beforeAll(() => setClock(() => JULY))
afterAll(() => setClock(null))
beforeEach(() => {
  setClock(() => JULY)
  resetProposalStore()
  resetCreatedInquiries()
  clearAuditMemory()
})
afterEach(() => {
  vi.unstubAllEnvs()
  model.replies = []
})

describe('who may approve', () => {
  it('refuses group sales on any proposal, with the reason, and changes nothing', async () => {
    const id = await flagged()
    signIn(SALES)
    const res = await post('/api/group/approve', { proposal_id: id })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('Only a general manager can approve')
    expect((await getProposal(id))!.status).toBe('awaiting_approval')
    expect(recentAudit().some((e) => e.action === 'proposal.approved')).toBe(false)
  })

  it('refuses admin too: running the platform is not approving discounts', async () => {
    const id = await flagged()
    signIn(ADMIN)
    const res = await post('/api/group/proposal-action', { proposal_id: id, action: 'approve', justification: 'ok' })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('Only a general manager can approve')
  })

  it('refuses a general manager who created the proposal', async () => {
    const id = await flagged('INQ-2009', GM.actor)
    signIn(GM)
    const res = await post('/api/group/approve', { proposal_id: id })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('you cannot also approve it')
  })

  it('refuses a general manager who submitted it for approval', async () => {
    const id = await flagged()
    signIn(GM)
    await post('/api/group/proposal-action', { proposal_id: id, action: 'submit_for_approval', justification: 'please' })
    const res = await post('/api/group/proposal-action', { proposal_id: id, action: 'approve', justification: 'fine' })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('you cannot also approve it')
  })

  it('refuses a general manager whose Run triage drafted the proposal, and lets another one approve it', async () => {
    signIn(GM)
    const triage = await post('/api/group/triage', {})
    const drafted = (triage.body.outcomes as { inquiry_id: string; action: string; artifact_id?: string }[]).find(
      (o) => o.inquiry_id === 'INQ-2009',
    )
    expect(drafted?.action).toBe('proposal_drafted')
    const id = drafted!.artifact_id!

    const own = await post('/api/group/approve', { proposal_id: id })
    expect(own.status).toBe(403)
    expect(own.body.error).toContain('you cannot also approve it')

    signIn(OTHER_GM)
    expect((await post('/api/group/approve', { proposal_id: id })).status).toBe(200)
  })

  it('refuses a general manager who had the side chat draft the proposal', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    model.replies = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'call-1', name: 'generate_proposal', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Drafted, and waiting on an approval.' }] },
    ]
    signIn(GM)
    const chat = await post('/api/group/assistant', { inquiry_id: 'INQ-2009', message: 'Draft the proposal' })
    expect(chat.status).toBe(200)
    expect((chat.body.trace as { tool: string; ok: boolean }[])[0]).toMatchObject({ tool: 'generate_proposal', ok: true })

    const res = await post('/api/group/approve', { proposal_id: 'PRP-2009' })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('you cannot also approve it')
  })

  it('refuses a general manager who had the side chat submit it for approval', async () => {
    const id = await flagged('INQ-2009', SALES.actor)
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    model.replies = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'call-1', name: 'submit_for_approval', input: { note: 'please' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Submitted.' }] },
    ]
    signIn(GM)
    const chat = await post('/api/group/assistant', { inquiry_id: 'INQ-2009', message: 'Submit it for approval' })
    expect((chat.body.trace as { tool: string; ok: boolean }[])[0]).toMatchObject({ tool: 'submit_for_approval', ok: true })

    const res = await post('/api/group/approve', { proposal_id: id })
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('you cannot also approve it')
  })

  it("approves someone else's flagged proposal, recording the caller whatever the body claims", async () => {
    const id = await flagged('INQ-2009', SALES.actor)
    signIn(GM)
    const res = await post('/api/group/approve', {
      proposal_id: id,
      approved_by: 'user-somebody-else',
      actor: 'Somebody Else',
      note: 'Third year of this retreat.',
    })
    expect(res.status).toBe(200)
    expect((res.body.data as { approved_by: string }).approved_by).toBe(GM.actor)

    const stored = (await getProposal(id))!
    expect(stored.status).toBe('approved')
    expect(stored.approved_by).toBe(GM.actor)
    const row = recentAudit().find((e) => e.action === 'proposal.approved')!
    expect(row.detail.approved_by).toBe(GM.actor)
    expect(row.detail.approver_name).toBe('Olivia Grant')
    expect(JSON.stringify(row.detail)).not.toContain('somebody')

    const gate = await canSend(stored)
    expect(gate.allowed).toBe(true)
    expect(gate.human_reason).toContain('Olivia Grant approved it')
  })

  it('sends nothing by approving', async () => {
    const id = await flagged()
    signIn(GM)
    expect((await post('/api/group/approve', { proposal_id: id })).status).toBe(200)
    const stored = (await getProposal(id))!
    expect(stored.sent_at).toBeNull()
    const sends = recentAudit().filter((e) => ['proposal.sent', 'proposal.send_failed', 'proposal.marked_sent'].includes(e.action))
    expect(sends).toEqual([])
  })
})

describe('an approval covers the proposal as it stood', () => {
  async function approved(): Promise<string> {
    const id = await flagged()
    signIn(GM)
    expect((await post('/api/group/approve', { proposal_id: id })).status).toBe(200)
    expect((await canSend((await getProposal(id))!)).allowed).toBe(true)
    return id
  }

  it('lapses when the verdicts change: the customer adds rooms after the sign-off', async () => {
    const id = await approved()
    // The contact is restated because an update re-parses the record, whose own copy is redacted.
    await update_inquiry({ inquiry_id: 'INQ-2009', rooms_requested: 40, contact_email: 'organiser@example.com' })
    const gate = await canSend((await getProposal(id))!)
    expect(gate.allowed).toBe(false)
    expect(gate.blocking.map((v) => v.rule_id)).toContain('GRP-ROOMS-CAP')
  })

  it('lapses when the discount is overridden after the sign-off', async () => {
    const id = await approved()
    await actingAs(SALES.actor, () =>
      override_proposal({ proposal_id: id, actor: 'Marcus Feld', justification: 'Loyal client.', discount_pct: 17 }),
    )
    expect((await canSend((await getProposal(id))!)).allowed).toBe(false)
  })

  it('lapses when the proposal is rejected, even if it is then drafted again unchanged', async () => {
    const id = await approved()
    signIn(SALES)
    expect((await post('/api/group/reject', { proposal_id: id, reason: 'Customer went elsewhere.' })).status).toBe(200)
    const redrafted = await generate_proposal({ inquiry_id: 'INQ-2009' })
    expect(redrafted.data!.proposal_id).toBe(id)

    const gate = await canSend((await getProposal(id))!)
    expect(gate.allowed).toBe(false)
    expect(gate.needs_approval).toBe(true)
  })

  it('lapses when the stay moves, even to the same number of nights at the same price', async () => {
    const id = await approved()
    await update_inquiry({
      inquiry_id: 'INQ-2009',
      arrival_date: '2026-08-04',
      departure_date: '2026-08-07',
      contact_email: 'organiser@example.com',
    })
    const gate = await canSend((await getProposal(id))!)
    expect(gate.allowed).toBe(false)
    expect(gate.needs_approval).toBe(true)
  })

  it('lapses when new dates bring a lower seasonal ceiling under the same flag', async () => {
    // INQ-2010 moved to August and asking 12% against Sacramento's 10%: priced at 10%, approved.
    await update_inquiry({
      inquiry_id: 'INQ-2010',
      arrival_date: '2027-08-03',
      departure_date: '2027-08-05',
      requested_discount_pct: 12,
      contact_email: 'organiser@example.com',
    })
    const id = await flagged('INQ-2010', SALES.actor)
    expect((await getProposal(id))!.pricing.discount_pct).toBe(10)
    signIn(GM)
    expect((await post('/api/group/approve', { proposal_id: id })).status).toBe(200)
    expect((await canSend((await getProposal(id))!)).allowed).toBe(true)

    // Moved into a legislature week, where the ceiling is 8%: the 10% nobody approved must not go out.
    await update_inquiry({
      inquiry_id: 'INQ-2010',
      arrival_date: '2027-04-13',
      departure_date: '2027-04-15',
      contact_email: 'organiser@example.com',
    })
    const gate = await canSend((await getProposal(id))!)
    expect(gate.allowed).toBe(false)
    expect(gate.needs_approval).toBe(true)
    expect(gate.human_reason).toContain('8%')
  })

  it('lapses when the letter is reworded after the sign-off', async () => {
    const id = await approved()
    await edit_proposal({
      proposal_id: id,
      edits: { intro: 'Alicia, we are delighted to host the retreat again.' },
      justification: 'Warmer opening.',
      actor: 'Marcus Feld',
    })
    const stored = (await getProposal(id))!
    expect(stored.status).toBe('awaiting_approval')
    expect((await canSend(stored)).allowed).toBe(false)
  })
})

describe('physical limits and past dates cannot be approved into a sent proposal', () => {
  /** PRP-2005 as production holds it: priced before capacity became a hard stop. */
  async function legacyPrp2005(): Promise<string> {
    const property = listProperties().find((p) => p.property_code === 'SOL-SAC')!
    const block = priceBlock({
      property,
      rooms: 22,
      arrival_date: '2026-11-09',
      departure_date: '2026-11-11',
      room_type: 'Standard King',
      discount_pct: 8,
    })
    const saved = await saveProposal({
      slot: await reserveProposalSlot('INQ-2005'),
      status: 'awaiting_approval',
      verdicts: [],
      pricing: {
        line_items: block.line_items,
        subtotal_cents: block.subtotal_cents,
        discount_pct: block.discount_pct,
        discount_cents: block.discount_cents,
        total_cents: block.total_cents,
      },
      pdf_path: null,
    })
    return saved.proposal_id
  }

  it('puts INQ-2005, 300 seats against 140, in pricing_blocked_by', async () => {
    const result = await evaluate_group_rules({ inquiry_id: 'INQ-2005' })
    expect(result.data!.pricing_blocked_by).toContain('GRP-MEETING-CAPACITY')
    expect((await generate_proposal({ inquiry_id: 'INQ-2005' })).ok).toBe(false)
  })

  it('answers 409 with the reason when a general manager tries to approve it', async () => {
    const id = await legacyPrp2005()
    signIn(GM)
    const res = await post('/api/group/approve', { proposal_id: id })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('300 people')
    expect(res.body.error).toContain('No approval can lift that')
  })

  it('is never sendable, even with an approval written straight into the store', async () => {
    const id = await legacyPrp2005()
    const stored = (await getProposal(id))!
    await approveProposal(
      stored,
      { id: GM.actor, role: 'gm', name: GM.name ?? null },
      { stay: ['SOL-SAC', '2026-11-09', '2026-11-11'], flags: [['GRP-MEETING-CAPACITY', 300, 140]] },
    )
    const gate = await canSend(stored)
    expect(gate.allowed).toBe(false)
    expect(gate.needs_approval).toBe(false)
    expect(gate.blocking.map((v) => v.rule_id)).toEqual(['GRP-MEETING-CAPACITY'])
  })

  it('blocks a proposal once its arrival date has passed, approved or not', async () => {
    const id = await flagged('INQ-2009')
    signIn(GM)
    expect((await post('/api/group/approve', { proposal_id: id })).status).toBe(200)

    const gate = await canSend((await getProposal(id))!, { now: SEPTEMBER })
    expect(gate.allowed).toBe(false)
    expect(gate.blocking.map((v) => v.rule_id)).toEqual(['GRP-ARRIVAL-PAST'])
    expect(gate.human_reason).toContain('July 28, 2026')
  })

  it('will not approve or price a past arrival', async () => {
    const id = await flagged('INQ-2009')
    setClock(() => SEPTEMBER)
    signIn(GM)
    const res = await post('/api/group/approve', { proposal_id: id })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already passed')

    const fresh = await generate_proposal({ inquiry_id: 'INQ-2001' })
    expect(fresh.ok).toBe(false)
    expect(fresh.error).toContain('September 14, 2026')
  })
})

describe('the role a signed-in user acts as', () => {
  it('lifts a group sales profile to gm when the service key has granted it', () => {
    expect(effectiveRole({ staff_role: 'gm' }, 'group_sales')).toBe('gm')
    expect(effectiveRole({}, 'gm')).toBe('gm')
  })

  it('takes gm away when the staff screen moves the profile to another role', () => {
    expect(effectiveRole({ staff_role: 'gm' }, 'concierge')).toBe('concierge')
    expect(effectiveRole({ staff_role: 'gm' }, 'admin')).toBe('admin')
  })

  it('grants nothing else from app_metadata, and ignores a role it does not know', () => {
    expect(effectiveRole({ staff_role: 'admin' }, 'group_sales')).toBe('group_sales')
    expect(effectiveRole({}, 'group_sales')).toBe('group_sales')
    expect(effectiveRole(undefined, 'nonsense')).toBeNull()
    expect(effectiveRole({ staff_role: 'gm' }, null)).toBeNull()
  })
})
