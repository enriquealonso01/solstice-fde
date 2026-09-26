// Typed, synchronous accessors over data/generated/*.json.
//
// Everything here is in-memory and O(1): the whole reference dataset is ~40 KB, it is built
// from the four provided files by `node scripts/data/build.mjs`, and it is bundled into the
// function by esbuild. No network, no cold-start query, no chance of a tool timing out on a
// lookup. Supabase holds the SAME reference data (see scripts/data/seed.mjs) so the admin UI
// can join against it with RLS; these accessors are the fast path for the agent's tools.
//
// Two house rules are enforced in this file rather than in a prompt:
//   1. A quarantined value is never returned as a price. `getPropertyRate` refuses it.
//   2. Raw contact details never leave here except through `getInquiryDeliveryTarget`.

import type {
  Citation,
  Guest,
  GroupInquiry,
  LoyaltyTier,
  Property,
  Reservation,
} from '../../../shared/types'
import { citations } from './result'
import { phoneLookupKey, emailLookupKey, normalizePhone } from './lookup'
import { normalizeRoomType, RATE_COLUMN_FOR_ROOM, type RoomType } from './roomTypes'

import propertiesJson from '../../../data/generated/properties.json'
import guestsJson from '../../../data/generated/guests.json'
import reservationsJson from '../../../data/generated/reservations.json'
import policiesJson from '../../../data/generated/policies.json'
import inquiriesJson from '../../../data/generated/inquiries.json'
import dataQualityJson from '../../../data/generated/data-quality.json'

// ------------------------------------------------------------------------------- types

/** Guests carry two fields beyond the shared `Guest` interface: one-way lookup keys that let
 *  us match an inbound caller without storing the number. See lookup.ts. */
export interface GeneratedGuest extends Guest {
  phone_lookup: string
  email_lookup: string
  marketing_opt_in: boolean
}

export interface PolicySection {
  section_id: string
  number: number
  title: string
  title_source: string
  body: string
}

/** The generated inquiry is a superset of `GroupInquiry`. The extra fields are the CSV
 *  columns the shared interface does not model, plus our own completeness analysis.
 *  `dataset_notes` is the CHALLENGE AUTHOR'S commentary on each row -- effectively an answer
 *  key. It must never reach the agent, so `listInquiries` strips it. */
export interface InquiryRecord extends GroupInquiry {
  contact_email_masked: string
  contact_phone_masked: string
  date_received: string | null
  nights: number | null
  stated_budget_per_night: number | null
  meeting_space_needed: boolean
  rooms_requested_raw: string | null
  rooms_requested_approx: number | null
  incomplete_fields: string[]
  is_actionable: boolean
  dataset_notes: string | null
}

/** What the UI, the agent and the tools are allowed to see. */
export type PublicInquiry = Omit<InquiryRecord, 'dataset_notes' | 'contact_email' | 'contact_phone'> & {
  contact_email: null
  contact_phone: null
}

// JSON imports widen string literals to `string`, so the shared unions (LoyaltyTier,
// market_type, rate_plan, status) do not survive the import. The generated files are produced
// by our own build script from a fixed schema, and `assertGeneratedData()` below re-checks
// every union at test time, which is what earns these assertions.
const properties = propertiesJson as unknown as Property[]
const guests = guestsJson as unknown as GeneratedGuest[]
const reservations = reservationsJson as unknown as Reservation[]
const policies = policiesJson as unknown as PolicySection[]
const inquiries = inquiriesJson as unknown as InquiryRecord[]

const byPropertyCode = new Map(properties.map((p) => [p.property_code, p]))
const byGuestId = new Map(guests.map((g) => [g.guest_id, g]))
const byPhoneLookup = new Map(guests.filter((g) => g.phone_lookup).map((g) => [g.phone_lookup, g]))
const byEmailLookup = new Map(guests.filter((g) => g.email_lookup).map((g) => [g.email_lookup, g]))
const byReservationId = new Map(reservations.map((r) => [r.reservation_id, r]))
const byPolicyId = new Map(policies.map((s) => [s.section_id, s]))
const byInquiryId = new Map(inquiries.map((i) => [i.inquiry_id, i]))

// -------------------------------------------------------------------------- properties

export function listProperties(): Property[] {
  return properties
}

