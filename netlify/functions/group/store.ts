// Proposal state, persisted in Postgres, and the approval gate over it.
//
// Memory is a cache in front of the `proposals` table, never the record: each Netlify invocation
// may land on a fresh instance. `StoredProposal.persisted` says which one you are looking at, and
// the tools put it in front of the user.
//
// THE GATE. `canSend` trusts no stored column. At send time it re-runs the rules engine on the
// inquiry as of today and re-prices the block, then:
//
//   anything in pricing_blocked_by (a physical limit, a past arrival) ──► never sent
//   every rule passes                                                 ──► sendable
//   flags remain ──► sendable only with an approval in audit_log that signs this exact proposal,
//                    stay and flag set, by an approver role who did not create or submit it
//
// FITTING supabase/schema.sql. The table has columns for inquiry_id, status, verdicts, pricing,
// pdf_path, sent_via, sent_to and sent_at. The human-facing code (PRP-2001), who approved it and
// why it was rejected have no column, so they live under one key, `pricing.__proposal`, until a
// migration adds them. `__proposal.approved_by` is display only: the gate reads approvals from
// audit_log and checks their signature. The customer's PDF token is not stored anywhere; it is
// derived (see accessTokenFor), so reading the table does not hand anyone the link.

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { GroupInquiry, Property, Proposal, RuleVerdict, StaffRole } from '../../../shared/types'
import { APPROVER_ROLES, evaluateGroupRules, priceBlock, type EvaluationResult, type ProposalLineCents } from '../../../src/lib/rules'
import { getPropertyRate } from '../_lib/data'
import { tryGetDb } from '../_lib/db'
import { auditLog, describeError, recentAudit } from '../_delivery/audit'
import { loadInquiry, loadInquiryContact, loadInquiryContext, loadProperty } from './_deps'
import { proseProblem, type ProposalProse } from './proposal'

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
  approver_name?: string | null
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
  /** For sentences a person reads; `approved_by` is the user id. */
  approver_name?: string | null
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
    approver_name: meta?.approver_name ?? null,
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
    approver_name: proposal.approver_name ?? null,
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

// ---------------------------------------------------------------- the clock

let clock: () => Date = () => new Date()

/** "Today" for every rule check in the group function. The engine never reads the clock itself. */
export function now(): Date {
  return clock()
}

/** Test seam: pin "today" so date rules do not rot with the calendar. Null restores the real one. */
export function setClock(next: (() => Date) | null): void {
  clock = next ?? (() => new Date())
}

// ---------------------------------------------------------------- who is acting

const requestActor = new AsyncLocalStorage<string>()

/** Runs one staff request as its verified user, so a proposal drafted or submitted anywhere inside
 *  it (a button, triage, the side chat) records them as its author. */
export function actingAs<T>(actorId: string, run: () => Promise<T>): Promise<T> {
  return requestActor.run(actorId, run)
}

/** The verified user behind this request, or null for the machine caller. */
export function currentActor(): string | null {
  return requestActor.getStore() ?? null
}

// ---------------------------------------------------------------- the live rule check

/** The inquiry handed to the engine has its real email and phone redacted, so "can we reach this
 *  customer" comes from the contact seam. */
export async function contactPresent(inquiryId: string): Promise<boolean> {
  const contact = await loadInquiryContact(inquiryId)
  if (!contact) return false
  return Boolean(contact.email || contact.phone || contact.email_masked || contact.phone_masked)
}

export interface LiveCheck {
  inquiry: GroupInquiry
  property: Property | null
  evaluation: EvaluationResult
}

/**
 * The rules engine over the inquiry as it stands on `asOf`. Given a proposal's pricing, it judges
 * what the proposal actually prices: never fewer rooms or a smaller discount than the row carries.
 */
