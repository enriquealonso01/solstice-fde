// The GROUP_TOOLS from shared/toolContracts.ts.
//
// Every one returns the `ToolResult` envelope. `grounded:false` is used where it is meant to be
// used: we have real data, it just does not answer the question asked, and the agent must say so
// rather than fill the gap. The canonical case is SOL-PVD's Boston referral, where the referral
// is citable and the inventory at the referred hotel simply does not exist in anything we hold.
//
// No tool here consults a language model. The ten inquiry outcomes are arithmetic and table
// lookups, which is why they are testable and why they will behave the same during the demo as
// they did this morning.

import type { GroupInquiry, Property, RuleVerdict, ToolResult } from '../../../shared/types'
import {
  assessCompleteness,
  buildDecisionOptions,
  evaluateGroupRules,
  findAlternates,
  describeAlternates,
  getPropertyRules,
  parseDate,
  priceBlock,
  speakDate,
  validatePropertyData,
  nightsBetween,
  formatUsd,
  type DecisionOption,
  type EvaluationResult,
  type PricedBlock,
} from '../../../src/lib/rules'
import { getPropertyRate } from '../_lib/data'
import { deliver, type DeliveryOutcome } from '../_delivery'
import { auditLog } from '../_delivery/audit'
import {
  fail,
  inquiryCitation,
  loadInquiry,
  loadInquiries,
  loadInquiryContact,
  loadInquiryContext,
  loadProperties,
  loadProperty,
  ok,
  policyCitation,
  propertyCitation,
  ungrounded,
} from './_deps'
import {
  buildProposalDocument,
  pdfFilename,
  renderProposalHtml,
  renderProposalPdf,
  renderProposalText,
  toBase64,
} from './proposal'
import {
  approveProposal,
  canSend,
  findProposalByInquiry,
  getProposal,
  hostPdf,
  markAwaitingApproval,
  markSent,
  newAccessToken,
  nextProposalId,
  putProposal,
  rejectProposal,
  requiresApproval,
  type StoredProposal,
} from './store'

/** The inquiry records handed to the engine have their real email and phone redacted, so
 *  "do we have any way of reaching this customer" has to come from the contact seam. */
async function contactPresent(inquiryId: string): Promise<boolean> {
  const contact = await loadInquiryContact(inquiryId)
  if (!contact) return false
  return Boolean(contact.email || contact.phone || contact.email_masked || contact.phone_masked)
}

// ---------------------------------------------------------------- 1. parse_inquiry

export interface ParseInquiryArgs {
  /** An existing inquiry to re-parse, or... */
  inquiry_id?: string
  /** ...a partial record captured from a form, an email, or a phone call. */
  raw?: Partial<Record<string, unknown>>
}

/** Room counts arrive as "around 25", "25-30", "a couple of dozen". Only an unambiguous whole
 *  number is accepted. Anything else returns null, which becomes a question, not a guess. */
export function parseRoomCount(value: unknown): { rooms: number | null; raw: string | null } {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { rooms: Math.round(value), raw: String(value) }
  }
  if (typeof value !== 'string') return { rooms: null, raw: null }
  const raw = value.trim()
  if (!raw) return { rooms: null, raw: null }
  if (/^\d+$/.test(raw)) return { rooms: Number(raw), raw }
  // "around 25", "~25", "25ish", "25-30" are all approximations. We refuse to hold
  // inventory against an approximation.
  return { rooms: null, raw }
}