export function getProperty(propertyCode: string | null | undefined): Property | null {
  if (!propertyCode) return null
  return byPropertyCode.get(propertyCode.trim().toUpperCase()) ?? null
}

/** Whole dollars -> integer cents. All arithmetic happens in cents (AGENTS.md). */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

export function fromCents(cents: number): number {
  return cents / 100
}

export type RateLookup =
  | {
      ok: true
      property_code: string
      room_type: RoomType
      rate_field: string
      nightly_rate: number
      nightly_rate_cents: number
      citation: Citation
    }
  | { ok: false; reason: string; flag: string | null; citation: Citation | null }

/** The ONLY sanctioned way to get a nightly rate.
 *
 *  SOL-PVD ships `base_rate_suite = -395`. The raw value is preserved in properties.json for
 *  auditability, but this function refuses to hand it back: a caller gets `ok: false` and a
 *  reason, which becomes a `grounded: false` ToolResult, which obliges the agent to escalate.
 *  Reading `property.base_rate_suite` directly anywhere else is a bug. */
export function getPropertyRate(propertyCode: string, roomTypeInput: string): RateLookup {
  const property = getProperty(propertyCode)
  if (!property) {
    return { ok: false, reason: `No property ${propertyCode} in the directory.`, flag: null, citation: null }
  }
  const citation = citations.property(property.property_code, property.property_name)

  const roomType = normalizeRoomType(roomTypeInput)
  if (!roomType) {
    return {
      ok: false,
      reason: `"${roomTypeInput}" is not a room type we recognise at ${property.property_name}. Ask the guest which room class they mean rather than guessing.`,
      flag: null,
      citation,
    }
  }

  const column = RATE_COLUMN_FOR_ROOM[roomType]
  const rateField = `base_rate_${column}` as 'base_rate_standard' | 'base_rate_deluxe' | 'base_rate_suite'
  const flag = property.data_quality_flags.find((f) => f.startsWith(`${rateField}_`)) ?? null
  if (flag) {
    return {
      ok: false,
      reason: `The ${column} rate for ${property.property_name} failed validation (${flag}) and is quarantined. We cannot quote a ${roomType} price here. Route to Sales or GM ${property.general_manager} for a rate rather than estimating one.`,
      flag,
      citation,
    }
  }

  const nightly = property[rateField]
  if (typeof nightly !== 'number' || !Number.isFinite(nightly) || nightly <= 0) {
    return {
      ok: false,
      reason: `${rateField} for ${property.property_name} is not a usable rate.`,
      flag: 'rate_unusable',
      citation,
    }
  }

  return {
    ok: true,
    property_code: property.property_code,
    room_type: roomType,
    rate_field: rateField,
    nightly_rate: nightly,
    nightly_rate_cents: toCents(nightly),
    citation,
  }
}

/** True when the named field on this property failed validation and must not be used. */
export function isQuarantined(propertyCode: string, field: string): boolean {
  const property = getProperty(propertyCode)
  if (!property) return false
  return property.data_quality_flags.some((f) => f.startsWith(`${field}_`))
}

export function getDataQuality(): typeof dataQualityJson {
  return dataQualityJson
}

// ----------------------------------------------------------------- guests, reservations

export type GuestLookup =
  | { status: 'found'; guest: GeneratedGuest; matched_on: 'phone' | 'email' | 'last4' }
  | { status: 'ambiguous'; candidates: GeneratedGuest[]; reason: string }
  | { status: 'not_found'; reason: string }

export function getGuest(guestId: string | null | undefined): GeneratedGuest | null {
  if (!guestId) return null
  return byGuestId.get(guestId.trim().toUpperCase()) ?? null
}

/** Matches an inbound caller against the profile set without any phone number being stored.
 *
 *  A full number hashes to an exact key. Only four digits is genuinely ambiguous in this data
 *  (G10001 and G10020 both end 0148; G10007 and G10015 both end 0177), so we return
 *  `ambiguous` and the agent must ask a second question. Guessing here would attach the wrong
 *  reservation to a caller, which is the worst failure mode this system has. */
