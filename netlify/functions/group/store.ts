// Proposal state: persisted in Postgres, and the approval gate over it.
//
// THE MISTAKE THIS FILE USED TO MAKE. Proposals lived in a module-level Map. That works on a
// laptop and is a lie on Netlify, where each invocation may land on a fresh function instance:
// generate_proposal returned an id, and the very next request had never heard of it. Everything
// a proposal needs to survive now goes to the `proposals` table, and memory is a cache in front
// of it, never the record. `StoredProposal.persisted` says which you are looking at, and the
// tools put it in front of the user, so "it worked locally" can never be mistaken for durable
// again.
//
// THE GATE: a proposal carrying any `flag` or `fail` verdict cannot reach `sent` without an
// explicit approval first. Enforced here, in the state machine, not in the prompt and not in the
// UI. An agent that decides to be helpful cannot route around it.
//
//   draft ──(no flags)──────────────► approved ──► sent
//     │                                  ▲
//     └──(any flag/fail)─► awaiting_approval ──(a named human approves)──┘
//
// FITTING supabase/schema.sql. The table has columns for inquiry_id, status, verdicts, pricing,
// pdf_path, sent_via, sent_to and sent_at, and nothing else. Three things a proposal needs have
// no column: the human-facing code (PRP-2001), who approved it, and why it was rejected. Rather
// than invent columns we cannot migrate from here, they live under one clearly-named key,
// `pricing.__proposal`. If this becomes a real product, the migration is obvious and this
// comment is the note that says so. The customer-facing PDF token is NOT stored anywhere; it is
// derived (see accessTokenFor) so that a row read by anyone with database access still does not
// hand them the link.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Proposal, RuleVerdict } from '../../../shared/types'
import type { ProposalLineCents } from '../../../src/lib/rules/pricing'
import { tryGetDb } from '../_lib/db'
import { auditLog, describeError } from '../_delivery/audit'
import type { ProposalProse } from './proposal'

/**
 * The `proposals.pricing` jsonb payload, and the shape the admin UI renders against.
 * ALL MONEY IS INTEGER CENTS. The dollar mirrors on `Proposal` exist only because
 * shared/types.ts declares them; anything doing arithmetic uses the `_cents` fields.
 */
export interface Pricing {
  /** Integer cents throughout, per field name. See ProposalLineCents. */
  line_items: ProposalLineCents[]
  subtotal_cents: number
  discount_pct: number
  discount_cents: number
  total_cents: number
  /** Present when the rules engine had to move off the number the customer asked for. */
  requested_discount_pct?: number
  /** Proposal metadata the table has no column for. See the note at the top of this file. */
  __proposal?: ProposalMeta
}

export interface ProposalMeta {
  code: string
  inquiry_code: string
  approved_by?: string | null
  approved_at?: string | null
  approval_note?: string | null
  rejected_reason?: string | null
  chosen_option?: string | null
  /** Bumped when a proposal is regenerated after an earlier one was already sent. */
  revision: number
  /**
   * Rep-written prose. PROSE ONLY: there is nothing numeric in here and there never will be,
   * because a hand-edited total is the one failure this architecture exists to prevent. The
   * numbers beside it in `pricing` are produced by the rules engine and by nothing else.
   */
  prose?: ProposalProse
}

/** `Omit<Proposal, 'line_items'>` until shared/types.ts renames ProposalLine's money fields to
 *  `_cents`. That interface declares `nightly_rate` and `line_total`, which is where a dollar
 *  value ended up sitting inside an object of cents; we do not widen back onto it. */
export interface StoredProposal extends Omit<Proposal, 'line_items' | 'subtotal' | 'total'> {
  line_items: ProposalLineCents[]
  /** `PRP-2001`, stable for the life of this proposal. */
  proposal_id: string
  /** `proposals.id`. Null only when we are running without a database. */
  row_id: string | null
  /** `INQ-2001`. */
  inquiry_id: string
  inquiry_row_id: string | null
  pricing: Pricing
  sent_to: string | null
  approved_by: string | null
  approved_at: string | null
  approval_note: string | null
  rejected_reason: string | null
  revision: number
  /** Rep-written prose overrides. Empty object when nobody has edited it. */
  prose: ProposalProse
  pdf_url: string | null
  /**
   * TRUE means this row is in Postgres and the next request will find it.
   * FALSE means it exists only in this function instance's memory and will be gone when the
   * instance is recycled. Every tool that returns a proposal says which it is.
   */
  persisted: boolean
  created_at: string
}