function parsePct(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.trim().match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

function parseCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export async function parse_inquiry(args: ParseInquiryArgs): Promise<ToolResult<{
  inquiry: GroupInquiry
  raw_rooms: string | null
  missing_fields: string[]
  questions: string[]
}>> {
  if (args.inquiry_id) {
    const existing = await loadInquiry(args.inquiry_id)
    if (!existing) return fail(`We have no record of an enquiry with the reference ${args.inquiry_id}.`)
    const context = await loadInquiryContext(args.inquiry_id)
    const completeness = assessCompleteness(
      existing,
      { rooms_requested: context?.raw_rooms },
      { contact_present: await contactPresent(existing.inquiry_id) },
    )
    return ok(
      {
        inquiry: existing,
        raw_rooms: context?.raw_rooms ?? null,
        missing_fields: existing.missing_fields,
        questions: completeness.questions,
      },
      { citations: [inquiryCitation(existing.inquiry_id, existing.company_name)] },
    )
  }

  const raw = args.raw ?? {}
  const { rooms, raw: rawRooms } = parseRoomCount(raw.rooms_requested)
  const arrival = parseDate(str(raw.arrival_date))
  const departure = parseDate(str(raw.departure_date))

  const inquiry: GroupInquiry = {
    inquiry_id: str(raw.inquiry_id) ?? `INQ-${Date.now().toString().slice(-6)}`,
    source: (str(raw.source) as GroupInquiry['source']) ?? 'manual',
    company_name: str(raw.company_name) ?? 'Unnamed group',
    contact_name: str(raw.contact_name) ?? '',
    contact_email: str(raw.contact_email),
    contact_phone: str(raw.contact_phone),
    event_type: str(raw.event_type) ?? 'Group booking',
    preferred_property_code: str(raw.preferred_property_code) ?? '',
    alternate_property_ok: raw.alternate_property_ok === true || raw.alternate_property_ok === 'Y',
    arrival_date: arrival ? str(raw.arrival_date) : null,
    departure_date: departure ? str(raw.departure_date) : null,
    rooms_requested: rooms,
    room_type_preference: str(raw.room_type_preference),
    requested_discount_pct: parsePct(raw.requested_discount_pct),
    meeting_capacity_needed: parseCount(raw.meeting_capacity_needed),
    special_requests: str(raw.special_requests),
    missing_fields: [],
  }

  const missing: string[] = []
  if (!inquiry.arrival_date) missing.push('arrival_date')
  if (!inquiry.departure_date) missing.push('departure_date')
  if (inquiry.rooms_requested === null) missing.push('rooms_requested')
  if (!inquiry.room_type_preference) missing.push('room_type_preference')
  if (inquiry.requested_discount_pct === null) missing.push('requested_discount_pct')
  if (raw.meeting_space_needed === true || raw.meeting_space_needed === 'Y') {
    if (inquiry.meeting_capacity_needed === null) missing.push('meeting_capacity_needed')
  }
  if (!inquiry.contact_email && !inquiry.contact_phone) missing.push('contact_channel')
  inquiry.missing_fields = missing

  const completeness = assessCompleteness(
    inquiry,
    { rooms_requested: rawRooms ?? undefined },
    { contact_present: Boolean(inquiry.contact_email || inquiry.contact_phone) },
  )

  return ok({
    inquiry,
    raw_rooms: rawRooms,
    missing_fields: missing,
    questions: completeness.questions,
  })
}

// ---------------------------------------------------------------- 2. validate_property_data

export async function validate_property_data(args: { property_code: string }): Promise<
  ToolResult<{
    property_code: string
    ok: boolean
    quarantined: { field: string; value: number; reason: string; human_reason: string }[]
    usable_rate_fields: string[]
  }>
> {
  const property = await loadProperty(args.property_code)
  if (!property) {
    return fail(
      `We have no record of a Solstice hotel with the code ${args.property_code}, so there is nothing to check.`,
    )
  }
  const validation = validatePropertyData(property)
  return ok(
    {
      property_code: validation.property_code,
      ok: validation.ok,
      quarantined: validation.quarantined.map((q) => ({
        field: q.field,
        value: q.value,
        reason: q.reason,
        human_reason: q.human_reason,
      })),
      usable_rate_fields: validation.usable_rate_fields,
    },
    { citations: [propertyCitation(property.property_code, property.property_name)] },
  )
}

// ---------------------------------------------------------------- 3. check_availability

export interface CheckAvailabilityArgs {
  property_code: string
  room_type?: string | null
  rooms?: number | null
  arrival_date?: string | null
  departure_date?: string | null
}

/**
 * NET-NEW TOOL, and honest about its own limits.
 *
 * The provided exports carry room-type COUNTS for each hotel and nothing at all about which
 * rooms are sold on which night. So this answers the question it can answer ("does the building
 * even contain this many of that room type?") with `grounded:true`, and marks the date-level
 * question `grounded:false` so the agent has to say "I need to confirm that" instead of
 * inventing an availability number. In production this call goes to the PMS.
 */
export async function check_availability(args: CheckAvailabilityArgs): Promise<
  ToolResult<{
    property_code: string
    room_type: string
    rooms_requested: number
    rooms_of_type_in_building: number
    fits_in_building: boolean
    nights: number
    date_level_availability: 'unknown_not_in_provided_data'
    human_reason: string
  }>
> {
  const property = await loadProperty(args.property_code)
  const rules = getPropertyRules(args.property_code)
  if (!property || !rules) {
    return fail(`We have no record of a Solstice hotel with the code ${args.property_code}.`)
  }

  const roomType = args.room_type?.trim() || 'Standard King'
  const rooms = args.rooms ?? 0
  const inBuilding = rules.inventory[roomType] ?? 0
  const arrival = parseDate(args.arrival_date ?? null)
  const departure = parseDate(args.departure_date ?? null)
  const nights = arrival && departure ? nightsBetween(arrival, departure) : 0
  const fits = rooms > 0 ? rooms <= inBuilding : true

  const payload = {
    property_code: property.property_code,
    room_type: roomType,
    rooms_requested: rooms,
    rooms_of_type_in_building: inBuilding,
    fits_in_building: fits,
    nights,
    date_level_availability: 'unknown_not_in_provided_data' as const,
    human_reason: fits
      ? `${property.property_name} has ${inBuilding} ${roomType} rooms in total, so a block of ${rooms} fits the building. What I cannot tell you from here is how many of those are already sold on those particular nights, because that lives in the property management system and not in anything I can see. I would want that confirmed before we promise the rooms.`
      : `${property.property_name} only has ${inBuilding} ${roomType} rooms in the entire building, and the request is for ${rooms}. That does not fit regardless of how the nights are selling, so we would need to split the block across room types or look at a larger hotel.`,
  }

  const citations = [propertyCitation(property.property_code, property.property_name)]

  // The building-size answer is grounded. The night-by-night answer is not, and saying so is
  // the entire point of the envelope.
  return fits
    ? ungrounded(payload, { citations })
    : ok(payload, { citations })
}

// ---------------------------------------------------------------- 4. evaluate_group_rules

export interface EvaluateArgs {
  inquiry_id?: string
  inquiry?: GroupInquiry
  received_date?: string | null
}

export interface EvaluationPayload extends EvaluationResult {
  property_name: string
  requires_approval: boolean
  /** Populated only when the ONE thing standing in the way is the discount. This is the
   *  judgment moment: three costed choices instead of a yes/no. */
  decision_options: DecisionOption[]
  summary: string
}

export async function evaluate_group_rules(args: EvaluateArgs): Promise<ToolResult<EvaluationPayload>> {
  const inquiry = args.inquiry ?? (args.inquiry_id ? await loadInquiry(args.inquiry_id) : null)
  if (!inquiry) {
    return fail(
      `We have no record of an enquiry with the reference ${args.inquiry_id ?? '(none supplied)'}.`,
    )
  }

  const property = await loadProperty(inquiry.preferred_property_code)
  const rules = getPropertyRules(inquiry.preferred_property_code)
  const context = await loadInquiryContext(inquiry.inquiry_id)

  const result = evaluateGroupRules({
    inquiry,
    property,
    received_date: args.received_date ?? context?.date_received ?? null,
    raw_values: { rooms_requested: context?.raw_rooms },
    contact_present: await contactPresent(inquiry.inquiry_id),
  })

  const blocking = result.verdicts.filter((v) => v.status === 'flag' || v.status === 'fail')
  const onlyDiscount =
    blocking.length === 1 && blocking[0].rule_id === 'GRP-DISCOUNT-CEILING' && blocking[0].status === 'flag'

  let options: DecisionOption[] = []
  if (onlyDiscount && property && rules) {
    const rate = sanctionedRate(property.property_code, inquiry.room_type_preference)
    options = buildDecisionOptions({
      inquiry,
      property,
      rules,
      ceiling_pct: result.effective_discount_pct_ceiling,
      requested_pct: inquiry.requested_discount_pct ?? 0,
      general_manager: property.general_manager,
      nightly_rack_cents: rate.ok ? rate.cents : undefined,
    })
  }

  const payload: EvaluationPayload = {
    ...result,
    property_name: rules?.property_name ?? inquiry.preferred_property_code,
    requires_approval: requiresApproval(result.verdicts),
    decision_options: options,
    summary: summarise(result, blocking, onlyDiscount),
  }

  const citations = [inquiryCitation(inquiry.inquiry_id, inquiry.company_name)]
  if (property) citations.push(propertyCitation(property.property_code, property.property_name))
  if (blocking.length > 0) {
    citations.push(
      policyCitation('13', 'Group block approval authority sits with Sales and the General Manager'),
    )
  }

  return ok(payload, { citations })
}

function summarise(result: EvaluationResult, blocking: RuleVerdict[], onlyDiscount: boolean): string {
  if (result.decision === 'auto_approve') {
    return 'Every check passed. This one is inside what we can approve on our own, so it can be priced and sent today.'
  }
  if (onlyDiscount) {
    const v = blocking[0]
    return `The only thing standing in the way is the discount: they asked for ${v.actual}% and we can approve ${v.threshold}%. Everything else about this booking is straightforward, so the sensible response is a choice of three, not a refusal.`
  }
  const fails = result.verdicts.filter((v) => v.status === 'fail')
  if (fails.length > 0) {
    return `We cannot send a priced proposal for this as it stands. ${fails.map((v) => v.human_reason).join(' ')}`
  }
  return `This needs a sign-off before it can go out. ${blocking.map((v) => v.human_reason).join(' ')}`
}

// ---------------------------------------------------------------- rate access

/**
 * `getPropertyRate()` is the ONLY sanctioned way to a nightly rate. Reading
 * `property.base_rate_suite` directly is a bug, because that column carries SOL-PVD's -395 and
 * the quarantine lives in the lookup. Everything in this file that needs a rate goes here.
 */
function sanctionedRate(
  propertyCode: string,
  roomType: string | null | undefined,
): { ok: true; cents: number } | { ok: false; reason: string } {
  const lookup = getPropertyRate(propertyCode, roomType ?? 'Standard King')
  return lookup.ok ? { ok: true, cents: lookup.nightly_rate_cents } : { ok: false, reason: lookup.reason }
}

// ---------------------------------------------------------------- 5. price_block

export interface PriceBlockArgs {
  inquiry_id?: string
  property_code?: string
  rooms?: number
  nights?: number
  arrival_date?: string | null
  departure_date?: string | null
  room_type?: string | null
  discount_pct?: number
}

export async function price_block(args: PriceBlockArgs): Promise<ToolResult<PricedBlock & { human_summary: string }>> {
  let property: Property | null = null
  let rooms = args.rooms ?? 0
  let arrival = args.arrival_date ?? null
  let departure = args.departure_date ?? null
  let roomType = args.room_type ?? null
  let discount = args.discount_pct

  if (args.inquiry_id) {
    const inquiry = await loadInquiry(args.inquiry_id)
    if (!inquiry) return fail(`We have no record of an enquiry with the reference ${args.inquiry_id}.`)
    property = await loadProperty(inquiry.preferred_property_code)
    rooms = args.rooms ?? inquiry.rooms_requested ?? 0
    arrival = arrival ?? inquiry.arrival_date
    departure = departure ?? inquiry.departure_date
    roomType = roomType ?? inquiry.room_type_preference
    if (discount === undefined) {
      const evaluation = evaluateGroupRules({
        inquiry,
        property,
        contact_present: await contactPresent(inquiry.inquiry_id),
      })
      // Default to the compliant number, never the one we are not allowed to give.
      discount = Math.min(inquiry.requested_discount_pct ?? 0, evaluation.effective_discount_pct_ceiling)
    }
  } else if (args.property_code) {
    property = await loadProperty(args.property_code)
  }

  if (!property) return fail('We need to know which hotel this block is for before we can price it.')

  const rate = sanctionedRate(property.property_code, roomType)
  if (!rate.ok) {
    return fail(rate.reason, {
      citations: [propertyCitation(property.property_code, property.property_name)],
    })
  }

  const block = priceBlock({
    property,
    rooms,
    nights: args.nights,
    arrival_date: arrival,
    departure_date: departure,
    room_type: roomType,
    discount_pct: discount ?? 0,
    nightly_rack_cents: rate.cents,
  })

  if (!block.ok) {
    return fail(block.error ?? 'We were not able to price this block.', {
      citations: [propertyCitation(property.property_code, property.property_name)],
    })
  }

  return ok(
    {
      ...block,
      human_summary: `${block.rooms} ${block.room_type} rooms for ${block.nights} night${block.nights === 1 ? '' : 's'} at ${property.property_name} comes to ${formatUsd(block.total_cents)}, which is ${formatUsd(block.nightly_net_cents)} per room per night${block.discount_pct > 0 ? ` after ${block.discount_pct}% off the ${formatUsd(block.nightly_rack_cents)} rate` : ''}.`,
    },
    { citations: [propertyCitation(property.property_code, property.property_name)] },
  )
}

// ---------------------------------------------------------------- 6. find_alternates

export async function find_alternates(args: { inquiry_id: string; limit?: number }): Promise<
  ToolResult<ReturnType<typeof findAlternates> & { human_summary: string }>
> {
  const inquiry = await loadInquiry(args.inquiry_id)
  if (!inquiry) return fail(`We have no record of an enquiry with the reference ${args.inquiry_id}.`)
  const properties = await loadProperties()
  const rules = getPropertyRules(inquiry.preferred_property_code)

  const result = findAlternates({ inquiry, properties, limit: args.limit })
  const citations = result.alternate_properties.map((alt) =>
    propertyCitation(alt.property_code, alt.property_name),
  )
  if (rules) citations.unshift(propertyCitation(rules.property_code, rules.property_name))

  return ok({ ...result, human_summary: describeAlternates(result, rules) }, { citations })
}

// ---------------------------------------------------------------- 7. draft_clarifying_questions

export async function draft_clarifying_questions(args: { inquiry_id?: string; inquiry?: GroupInquiry }): Promise<
  ToolResult<{
    inquiry_id: string
    complete: boolean
    blocking_missing: string[]
    questions: string[]
    email_body: string
  }>
> {
  const inquiry = args.inquiry ?? (args.inquiry_id ? await loadInquiry(args.inquiry_id) : null)
  if (!inquiry) {
    return fail(`We have no record of an enquiry with the reference ${args.inquiry_id ?? '(none supplied)'}.`)
  }
  const context = await loadInquiryContext(inquiry.inquiry_id)
  const completeness = assessCompleteness(
    inquiry,
    { rooms_requested: context?.raw_rooms },
    { contact_present: await contactPresent(inquiry.inquiry_id) },
  )

  const numbered = completeness.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
  const email_body = completeness.questions.length
    ? [
        `Hello ${inquiry.contact_name || 'there'},`,
        '',
        `Thank you for getting in touch about ${inquiry.company_name}. I would love to put a proposal together for you, and there are just a few things I need before I can quote properly and hold the rooms:`,
        '',
        numbered,
        '',
        'As soon as I have those I will come straight back with the rate and the block.',
        '',
        'With best wishes,',
        'Sol',
        'Solstice Group Sales',
      ].join('\n')
    : ''

  return ok(
    {
      inquiry_id: inquiry.inquiry_id,
      complete: completeness.complete,
      blocking_missing: completeness.blocking_missing,
      questions: completeness.questions,
      email_body,
    },
    { citations: [inquiryCitation(inquiry.inquiry_id, inquiry.company_name)] },
  )
}

// ---------------------------------------------------------------- 8. generate_proposal

export interface GenerateProposalArgs {
  inquiry_id: string
  /** Rep's chosen discount, e.g. after picking one of the three options. Defaults to the
   *  most we are allowed to approve for these dates, never to the number they asked for. */
  discount_pct?: number
  /** Recorded on the proposal when the rep took an option off the judgment list. */
  chosen_option?: string
  prepared_on?: string
}

export interface GenerateProposalPayload {
  proposal_id: string
  status: StoredProposal['status']
  requires_approval: boolean
  verdicts: RuleVerdict[]
  discount_pct: number
  total: number
  total_display: string
  pdf_url: string | null
  pdf_bytes_length: number
  html: string
  text: string
  human_summary: string
}

export async function generate_proposal(
  args: GenerateProposalArgs,
): Promise<ToolResult<GenerateProposalPayload>> {
  const inquiry = await loadInquiry(args.inquiry_id)
  if (!inquiry) return fail(`We have no record of an enquiry with the reference ${args.inquiry_id}.`)

  const property = await loadProperty(inquiry.preferred_property_code)
  if (!property) {
    return fail(
      `We have no record of a Solstice hotel with the code ${inquiry.preferred_property_code}, so we cannot quote for it.`,
    )
  }

  const context = await loadInquiryContext(inquiry.inquiry_id)
  const evaluation = evaluateGroupRules({
    inquiry,
    property,
    received_date: context?.date_received ?? null,
    raw_values: { rooms_requested: context?.raw_rooms },
    contact_present: await contactPresent(inquiry.inquiry_id),
  })

  // Refuse to price what the rules say must not be priced.
  if (evaluation.pricing_blocked_by.length > 0) {
    const blockers = evaluation.verdicts.filter((v) => evaluation.pricing_blocked_by.includes(v.rule_id as never))
    const alternates = findAlternates({ inquiry, properties: await loadProperties() })
    const rules = getPropertyRules(inquiry.preferred_property_code)
    await auditLog('proposal.refused', `inquiry:${inquiry.inquiry_id}`, {
      reason: evaluation.pricing_blocked_by,
      decision: evaluation.decision,
    })
    return fail(
      `${blockers.map((v) => v.human_reason).join(' ')} ${describeAlternates(alternates, rules)}`.trim(),
      {
        citations: [
          inquiryCitation(inquiry.inquiry_id, inquiry.company_name),
          propertyCitation(property.property_code, property.property_name),
        ],
      },
    )
  }

  const discount =
    args.discount_pct ??
    Math.min(inquiry.requested_discount_pct ?? 0, evaluation.effective_discount_pct_ceiling)

  const rate = sanctionedRate(property.property_code, inquiry.room_type_preference)
  if (!rate.ok) {
    return fail(rate.reason, {
      citations: [propertyCitation(property.property_code, property.property_name)],
    })
  }

  const block = priceBlock({
    property,
    rooms: inquiry.rooms_requested ?? 0,
    arrival_date: inquiry.arrival_date,
    departure_date: inquiry.departure_date,
    room_type: inquiry.room_type_preference,
    discount_pct: discount,
    nightly_rack_cents: rate.cents,
  })
  if (!block.ok) {
    return fail(block.error ?? 'We were not able to price this block.', {
      citations: [propertyCitation(property.property_code, property.property_name)],
    })
  }

  // Only things a customer should actually read. Internal thresholds stay internal.
  const customerNotes: string[] = []
  if (inquiry.special_requests) {
    customerNotes.push(`We have noted your request: ${inquiry.special_requests}.`)
  }
  for (const referral of evaluation.referrals) customerNotes.push(referral)

  const proposalId = nextProposalId()
  const document = buildProposalDocument({
    proposal_id: proposalId,
    inquiry,
    property,
    block,
    verdicts: evaluation.verdicts,
    required_follow_ups: evaluation.required_follow_ups,
    customer_notes: customerNotes,
    prepared_on: args.prepared_on ? new Date(args.prepared_on) : undefined,
  })

  const accessToken = newAccessToken()
  let pdfBytes: Uint8Array | null = null
  let pdfUrl: string | null = null
  try {
    pdfBytes = await renderProposalPdf(document)
    const hosted = await hostPdf(proposalId, pdfBytes, pdfFilename(document), accessToken)
    pdfUrl = hosted.url
  } catch (err) {
    // A PDF that will not render must not take the proposal down with it: the email still
    // carries the full quote in its body.
    await auditLog('proposal.pdf_failed', `proposal:${proposalId}`, {
      inquiry_id: inquiry.inquiry_id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const html = renderProposalHtml(document, pdfUrl)
  const text = renderProposalText(document, pdfUrl)
  const needsApproval = requiresApproval(evaluation.verdicts)

  const stored: StoredProposal = {
    proposal_id: proposalId,
    inquiry_id: inquiry.inquiry_id,
    status: needsApproval ? 'awaiting_approval' : 'draft',
    verdicts: evaluation.verdicts,
    line_items: block.line_items,
    subtotal: block.subtotal,
    discount_pct: block.discount_pct,
    total: block.total,
    // Integer cents. The dollar fields above exist only to satisfy shared/types.ts.
    pricing: {
      line_items: block.line_items,
      subtotal_cents: block.subtotal_cents,
      discount_pct: block.discount_pct,
      discount_cents: block.discount_cents,
      total_cents: block.total_cents,
      requested_discount_pct:
        inquiry.requested_discount_pct !== null &&
        inquiry.requested_discount_pct !== block.discount_pct
          ? inquiry.requested_discount_pct
          : undefined,
    },
    pdf_path: pdfUrl,
    sent_via: null,
    sent_to: null,
    access_token: accessToken,
    sent_at: null,
    document,
    pdf_bytes: pdfBytes,
    pdf_url: pdfUrl,
    approved_by: null,
    approved_at: null,
    approval_note: null,
    rejected_reason: null,
    history: [
      {
        at: new Date().toISOString(),
        event: 'generated',
        by: null,
        detail: args.chosen_option ? `option: ${args.chosen_option}` : undefined,
      },
    ],
  }
  putProposal(stored)

  await auditLog('proposal.generated', `proposal:${proposalId}`, {
    inquiry_id: inquiry.inquiry_id,
    property_code: property.property_code,
    discount_pct: discount,
    total: block.total,
    requires_approval: needsApproval,
    chosen_option: args.chosen_option ?? null,
    pdf_hosted: Boolean(pdfUrl),
  })

  return ok(
    {
      proposal_id: proposalId,
      status: stored.status,
      requires_approval: needsApproval,
      verdicts: evaluation.verdicts,
      discount_pct: discount,
      total: block.total,
      total_display: formatUsd(block.total_cents),
      pdf_url: pdfUrl,
      pdf_bytes_length: pdfBytes?.length ?? 0,
      html,
      text,
      human_summary: needsApproval
        ? `Proposal ${proposalId} is drafted at ${formatUsd(block.total_cents)}, and it is waiting on an approval before it can go anywhere. ${canSend(stored).human_reason}`
        : `Proposal ${proposalId} is ready at ${formatUsd(block.total_cents)}. Every rule check passed, so it can go straight out.`,
    },
    {
      citations: [
        inquiryCitation(inquiry.inquiry_id, inquiry.company_name),
        propertyCitation(property.property_code, property.property_name),
      ],
    },
  )
}

// ---------------------------------------------------------------- 9. submit_for_approval

export async function submit_for_approval(args: {
  proposal_id: string
  submitted_by?: string | null
  note?: string
}): Promise<ToolResult<{ proposal_id: string; status: string; blocking: RuleVerdict[]; human_summary: string }>> {
  const proposal = getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)

  const gate = canSend(proposal)
  if (gate.blocking.length === 0) {
    return ok({
      proposal_id: proposal.proposal_id,
      status: proposal.status,
      blocking: [],
      human_summary: `Proposal ${proposal.proposal_id} does not need an approval. Every check passed, so it can be sent as it stands.`,
    })
  }

  await markAwaitingApproval(proposal, args.submitted_by ?? null, args.note)
  return ok({
    proposal_id: proposal.proposal_id,
    status: proposal.status,
    blocking: gate.blocking,
    human_summary: `Proposal ${proposal.proposal_id} is now with an approver. ${gate.blocking.map((v) => v.human_reason).join(' ')}`,
  })
}

// ---------------------------------------------------------------- 10. send_proposal

export interface SendProposalPayload {
  proposal_id: string
  sent: boolean
  channel: string | null
  route: string
  delivery: DeliveryOutcome
  human_summary: string
}

/** THE GATE IS HERE. A flagged proposal cannot leave the building before an approval, whoever
 *  or whatever is asking. */
export async function send_proposal(args: {
  proposal_id: string
  actor?: string | null
}): Promise<ToolResult<SendProposalPayload>> {
  const proposal = getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)

  const gate = canSend(proposal)
  if (!gate.allowed) {
    await auditLog('proposal.send_blocked', `proposal:${proposal.proposal_id}`, {
      inquiry_id: proposal.inquiry_id,
      status: proposal.status,
      blocking_rules: gate.blocking.map((v) => v.rule_id),
      actor: args.actor ?? null,
    })
    return fail(gate.human_reason, {
      citations: [
        policyCitation('13', 'Group block approval authority sits with Sales and the General Manager'),
      ],
    })
  }

  // The only place the real address is read. Everything else works from the masked pair.
  const contact = await loadInquiryContact(proposal.inquiry_id)
  const outcome = await deliver({
    proposal_id: proposal.proposal_id,
    inquiry_id: proposal.inquiry_id,
    contact: {
      name: proposal.document.contact_name,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    },
    subject: `Your group proposal for ${proposal.document.company_name} at ${proposal.document.property_name}`,
    html: renderProposalHtml(proposal.document, proposal.pdf_url),
    text: renderProposalText(proposal.document, proposal.pdf_url),
    pdf_url: proposal.pdf_url,
    attachment: proposal.pdf_bytes
      ? {
          filename: pdfFilename(proposal.document),
          content_base64: toBase64(proposal.pdf_bytes),
          content_type: 'application/pdf',
        }
      : null,
    actor: args.actor ?? null,
  })

  if (outcome.ok && outcome.channel) {
    await markSent(proposal, outcome.channel, args.actor ?? null, outcome.displayed_to)
  }

  const payload: SendProposalPayload = {
    proposal_id: proposal.proposal_id,
    sent: outcome.ok,
    channel: outcome.channel,
    route: outcome.route,
    delivery: outcome,
    human_summary: outcome.ok
      ? `Proposal ${proposal.proposal_id} went out by ${outcome.channel} to ${outcome.displayed_to}${outcome.demo_mode ? ', routed to the demo inbox for this run' : ''}.`
      : (outcome.human_reason ?? 'The proposal was not sent.'),
  }

  // A failed send is a real answer, not a crash. `ok:false` so the agent says so plainly.
  return outcome.ok
    ? ok(payload)
    : { ...fail(payload.human_summary), data: payload, grounded: true }
}

// ---------------------------------------------------------------- 11. create_inquiry

export interface CreateInquiryArgs {
  company_name: string
  contact_name?: string
  contact_email?: string | null
  contact_phone?: string | null
  event_type?: string
  preferred_property_code: string
  alternate_property_ok?: boolean
  arrival_date?: string | null
  departure_date?: string | null
  rooms_requested?: number | string | null
  room_type_preference?: string | null
  requested_discount_pct?: number | null
  meeting_capacity_needed?: number | null
  meeting_space_needed?: boolean
  special_requests?: string | null
  source?: GroupInquiry['source']
}

const created = new Map<string, GroupInquiry>()

export function resetCreatedInquiries(): void {
  created.clear()
}

export function createdInquiries(): GroupInquiry[] {
  return [...created.values()]
}

export function getCreatedInquiry(id: string): GroupInquiry | null {
  return created.get(id) ?? null
}

/** For enquiries that arrive by phone. Sol takes the details on the call and this puts a real
 *  row on the group sales board within the second, which is the whole point of the split-screen
 *  demo. Phone calls usually arrive with a number and no email, which is exactly the case the
 *  delivery adapter routes to SMS. */
export async function create_inquiry(args: CreateInquiryArgs): Promise<
  ToolResult<{ inquiry: GroupInquiry; missing_fields: string[]; questions: string[]; human_summary: string }>
> {
  if (!args.company_name?.trim()) {
    return fail('We need the name of the company or group before we can open an enquiry for them.')
  }
  const property = await loadProperty(args.preferred_property_code)
  if (!property) {
    return fail(
      `We have no record of a Solstice hotel with the code ${args.preferred_property_code}, so we cannot open an enquiry against it.`,
    )
  }

  const existing = await loadInquiries()
  const id = `INQ-${String(2000 + existing.length + created.size + 1)}`

  const parsed = await parse_inquiry({
    raw: {
      ...args,
      inquiry_id: id,
      source: args.source ?? 'voice',
      alternate_property_ok: args.alternate_property_ok === true,
    },
  })
  if (!parsed.ok || !parsed.data) return fail(parsed.error ?? 'We could not open the enquiry.')

  const inquiry = parsed.data.inquiry
  created.set(id, inquiry)

  await auditLog('inquiry.created', `inquiry:${id}`, {
    source: inquiry.source,
    company_name: inquiry.company_name,
    property_code: inquiry.preferred_property_code,
    contact_email: inquiry.contact_email,
    contact_phone: inquiry.contact_phone,
    missing_fields: inquiry.missing_fields,
  })

  return ok(
    {
      inquiry,
      missing_fields: inquiry.missing_fields,
      questions: parsed.data.questions,
      human_summary: `Enquiry ${id} is open for ${inquiry.company_name} at ${property.property_name}.${
        inquiry.missing_fields.length
          ? ` There are still ${parsed.data.questions.length} things to confirm before we can quote.`
          : ' Everything we need is on it.'
      }${inquiry.contact_email ? '' : ' They gave us a phone number and no email, so the proposal goes out by text with a link.'}`,
    },
    { citations: [propertyCitation(property.property_code, property.property_name)] },
  )
}

// ---------------------------------------------------------------- inbox rows for the admin UI

/** `inquiries.payload` jsonb. Denormalises `property_name` and `nights` because the detail view
 *  renders them directly and should not have to join to show a hotel name. */
export interface InquiryPayload {
  company_name: string
  contact_name: string
  contact_email: string | null
  contact_phone: string | null
  event_type: string
  preferred_property_code: string
  property_name: string
  alternate_property_ok: boolean
  arrival_date: string | null
  departure_date: string | null
  nights: number | null
  rooms_requested: number | null
  room_type_preference: string | null
  requested_discount_pct: number | null
  stated_budget_per_night: number | null
  meeting_space_needed: boolean
  meeting_capacity_needed: number | null
  special_requests: string | null
}

export interface InquiryRow {
  id: string
  inquiry_code: string
  source: GroupInquiry['source']
  payload: InquiryPayload
  missing_fields: string[]
  status: string
  created_at: string
}

export async function buildInquiryRow(inquiry: GroupInquiry): Promise<InquiryRow> {
  const property = await loadProperty(inquiry.preferred_property_code)
  const context = await loadInquiryContext(inquiry.inquiry_id)
  const contact = await loadInquiryContact(inquiry.inquiry_id)
  const arrival = parseDate(inquiry.arrival_date)
  const departure = parseDate(inquiry.departure_date)
  const nights = arrival && departure ? nightsBetween(arrival, departure) : (context?.nights ?? null)

  const proposal = findProposalByInquiry(inquiry.inquiry_id)
  const evaluation = evaluateGroupRules({
    inquiry,
    property,
    contact_present: Boolean(contact?.email || contact?.phone || contact?.email_masked || contact?.phone_masked),
  })

  return {
    id: inquiry.inquiry_id,
    inquiry_code: inquiry.inquiry_id,
    source: inquiry.source,
    payload: {
      company_name: inquiry.company_name,
      contact_name: inquiry.contact_name,
      // Masked. The screen never needs the real address; only `send_proposal` does.
      contact_email: contact?.email_masked || null,
      contact_phone: contact?.phone_masked || null,
      event_type: inquiry.event_type,
      preferred_property_code: inquiry.preferred_property_code,
      property_name: property?.property_name ?? inquiry.preferred_property_code,
      alternate_property_ok: inquiry.alternate_property_ok,
      arrival_date: inquiry.arrival_date,
      departure_date: inquiry.departure_date,
      nights,
      rooms_requested: inquiry.rooms_requested,
      room_type_preference: inquiry.room_type_preference,
      requested_discount_pct: inquiry.requested_discount_pct,
      stated_budget_per_night: context?.stated_budget_per_night ?? null,
      meeting_space_needed:
        context?.meeting_space_needed ??
        ((inquiry.meeting_capacity_needed ?? 0) > 0 ||
          inquiry.missing_fields.includes('meeting_capacity_needed')),
      meeting_capacity_needed: inquiry.meeting_capacity_needed,
      special_requests: inquiry.special_requests,
    },
    missing_fields: inquiry.missing_fields,
    status: proposal ? proposal.status : statusFor(evaluation),
    created_at: context?.date_received
      ? new Date(`${context.date_received}T09:00:00Z`).toISOString()
      : new Date().toISOString(),
  }
}

function statusFor(evaluation: EvaluationResult): string {
  if (evaluation.clarifying_questions.length > 0 && evaluation.pricing_blocked_by.includes('GRP-COMPLETENESS')) {
    return 'needs_information'
  }
  if (evaluation.decision === 'blocked') return 'blocked'
  if (evaluation.decision === 'needs_approval') return 'needs_review'
  return 'auto_approvable'
}

// ---------------------------------------------------------------- staff actions (not agent tools)

/** Re-price a proposal at the discount the customer actually asked for. This is an OVERRIDE:
 *  it does not clear the flag, it records that a named human chose to exceed the ceiling, and
 *  the proposal still has to be approved before it can be sent. */
export async function override_proposal(args: {
  proposal_id: string
  actor: string
  justification: string
  discount_pct?: number
}): Promise<ToolResult<{ proposal_id: string; status: string; discount_pct: number; human_summary: string }>> {
  const existing = getProposal(args.proposal_id)
  if (!existing) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)
  if (!args.actor?.trim()) {
    return fail('An override has to be attributed to a person. We do not record anonymous overrides.')
  }
  if (!args.justification?.trim()) {
    return fail(
      'An override needs a reason on it. "Customer asked" is not a reason; say what makes this booking worth the exception.',
    )
  }

  const inquiry = await loadInquiry(existing.inquiry_id)
  if (!inquiry) return fail(`We have no record of enquiry ${existing.inquiry_id}.`)

  const requested = args.discount_pct ?? inquiry.requested_discount_pct ?? existing.discount_pct
  const regenerated = await generate_proposal({
    inquiry_id: existing.inquiry_id,
    discount_pct: requested,
    chosen_option: 'override',
  })
  if (!regenerated.ok || !regenerated.data) {
    return fail(regenerated.error ?? 'We were not able to re-price this block.')
  }

  const fresh = getProposal(regenerated.data.proposal_id)
  if (fresh) {
    fresh.history.push({
      at: new Date().toISOString(),
      event: 'override',
      by: args.actor,
      detail: args.justification,
    })
  }

  await auditLog('proposal.override', `proposal:${regenerated.data.proposal_id}`, {
    inquiry_id: existing.inquiry_id,
    replaces_proposal: existing.proposal_id,
    actor: args.actor,
    justification: args.justification,
    ceiling_pct: existing.discount_pct,
    override_discount_pct: requested,
    still_requires_approval: regenerated.data.requires_approval,
  })

  return ok({
    proposal_id: regenerated.data.proposal_id,
    status: regenerated.data.status,
    discount_pct: requested,
    human_summary: `${args.actor} re-priced this block at ${requested}% and gave the reason: ${args.justification}. ${
      regenerated.data.requires_approval
        ? 'It is above what we can approve on our own, so it still needs a sign-off before it can go to the customer.'
        : 'It is within what we can approve, so it can go out.'
    }`,
  })
}

/** Deliberately NOT in GROUP_TOOLS. Approving one's own over-authority proposal is a human act
 *  with a named human attached to it, which is what makes the audit row worth anything. */
export async function approve(args: {
  proposal_id: string
  approved_by: string
  note?: string
}): Promise<ToolResult<{ proposal_id: string; status: string; human_summary: string }>> {
  const proposal = getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)
  if (!args.approved_by?.trim()) {
    return fail('An approval has to be attributed to a person. We do not record anonymous approvals.')
  }
  await approveProposal(proposal, args.approved_by, args.note)
  return ok({
    proposal_id: proposal.proposal_id,
    status: proposal.status,
    human_summary: `${args.approved_by} approved proposal ${proposal.proposal_id}. It can now be sent.`,
  })
}

export async function reject(args: {
  proposal_id: string
  rejected_by: string
  reason: string
}): Promise<ToolResult<{ proposal_id: string; status: string; human_summary: string }>> {
  const proposal = getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)
  await rejectProposal(proposal, args.rejected_by, args.reason)
  return ok({
    proposal_id: proposal.proposal_id,
    status: proposal.status,
    human_summary: `${args.rejected_by} turned down proposal ${proposal.proposal_id}: ${args.reason}`,
  })
}

export { findProposalByInquiry, getProposal, listProposals } from './store'
export { speakDate }