export function getGuestByPhone(phone: string | null | undefined): GuestLookup {
  const digits = normalizePhone(phone)
  if (digits.length === 0) {
    return { status: 'not_found', reason: 'No phone number supplied.' }
  }

  if (digits.length >= 7) {
    const exact = byPhoneLookup.get(phoneLookupKey(digits))
    if (exact) return { status: 'found', guest: exact, matched_on: 'phone' }
    return {
      status: 'not_found',
      reason: 'That number does not match any guest profile. Ask for a confirmation number or the name on the reservation.',
    }
  }

  const tail = digits.slice(-4)
  const candidates = guests.filter((g) => g.phone_masked.endsWith(tail))
  if (candidates.length === 1) return { status: 'found', guest: candidates[0], matched_on: 'last4' }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates,
      reason: `${candidates.length} guest profiles end in ${tail}. Ask for the full number, a confirmation number, or the property and dates before pulling up an account.`,
    }
  }
  return { status: 'not_found', reason: `No guest profile ends in ${tail}.` }
}

export function getGuestByEmail(email: string | null | undefined): GuestLookup {
  const key = emailLookupKey(email)
  if (!key) return { status: 'not_found', reason: 'No usable email address supplied.' }
  const hit = byEmailLookup.get(key)
  return hit
    ? { status: 'found', guest: hit, matched_on: 'email' }
    : { status: 'not_found', reason: 'That email does not match any guest profile.' }
}

export function getReservation(reservationId: string | null | undefined): Reservation | null {
  if (!reservationId) return null
  return byReservationId.get(reservationId.trim().toUpperCase()) ?? null
}

export function listReservationsForGuest(guestId: string): Reservation[] {
  return reservations.filter((r) => r.guest_id === guestId)
}

export function listReservations(): Reservation[] {
  return reservations
}

export function listGuests(): GeneratedGuest[] {
  return guests
}

// --------------------------------------------------- A3 compatibility surface
// `netlify/functions/tools/_deps.ts` declares the plural accessor names it expects from this
// module. They are aliases, kept so that boundary file never has to change. Prefer the
// `list*` names in new code.
export const getGuests = listGuests
export const getReservations = listReservations
export const getProperties = listProperties
export const getPolicies = listPolicies

// ----------------------------------------------------------------------------- policies

export function listPolicies(): PolicySection[] {
  return policies
}

/** Accepts `5`, `"5"` or `"policy:5"`. */
export function getPolicySection(ref: number | string): PolicySection | null {
  const id = typeof ref === 'number' ? `policy:${ref}` : ref.startsWith('policy:') ? ref : `policy:${ref}`
  return byPolicyId.get(id) ?? null
}

export interface PolicyHit {
  section: PolicySection
  score: number
  snippet: string
  citation: Citation
}