export async function evaluateLive(
  inquiryId: string,
  asOf: Date,
  pricing?: Pricing,
): Promise<LiveCheck | null> {
  const inquiry = await loadInquiry(inquiryId)
  if (!inquiry) return null
  const property = await loadProperty(inquiry.preferred_property_code)
  const context = await loadInquiryContext(inquiryId)
  const pricedRooms = pricing?.line_items[0]?.rooms ?? 0
  const judged: GroupInquiry = pricing
    ? {
        ...inquiry,
        rooms_requested:
          inquiry.rooms_requested === null ? null : Math.max(inquiry.rooms_requested, pricedRooms),
        requested_discount_pct: Math.max(inquiry.requested_discount_pct ?? 0, pricing.discount_pct),
      }
    : inquiry
  const evaluation = evaluateGroupRules({
    inquiry: judged,
    property,
    received_date: context?.date_received ?? null,
    raw_values: { rooms_requested: context?.raw_rooms },
    contact_present: await contactPresent(inquiryId),
    as_of: asOf,
  })
  return { inquiry, property, evaluation }
}

/** The block re-priced by the engine today at the discount the proposal carries, or null when it
 *  cannot be priced at all. */
function repricedTotal(live: LiveCheck, pricing: Pricing): number | null {
  const line = pricing.line_items[0]
  if (!line || !live.property) return null
  const rate = getPropertyRate(live.property.property_code, line.room_type)
  if (!rate.ok) return null
  const block = priceBlock({
    property: live.property,
    rooms: line.rooms,
    arrival_date: live.inquiry.arrival_date,
    departure_date: live.inquiry.departure_date,
    room_type: line.room_type,
    discount_pct: pricing.discount_pct,
    nightly_rack_cents: rate.nightly_rate_cents,
  })
  return block.ok ? block.total_cents : null
}

export function blockingVerdicts(verdicts: RuleVerdict[]): RuleVerdict[] {
  return verdicts.filter((v) => v.status === 'flag' || v.status === 'fail')
}

export function requiresApproval(verdicts: RuleVerdict[]): boolean {
  return blockingVerdicts(verdicts).length > 0
}

/** Verdicts no approval can lift: a physical limit, a past arrival, a blackout, missing details. */
function hardStops(evaluation: EvaluationResult): RuleVerdict[] {
  return evaluation.verdicts.filter((v) =>
    (evaluation.pricing_blocked_by as string[]).includes(v.rule_id),
  )
}

function reasons(verdicts: RuleVerdict[]): string {
  return verdicts.map((v) => v.human_reason).join(' ')
}

// ---------------------------------------------------------------- approvals

export interface Approver {
  /** The verified auth user id, never a name taken from a request body. */
  id: string
  role: StaffRole
  name: string | null
}

export interface AuditRow {
  action: string
  detail: Record<string, unknown>
}

/** Audit rows about one proposal with one of `actions`, oldest first. Null when the log cannot be
 *  read, which every caller treats as "not proven". */
export type AuditReader = (proposalId: string, actions: readonly string[]) => Promise<AuditRow[] | null>

export const readProposalAudit: AuditReader = async (proposalId, actions) => {
  const subject = `proposal:${proposalId}`
  const db = tryGetDb()
  if (!db) {
    return recentAudit(Number.MAX_SAFE_INTEGER)
      .filter((e) => e.subject === subject && actions.includes(e.action))
      .reverse()
  }
  const { data, error } = await db
    .from('audit_log')
    .select('action, detail')
    .eq('subject', subject)
    .in('action', [...actions])
    .order('created_at', { ascending: true })
  return error ? null : ((data ?? []) as AuditRow[])
}

/** Doing any of these to a proposal makes you its author, and an author cannot approve it. */
const AUTHORING_ACTIONS = [
  'proposal.generated',
  'proposal.submitted_for_approval',
  'proposal.override',
  'proposal.edited',
  'proposal.action.submit_for_approval',
  'proposal.action.override',
]

/** What an approval is given for: the stay, and each flag with the numbers it was judged on. */
export interface ApprovalTerms {
  stay: [property: string, arrival: string | null, departure: string | null]
  flags: [rule: string, actual: string | number, threshold: string | number][]
}

