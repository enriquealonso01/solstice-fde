/**
 * SINGLE IMPORT BOUNDARY for the group booking tools.
 *
 * Two jobs:
 *  1. The `ToolResult` envelope helpers, so every group tool answers in the shape both agent
 *     runtimes expect.
 *  2. The DATA SEAM. The group engine never reaches for a file or a database itself; it asks
 *     this module. The default source is `netlify/functions/_lib/data.ts`, which serves
 *     data/generated/*.json, built deterministically from the four provided files. There is
 *     exactly one copy of the hotel data in this repository and this is how everything reaches
 *     it.
 *
 * Note what `listInquiries()` does NOT return: the real contact details, and the challenge
 * author's own commentary on each row. The commentary is an answer key, and an engine that can
 * read the answer key has proved nothing. The real address is reachable only through
 * `loadInquiryContact` below.
 */

import type { Citation, GroupInquiry, Property, ToolResult } from '../../../shared/types'
import { maskEmail, maskPhone } from '../_lib/mask'
import {
  getInquiryDeliveryTarget,
  listInquiries as listGeneratedInquiries,
  listProperties as listGeneratedProperties,
} from '../_lib/data'
import { tryGetDb } from '../_lib/db'

// ---------------------------------------------------------------- envelope

export interface EnvelopeOptions {
  citations?: Citation[]
  masked_fields?: string[]
  latency_ms?: number
}

/** Grounded success: the answer came from the provided data. */
export function ok<T>(data: T, opts: EnvelopeOptions = {}): ToolResult<T> {
  return {
    ok: true,
    data,
    grounded: true,
    citations: opts.citations,
    masked_fields: opts.masked_fields,
    latency_ms: opts.latency_ms,
  }
}

/** Hard failure. The agent must say so and escalate; it must never fill the gap itself. */
export function fail(error: string, opts: EnvelopeOptions = {}): ToolResult<never> {
  return {
    ok: false,
    grounded: false,
    error,
    citations: opts.citations,
    masked_fields: opts.masked_fields,
    latency_ms: opts.latency_ms,
  }
}

/**
 * We have data, but it does not answer the question that was asked. The canonical case in the
 * group workflow is SOL-PVD's referral to a Boston-area sister property: the referral is real
 * and citable, the inventory and rates at that hotel are not in any system we can see, and the
 * only honest answer is "we are passing this on", never an invented rate.
 */
export function ungrounded<T>(data: T, opts: EnvelopeOptions = {}): ToolResult<T> {
  return { ...ok(data, opts), grounded: false }
}

export function propertyCitation(code: string, name: string): Citation {
  return { source: 'property', ref: `property:${code}`, label: name }
}

export function inquiryCitation(id: string, company: string): Citation {
  return { source: 'inquiry', ref: `inquiry:${id}`, label: `${id} — ${company}` }
}

export function policyCitation(section: string, label: string): Citation {
  return { source: 'policy', ref: `policy:${section}`, label }
}

// ---------------------------------------------------------------- data seam

/** Columns the shared `GroupInquiry` interface does not model, carried alongside so the engine
 *  can ask the questions the export can actually answer. */
export interface InquiryContext {
  date_received: string
  nights: number | null
  stated_budget_per_night: number | null
  meeting_space_needed: boolean
  /** What the customer literally wrote, e.g. "around 25". Quoted back in a question rather
   *  than rounded into a number we then hold inventory against. */
  raw_rooms?: string
}

/** Contact details, split so the real address is only ever reached on the send path.
 *  Everything a screen or a prompt sees uses the masked pair. */
export interface InquiryContact {
  email: string | null
  phone: string | null
  email_masked: string
  phone_masked: string
}

export interface GroupDataSource {
  name: string
  properties(): Promise<Property[]> | Property[]
  inquiries(): Promise<GroupInquiry[]> | GroupInquiry[]
  inquiryContext?(id: string): Promise<InquiryContext | null> | InquiryContext | null
  /** Only `send_proposal` calls this. */
  contactFor?(id: string): Promise<InquiryContact | null> | InquiryContact | null
}