// ---------------------------------------------------------------- memory fallback

/** Cache in front of the table, and the whole store when Supabase is unconfigured.
 *  Keyed by proposal code. */
const memory = new Map<string, StoredProposal>()

/** PDF bytes, cached only so the fallback route can serve without re-rendering. Never the
 *  record: the customer's link points at Supabase Storage. */
const pdfCache = new Map<string, Uint8Array>()

export function cachePdf(code: string, bytes: Uint8Array): void {
  pdfCache.set(code, bytes)
}

export function cachedPdf(code: string): Uint8Array | null {
  return pdfCache.get(code) ?? null
}

/** Test seam. */
export function resetProposalStore(): void {
  memory.clear()
  pdfCache.clear()
}

// ---------------------------------------------------------------- identity

/** `INQ-2001` -> `PRP-2001`. One live proposal per inquiry, so the code is stable and a rep
 *  clicking generate twice gets the same reference back rather than a second proposal. */
export function proposalCodeFor(inquiryCode: string, revision = 1): string {
  const suffix = inquiryCode.replace(/^INQ-/i, '') || inquiryCode
  return revision > 1 ? `PRP-${suffix}-${revision}` : `PRP-${suffix}`
}

/** Per-instance key, used only when nothing better is configured. Links minted under it stop
 *  working when the instance recycles, which is strictly better than a guessable token. */
const EPHEMERAL_KEY = randomBytes(32).toString('hex')

function linkSecret(): string {
  return (
    process.env.PROPOSAL_LINK_SECRET?.trim() ||
    process.env.TOOL_WEBHOOK_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    EPHEMERAL_KEY
  )
}

/**
 * The capability token in a customer's PDF link. Derived rather than stored, so that it is the
 * same on every function instance without a column to hold it, and so that reading the
 * `proposals` table does not hand somebody every customer's link.
 */
export function accessTokenFor(proposalCode: string): string {
  return createHmac('sha256', linkSecret()).update(`proposal:${proposalCode}`).digest('base64url').slice(0, 32)
}

