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
 * `contactFor` below, which `send_proposal` alone calls.
 */

import type { Citation, GroupInquiry, Property, ToolResult } from '../../../shared/types'
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

export async function loadInquiries(): Promise<GroupInquiry[]> {
  return await source.inquiries()
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
  const all = await loadInquiries()
  return all.find((i) => i.inquiry_id === code) ?? null
}

export async function loadInquiryContext(id: string): Promise<InquiryContext | null> {
  if (!source.inquiryContext) return null
  return (await source.inquiryContext(await toInquiryCode(id))) ?? null
}

/** The send path, and the send path only. */
export async function loadInquiryContact(id: string): Promise<InquiryContact | null> {
  if (source.contactFor) {
    const contact = await source.contactFor(await toInquiryCode(id))
    if (contact) return contact
  }
  return null
}