export const GENERATED_SOURCE: GroupDataSource = {
  name: 'data/generated (built from data/solstice-*.csv)',
  properties: () => listGeneratedProperties(),
  inquiries: () => listGeneratedInquiries(),
  inquiryContext: (id) => {
    const record = listGeneratedInquiries().find((i) => i.inquiry_id === id)
    if (!record) return null
    return {
      date_received: record.date_received ?? '',
      nights: record.nights,
      stated_budget_per_night: record.stated_budget_per_night,
      meeting_space_needed: record.meeting_space_needed,
      raw_rooms: record.rooms_requested_raw ?? undefined,
    }
  },
  contactFor: (id) => {
    const record = listGeneratedInquiries().find((i) => i.inquiry_id === id)
    if (!record) return null
    const target = getInquiryDeliveryTarget(id)
    return {
      email: target?.channel === 'email' ? target.address : null,
      phone: target?.channel === 'sms' ? target.address : null,
      email_masked: record.contact_email_masked ?? '',
      phone_masked: record.contact_phone_masked ?? '',
    }
  },
}

/**
 * Inquiries opened at runtime, by Sol on a phone call. They are not in the generated dataset,
 * because they did not exist when it was built, and every tool that takes an inquiry_id has to
 * be able to see them or the phone-only demo path dead-ends the moment the call ends.
 *
 * They are ALSO written to the `inquiries` table by `create_inquiry`; this overlay is what makes
 * them visible within the same request, before and regardless of that write.
 */
const runtimeInquiries = new Map<string, { inquiry: GroupInquiry; contact: InquiryContact; context: InquiryContext }>()

export function registerInquiry(
  inquiry: GroupInquiry,
  context: Partial<InquiryContext> = {},
): void {
  runtimeInquiries.set(inquiry.inquiry_id, {
    inquiry,
    contact: {
      // An inquiry rebuilt from a persisted row carries masked values; they are never a raw address.
      email: unmasked(inquiry.contact_email),
      phone: unmasked(inquiry.contact_phone),
      email_masked: maskEmail(inquiry.contact_email),
      phone_masked: maskPhone(inquiry.contact_phone),
    },
    context: {
      date_received: context.date_received ?? new Date().toISOString().slice(0, 10),
      nights: context.nights ?? null,
      stated_budget_per_night: context.stated_budget_per_night ?? null,
      meeting_space_needed: context.meeting_space_needed ?? false,
      raw_rooms: context.raw_rooms,
    },
  })
}

export function registeredInquiries(): GroupInquiry[] {
  return [...runtimeInquiries.values()].map((entry) => entry.inquiry)
}

export function resetRegisteredInquiries(): void {
  runtimeInquiries.clear()
}

let source: GroupDataSource = GENERATED_SOURCE

/** Test seam, and the hook a future PMS integration plugs into: swap the whole dataset without
 *  touching a single rule. */
export function setGroupDataSource(next: GroupDataSource): void {
  source = next
}

export function resetGroupDataSource(): void {
  source = GENERATED_SOURCE
}

export function currentSourceName(): string {
  return source.name
}

export async function loadProperties(): Promise<Property[]> {
  return await source.properties()
}

export async function loadProperty(code: string): Promise<Property | null> {
  const all = await loadProperties()
  return all.find((p) => p.property_code === code) ?? null
}

/* ------------------------------------------------------------------ *
 * Rehydrating inquiries taken on the phone                             *
 * ------------------------------------------------------------------ */

/**
 * Inquiries taken on a call, read back from the `inquiries` table so they survive a cold start.
 * The payload holds only the masked contact: the rules see a reachable customer, and delivery,
 * which needs the raw address from `inquiry_contacts`, can never send to a row of asterisks.
 */
export interface PersistedInquiryRow {
  inquiry_code: string
  source: string
  payload: Record<string, unknown> | null
  missing_fields: string[] | null
}

/** Per-instance cache. Rehydration is a read of at most a handful of rows, but the inbox, the
 *  detail view and every tool call would otherwise each pay for it. */
let rehydrated: Map<string, RehydratedInquiry> | null = null