/** Constant-time check of the capability token on a customer's PDF link. */
export function tokenMatches(proposal: StoredProposal, supplied: string | null): boolean {
  if (!supplied) return false
  const expected = accessTokenFor(proposal.proposal_id)
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------- row mapping

interface ProposalRow {
  id: string
  inquiry_id: string
  status: Proposal['status']
  verdicts: RuleVerdict[]
  pricing: Pricing
  pdf_path: string | null
  sent_via: 'email' | 'sms' | null
  sent_to: string | null
  sent_at: string | null
  created_at: string
}

function fromRow(row: ProposalRow, inquiryCode: string): StoredProposal {
  const meta = row.pricing?.__proposal
  const pricing = row.pricing ?? emptyPricing()
  return {
    proposal_id: meta?.code ?? proposalCodeFor(inquiryCode),
    row_id: row.id,
    inquiry_id: meta?.inquiry_code ?? inquiryCode,
    inquiry_row_id: row.inquiry_id,
    status: row.status,
    verdicts: row.verdicts ?? [],
    pricing,
    line_items: pricing.line_items ?? [],
    discount_pct: pricing.discount_pct ?? 0,
    pdf_path: row.pdf_path,
    pdf_url: row.pdf_path,
    sent_via: row.sent_via,
    sent_to: row.sent_to,
    sent_at: row.sent_at,
    approved_by: meta?.approved_by ?? null,
    approved_at: meta?.approved_at ?? null,
    approval_note: meta?.approval_note ?? null,
    rejected_reason: meta?.rejected_reason ?? null,
    revision: meta?.revision ?? 1,
    prose: meta?.prose ?? {},
    persisted: true,
    created_at: row.created_at,
  }
}

function emptyPricing(): Pricing {
  return { line_items: [], subtotal_cents: 0, discount_pct: 0, discount_cents: 0, total_cents: 0 }
}

function toRowPayload(proposal: StoredProposal): Record<string, unknown> {
  const meta: ProposalMeta = {
    code: proposal.proposal_id,
    inquiry_code: proposal.inquiry_id,
    approved_by: proposal.approved_by,
    approved_at: proposal.approved_at,
    approval_note: proposal.approval_note,
    rejected_reason: proposal.rejected_reason,
    revision: proposal.revision,
    prose: proposal.prose,
  }
  return {
    inquiry_id: proposal.inquiry_row_id,
    status: proposal.status,
    verdicts: proposal.verdicts,
    pricing: { ...proposal.pricing, __proposal: meta },
    pdf_path: proposal.pdf_path,
    sent_via: proposal.sent_via,
    sent_to: proposal.sent_to,
    sent_at: proposal.sent_at,
  }
}

// ---------------------------------------------------------------- inquiry id resolution

/** `proposals.inquiry_id` is a uuid foreign key; everything else in this codebase speaks in
 *  `INQ-2001`. One lookup, cached for the life of the instance because inquiry ids never move. */
const inquiryIdCache = new Map<string, string>()

export async function resolveInquiryRowId(inquiryCode: string): Promise<string | null> {
  const cached = inquiryIdCache.get(inquiryCode)
  if (cached) return cached
  const db = tryGetDb()
  if (!db) return null
  const { data, error } = await db
    .from('inquiries')
    .select('id')
    .eq('inquiry_code', inquiryCode)
    .limit(1)
  if (error || !data?.[0]) return null
  const id = (data[0] as { id: string }).id
  inquiryIdCache.set(inquiryCode, id)
  return id
}

async function inquiryCodesByRowId(): Promise<Map<string, string>> {
  const db = tryGetDb()
  const out = new Map<string, string>()
  if (!db) return out
  const { data, error } = await db.from('inquiries').select('id, inquiry_code')
  if (error || !data) return out
  for (const row of data as { id: string; inquiry_code: string }[]) out.set(row.id, row.inquiry_code)
  return out
}

// ---------------------------------------------------------------- reads

/** Every proposal, newest first. Reads Postgres; falls back to memory only when there is no
 *  database configured on this deploy. */
export async function listProposals(): Promise<StoredProposal[]> {
  const db = tryGetDb()
  if (!db) return [...memory.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))

  const { data, error } = await db
    .from('proposals')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    console.warn(`[solstice] proposals read failed, falling back to memory: ${error.message}`)
    return [...memory.values()]
  }

  const codes = await inquiryCodesByRowId()
  const rows = (data as ProposalRow[]).map((row) =>
    fromRow(row, codes.get(row.inquiry_id) ?? row.inquiry_id),
  )
  for (const row of rows) memory.set(row.proposal_id, row)
  return rows
}

export async function getProposal(code: string): Promise<StoredProposal | null> {
  if (!code) return null
  const all = await listProposals()
  const hit = all.find((p) => p.proposal_id === code || p.row_id === code)
  if (hit) return hit
  // A memory-only proposal, on a deploy where the database read succeeded but this proposal was
  // never persisted. Still worth returning, still honestly labelled.
  return memory.get(code) ?? null
}

/** The live proposal for an inquiry: the most recent one that has not been sent, or the most
 *  recent one overall if they all have. */
export async function findProposalByInquiry(inquiryCode: string): Promise<StoredProposal | null> {
  const all = await listProposals()
  const mine = all.filter((p) => p.inquiry_id === inquiryCode)
  if (mine.length === 0) return null
  return mine.find((p) => p.status !== 'sent') ?? mine[0]
}

// ---------------------------------------------------------------- writes

export interface ProposalSlot {
  code: string
  revision: number
  row_id: string | null
  inquiry_row_id: string | null
  inquiry_code: string
  created_at: string
  /** True when we are updating a proposal that already existed rather than starting one. */
  replaces_existing: boolean
}

