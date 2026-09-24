/**
 * SINGLE IMPORT BOUNDARY for the group booking tools.
 *
 * Two jobs:
 *  1. The `ToolResult` envelope helpers, so every group tool answers in the shape the agent
 *     runtimes expect. These match the contract A1 is building in `_lib/result.ts`; when that
 *     lands, the three functions below become one-line re-exports and nothing else moves.
 *  2. The DATA SEAM. The group engine never reaches for a file or a database directly. It asks
 *     this module, which serves whatever source has been installed. The default source is the
 *     seed copy of the provided CSVs, so the rules engine, the tools and the tests all run with
 *     zero I/O and zero dependency on whether Supabase has been seeded yet.
 *
 * `netlify/functions/group/index.ts` installs the real source at request time. Nothing in the
 * testable path imports A1's modules, which is deliberate: the ten inquiry outcomes have to be
 * provable on their own.
 */

import type { Citation, GroupInquiry, Property, ToolResult } from '../../../shared/types'
import { SEED_INQUIRIES, SEED_INQUIRY_CONTEXT, type InquiryContext } from '../../../src/lib/rules/fixtures/inquiries'
import { SEED_PROPERTIES } from '../../../src/lib/rules/fixtures/properties'

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
  /** Only `send_proposal` calls this. A source may hold the real address behind it. */
  contactFor?(id: string): Promise<InquiryContact | null> | InquiryContact | null
}

function maskEmailLocal(email: string | null): string {
  if (!email) return ''
  const at = email.lastIndexOf('@')
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***'
}

function maskPhoneLocal(phone: string | null): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return phone.replace(/\d/g, '*')
  let seen = 0
  const keepFrom = digits.length - 4
  let out = ''
  for (const ch of phone) {
    if (ch >= '0' && ch <= '9') {
      out += seen >= keepFrom ? ch : '*'
      seen += 1
    } else out += ch
  }
  return out
}

export const SEED_SOURCE: GroupDataSource = {
  name: 'seed (data/solstice-*.csv, transcribed)',
  properties: () => SEED_PROPERTIES,
  inquiries: () => SEED_INQUIRIES,
  inquiryContext: (id) => SEED_INQUIRY_CONTEXT[id] ?? null,
  contactFor: (id) => {
    const inquiry = SEED_INQUIRIES.find((i) => i.inquiry_id === id)
    if (!inquiry) return null
    return {
      email: inquiry.contact_email,
      phone: inquiry.contact_phone,
      email_masked: maskEmailLocal(inquiry.contact_email),
      phone_masked: maskPhoneLocal(inquiry.contact_phone),
    }
  },
}

let source: GroupDataSource = SEED_SOURCE

/** Installed by the function entry point once A1's data layer is available. */
export function setGroupDataSource(next: GroupDataSource): void {
  source = next
}

export function resetGroupDataSource(): void {
  source = SEED_SOURCE
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

export async function loadInquiry(id: string): Promise<GroupInquiry | null> {
  const all = await loadInquiries()
  return all.find((i) => i.inquiry_id === id) ?? null
}

export async function loadInquiryContext(id: string): Promise<InquiryContext | null> {
  if (!source.inquiryContext) return null
  return (await source.inquiryContext(id)) ?? null
}

/** The send path, and the send path only. Falls back to whatever is on the inquiry record
 *  when the installed source does not separate real from masked. */
export async function loadInquiryContact(id: string): Promise<InquiryContact | null> {
  if (source.contactFor) {
    const contact = await source.contactFor(id)
    if (contact) return contact
  }
  const inquiry = await loadInquiry(id)
  if (!inquiry) return null
  return {
    email: inquiry.contact_email,
    phone: inquiry.contact_phone,
    email_masked: maskEmailLocal(inquiry.contact_email),
    phone_masked: maskPhoneLocal(inquiry.contact_phone),
  }
}

export type { InquiryContext }
