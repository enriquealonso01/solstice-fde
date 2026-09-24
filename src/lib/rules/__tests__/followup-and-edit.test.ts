// Follow-ups and proposal edits.
//
// Two features with one shared idea: anything that goes to a customer in the hotel's name gets
// drafted, read by a person, approved, then sent, and the numbers are never typed by hand.

import { beforeEach, describe, expect, it } from 'vitest'
import { clearAuditMemory, recentAudit } from '../../../../netlify/functions/_delivery/audit'
import { getCommunications } from '../../../../netlify/functions/group/communications'
import {
  actOnFollowUp,
  draftFollowUp,
  findFollowUpByInquiry,
  getFollowUp,
  listFollowUps,
  resetFollowUpStore,
} from '../../../../netlify/functions/group/followUps'
import {
  getProposal,
  markSent,
  resetProposalStore,
} from '../../../../netlify/functions/group/store'
import {
  edit_proposal,
  generate_proposal,
  materialiseProposal,
  resetCreatedInquiries,
} from '../../../../netlify/functions/group/tools'

const REP = 'Dana Reyes (group_sales, 0000-uuid)'

beforeEach(() => {
  resetProposalStore()
  resetFollowUpStore()
  resetCreatedInquiries()
  clearAuditMemory()
})

// ============================================================================ follow-ups

describe('INQ-2004, the enquiry that cannot be quoted', () => {
  it('drafts a follow-up naming only what is genuinely missing', async () => {
    const result = await draftFollowUp('INQ-2004')
    expect(result.ok).toBe(true)
    const followUp = result.follow_up!

    expect(followUp.status).toBe('draft')
    expect(followUp.missing_fields).toEqual(
      expect.arrayContaining(['arrival_date', 'departure_date', 'rooms_requested']),
    )

    const body = followUp.body.toLowerCase()
    expect(body).toContain('arrival date')
    expect(body).toContain('departure date')
    expect(followUp.body).toContain('around 25')

    // It asks for nothing the customer already gave us.
    expect(body).not.toContain('which hotel')
    expect(body).not.toContain('company')
  })

  it('invents neither a deadline nor a policy', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    const body = follow_up!.body.toLowerCase()
    for (const invention of [
      'within 24',
      'within 48',
      '72 hours',
      'by friday',
      'expires',
      'deadline',
      'our policy',
      'policy requires',
      'non-refundable',
    ]) {
      expect(body, `follow-up invented "${invention}"`).not.toContain(invention)
    }
  })

  it('routes to email because this contact has an email address', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    expect(follow_up!.channel).toBe('email')
    expect(follow_up!.subject).toContain('Meridian Wealth Partners')
  })

  it('refuses to draft one for an enquiry that has everything', async () => {
    const result = await draftFollowUp('INQ-2001')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('nothing to ask for')
  })

  it('is idempotent: drafting twice edits one follow-up', async () => {
    const first = await draftFollowUp('INQ-2004')
    const second = await draftFollowUp('INQ-2004')
    expect(second.follow_up!.follow_up_id).toBe(first.follow_up!.follow_up_id)
    expect((await listFollowUps()).filter((f) => f.inquiry_id === 'INQ-2004')).toHaveLength(1)
  })
})