/**
 * Works out which proposal a generation is going to become, BEFORE the PDF is rendered, because
 * the code is baked into the PDF, its filename and its link.
 *
 * Idempotent per inquiry: a rep who clicks generate twice lands on the same slot and updates the
 * existing draft. The one exception is a proposal that has already gone to the customer. That
 * one is history and cannot be rewritten, so a regeneration opens the next revision.
 */
export async function reserveProposalSlot(inquiryCode: string): Promise<ProposalSlot> {
  const existing = await findProposalByInquiry(inquiryCode)
  const reusable = existing && existing.status !== 'sent' ? existing : null
  const revision = reusable ? reusable.revision : existing ? existing.revision + 1 : 1
  return {
    code: reusable ? reusable.proposal_id : proposalCodeFor(inquiryCode, revision),
    revision,
    row_id: reusable?.row_id ?? null,
    inquiry_row_id: reusable?.inquiry_row_id ?? (await resolveInquiryRowId(inquiryCode)),
    inquiry_code: inquiryCode,
    created_at: reusable?.created_at ?? new Date().toISOString(),
    replaces_existing: Boolean(reusable),
  }
}

export interface SaveInput {
  slot: ProposalSlot
  status: Proposal['status']
  verdicts: RuleVerdict[]
  pricing: Pricing
  pdf_path: string | null
  prose?: ProposalProse
}

export async function saveProposal(input: SaveInput): Promise<StoredProposal> {
  const { slot } = input
  const code = slot.code
  const revision = slot.revision
  const inquiryRowId = slot.inquiry_row_id

  const proposal: StoredProposal = {
    proposal_id: code,
    row_id: slot.row_id,
    inquiry_id: slot.inquiry_code,
    inquiry_row_id: inquiryRowId,
    status: input.status,
    verdicts: input.verdicts,
    pricing: input.pricing,
    line_items: input.pricing.line_items,
    discount_pct: input.pricing.discount_pct,
    pdf_path: input.pdf_path,
    pdf_url: input.pdf_path,
    sent_via: null,
    sent_to: null,
    sent_at: null,
    approved_by: null,
    approved_at: null,
    approval_note: null,
    rejected_reason: null,
    revision,
    prose: input.prose ?? {},
    persisted: false,
    created_at: slot.created_at,
  }

  await persist(proposal, { replaced: slot.replaces_existing })
  memory.set(code, proposal)
  return proposal
}

/** Writes the current state of a proposal to Postgres. Sets `persisted` to what actually
 *  happened, so a caller can never mistake an in-memory object for a durable one. */
async function persist(proposal: StoredProposal, opts: { replaced?: boolean } = {}): Promise<void> {
  const db = tryGetDb()
  if (!db) {
    proposal.persisted = false
    return
  }
  if (!proposal.inquiry_row_id) {
    proposal.inquiry_row_id = await resolveInquiryRowId(proposal.inquiry_id)
  }
  if (!proposal.inquiry_row_id) {
    proposal.persisted = false
    await auditLog('proposal.persist_failed', `proposal:${proposal.proposal_id}`, {
      inquiry_id: proposal.inquiry_id,
      error: `No row in \`inquiries\` has inquiry_code ${proposal.inquiry_id}, and proposals.inquiry_id is a foreign key onto it. Run scripts/data/seed.mjs.`,
    })
    return
  }

  const payload = toRowPayload(proposal)
  try {
    if (proposal.row_id) {
      const { error } = await db.from('proposals').update(payload).eq('id', proposal.row_id)
      if (error) throw new Error(error.message)
    } else {
      const { data, error } = await db.from('proposals').insert(payload).select('id, created_at')
      if (error) throw new Error(error.message)
      const row = (data?.[0] as { id: string; created_at: string } | undefined) ?? null
      if (row) {
        proposal.row_id = row.id
        proposal.created_at = row.created_at
      }
    }
    proposal.persisted = true
    if (opts.replaced) {
      await auditLog('proposal.regenerated', `proposal:${proposal.proposal_id}`, {
        inquiry_id: proposal.inquiry_id,
        status: proposal.status,
        total_cents: proposal.pricing.total_cents,
      })
    }
  } catch (err) {
    proposal.persisted = false
    await auditLog('proposal.persist_failed', `proposal:${proposal.proposal_id}`, {
      inquiry_id: proposal.inquiry_id,
      error: describeError(err),
    })
  }
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

/** The single authority on whether a proposal may be sent. */
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
      human_reason:
        'Every rule check on this block passed, so it is inside what we are allowed to approve on our own and can go out now.',
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
  await persist(proposal)
  await auditLog('proposal.submitted_for_approval', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    submitted_by: by,
    note: note ?? null,
    blocking_rules: blockingVerdicts(proposal.verdicts).map((v) => v.rule_id),
    persisted: proposal.persisted,
  })
  memory.set(proposal.proposal_id, proposal)
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
  await persist(proposal)
  await auditLog('proposal.approved', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    approved_by: by,
    note: note ?? null,
    discount_pct: proposal.discount_pct,
    overrode_rules: blockingVerdicts(proposal.verdicts).map((v) => v.rule_id),
    persisted: proposal.persisted,
  })
  memory.set(proposal.proposal_id, proposal)
  return proposal
}