export interface RehydratedInquiry {
  inquiry: GroupInquiry
  context: InquiryContext
  contact: InquiryContact
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function rehydrateInquiryRow(row: PersistedInquiryRow): RehydratedInquiry | null {
  const payload = row.payload
  if (!payload) return null

  const source_ = row.source === 'voice' || row.source === 'manual' ? row.source : 'portal'

  const inquiry: GroupInquiry = {
    inquiry_id: row.inquiry_code,
    source: source_,
    company_name: str(payload.company_name) ?? row.inquiry_code,
    contact_name: str(payload.contact_name) ?? '',
    // Masked, deliberately, even when a legacy row still carries a raw value. See the note above.
    contact_email: maskEmail(str(payload.contact_email)) || null,
    contact_phone: maskPhone(str(payload.contact_phone)) || null,
    event_type: str(payload.event_type) ?? '',
    preferred_property_code: str(payload.preferred_property_code) ?? '',
    alternate_property_ok: payload.alternate_property_ok === true,
    arrival_date: str(payload.arrival_date),
    departure_date: str(payload.departure_date),
    rooms_requested: num(payload.rooms_requested),
    room_type_preference: str(payload.room_type_preference),
    requested_discount_pct: num(payload.requested_discount_pct),
    meeting_capacity_needed: num(payload.meeting_capacity_needed),
    special_requests: str(payload.special_requests),
    missing_fields: Array.isArray(row.missing_fields) ? row.missing_fields : [],
  }

  return {
    inquiry,
    context: {
      date_received: str(payload.date_received) ?? new Date().toISOString().slice(0, 10),
      nights: num(payload.nights),
      stated_budget_per_night: num(payload.stated_budget_per_night),
      meeting_space_needed: payload.meeting_space_needed === true,
    },
    contact: {
      // Null on purpose: a raw address is read only from inquiry_contacts, never from the payload,
      // which staff can read. Masked again in case a legacy row still carries a raw value.
      email: null,
      phone: null,
      email_masked: maskEmail(str(payload.contact_email)),
      phone_masked: maskPhone(str(payload.contact_phone)),
    },
  }
}

/** Never throws. A database that is not there must degrade to exactly the previous behaviour
 *  rather than take the whole group inbox down with it. */
async function rehydratedInquiries(): Promise<Map<string, RehydratedInquiry>> {
  if (rehydrated) return rehydrated
  const empty = new Map<string, RehydratedInquiry>()
  const db = tryGetDb()
  if (!db) return empty
  try {
    const { data, error } = await db
      .from('inquiries')
      .select('inquiry_code, source, payload, missing_fields')
    if (error || !data) return empty

    const next = new Map<string, RehydratedInquiry>()
    for (const row of data as PersistedInquiryRow[]) {
      const entry = rehydrateInquiryRow(row)
      if (entry) next.set(entry.inquiry.inquiry_id, entry)
    }
    rehydrated = next
    return next
  } catch {
    return empty
  }
}

/** Test seam, and the hook for anything that writes an inquiry and then reads it back. */
export function resetRehydratedInquiries(): void {
  rehydrated = null
}

export async function loadInquiries(): Promise<GroupInquiry[]> {
  const seeded = await source.inquiries()
  const runtime = registeredInquiries()

  // Additive by construction: a persisted row is used only when neither the generated dataset nor
  // this instance's memory already has that code. The inbox can gain a row; it cannot lose one.
  const known = new Set([...seeded, ...runtime].map((i) => i.inquiry_id))
  const restored = [...(await rehydratedInquiries()).values()]
    .filter((entry) => !known.has(entry.inquiry.inquiry_id))
    .map((entry) => entry.inquiry)

  return [...seeded, ...runtime, ...restored]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const codeByRowId = new Map<string, string>()

/** Every tool here speaks in `INQ-2001`, but the admin UI reads inquiries straight from Postgres,
 *  where the primary key is a uuid. Accept either rather than making the caller guess which one
 *  this particular entry point wanted. Cached: inquiry ids never move. */
async function toInquiryCode(idOrCode: string): Promise<string> {
  if (!UUID_RE.test(idOrCode)) return idOrCode
  const cached = codeByRowId.get(idOrCode)
  if (cached) return cached
  const db = tryGetDb()
  if (!db) return idOrCode
  const { data, error } = await db
    .from('inquiries')
    .select('inquiry_code')
    .eq('id', idOrCode)
    .limit(1)
  if (error || !data?.[0]) return idOrCode
  const code = (data[0] as { inquiry_code: string }).inquiry_code
  codeByRowId.set(idOrCode, code)
  return code
}

export async function loadInquiry(id: string): Promise<GroupInquiry | null> {
  const code = await toInquiryCode(id)
  const runtime = runtimeInquiries.get(code)
  if (runtime) return runtime.inquiry
  const all = await source.inquiries()
  const seeded = all.find((i) => i.inquiry_id === code)
  if (seeded) return seeded
  return (await rehydratedInquiries()).get(code)?.inquiry ?? null
}

export async function loadInquiryContext(id: string): Promise<InquiryContext | null> {
  const code = await toInquiryCode(id)
  const runtime = runtimeInquiries.get(code)
  if (runtime) return runtime.context
  const seeded = source.inquiryContext ? await source.inquiryContext(code) : null
  if (seeded) return seeded
  return (await rehydratedInquiries()).get(code)?.context ?? null
}

/**
 * The raw address is used only to send; screens and the rules read the masked pair. Each raw field
 * comes from this instance's memory, else `inquiry_contacts`, else the generated dataset.
 */
export async function loadInquiryContact(id: string): Promise<InquiryContact | null> {
  const code = await toInquiryCode(id)
  const runtime = runtimeInquiries.get(code)?.contact
  if (runtime?.email && runtime.phone) return runtime

  const found = [
    runtime,
    await storedInquiryContact(code),
    source.contactFor ? await source.contactFor(code) : null,
    // Masked pair only: the rules see a reachable customer while delivery routes to a human.
    (await rehydratedInquiries()).get(code)?.contact,
  ].filter((c): c is InquiryContact => Boolean(c))
  if (found.length === 0) return null

  const first = (key: keyof InquiryContact) => found.find((c) => c[key])?.[key] ?? null
  const email = first('email')
  const phone = first('phone')
  return {
    email,
    phone,
    email_masked: email ? maskEmail(email) : (first('email_masked') ?? ''),
    phone_masked: phone ? maskPhone(phone) : (first('phone_masked') ?? ''),
  }
}

/* ------------------------------------------------------------------ *
 * Raw contacts                                                         *
 * ------------------------------------------------------------------ */

// The raw email and phone of an inquiry live in `inquiry_contacts` (migration 007), which only the
// service role can read; `inquiries.payload`, which group sales can read, keeps the masked pair.
// Until 007 is applied the table is missing: the write reports false and the read falls through.

/** A value that is not a masked one, or null. */
function unmasked(value: string | null | undefined): string | null {
  return value && value.trim() && !value.includes('*') ? value.trim() : null
}

/** Call after the inquiry row is written: the contact row references it. */
export async function saveInquiryContact(inquiryCode: string): Promise<boolean> {
  const contact = runtimeInquiries.get(inquiryCode)?.contact
  const db = tryGetDb()
  const email = unmasked(contact?.email)
  const phone = unmasked(contact?.phone)
  if (!db || (!email && !phone)) return false
  // Only the fields we hold: an upsert leaves the columns it is not sent untouched.
  const row: Record<string, string> = { inquiry_code: inquiryCode }
  if (email) row.email = email
  if (phone) row.phone = phone
  try {
    const { error } = await db.from('inquiry_contacts').upsert(row, { onConflict: 'inquiry_code' })
    return !error
  } catch {
    return false
  }
}

async function storedInquiryContact(inquiryCode: string): Promise<InquiryContact | null> {
  const db = tryGetDb()
  if (!db) return null
  try {
    const { data, error } = await db
      .from('inquiry_contacts')
      .select('email, phone')
      .eq('inquiry_code', inquiryCode)
      .maybeSingle()
    if (error || !data) return null
    const row = data as { email: unknown; phone: unknown }
    const email = unmasked(str(row.email))
    const phone = unmasked(str(row.phone))
    if (!email && !phone) return null
    return { email, phone, email_masked: maskEmail(email), phone_masked: maskPhone(phone) }
  } catch {
    return null
  }
}
