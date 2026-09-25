/**
 * Auto-triage: sweep the inbox and do the obvious work before a human opens it.
 *
 * For every inquiry with nothing on it yet, decide one of three things:
 *   - information is missing        -> draft a follow-up asking for exactly what is absent
 *   - it is complete                -> draft a proposal, priced by the rules engine
 *   - it cannot proceed at all      -> leave it, and say why
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: send anything. Every artifact it produces lands in `draft`
 * and goes through the same approval gate a human-made one does. The agent is allowed to do the
 * typing; it is not allowed to decide what reaches a customer. That boundary is the whole reason
 * the sales team can trust an empty inbox in the morning.
 *
 * It is also idempotent. Running it twice does not produce two follow-ups, because a sales rep
 * clicking a button twice must not double-message a customer.
 */
import { loadInquiries } from './_deps'
import { auditLog } from '../_delivery/audit'
import { draftFollowUp, findFollowUpByInquiry } from './followUps'
import { generate_proposal } from './tools'
import { findProposalByInquiry } from './store'
import type { GroupInquiry } from '../../../shared/types'

export type TriageAction = 'follow_up_drafted' | 'proposal_drafted' | 'skipped_existing' | 'skipped_blocked'

export interface TriageOutcome {
  inquiry_id: string
  company: string
  action: TriageAction
  detail: string
  artifact_id?: string
  missing_fields?: string[]
}

export interface TriageResult {
  ok: true
  considered: number
  outcomes: TriageOutcome[]
  summary: string
  /** Everything produced is a draft. Stated in the payload so a caller cannot assume otherwise. */
  nothing_was_sent: true
}

/** An inquiry is ready to quote when the parser found no missing fields. */
function isComplete(inquiry: GroupInquiry): boolean {
  return (inquiry.missing_fields ?? []).length === 0
}

export async function triageInbox(actor: string): Promise<TriageResult> {
  const inquiries = await loadInquiries()
  const outcomes: TriageOutcome[] = []

  for (const inquiry of inquiries) {
    const id = inquiry.inquiry_id
    const company = inquiry.company_name

    // Already worked. Leave it alone rather than producing a second artifact.
    const [existingProposal, existingFollowUp] = await Promise.all([
      findProposalByInquiry(id).catch(() => null),
      findFollowUpByInquiry(id).catch(() => null),
    ])
    if (existingProposal || existingFollowUp) {
      outcomes.push({
        inquiry_id: id,
        company,
        action: 'skipped_existing',
        detail: existingProposal
          ? `Already has proposal ${existingProposal.proposal_id}.`
          : `Already has follow-up ${existingFollowUp?.follow_up_id}.`,
      })
      continue
    }

    if (!isComplete(inquiry)) {
      const drafted = await draftFollowUp(id)
      if (!drafted.ok || !drafted.follow_up) {
        outcomes.push({
          inquiry_id: id,
          company,
          action: 'skipped_blocked',
          detail: drafted.error ?? 'A follow-up could not be drafted.',
          missing_fields: inquiry.missing_fields,
        })
        continue
      }
      outcomes.push({
        inquiry_id: id,
        company,
        action: 'follow_up_drafted',
        detail: `Asks for ${inquiry.missing_fields.join(', ')}. Waiting for a human to approve and send.`,
        artifact_id: drafted.follow_up.follow_up_id,
        missing_fields: inquiry.missing_fields,
      })
      continue
    }

    const proposal = await generate_proposal({ inquiry_id: id })
    if (!proposal.ok || !proposal.data) {
      outcomes.push({
        inquiry_id: id,
        company,
        action: 'skipped_blocked',
        detail: proposal.error ?? 'A proposal could not be generated.',
      })
      continue
    }
    outcomes.push({
      inquiry_id: id,
      company,
      action: 'proposal_drafted',
      detail: proposal.data.requires_approval
        ? 'Priced, but flagged: it needs a decision before it can go out.'
        : 'Priced and within every rule. Ready for a human to send.',
      artifact_id: proposal.data.proposal_id,
    })
  }

  const counts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.action] = (acc[o.action] ?? 0) + 1
    return acc
  }, {})

  const parts: string[] = []
  if (counts.proposal_drafted) parts.push(`${counts.proposal_drafted} proposal(s) drafted`)
  if (counts.follow_up_drafted) parts.push(`${counts.follow_up_drafted} follow-up(s) drafted`)
  if (counts.skipped_existing) parts.push(`${counts.skipped_existing} already had work on them`)
  if (counts.skipped_blocked) parts.push(`${counts.skipped_blocked} could not be progressed`)

  const summary = parts.length
    ? `${parts.join(', ')}. Nothing was sent; everything is waiting for a human.`
    : 'Nothing to do: every inquiry already has work on it.'

  await auditLog('group.triage_run', 'inbox', {
    actor,
    considered: inquiries.length,
    ...counts,
    nothing_was_sent: true,
  })

  return { ok: true, considered: inquiries.length, outcomes, summary, nothing_was_sent: true }
}