export function approvalTerms(live: LiveCheck): ApprovalTerms {
  return {
    stay: [live.inquiry.preferred_property_code, live.inquiry.arrival_date, live.inquiry.departure_date],
    flags: blockingVerdicts(live.evaluation.verdicts)
      .map((v): ApprovalTerms['flags'][number] => [v.rule_id, v.actual, v.threshold])
      .sort((a, b) => a[0].localeCompare(b[0])),
  }
}

/**
 * What an approval signs: these terms, and this proposal's price, rooms and words. A later change
 * to any of them (new dates, a lower seasonal ceiling, an override, an edit) voids the approval,
 * and a row a browser inserts into audit_log (which RLS allows) cannot carry a valid one.
 */
export function approvalSignature(p: StoredProposal, approverId: string, terms: ApprovalTerms): string {
  const material = {
    proposal: p.proposal_id,
    approver: approverId,
    terms,
    total_cents: p.pricing.total_cents,
    discount_pct: p.pricing.discount_pct,
    lines: p.pricing.line_items.map((l) => [l.room_type, l.rooms, l.nights, l.net_total_cents]),
    prose: [p.prose.intro ?? null, p.prose.body ?? null, p.prose.customer_notes ?? null],
  }
  return createHmac('sha256', linkSecret())
    .update(`approval:${JSON.stringify(material)}`)
    .digest('base64url')
}

/** Who approved this proposal as it stands, from a signed row in audit_log recorded after its last
 *  rejection, or null. */
async function signedApproval(p: StoredProposal, terms: ApprovalTerms, read: AuditReader): Promise<string | null> {
  const rows = (await read(p.proposal_id, ['proposal.approved', 'proposal.rejected'])) ?? []
  const sinceRejection = rows.slice(rows.map((r) => r.action).lastIndexOf('proposal.rejected') + 1)
  const row = sinceRejection.find((r) => {
    const by = r.detail.approved_by
    return typeof by === 'string' && r.detail.signature === approvalSignature(p, by, terms)
  })
  return row ? String(row.detail.approver_name ?? row.detail.approved_by) : null
}

export interface GateDeps {
  /** "Today". Defaults to the group clock. */
  now?: Date
  /** Where approvals and authorship are read from. Defaults to audit_log. */
  audit?: AuditReader
}

export type ApprovalCheck =
  | { ok: true; terms: ApprovalTerms }
  | { ok: false; status: 403 | 409 | 503; reason: string }

/** Whether `approver` may approve `proposal` as it stands today. Each refusal says why. */
export async function checkApproval(
  proposal: StoredProposal,
  approver: Approver,
  deps: GateDeps = {},
): Promise<ApprovalCheck> {
  const id = proposal.proposal_id
  if (!APPROVER_ROLES.includes(approver.role)) {
    return {
      ok: false,
      status: 403,
      reason: `Only a general manager can approve a group block that is outside the property's limits (Policy 13). You are signed in as ${approver.role.replace('_', ' ')}, so submit ${id} for approval instead.`,
    }
  }
  const authored = await (deps.audit ?? readProposalAudit)(id, AUTHORING_ACTIONS)
  if (!authored) {
    return {
      ok: false,
      status: 503,
      reason: `We could not read the audit log for ${id}, so we cannot confirm you did not create or submit it. Nothing was approved.`,
    }
  }
  if (authored.some((row) => row.detail.actor_id === approver.id)) {
    return {
      ok: false,
      status: 403,
      reason: `You created or submitted ${id}, so you cannot also approve it. Another general manager has to sign it off.`,
    }
  }
  if (proposal.status === 'sent' || proposal.status === 'rejected') {
    return { ok: false, status: 409, reason: `${id} has already been ${proposal.status}, so there is nothing to approve.` }
  }
  const live = await evaluateLive(proposal.inquiry_id, deps.now ?? now(), proposal.pricing)
  if (!live) {
    return {
      ok: false,
      status: 409,
      reason: `Inquiry ${proposal.inquiry_id} is no longer on file, so ${id} cannot be checked or approved.`,
    }
  }
  const stops = hardStops(live.evaluation)
  if (stops.length > 0) {
    return { ok: false, status: 409, reason: `${id} cannot be approved. ${reasons(stops)} No approval can lift that.` }
  }
  return { ok: true, terms: approvalTerms(live) }
}

