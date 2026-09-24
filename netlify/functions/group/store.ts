// Proposal state and the approval gate.
//
// THE GATE: a proposal carrying any `flag` or `fail` verdict cannot reach `sent` without an
// explicit approval first. This is enforced here, in the state machine, not in the prompt and
// not in the UI. An agent that decides to be helpful cannot route around it, because the send
// path asks this module for permission and the answer is a hard no.
//
//   draft ──(no flags)──────────────► approved ──► sent
//     │                                  ▲
//     └──(any flag/fail)─► awaiting_approval ──(a named human approves)──┘
//
// Persistence is best-effort: the demo runs from memory so that a missing Supabase schema
// degrades to "works, just not durable" rather than "crashes".

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Proposal, ProposalLine, RuleVerdict } from '../../../shared/types'
import { auditLog, describeError } from '../_delivery/audit'
import type { ProposalDocument } from './proposal'

/**
 * The `proposals.pricing` jsonb payload, and the shape the admin UI renders against.
 * ALL MONEY IS INTEGER CENTS. The dollar mirrors on `Proposal` exist only because
 * shared/types.ts declares them; anything doing arithmetic uses the `_cents` fields.
 */
export interface Pricing {
  line_items: ProposalLine[]
  subtotal_cents: number
  discount_pct: number
  discount_cents: number
  total_cents: number
  /** Present when the rules engine had to move off the number the customer asked for. */
  requested_discount_pct?: number
}

export interface StoredProposal extends Proposal {
  pricing: Pricing
  document: ProposalDocument
  pdf_bytes: Uint8Array | null
  pdf_url: string | null
  /** Masked recipient, mirrored to `proposals.sent_to`. */
  sent_to: string | null
  /**
   * Random per-proposal capability token. It appears only in the link we put in the customer's
   * email or text, which is how a customer with no login opens their own PDF and nobody opens
   * anybody else's. It is never rendered in the admin UI and never written to the audit trail.
   */
  access_token: string
  /** Populated when someone approves or rejects. */
  approved_by: string | null
  approved_at: string | null
  approval_note: string | null
  rejected_reason: string | null
  /** Human-readable trail of what happened to this proposal. */
  history: { at: string; event: string; by: string | null; detail?: string }[]
}

const proposals = new Map<string, StoredProposal>()

let counter = 0
export function nextProposalId(): string {
  counter += 1
  return `PRP-${String(counter).padStart(4, '0')}`
}

/** Test seam. */
export function resetProposalStore(): void {
  proposals.clear()
  counter = 0
}

export function putProposal(proposal: StoredProposal): StoredProposal {
  proposals.set(proposal.proposal_id, proposal)
  return proposal
}

export function getProposal(id: string): StoredProposal | null {
  return proposals.get(id) ?? null
}

export function listProposals(): StoredProposal[] {
  return [...proposals.values()]
}

export function findProposalByInquiry(inquiryId: string): StoredProposal | null {
  return [...proposals.values()].reverse().find((p) => p.inquiry_id === inquiryId) ?? null
}

/** Constant-time check of the capability token on a customer's PDF link. */
export function tokenMatches(proposal: StoredProposal, supplied: string | null): boolean {
  if (!supplied || !proposal.access_token) return false
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(proposal.access_token, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------- the gate

export function blockingVerdicts(verdicts: RuleVerdict[]): RuleVerdict[] {
  return verdicts.filter((v) => v.status === 'flag' || v.status === 'fail')
}

export function requiresApproval(verdicts: RuleVerdict[]): boolean {
  return blockingVerdicts(verdicts).length > 0
}

export interface GateDecision {
  allowed: boolean
  /** Safe to show a salesperson. */
  human_reason: string
  blocking: RuleVerdict[]
}

/** The single authority on whether a proposal may be sent. Called by `send_proposal`
 *  and by nothing else that matters. */
export function canSend(proposal: StoredProposal): GateDecision {
  const blocking = blockingVerdicts(proposal.verdicts)

  if (proposal.status === 'sent') {
    return {
      allowed: false,
      human_reason: `Proposal ${proposal.proposal_id} has already gone out to the customer. Sending it again would be the second copy they receive, so if something has changed we should generate a fresh proposal rather than resend this one.`,
      blocking,
    }
  }

  if (proposal.status === 'rejected') {
    return {
      allowed: false,
      human_reason: `Proposal ${proposal.proposal_id} was turned down internally${proposal.rejected_reason ? `: ${proposal.rejected_reason}` : ''}. It cannot be sent as it stands.`,
      blocking,
    }
  }

  if (blocking.length === 0) {
    return {
      allowed: true,
      human_reason: `Every rule check on this block passed, so it is inside what we are allowed to approve on our own and can go out now.`,
      blocking,
    }
  }

  if (proposal.status === 'approved') {
    return {
      allowed: true,
      human_reason: `This proposal was outside our own authority, and ${proposal.approved_by ?? 'an authorised approver'} approved it${proposal.approved_at ? ` on ${proposal.approved_at.slice(0, 10)}` : ''}. It can go out now.`,
      blocking,
    }
  }

  const reasons = blocking.map((v) => v.human_reason).join(' ')
  return {
    allowed: false,
    human_reason: `This one cannot go out yet. ${reasons} Someone with the authority to sign that off has to approve it first, and until they do, we hold the proposal rather than send it.`,
    blocking,
  }
}

// ---------------------------------------------------------------- transitions

export async function markAwaitingApproval(
  proposal: StoredProposal,
  by: string | null,
  note?: string,
): Promise<StoredProposal> {
  proposal.status = 'awaiting_approval'
  proposal.history.push({ at: new Date().toISOString(), event: 'submitted_for_approval', by: by ?? null, detail: note })
  await auditLog('proposal.submitted_for_approval', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    submitted_by: by,
    note: note ?? null,
    blocking_rules: blockingVerdicts(proposal.verdicts).map((v) => v.rule_id),
  })
  await persist(proposal)
  return proposal
}

export async function approveProposal(
  proposal: StoredProposal,
  by: string,
  note?: string,
): Promise<StoredProposal> {
  proposal.status = 'approved'
  proposal.approved_by = by
  proposal.approved_at = new Date().toISOString()
  proposal.approval_note = note ?? null
  proposal.history.push({ at: proposal.approved_at, event: 'approved', by, detail: note })
  await auditLog('proposal.approved', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    approved_by: by,
    note: note ?? null,
    discount_pct: proposal.discount_pct,
    overrode_rules: blockingVerdicts(proposal.verdicts).map((v) => v.rule_id),
  })
  await persist(proposal)
  return proposal
}