export async function rejectProposal(
  proposal: StoredProposal,
  by: string,
  reason: string,
): Promise<StoredProposal> {
  proposal.status = 'rejected'
  proposal.rejected_reason = reason
  await persist(proposal)
  await auditLog('proposal.rejected', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    rejected_by: by,
    reason,
    persisted: proposal.persisted,
  })
  memory.set(proposal.proposal_id, proposal)
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
  await persist(proposal)
  await auditLog('proposal.marked_sent', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    sent_via: via,
    sent_to: sentTo ?? null,
    by,
    persisted: proposal.persisted,
  })
  memory.set(proposal.proposal_id, proposal)
  return proposal
}

/** Saves a change to an existing proposal that is not a regeneration: a prose edit, or a new
 *  PDF link after a re-render. Numbers are never touched by this path. */
export async function updateProposal(proposal: StoredProposal): Promise<StoredProposal> {
  await persist(proposal)
  memory.set(proposal.proposal_id, proposal)
  return proposal
}

/** One sentence a caller can put in front of a person. Durability is not a footnote. */
export function durabilityNote(proposal: StoredProposal): string {
  return proposal.persisted
    ? ''
    : ' Note that this proposal is only held in memory on this server, because the database is not reachable, so it will disappear if the process restarts.'
}

// ---------------------------------------------------------------- PDF hosting

export const PDF_BUCKET = 'proposals'

export interface HostedPdf {
  url: string
  /** 'storage' = a real object URL in the public `proposals` bucket, which is what the
   *  customer's link points at and what survives a cold function instance. 'function' = served
   *  back out of this deploy behind a capability token, which is a fallback only. */
  host: 'storage' | 'function'
  path: string
}

/**
 * Puts the PDF somewhere a phone can open over https.
 *
 * PREFERRED: the public Supabase Storage bucket. The object path carries the proposal code and
 * its derived access token, so the URL is unguessable, it needs no login, and it keeps working
 * after this function instance is recycled.
 *
 * FALLBACK, when Storage is not configured: a link back into this function carrying the same
 * token as a query parameter.
 */
export async function hostPdf(
  proposalCode: string,
  bytes: Uint8Array,
  filename: string,
): Promise<HostedPdf> {
  const token = accessTokenFor(proposalCode)
  const path = `${proposalCode}/${token}/${filename}`
  const db = tryGetDb()
  if (db) {
    try {
      const { error } = await db.storage
        .from(PDF_BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
      if (!error) {
        const { data } = db.storage.from(PDF_BUCKET).getPublicUrl(path)
        if (data?.publicUrl) return { url: data.publicUrl, host: 'storage', path }
      }
    } catch {
      // Falls through to the function-hosted link below.
    }
  }
  const base = (process.env.PUBLIC_BASE_URL ?? process.env.URL ?? '').replace(/\/+$/, '')
  return { url: `${base}/api/group/pdf/${proposalCode}.pdf?t=${token}`, host: 'function', path }
}