describe('the follow-up approval gate', () => {
  it('will not send before somebody has approved the wording', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    const sent = await actOnFollowUp({
      follow_up_id: follow_up!.follow_up_id,
      action: 'send',
      actor: REP,
    })
    expect(sent.ok).toBe(false)
    expect(sent.error).toContain('not been approved')
    expect((await getFollowUp(follow_up!.follow_up_id))!.status).toBe('draft')
    expect(recentAudit().some((e) => e.action === 'follow_up.send_blocked')).toBe(true)
  })

  it('records who approved it and what was missing', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    const approved = await actOnFollowUp({
      follow_up_id: follow_up!.follow_up_id,
      action: 'approve',
      actor: REP,
      justification: 'Wording reads fine.',
    })
    expect(approved.ok).toBe(true)
    expect(approved.status).toBe('approved')

    const row = recentAudit().find((e) => e.action === 'follow_up.approved')!
    expect(row.detail.actor).toBe(REP)
    expect(row.detail.missing_fields).toEqual(
      expect.arrayContaining(['arrival_date', 'departure_date', 'rooms_requested']),
    )
  })

  it('keeps a rep edit and audits it', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    await actOnFollowUp({
      follow_up_id: follow_up!.follow_up_id,
      action: 'approve',
      actor: REP,
      edited_body: 'Hello, could you confirm your dates and an exact room count? Thanks, Sol',
      justification: 'Shorter, they are a repeat customer.',
    })
    const stored = (await getFollowUp(follow_up!.follow_up_id))!
    expect(stored.body).toContain('exact room count')
    const edit = recentAudit().find((e) => e.action === 'follow_up.edited')!
    expect(edit.detail.actor).toBe(REP)
    expect(edit.detail.justification).toContain('repeat customer')
  })

  it('will not send the same follow-up twice', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    const id = follow_up!.follow_up_id
    await actOnFollowUp({ follow_up_id: id, action: 'approve', actor: REP })

    const stored = (await getFollowUp(id))!
    stored.status = 'sent'
    const again = await actOnFollowUp({ follow_up_id: id, action: 'send', actor: REP })
    expect(again.ok).toBe(false)
    expect(again.error).toContain('already gone to the customer')
  })

  it('can be discarded, and then cannot be resurrected', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    const id = follow_up!.follow_up_id
    await actOnFollowUp({ follow_up_id: id, action: 'discard', actor: REP, justification: 'Called them instead.' })
    expect((await getFollowUp(id))!.status).toBe('discarded')

    const retried = await actOnFollowUp({ follow_up_id: id, action: 'approve', actor: REP })
    expect(retried.ok).toBe(false)
    expect(retried.error).toContain('discarded')
  })

  it('fails explicitly rather than crashing when the provider is not configured', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    const id = follow_up!.follow_up_id
    await actOnFollowUp({ follow_up_id: id, action: 'approve', actor: REP })
    const sent = await actOnFollowUp({ follow_up_id: id, action: 'send', actor: REP })

    // No Telnyx key on this deploy, so it must refuse in words rather than throw.
    expect(sent.ok).toBe(false)
    expect(sent.error).toBeTruthy()
    expect(sent.error).not.toMatch(/undefined|\[object|TypeError/)
    expect(recentAudit().some((e) => e.action === 'follow_up.send_failed')).toBe(true)
  })
})

// ============================================================================ proposal edits