// Guests do not use our vocabulary. This maps how people actually ask onto the words the
// policy document uses. It expands the query only; it never invents an answer.
const SYNONYMS: Record<string, string[]> = {
  cancel: ['cancellation', 'cancelled', 'refund'],
  cancelling: ['cancellation', 'refund'],
  refund: ['refund', 'service recovery', 'cancellation'],
  money: ['refund', 'charge', 'fee'],
  charge: ['charged', 'fee', 'forfeits'],
  charged: ['charged', 'fee', 'forfeits', 'no-show'],
  pet: ['pets', 'service animal'],
  dog: ['service animal', 'pets'],
  animal: ['service animal', 'pets'],
  checkout: ['check-out', 'late check-out'],
  checkin: ['check-in', 'early check-in'],
  early: ['early check-in', 'availability'],
  late: ['late check-out', 'discretion'],
  upgrade: ['upgrade', 'loyalty', 'platinum', 'gold'],
  loyalty: ['loyalty', 'platinum', 'gold', 'silver'],
  smoke: ['smoking', 'vaping', 'smoke-free'],
  smoking: ['smoking', 'vaping', 'cleaning fee'],
  vape: ['vaping', 'e-cigarettes'],
  parking: ['parking', 'valet'],
  // Guests describe leaving something behind without ever saying "lost and found".
  lost: ['lost and found'],
  left: ['lost and found', 'left behind'],
  forgot: ['lost and found', 'left behind'],
  laptop: ['lost and found', 'electronics'],
  wallet: ['lost and found'],
  jewelry: ['lost and found', 'jewelry'],
  belongings: ['lost and found'],
  luggage: ['lost and found'],
  // ...and describe a no-show as "never turned up".
  noshow: ['no-show'],
  showed: ['no-show'],
  show: ['no-show'],
  turned: ['no-show'],
  missed: ['no-show', 'cancellation'],
  comp: ['comp', 'comped', 'service recovery'],
  deposit: ['incidental hold', 'deposit', 'photo id'],
  id: ['photo id', 'verification'],
  group: ['group block', 'sales'],
  block: ['group block'],
  escalate: ['escalation', 'manager', 'agm'],
  complaint: ['service recovery', 'escalation'],
  noise: ['service recovery', 'service failure'],
  rollaway: ['rollaway', 'extra guests'],
  crib: ['rollaway', 'extra guests'],
  kids: ['kids', 'extra guests'],
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'i', 'my', 'me',
  'we', 'you', 'your', 'it', 'to', 'of', 'for', 'in', 'on', 'at', 'and', 'or', 'if', 'what',
  'how', 'when', 'about', 'with', 'this', 'that', 'be', 'get', 'got', 'have', 'has',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Scored keyword retrieval over the 15 policy sections. Small enough that a full scan is
 *  faster than any index, and unlike an embedding it is fully explainable on stage: the score
 *  is "how many of your words, and their synonyms, appear in this section". */
export function searchPolicies(query: string, limit = 3): PolicyHit[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const expanded = new Set<string>(tokens)
  for (const token of tokens) for (const syn of SYNONYMS[token] ?? []) expanded.add(syn.toLowerCase())

  const hits: PolicyHit[] = []
  for (const section of policies) {
    const title = section.title.toLowerCase()
    const body = section.body.toLowerCase()
    let score = 0
    for (const term of expanded) {
      if (title.includes(term)) score += 4
      const occurrences = body.split(term).length - 1
      if (occurrences > 0) score += Math.min(occurrences, 3)
    }
    if (score > 0) {
      hits.push({
        section,
        score,
        snippet: snippetFor(section, expanded),
        citation: citations.policy(section.number, section.title),
      })
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.section.number - b.section.number).slice(0, limit)
}

function snippetFor(section: PolicySection, terms: Set<string>): string {
  const sentences = section.body.split(/(?<=[.?!])\s+/)
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    for (const term of terms) if (lower.includes(term)) return sentence.trim()
  }
  return section.body.slice(0, 180).trim()
}

// ---------------------------------------------------------------------------- inquiries

function toPublic(record: InquiryRecord): PublicInquiry {
  const { dataset_notes: _notes, contact_email: _email, contact_phone: _phone, ...rest } = record
  return { ...rest, contact_email: null, contact_phone: null }
}

/** The inquiry inbox. Raw contact details and the challenge author's commentary are stripped;
 *  `contact_email_masked` / `contact_phone_masked` are what the rep sees. */
export function listInquiries(): PublicInquiry[] {
  return inquiries.map(toPublic)
}

export function getInquiry(inquiryId: string | null | undefined): PublicInquiry | null {
  if (!inquiryId) return null
  const record = byInquiryId.get(inquiryId.trim().toUpperCase())
  return record ? toPublic(record) : null
}

export interface DeliveryTarget {
  inquiry_id: string
  channel: 'email' | 'sms'
  address: string
  masked: string
}

/** Resolves the real address for the send path, and ONLY the send path.
 *  Email wins when present; an inquiry that arrived by phone falls back to SMS, which is
 *  demo path 2. Callers must write the resulting send to `audit_log`. */
export function getInquiryDeliveryTarget(inquiryId: string): DeliveryTarget | null {
  const record = byInquiryId.get(inquiryId.trim().toUpperCase())
  if (!record) return null
  if (record.contact_email) {
    return {
      inquiry_id: record.inquiry_id,
      channel: 'email',
      address: record.contact_email,
      masked: record.contact_email_masked,
    }
  }
  if (record.contact_phone) {
    return {
      inquiry_id: record.inquiry_id,
      channel: 'sms',
      address: record.contact_phone,
      masked: record.contact_phone_masked,
    }
  }
  return null
}

/** Tests and offline evaluation only. `dataset_notes` is the challenge author's answer key;
 *  putting it in front of the agent would make every demo a lie. */
export function listInquiriesWithDatasetNotes(): InquiryRecord[] {
  return inquiries
}

/** What to ask the guest for each blocking gap, so clarifying questions read consistently
 *  whether they come from chat, voice, or the group-sales side chat. */
export const MISSING_FIELD_PROMPTS: Record<string, string> = {
  company_name: 'Which organisation should the block be held under?',
  contact_name: 'Who should we put down as the main contact for the block?',
  contact_channel: 'What is the best email or mobile number to send the proposal to?',
  preferred_property_code: 'Which Solstice property did you have in mind?',
  arrival_date: 'What is the arrival date?',
  departure_date: 'What is the departure date?',
  rooms_requested: 'How many rooms do you need? An exact number lets us hold inventory.',
  meeting_capacity_needed: 'How many people need to be seated in the meeting space?',
  rooms_requested_is_approximate: 'You mentioned an approximate room count. Can you confirm the exact number?',
  room_type_preference: 'Any preference on room type: standard king, standard double, or deluxe?',
  requested_discount_pct: 'Is there a target rate or discount you are working towards?',
  stated_budget_per_night: 'What nightly budget are you working with?',
  nights: 'How many nights will the group be staying?',
  contact_phone: 'Is there a mobile number we can reach you on?',
  contact_email: 'What email should the proposal go to?',
}

// -------------------------------------------------------------------------- self-checks

const LOYALTY_TIERS: LoyaltyTier[] = ['None', 'Silver', 'Gold', 'Platinum']
const MARKET_TYPES = ['Urban', 'Resort']
const RATE_PLANS = ['Best Available Rate', 'Advance Purchase', 'Corporate Negotiated', 'Loyalty Redemption']
const RESERVATION_STATUSES = ['Confirmed', 'Cancelled', 'Checked-in', 'Checked-out', 'No-show']

/** Re-checks every union the JSON import widened to `string`, plus the invariants the rest of
 *  this file assumes. Called from the vitest suite, so a bad regeneration fails in CI rather
 *  than at 2am in front of a panel. Returns the problems; empty array means clean. */
export function assertGeneratedData(): string[] {
  const problems: string[] = []

  for (const p of properties) {
    if (!MARKET_TYPES.includes(p.market_type)) problems.push(`${p.property_code}: market_type "${p.market_type}"`)
    if (!Array.isArray(p.blackout_dates)) problems.push(`${p.property_code}: blackout_dates is not an array`)
    if (!Array.isArray(p.data_quality_flags)) problems.push(`${p.property_code}: data_quality_flags is not an array`)
  }
  for (const g of guests) {
    if (!LOYALTY_TIERS.includes(g.loyalty_tier)) problems.push(`${g.guest_id}: loyalty_tier "${g.loyalty_tier}"`)
    if (g.email_masked.includes('@') && !g.email_masked.startsWith(`${g.email_masked[0]}***@`)) {
      problems.push(`${g.guest_id}: email_masked "${g.email_masked}" is not masked`)
    }
    if (/\d{5,}/.test(g.phone_masked.replace(/\D/g, ''))) {
      problems.push(`${g.guest_id}: phone_masked "${g.phone_masked}" exposes more than four digits`)
    }
  }
  for (const r of reservations) {
    if (!RATE_PLANS.includes(r.rate_plan)) problems.push(`${r.reservation_id}: rate_plan "${r.rate_plan}"`)
    if (!RESERVATION_STATUSES.includes(r.status)) problems.push(`${r.reservation_id}: status "${r.status}"`)
    if (r.payment_last4.length > 4) problems.push(`${r.reservation_id}: payment_last4 "${r.payment_last4}"`)
    if (!byPropertyCode.has(r.property_code)) problems.push(`${r.reservation_id}: unknown property ${r.property_code}`)
    if (!byGuestId.has(r.guest_id)) problems.push(`${r.reservation_id}: unknown guest ${r.guest_id}`)
  }
  if (policies.length !== 15) problems.push(`expected 15 policy sections, found ${policies.length}`)
  for (const i of inquiries) {
    if (i.preferred_property_code && !byPropertyCode.has(i.preferred_property_code)) {
      problems.push(`${i.inquiry_id}: unknown property ${i.preferred_property_code}`)
    }
  }
  return problems
}
