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
  rateFieldForRoomType,
  type DecisionOption,
  type EvaluationResult,
  type PricedBlock,
} from '../../../src/lib/rules'
import { getPropertyRate } from '../_lib/data'
import { tryGetDb } from '../_lib/db'
import { deliver, type DeliveryOutcome } from '../_delivery'
import { auditLog } from '../_delivery/audit'
import {
  fail,
  inquiryCitation,
  registerInquiry,
  registeredInquiries,
  resetRegisteredInquiries,
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
import { endSentence } from '../../../shared/text'
import {
  buildProposalDocument,
  EDITABLE_PROSE_FIELDS,
  LOCKED_NUMERIC_FIELDS,
  passableProse,
  pdfFilename,
  proseProblem,
  type ProposalDocument,
  type ProposalProse,
  renderProposalHtml,
  renderProposalPdf,
  renderProposalText,
  toBase64,
} from './proposal'
import {
  approveProposal,
  cachePdf,
  cachedPdf,
  canSend,
  checkApproval,
  contactPresent,
  currentActor,
  durabilityNote,
  findProposalByInquiry,
  getProposal,
  hostPdf,
  markAwaitingApproval,
  markSent,
  now,
  rejectProposal,
  requiresApproval,
  reserveProposalSlot,
  saveProposal,
  updateProposal,
  type Approver,
  type StoredProposal,
} from './store'

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
    if (!existing) return fail(`We have no record of an inquiry with the reference ${args.inquiry_id}.`)
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
      `We have no record of an inquiry with the reference ${args.inquiry_id ?? '(none supplied)'}.`,
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
    as_of: now(),
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
    if (!inquiry) return fail(`We have no record of an inquiry with the reference ${args.inquiry_id}.`)
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
        as_of: now(),
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
  if (!inquiry) return fail(`We have no record of an inquiry with the reference ${args.inquiry_id}.`)
  const properties = await loadProperties()
  const rules = getPropertyRules(inquiry.preferred_property_code)

  const result = findAlternates({ inquiry, properties, limit: args.limit })
  const citations = result.alternate_properties.map((alt) =>
    propertyCitation(alt.property_code, alt.property_name),
  )
  if (rules) citations.unshift(propertyCitation(rules.property_code, rules.property_name))

  return ok({ ...result, human_summary: describeAlternates(result) }, { citations })
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
    return fail(`We have no record of an inquiry with the reference ${args.inquiry_id ?? '(none supplied)'}.`)
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
        `${endSentence(`Thank you for getting in touch about ${inquiry.company_name}`)} I would love to put a proposal together for you, and there are just a few things I need before I can quote properly and hold the rooms:`,
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
  /** Carried onto a new revision so a rep's own words survive a re-price. Prose only. */
  prose?: ProposalProse
  prepared_on?: string
}