describe('editing a proposal', () => {
  it('rewrites the prose and re-renders the letter from the stored record', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const edited = await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      edits: {
        intro: 'Bethany, it was good to speak this morning. Here is the block we discussed.',
        body: 'Give me a call once the team has signed off and I will hold the rooms.',
        customer_notes: ['Breakout room on day two is included.'],
      },
      justification: 'Warmer opening after the call, and their breakout request confirmed.',
      actor: REP,
    })

    expect(edited.ok).toBe(true)
    expect(edited.data!.proposal.prose.intro).toContain('good to speak this morning')

    // The letter carries the new words, and the derived note it replaced is gone.
    expect(edited.data!.proposal.html).toContain('good to speak this morning')
    expect(edited.data!.proposal.html).toContain('Breakout room on day two')
    expect(edited.data!.proposal.text).toContain('Give me a call once the team has signed off')

    // And the PDF re-renders with them too.
    const stored = (await getProposal(generated.data!.proposal_id))!
    const materialised = await materialiseProposal(stored, { force_render: true })
    expect(materialised!.document.intro).toContain('good to speak this morning')
    expect(materialised!.document.body_note).toContain('hold the rooms')
  })

  it('leaves the numbers exactly where the rules engine put them', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const before = (await getProposal(generated.data!.proposal_id))!.pricing

    const edited = await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      edits: { intro: 'Anything at all.' },
      justification: 'Tone.',
      actor: REP,
    })

    expect(edited.data!.proposal.pricing.total_cents).toBe(before.total_cents)
    expect(edited.data!.proposal.pricing.discount_pct).toBe(before.discount_pct)
    expect(edited.data!.proposal.verdicts).toEqual(
      (await getProposal(generated.data!.proposal_id))!.verdicts,
    )
  })

  it('refuses an attempt to edit a number, and says why', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const attempted = await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      // A rep, or an agent, trying to type a total straight into the letter.
      edits: { total_cents: 1, discount_pct: 40 } as never,
      justification: 'Customer pushed back.',
      actor: REP,
    })

    expect(attempted.ok).toBe(false)
    expect(attempted.error).toContain('total_cents')
    expect(attempted.error).toContain('rules engine')
    expect(attempted.error).toContain('override')

    // Nothing moved.
    const stored = (await getProposal(generated.data!.proposal_id))!
    expect(stored.pricing.discount_pct).toBe(10)
    expect(stored.pricing.total_cents).toBe(709_560)
  })

  it('says in the response which fields are editable and why the numbers are not', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const edited = await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      edits: { intro: 'Hello.' },
      justification: 'Tone.',
      actor: REP,
    })

    expect(edited.data!.editable_fields).toEqual(['intro', 'body', 'customer_notes'])
    expect(edited.data!.locked_fields).toEqual(
      expect.arrayContaining(['discount_pct', 'total', 'verdicts']),
    )
    expect(edited.data!.explanation).toContain('rules engine')
    expect(edited.data!.explanation).toContain('override')
  })

  it('needs an actor and a justification', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const noReason = await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      edits: { intro: 'Hello.' },
      justification: '   ',
      actor: REP,
    })
    expect(noReason.ok).toBe(false)
    expect(noReason.error).toContain('needs a note')

    const anonymous = await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      edits: { intro: 'Hello.' },
      justification: 'Tone.',
      actor: '',
    })
    expect(anonymous.ok).toBe(false)
    expect(anonymous.error).toContain('attributed to a person')
  })

  it('audits every edit with the actor and the reason', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      edits: { intro: 'Hello.' },
      justification: 'They asked for a warmer opening.',
      actor: REP,
    })
    const row = recentAudit().find((e) => e.action === 'proposal.edited')!
    expect(row.detail.actor).toBe(REP)
    expect(row.detail.justification).toContain('warmer opening')
    expect(row.detail.fields).toEqual(['intro'])
  })

  it('does not rewrite a proposal the customer already has', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const original = (await getProposal(generated.data!.proposal_id))!
    await markSent(original, 'email', REP, 'b***@harlowvance.com')

    const edited = await edit_proposal({
      proposal_id: original.proposal_id,
      edits: { intro: 'Second thoughts about the wording.' },
      justification: 'Typo in the opening line.',
      actor: REP,
    })

    expect(edited.ok).toBe(true)
    expect(edited.data!.opened_new_revision).toBe(true)
    expect(edited.data!.proposal.proposal_id).not.toBe(original.proposal_id)
    expect(edited.data!.proposal.revision).toBe(2)

    // The one they hold is untouched.
    const sent = (await getProposal(original.proposal_id))!
    expect(sent.status).toBe('sent')
    expect(sent.prose.intro).toBeUndefined()
  })

  it('carries the prose onto a re-price rather than losing the rep works', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2009' })
    await edit_proposal({
      proposal_id: generated.data!.proposal_id,
      edits: { intro: 'Alicia, lovely to hear from you again.' },
      justification: 'Third year of this booking.',
      actor: REP,
    })

    const repriced = await generate_proposal({ inquiry_id: 'INQ-2009', discount_pct: 16 })
    const stored = (await getProposal(repriced.data!.proposal_id))!
    expect(stored.prose.intro).toContain('lovely to hear from you again')
    expect(stored.pricing.discount_pct).toBe(16)
  })
})

// ============================================================================ the thread