export async function rejectProposal(
  proposal: StoredProposal,
  by: string,
  reason: string,
): Promise<StoredProposal> {
  proposal.status = 'rejected'
  proposal.rejected_reason = reason
  proposal.history.push({ at: new Date().toISOString(), event: 'rejected', by, detail: reason })
  await auditLog('proposal.rejected', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    rejected_by: by,
    reason,
  })
  await persist(proposal)
  return proposal
}

export async function markSent(
  proposal: StoredProposal,
  via: 'email' | 'sms',
  by: string | null,
  sentTo?: string | null,
): Promise<StoredProposal> {
  proposal.status = 'sent'
  proposal.sent_via = via
  proposal.sent_to = sentTo ?? null
  proposal.sent_at = new Date().toISOString()
  proposal.history.push({ at: proposal.sent_at, event: `sent_by_${via}`, by: by ?? null })
  await persist(proposal)
  return proposal
}

// ---------------------------------------------------------------- persistence (best effort)

let cachedClient: SupabaseClient | null | undefined

function getClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    cachedClient = null
    return null
  }
  try {
    cachedClient = createClient(url, key, { auth: { persistSession: false } })
  } catch {
    cachedClient = null
  }
  return cachedClient
}

export function resetStoreClient(): void {
  cachedClient = undefined
}

/** Mirrors the proposal into Supabase when it is configured. Never throws: a database that is
 *  not there yet must not stop a demo, it must only stop durability. */
async function persist(proposal: StoredProposal): Promise<void> {
  const client = getClient()
  if (!client) return
  try {
    await client.from('proposals').upsert(
      {
        id: undefined,
        inquiry_id: proposal.inquiry_id,
        status: proposal.status,
        verdicts: proposal.verdicts,
        pricing: proposal.pricing,
        pdf_path: proposal.pdf_path,
        sent_via: proposal.sent_via,
        sent_to: proposal.sent_to ?? null,
        sent_at: proposal.sent_at,
      },
      { onConflict: 'id' },
    )
  } catch (err) {
    await auditLog('proposal.persist_failed', `proposal:${proposal.proposal_id}`, {
      error: describeError(err),
    })
  }
}

// ---------------------------------------------------------------- PDF hosting

export const PDF_BUCKET = 'proposals'

export interface HostedPdf {
  url: string
  /** 'storage' = a real object URL in the public `proposals` bucket, which is what the
   *  customer's link points at and what survives a cold function instance. 'function' = served
   *  back out of this instance's memory behind a capability token, which is a fallback only. */
  host: 'storage' | 'function'
  path: string
}

/** 32 bytes of randomness, url-safe. Long enough that the fallback link is not enumerable. */
export function newAccessToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Puts the PDF somewhere a phone can open over https.
 *
 * PREFERRED: the public Supabase Storage bucket. The object path carries the proposal id and
 * the per-proposal access token, so the URL is unguessable, it needs no login, and it keeps
 * working after this function instance is recycled.
 *
 * FALLBACK, when Storage is not configured: a link back into this function carrying the same
 * token as a query parameter. Same unguessability, but it dies with the instance, which is why
 * it is the fallback and not the plan.
 */
export async function hostPdf(
  proposalId: string,
  bytes: Uint8Array,
  filename: string,
  accessToken: string,
): Promise<HostedPdf> {
  const path = `${proposalId}/${accessToken}/${filename}`
  const client = getClient()
  if (client) {
    try {
      const { error } = await client.storage
        .from(PDF_BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
      if (!error) {
        const { data } = client.storage.from(PDF_BUCKET).getPublicUrl(path)
        if (data?.publicUrl) return { url: data.publicUrl, host: 'storage', path }
      }
    } catch {
      // Falls through to the function-hosted link below.
    }
  }
  const base = (process.env.PUBLIC_BASE_URL ?? process.env.URL ?? '').replace(/\/+$/, '')
  return {
    url: `${base}/api/group/pdf/${proposalId}.pdf?t=${accessToken}`,
    host: 'function',
    path,
  }
}