export interface GenerateProposalPayload {
  proposal_id: string
  status: StoredProposal['status']
  requires_approval: boolean
  /** False means this proposal exists only in one server's memory and the next request will
   *  not find it. Surfaced rather than assumed: that failure once looked exactly like success. */
  persisted: boolean
  /** True when this updated the draft already on the inquiry instead of adding a second one. */
  replaced_existing: boolean
  verdicts: RuleVerdict[]
  discount_pct: number
  /** Integer cents. `total_display` is the same figure formatted for a person. */
  total_cents: number
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
  if (!inquiry) return fail(`We have no record of an inquiry with the reference ${args.inquiry_id}.`)

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
    as_of: now(),
  })

  // Refuse to price what the rules say must not be priced.
  if (evaluation.pricing_blocked_by.length > 0) {
    const blockers = evaluation.verdicts.filter((v) => evaluation.pricing_blocked_by.includes(v.rule_id as never))
    const alternates = findAlternates({ inquiry, properties: await loadProperties() })
    await auditLog('proposal.refused', `inquiry:${inquiry.inquiry_id}`, {
      reason: evaluation.pricing_blocked_by,
      decision: evaluation.decision,
    })
    return fail(
      `${blockers.map((v) => v.human_reason).join(' ')} ${describeAlternates(alternates)}`.trim(),
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
  const customerNotes = derivedCustomerNotes(inquiry, evaluation)

  // Reserve the slot BEFORE rendering, because the code is baked into the PDF, its filename
  // and its link. Reserving also decides whether this replaces an existing draft, which is what
  // makes a rep clicking generate twice produce one proposal rather than two.
  const slot = await reserveProposalSlot(inquiry.inquiry_id)
  const proposalId = slot.code

  // A regeneration keeps whatever the rep had already written, unless they pass new prose. Words
  // the prose guard rejects are not carried forward.
  const existing = slot.replaces_existing ? await getProposal(proposalId) : null
  const prose = passableProse(args.prose ?? existing?.prose ?? {})

  const document = buildProposalDocument({
    proposal_id: proposalId,
    inquiry,
    property,
    block,
    verdicts: evaluation.verdicts,
    required_follow_ups: evaluation.required_follow_ups,
    customer_notes: customerNotes,
    prose,
    prepared_on: args.prepared_on ? new Date(args.prepared_on) : undefined,
  })

  let pdfBytes: Uint8Array | null = null
  let pdfUrl: string | null = null
  try {
    pdfBytes = await renderProposalPdf(document)
    cachePdf(proposalId, pdfBytes)
    const hosted = await hostPdf(proposalId, pdfBytes, pdfFilename(document))
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

  const stored = await saveProposal({
    slot,
    status: needsApproval ? 'awaiting_approval' : 'draft',
    verdicts: evaluation.verdicts,
    // Integer cents. The dollar fields on `Proposal` exist only to satisfy shared/types.ts.
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
    prose,
  })

  await auditLog('proposal.generated', `proposal:${proposalId}`, {
    inquiry_id: inquiry.inquiry_id,
    property_code: property.property_code,
    discount_pct: discount,
    total_cents: block.total_cents,
    requires_approval: needsApproval,
    chosen_option: args.chosen_option ?? null,
    pdf_hosted: Boolean(pdfUrl),
    replaced_existing: slot.replaces_existing,
    persisted: stored.persisted,
    // Whoever drafts it cannot approve it (checkApproval reads this).
    actor_id: currentActor(),
  })

  return ok(
    {
      proposal_id: proposalId,
      status: stored.status,
      requires_approval: needsApproval,
      persisted: stored.persisted,
      replaced_existing: slot.replaces_existing,
      verdicts: evaluation.verdicts,
      discount_pct: discount,
      total_cents: block.total_cents,
      total_display: formatUsd(block.total_cents),
      pdf_url: pdfUrl,
      pdf_bytes_length: pdfBytes?.length ?? 0,
      html,
      text,
      human_summary:
        (needsApproval
          ? `Proposal ${proposalId} is drafted at ${formatUsd(block.total_cents)}, and it is waiting on an approval before it can go anywhere. ${(await canSend(stored)).human_reason}`
          : `Proposal ${proposalId} is ready at ${formatUsd(block.total_cents)}. Every rule check passed, so it can go straight out.`) +
        (slot.replaces_existing
          ? ` This replaces the earlier draft on the same inquiry rather than adding a second one.`
          : '') +
        durabilityNote(stored),
    },
    {
      citations: [
        inquiryCitation(inquiry.inquiry_id, inquiry.company_name),
        propertyCitation(property.property_code, property.property_name),
      ],
    },
  )
}

/** The notes we put in front of a customer when nobody has written their own. Derived, so a
 *  referral or a special request never silently disappears from the letter. */
function derivedCustomerNotes(inquiry: GroupInquiry, evaluation: EvaluationResult): string[] {
  const notes: string[] = []
  if (inquiry.special_requests) notes.push(`We have noted your request: ${inquiry.special_requests}.`)
  for (const referral of evaluation.referrals) notes.push(referral)
  return notes
}

// ---------------------------------------------------------------- rehydration

/**
 * Rebuilds the customer-facing letter from a stored proposal.
 *
 * The `proposals` table holds numbers, not prose, which is deliberate: the letter is derived
 * from the pricing that was approved plus the inquiry and the property, so the words a customer
 * reads cannot drift away from the figures a manager signed off. It also means a proposal
 * generated on one function instance can be sent from another, which is the bug this replaced.
 *
 * The PDF bytes come from this instance's cache when they are there, and are re-rendered when
 * they are not. Re-rendering is deterministic, so the attachment is byte-for-byte the document
 * whose link the customer already has.
 */
export async function materialiseProposal(
  proposal: StoredProposal,
  opts: { force_render?: boolean } = {},
): Promise<{ document: ProposalDocument; pdfBytes: Uint8Array | null } | null> {
  const inquiry = await loadInquiry(proposal.inquiry_id)
  if (!inquiry) return null
  const property = await loadProperty(inquiry.preferred_property_code)
  if (!property) return null

  const context = await loadInquiryContext(inquiry.inquiry_id)
  const evaluation = evaluateGroupRules({
    inquiry,
    property,
    received_date: context?.date_received ?? null,
    raw_values: { rooms_requested: context?.raw_rooms },
    contact_present: await contactPresent(inquiry.inquiry_id),
    as_of: now(),
  })

  const line = proposal.pricing.line_items[0]
  const rate = sanctionedRate(property.property_code, line?.room_type ?? inquiry.room_type_preference)
  const block: PricedBlock = {
    ok: true,
    property_code: property.property_code,
    room_type: line?.room_type ?? inquiry.room_type_preference ?? 'Standard King',
    rooms: line?.rooms ?? inquiry.rooms_requested ?? 0,
    nights: line?.nights ?? 0,
    rate_field: rateFieldForRoomType(line?.room_type ?? inquiry.room_type_preference),
    // Already cents on the stored line. The previous version multiplied by 100 here, which is
    // how a dollar value ended up in an object of cents in the first place.
    nightly_rack_cents: line?.nightly_rate_cents ?? (rate.ok ? rate.cents : 0),
    nightly_net_cents: line?.nightly_net_cents ?? 0,
    discount_pct: proposal.pricing.discount_pct,
    subtotal_cents: proposal.pricing.subtotal_cents,
    discount_cents: proposal.pricing.discount_cents,
    total_cents: proposal.pricing.total_cents,
    line_items: proposal.pricing.line_items,
  }

  const document = buildProposalDocument({
    proposal_id: proposal.proposal_id,
    inquiry,
    property,
    block,
    verdicts: proposal.verdicts,
    required_follow_ups: evaluation.required_follow_ups,
    customer_notes: derivedCustomerNotes(inquiry, evaluation),
    prose: proposal.prose,
    prepared_on: new Date(proposal.created_at),
  })

  let pdfBytes = opts.force_render ? null : cachedPdf(proposal.proposal_id)
  if (!pdfBytes) {
    try {
      pdfBytes = await renderProposalPdf(document)
      cachePdf(proposal.proposal_id, pdfBytes)
    } catch {
      pdfBytes = null
    }
  }

  return { document, pdfBytes }
}

// ---------------------------------------------------------------- 9. submit_for_approval

export async function submit_for_approval(args: {
  proposal_id: string
  submitted_by?: string | null
  note?: string
}): Promise<ToolResult<{ proposal_id: string; status: string; blocking: RuleVerdict[]; human_summary: string }>> {
  const proposal = await getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)

  const gate = await canSend(proposal)
  if (!gate.needs_approval) {
    // Either nothing needs signing off, or something no approval can lift. Say which.
    if (!gate.allowed) return fail(gate.human_reason)
    return ok({
      proposal_id: proposal.proposal_id,
      status: proposal.status,
      blocking: [],
      human_summary: `There is nothing to submit on ${proposal.proposal_id}. ${gate.human_reason}`,
    })
  }

  await markAwaitingApproval(proposal, args.submitted_by ?? null, args.note)
  return ok({
    proposal_id: proposal.proposal_id,
    status: proposal.status,
    blocking: gate.blocking,
    human_summary: `Proposal ${proposal.proposal_id} is now with an approver. ${gate.blocking.map((v) => v.human_reason).join(' ')}${durabilityNote(proposal)}`,
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

/** THE GATE IS HERE. Nothing leaves the building until `canSend` has re-checked it live, whoever
 *  or whatever is asking. */
export async function send_proposal(args: {
  proposal_id: string
  actor?: string | null
}): Promise<ToolResult<SendProposalPayload>> {
  const proposal = await getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)

  const gate = await canSend(proposal)
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

  // The proposal row carries pricing, not prose: the letter is re-rendered from the stored
  // numbers plus the inquiry and the property, so what the customer receives cannot drift away
  // from what the database says was approved.
  const materialised = await materialiseProposal(proposal)
  if (!materialised) {
    return fail(
      `Proposal ${proposal.proposal_id} is on file but we cannot rebuild the letter for it, because inquiry ${proposal.inquiry_id} or its hotel is no longer in the directory. Nothing was sent.`,
    )
  }
  const { document, pdfBytes } = materialised

  // The only place the real address is read. Everything else works from the masked pair.
  const contact = await loadInquiryContact(proposal.inquiry_id)
  const outcome = await deliver({
    proposal_id: proposal.proposal_id,
    inquiry_id: proposal.inquiry_id,
    contact: {
      name: document.contact_name,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    },
    subject: `Your group proposal for ${document.company_name} at ${document.property_name}`,
    html: renderProposalHtml(document, proposal.pdf_url),
    text: renderProposalText(document, proposal.pdf_url),
    pdf_url: proposal.pdf_url,
    attachment: pdfBytes
      ? {
          filename: pdfFilename(document),
          content_base64: toBase64(pdfBytes),
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
      ? `Proposal ${proposal.proposal_id} went out by ${outcome.channel} to ${outcome.displayed_to}${outcome.demo_mode ? ', routed to the demo inbox for this run' : ''}.${durabilityNote(proposal)}`
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

export function resetCreatedInquiries(): void {
  resetRegisteredInquiries()
}

export function createdInquiries(): GroupInquiry[] {
  return registeredInquiries()
}

export function getCreatedInquiry(id: string): GroupInquiry | null {
  return registeredInquiries().find((i) => i.inquiry_id === id) ?? null
}

/** For inquiries that arrive by phone. Sol takes the details on the call and this puts a real
 *  row on the group sales board within the second, which is the whole point of the split-screen
 *  demo. Phone calls usually arrive with a number and no email, which is exactly the case the
 *  delivery adapter routes to SMS. */
export async function create_inquiry(args: CreateInquiryArgs): Promise<
  ToolResult<{ inquiry: GroupInquiry; missing_fields: string[]; questions: string[]; human_summary: string }>
> {
  // Open the record on the FIRST useful thing the caller gives us, which in practice is an email
  // address. A caller who hangs up after answering one question should still be reachable; an
  // inquiry that only exists once every field is known is an inquiry we lose.
  const hasContact = Boolean(args.contact_email?.trim() || args.contact_phone?.trim())
  if (!hasContact && !args.company_name?.trim()) {
    return fail(
      'We need at least one way to reach them, an email address or a phone number, or the name of the group, before we can open an inquiry.',
    )
  }

  // The property may not be known yet. If one is named it must be real; if none is named the
  // inquiry opens without it and the gap is reported like any other missing field.
  const property = args.preferred_property_code ? await loadProperty(args.preferred_property_code) : null
  if (args.preferred_property_code && !property) {
    return fail(
      `We have no record of a Solstice hotel with the code ${args.preferred_property_code}, so we cannot open an inquiry against it.`,
    )
  }

  const existing = await loadInquiries()
  const id = `INQ-${String(2000 + existing.length + 1)}`

  const parsed = await parse_inquiry({
    raw: {
      ...args,
      inquiry_id: id,
      source: args.source ?? 'voice',
      alternate_property_ok: args.alternate_property_ok === true,
    },
  })
  if (!parsed.ok || !parsed.data) return fail(parsed.error ?? 'We could not open the inquiry.')

  const inquiry = parsed.data.inquiry

  // Visible to every tool in this process immediately...
  registerInquiry(inquiry, {
    meeting_space_needed: args.meeting_space_needed === true,
    raw_rooms: parsed.data.raw_rooms ?? undefined,
  })
  // ...and written to the `inquiries` table, so the row survives the call that created it and
  // so a proposal or a follow-up raised against it has a foreign key to point at.
  const persisted = await persistInquiry(inquiry, args.meeting_space_needed === true)

  await auditLog('inquiry.created', `inquiry:${id}`, {
    persisted,
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
      next_question: nextQuestion(inquiry),
      human_summary: `Inquiry ${id} is open for ${inquiry.company_name}${
        property ? ` at ${property.property_name}` : ''
      }.${
        inquiry.missing_fields.length
          ? ` Still to confirm: ${inquiry.missing_fields.join(', ')}.`
          : ' Everything we need is on it.'
      }${inquiry.contact_email ? '' : ' No email yet, so anything we send goes by text with a link.'}${
        persisted
          ? ''
          : ' Note that this inquiry is only held in memory on this server, because the database is not reachable, so it will disappear if the process restarts.'
      }`,
    },
    { citations: property ? [propertyCitation(property.property_code, property.property_name)] : [] },
  )
}

/**
 * The single next thing to ask, in the order that protects the business.
 *
 * Contact first: a caller who hangs up after one answer is still reachable. Then who they are,
 * then where and when, then size, then the negotiable parts. Sol asks these ONE AT A TIME; a
 * list of six questions read down a phone line is how a caller decides to fill in a web form
 * instead.
 */
export function nextQuestion(inquiry: GroupInquiry): { field: string; ask: string } | null {
  const p = inquiry
  if (!p.contact_email && !p.contact_phone)
    return { field: 'contact_email', ask: 'What is the best email address to send the proposal to?' }
  if (!p.contact_email)
    return { field: 'contact_email', ask: 'What email address should the proposal go to?' }
  // The parser fills a placeholder when no name was given, so treat those as still missing.
  if (!p.company_name || /^(unknown|unnamed|untitled)\b/i.test(p.company_name.trim()))
    return { field: 'company_name', ask: 'And which company or group is this for?' }
  if (!p.preferred_property_code)
    return { field: 'preferred_property_code', ask: 'Which Solstice hotel did you have in mind?' }
  if (!p.arrival_date) return { field: 'arrival_date', ask: 'What dates are you looking at?' }
  if (!p.rooms_requested) return { field: 'rooms_requested', ask: 'Roughly how many rooms do you need?' }
  if (!p.contact_name) return { field: 'contact_name', ask: 'And who should the proposal be addressed to?' }
  return null
}

export interface UpdateInquiryArgs extends Partial<CreateInquiryArgs> {
  inquiry_id: string
}

/**
 * Add what the caller just told us to an inquiry that is already open.
 *
 * This is the other half of asking one question at a time: `create_inquiry` opens the record on
 * the first answer, and every answer after it lands here. Without it the agent either holds the
 * whole interview in its head until the end, or opens a second inquiry per answer.
 */
export async function update_inquiry(args: UpdateInquiryArgs): Promise<
  ToolResult<{ inquiry: GroupInquiry; missing_fields: string[]; next_question: { field: string; ask: string } | null; human_summary: string }>
> {
  const current = await loadInquiry(args.inquiry_id)
  if (!current) {
    return fail(`We have no record of an inquiry with the reference ${args.inquiry_id}.`)
  }

  if (args.preferred_property_code) {
    const property = await loadProperty(args.preferred_property_code)
    if (!property) {
      return fail(
        `We have no record of a Solstice hotel with the code ${args.preferred_property_code}, so it cannot go on this inquiry.`,
      )
    }
  }

  // Only overwrite what was actually supplied; an omitted field keeps whatever we already had.
  const merged: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(args)) {
    if (key === 'inquiry_id') continue
    if (value === undefined) continue
    merged[key] = value
  }

  const parsed = await parse_inquiry({ raw: { ...merged, inquiry_id: current.inquiry_id, source: current.source } })
  if (!parsed.ok || !parsed.data) return fail(parsed.error ?? 'We could not update the inquiry.')

  const inquiry = parsed.data.inquiry
  registerInquiry(inquiry, { raw_rooms: parsed.data.raw_rooms ?? undefined })
  const persisted = await persistInquiry(inquiry, false)

  const changed = Object.keys(args).filter((k) => k !== 'inquiry_id')
  await auditLog('inquiry.updated', `inquiry:${inquiry.inquiry_id}`, {
    persisted,
    changed,
    missing_fields: inquiry.missing_fields,
  })

  const next = nextQuestion(inquiry)
  return ok({
    inquiry,
    missing_fields: inquiry.missing_fields,
    next_question: next,
    human_summary: `Updated ${inquiry.inquiry_id} with ${changed.join(', ')}.${
      next ? ` Next we need: ${next.field}.` : ' We have everything we need to quote.'
    }`,
  })
}

/** Writes a runtime-created inquiry to the `inquiries` table. The payload is the same
 *  denormalised shape the seeded rows carry, so the inbox renders a phoned-in inquiry exactly
 *  like a portal one. Never throws: a database that is not there must not lose the call. */
async function persistInquiry(inquiry: GroupInquiry, meetingSpaceNeeded: boolean): Promise<boolean> {
  const db = tryGetDb()
  if (!db) return false
  try {
    const row = await buildInquiryRow(inquiry)
    const { error } = await db.from('inquiries').upsert(
      {
        inquiry_code: inquiry.inquiry_id,
        source: inquiry.source,
        payload: { ...row.payload, meeting_space_needed: meetingSpaceNeeded },
        missing_fields: inquiry.missing_fields,
        status: row.status,
      },
      { onConflict: 'inquiry_code' },
    )
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    await auditLog('inquiry.persist_failed', `inquiry:${inquiry.inquiry_id}`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
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

  const proposal = await findProposalByInquiry(inquiry.inquiry_id)
  const evaluation = evaluateGroupRules({
    inquiry,
    property,
    contact_present: Boolean(contact?.email || contact?.phone || contact?.email_masked || contact?.phone_masked),
    as_of: now(),
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

// ---------------------------------------------------------------- edit a proposal

export interface EditProposalArgs {
  proposal_id: string
  edits: ProposalProse
  justification: string
  actor: string
}

export interface EditProposalPayload {
  proposal: {
    proposal_id: string
    status: StoredProposal['status']
    revision: number
    prose: ProposalProse
    pricing: StoredProposal['pricing']
    verdicts: RuleVerdict[]
    pdf_url: string | null
    persisted: boolean
    html: string
    text: string
  }
  editable_fields: readonly string[]
  locked_fields: readonly string[]
  /** Read aloud to a rep who asks why they cannot just change the total. */
  explanation: string
  opened_new_revision: boolean
}

const WHY_THE_NUMBERS_ARE_LOCKED =
  'You can rewrite anything the customer reads as words: the opening paragraph, the "good to know" notes, and the next steps. The numbers are not editable here on purpose. The rate, the discount, the totals and the rule verdicts are produced by the rules engine from the property record, and a figure typed in by hand would be one no rule ever produced and no audit row could explain. If the discount itself needs to change, use the override: it re-prices through the same engine and records who decided and why.'

/**
 * Edits the PROSE of a proposal and re-renders both the email and the PDF from the stored
 * record, so the document a customer receives and the row a manager approved cannot drift.
 *
 * An edit to a proposal that has already been sent opens the next revision and leaves the sent
 * one as the customer has it. The one exception is clearing words the prose guard rejects: that
 * corrects the sent letter in place, so the customer's link stops showing test text.
 */
export async function edit_proposal(args: EditProposalArgs): Promise<ToolResult<EditProposalPayload>> {
  const proposal = await getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)
  if (!args.actor?.trim()) {
    return fail('An edit has to be attributed to a person. We do not record anonymous edits.')
  }
  if (!args.justification?.trim()) {
    return fail(
      'An edit needs a note saying what changed and why. It goes in the audit trail beside the words themselves.',
    )
  }

  // Reject anything that looks like an attempt to edit a number, loudly rather than silently.
  const attempted = Object.keys(args.edits ?? {})
  const rejected = attempted.filter((key) => !(EDITABLE_PROSE_FIELDS as readonly string[]).includes(key))
  if (rejected.length > 0) {
    return fail(
      `${rejected.join(' and ')} cannot be edited by hand. ${WHY_THE_NUMBERS_ARE_LOCKED}`,
    )
  }

  const wording = proseProblem(args.edits)
  if (wording) return fail(`${wording} Nothing was saved.`)

  const merged: ProposalProse = {
    ...proposal.prose,
    ...(args.edits.intro !== undefined ? { intro: args.edits.intro } : {}),
    ...(args.edits.body !== undefined ? { body: args.edits.body } : {}),
    ...(args.edits.customer_notes !== undefined
      ? { customer_notes: args.edits.customer_notes }
      : {}),
  }

  const fields = attempted as (keyof ProposalProse)[]
  const clearsResidue =
    proposal.status === 'sent' &&
    fields.length > 0 &&
    fields.every((f) => isBlank(args.edits[f]) && proseProblem({ [f]: proposal.prose[f] }) !== null)
  if (clearsResidue) for (const f of fields) delete merged[f]

  // Already with the customer: open the next revision rather than rewriting what they hold.
  if (proposal.status === 'sent' && !clearsResidue) {
    const regenerated = await generate_proposal({
      inquiry_id: proposal.inquiry_id,
      discount_pct: proposal.pricing.discount_pct,
      chosen_option: 'edit_after_send',
      prose: merged,
    })
    if (!regenerated.ok || !regenerated.data) {
      return fail(regenerated.error ?? 'We were not able to open a new revision of this proposal.')
    }
    const fresh = (await getProposal(regenerated.data.proposal_id))!
    await auditLog('proposal.edited', `proposal:${fresh.proposal_id}`, {
      inquiry_id: proposal.inquiry_id,
      actor: args.actor,
      actor_id: currentActor(),
      justification: args.justification,
      fields: attempted,
      opened_new_revision: true,
      replaces_proposal: proposal.proposal_id,
      persisted: fresh.persisted,
    })
    return ok(
      await editPayload(fresh, regenerated.data.html, regenerated.data.text, true),
      { citations: [inquiryCitation(proposal.inquiry_id, fresh.proposal_id)] },
    )
  }

  const removed = clearsResidue ? Object.fromEntries(fields.map((f) => [f, proposal.prose[f]])) : null
  proposal.prose = merged
  // An approval signs the words too, so changed words need signing again.
  if (proposal.status === 'approved') proposal.status = 'awaiting_approval'

  // Re-render from the record, never from whatever the caller happened to send us.
  const materialised = await materialiseProposal(proposal, { force_render: true })
  if (!materialised) {
    return fail(
      `We saved nothing, because the letter for ${proposal.proposal_id} cannot be rebuilt: inquiry ${proposal.inquiry_id} or its hotel is no longer in the directory.`,
    )
  }
  if (materialised.pdfBytes) {
    const hosted = await hostPdf(
      proposal.proposal_id,
      materialised.pdfBytes,
      pdfFilename(materialised.document),
    )
    proposal.pdf_path = hosted.url
    proposal.pdf_url = hosted.url
  }
  await updateProposal(proposal)

  await auditLog('proposal.edited', `proposal:${proposal.proposal_id}`, {
    inquiry_id: proposal.inquiry_id,
    actor: args.actor,
    actor_id: currentActor(),
    justification: args.justification,
    fields: attempted,
    opened_new_revision: false,
    removed_from_sent_letter: removed,
    persisted: proposal.persisted,
  })

  return ok(
    await editPayload(
      proposal,
      renderProposalHtml(materialised.document, proposal.pdf_url),
      renderProposalText(materialised.document, proposal.pdf_url),
      false,
    ),
    { citations: [inquiryCitation(proposal.inquiry_id, proposal.proposal_id)] },
  )
}

function isBlank(value: unknown): boolean {
  return value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)
}

async function editPayload(
  proposal: StoredProposal,
  html: string,
  text: string,
  openedNewRevision: boolean,
): Promise<EditProposalPayload> {
  return {
    proposal: {
      proposal_id: proposal.proposal_id,
      status: proposal.status,
      revision: proposal.revision,
      prose: proposal.prose,
      pricing: proposal.pricing,
      verdicts: proposal.verdicts,
      pdf_url: proposal.pdf_url,
      persisted: proposal.persisted,
      html,
      text,
    },
    editable_fields: EDITABLE_PROSE_FIELDS,
    locked_fields: LOCKED_NUMERIC_FIELDS,
    explanation: WHY_THE_NUMBERS_ARE_LOCKED,
    opened_new_revision: openedNewRevision,
  }
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
  const existing = await getProposal(args.proposal_id)
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
  if (!inquiry) return fail(`We have no record of inquiry ${existing.inquiry_id}.`)

  const requested = args.discount_pct ?? inquiry.requested_discount_pct ?? existing.discount_pct
  const regenerated = await generate_proposal({
    inquiry_id: existing.inquiry_id,
    discount_pct: requested,
    chosen_option: 'override',
  })
  if (!regenerated.ok || !regenerated.data) {
    return fail(regenerated.error ?? 'We were not able to re-price this block.')
  }

  const fresh = await getProposal(regenerated.data.proposal_id)

  await auditLog('proposal.override', `proposal:${regenerated.data.proposal_id}`, {
    inquiry_id: existing.inquiry_id,
    replaces_proposal: existing.proposal_id,
    actor: args.actor,
    actor_id: currentActor(),
    justification: args.justification,
    ceiling_pct: existing.discount_pct,
    override_discount_pct: requested,
    still_requires_approval: regenerated.data.requires_approval,
    persisted: fresh?.persisted ?? false,
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

export type ApprovalResult = ToolResult<{
  proposal_id: string
  status: string
  approved_by: string
  human_summary: string
}> & {
  /** What the staff route answers with. */
  http_status: 200 | 403 | 404 | 409 | 503
}

/** Deliberately NOT in GROUP_TOOLS, so no agent can approve. `approver` comes from the verified
 *  session; `checkApproval` decides whether they may. Approving sends nothing. */
export async function approve(args: {
  proposal_id: string
  approver: Approver
  note?: string
}): Promise<ApprovalResult> {
  const proposal = await getProposal(args.proposal_id)
  if (!proposal) {
    return { ...fail(`We have no record of a proposal with the reference ${args.proposal_id}.`), http_status: 404 }
  }
  const check = await checkApproval(proposal, args.approver)
  if (!check.ok) {
    await auditLog('proposal.approval_refused', `proposal:${proposal.proposal_id}`, {
      inquiry_id: proposal.inquiry_id,
      approver_id: args.approver.id,
      approver_role: args.approver.role,
      reason: check.reason,
    })
    return { ...fail(check.reason), http_status: check.status }
  }
  await approveProposal(proposal, args.approver, check.terms, args.note)
  const gate = await canSend(proposal)
  return {
    ...ok({
      proposal_id: proposal.proposal_id,
      status: proposal.status,
      approved_by: args.approver.id,
      human_summary: `${args.approver.name ?? 'A general manager'} approved proposal ${proposal.proposal_id}. ${
        gate.allowed ? 'It can now be sent.' : gate.human_reason
      }`,
    }),
    http_status: 200,
  }
}

export async function reject(args: {
  proposal_id: string
  rejected_by: string
  reason: string
}): Promise<ToolResult<{ proposal_id: string; status: string; human_summary: string }>> {
  const proposal = await getProposal(args.proposal_id)
  if (!proposal) return fail(`We have no record of a proposal with the reference ${args.proposal_id}.`)
  await rejectProposal(proposal, args.rejected_by, args.reason)
  return ok({
    proposal_id: proposal.proposal_id,
    status: proposal.status,
    human_summary: `${args.rejected_by} turned down proposal ${proposal.proposal_id}: ${args.reason}`,
  })
}

export { findProposalByInquiry, getProposal, listProposals, canSend } from './store'
export { speakDate }