describe('the conversation thread', () => {
  it('is empty rather than missing for an enquiry nobody has written to', async () => {
    const thread = await getCommunications('INQ-2001')
    expect(thread.inquiry_id).toBe('INQ-2001')
    expect(thread.items).toEqual([])
  })

  it('shows a sent proposal, addressed to the customer, with the demo redirect noted apart', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const proposal = (await getProposal(generated.data!.proposal_id))!
    await markSent(proposal, 'email', REP, 'b***@harlowvance.com')

    const thread = await getCommunications('INQ-2001')
    expect(thread.items).toHaveLength(1)
    const item = thread.items[0]

    expect(item.direction).toBe('outbound')
    expect(item.channel).toBe('email')
    expect(item.subject).toContain(proposal.proposal_id)
    expect(item.preview).toContain('18 rooms')
    expect(item.status).toBe('sent')

    // The screen tells the truth: the customer is the recipient, the redirect is separate.
    expect(item.recipient).toBe('b***@harlowvance.com')
    expect(item.recipient).not.toContain('enrique')
  })

  it('reads oldest first, so it looks like a conversation', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2004' }).catch(() => null)
    expect(generated?.ok ?? false).toBe(false) // INQ-2004 cannot be quoted, which is the point

    const { follow_up } = await draftFollowUp('INQ-2004')
    const stored = (await getFollowUp(follow_up!.follow_up_id))!
    stored.status = 'sent'
    stored.sent_at = new Date().toISOString()
    stored.sent_to = 'j***@meridianwp.com'
    stored.approved_by = REP

    const thread = await getCommunications('INQ-2004')
    expect(thread.items).toHaveLength(1)
    expect(thread.items[0].id).toContain('follow_up:')
    expect(thread.items[0].preview.toLowerCase()).toContain('meridian')

    const timestamps = thread.items.map((i) => i.occurred_at)
    expect([...timestamps].sort()).toEqual(timestamps)
  })

  it('finds the enquiry by code even though the UI may hold a uuid', async () => {
    const byCode = await getCommunications('inq-2001')
    expect(byCode.inquiry_id).toBe('INQ-2001')
    const unknown = await getCommunications('00000000-0000-0000-0000-000000000000')
    expect(unknown.items).toEqual([])
  })
})

describe('the follow-up channel follows the contact details, like a proposal', () => {
  it('goes by text when there is a phone number and no email', async () => {
    // A voice-created enquiry: a number and nothing else, which is demo path two.
    const { create_inquiry } = await import('../../../../netlify/functions/group/tools')
    const created = await create_inquiry({
      company_name: 'Cypress Ridge Reunion',
      contact_name: 'Dana Alvarez',
      contact_phone: '+13055557788',
      preferred_property_code: 'SOL-TPA',
      meeting_space_needed: true,
      source: 'voice',
    })
    expect(created.ok).toBe(true)

    const result = await draftFollowUp(created.data!.inquiry.inquiry_id)
    expect(result.ok).toBe(true)
    expect(result.follow_up!.channel).toBe('sms')
    expect(result.follow_up!.subject).toBeNull()
    // Short enough for a phone, and it still names what is missing.
    expect(result.follow_up!.body.length).toBeLessThan(480)
    expect(result.follow_up!.body).toContain('Solstice')
  })
})

describe('follow-ups survive being looked up again', () => {
  it('is findable by its code and by its enquiry', async () => {
    const { follow_up } = await draftFollowUp('INQ-2004')
    expect((await getFollowUp(follow_up!.follow_up_id))?.follow_up_id).toBe(follow_up!.follow_up_id)
    expect((await findFollowUpByInquiry('INQ-2004'))?.follow_up_id).toBe(follow_up!.follow_up_id)
  })

  it('says out loud when it is only in memory', async () => {
    const { follow_up, human_summary } = await draftFollowUp('INQ-2004')
    expect(follow_up!.persisted).toBe(false)
    expect(human_summary).toContain('only held in memory')
  })
})