export interface GateDecision {
  allowed: boolean
  /** Safe to show a salesperson. */
  human_reason: string
  /** The live verdicts in the way, or when allowed, the flags an approval lifted. */
  blocking: RuleVerdict[]
  /** True when the one thing missing is an approval. */
  needs_approval: boolean
}

/** The single authority on whether a proposal may be sent. See the note at the top of this file. */
export async function canSend(proposal: StoredProposal, deps: GateDeps = {}): Promise<GateDecision> {
  const id = proposal.proposal_id
  const refuse = (human_reason: string, blocking: RuleVerdict[] = [], needs_approval = false): GateDecision => ({
    allowed: false,
    human_reason,
    blocking,
    needs_approval,
  })

  if (proposal.status === 'sent') {
    return refuse(
      `Proposal ${id} has already gone out to the customer. Sending it again would be the second copy they receive, so if something has changed we should generate a fresh proposal rather than resend this one.`,
    )
  }
  if (proposal.status === 'rejected') {
    return refuse(
      `Proposal ${id} was turned down internally${proposal.rejected_reason ? `: ${proposal.rejected_reason}` : ''}. It cannot be sent as it stands.`,
    )
  }

  const wording = proseProblem(proposal.prose)
  if (wording) return refuse(`Proposal ${id} cannot go out with the words it has. ${wording} Edit the letter first.`)

  const live = await evaluateLive(proposal.inquiry_id, deps.now ?? now(), proposal.pricing)
  if (!live) {
    return refuse(
      `Inquiry ${proposal.inquiry_id} is no longer on file, so ${id} cannot be re-checked, and nothing goes out unchecked.`,
    )
  }

  const stops = hardStops(live.evaluation)
  if (stops.length > 0) return refuse(`This one cannot go out. ${reasons(stops)} No approval can change that.`, stops)

  if (repricedTotal(live, proposal.pricing) !== proposal.pricing.total_cents) {
    return refuse(
      `The price on ${id} no longer matches what the rules engine produces for this inquiry today, so it has to be regenerated before it can go out.`,
    )
  }

  const blocking = blockingVerdicts(live.evaluation.verdicts)
  if (blocking.length === 0) {
    return {
      allowed: true,
      human_reason:
        'Every rule check on this block passes as of today, so it is inside what we are allowed to approve on our own and can go out now.',
      blocking,
      needs_approval: false,
    }
  }

  const approver = await signedApproval(proposal, approvalTerms(live), deps.audit ?? readProposalAudit)
  if (approver) {
    return {
      allowed: true,
      human_reason: `This proposal was outside our own authority, and ${approver} approved it exactly as it stands. It can go out now.`,
      blocking,
      needs_approval: false,
    }
  }

  return refuse(
    `This one cannot go out yet. ${reasons(blocking)} Someone with the authority to sign that off has to approve it first, and until they do, we hold the proposal rather than send it.`,
    blocking,
    true,
  )
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
    actor_id: currentActor(),
    note: note ?? null,
    blocking_rules: blockingVerdicts(proposal.verdicts).map((v) => v.rule_id),
    persisted: proposal.persisted,
  })
  memory.set(proposal.proposal_id, proposal)
  return proposal
}

/** Records an approval. Call `checkApproval` first: this writes what it is given. */
export async function approveProposal(
  proposal: StoredProposal,
  approver: Approver,
  terms: ApprovalTerms,
  note?: string,
): Promise<StoredProposal> {
  proposal.status = 'approved'
  proposal.approved_by = approver.id
  proposal.approver_name = approver.name
  proposal.approved_at = now().toISOString()
  proposal.approval_note = note ?? null
  await persist(proposal)
  await auditLog('proposal.approved', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    approved_by: approver.id,
    approver_name: approver.name,
    approver_role: approver.role,
    terms,
    signature: approvalSignature(proposal, approver.id, terms),
    note: note ?? null,
    discount_pct: proposal.discount_pct,
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
