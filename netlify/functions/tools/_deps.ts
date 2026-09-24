/**
 * SINGLE IMPORT BOUNDARY between the concierge tool layer (A3) and the shared
 * primitives in `netlify/functions/_lib/` (A1).
 *
 * Every `_lib` import in this directory goes through THIS file and nowhere else,
 * so a change on A1's side is a one-file change here rather than a sweep.
 *
 * Accessors are re-exported as `async` even though A1 implements them
 * synchronously against bundled data: `await` on a non-promise is a no-op, and it
 * keeps this boundary stable if the data layer ever moves behind a network call.
 */
import {
  findGuestsByName,
  getGuest,
  getGuestByEmail,
  getGuestByPhone,
  getGuests,
  getPolicies,
  getProperties,
  getProperty,
  getPropertyRate,
  getReservation,
  getReservations,
  listReservationsForGuest,
  type GeneratedGuest,
  type GuestLookup,
  type PolicySection,
  type RateLookup,
} from '../_lib/data'
import { maskArgs, maskEmail, maskPhone } from '../_lib/mask'
import { ok, fail } from '../_lib/result'
import { tryGetDb } from '../_lib/db'

import type { Citation, Guest, Property, Reservation, ToolResult } from '../../../shared/types'

export type { GeneratedGuest, GuestLookup, PolicySection, RateLookup }

/**
 * Record access goes through A1's sanctioned lookups rather than scanning the arrays here.
 * Two of them exist specifically to stop this layer guessing:
 *  - `getGuestByPhone` returns `ambiguous` rather than picking, because two pairs of guests in
 *    this data share their last four digits.
 *  - `getPropertyRate` is the ONLY sanctioned path to a nightly rate; it is what quarantines
 *    SOL-PVD's -395 suite rate. Reading `property.base_rate_*` directly is a bug.
 */
export { findGuestsByName, getGuest, getGuestByEmail, getGuestByPhone, getProperty, getPropertyRate, getReservation, listReservationsForGuest }

export async function loadGuests(): Promise<Guest[]> {
  return await getGuests()
}

export async function loadReservations(): Promise<Reservation[]> {
  return await getReservations()
}

export async function loadProperties(): Promise<Property[]> {
  return await getProperties()
}

export async function loadPolicies(): Promise<PolicySection[]> {
  return await getPolicies()
}

export { maskArgs, maskEmail, maskPhone }

export interface EnvelopeOptions {
  citations?: Citation[]
  masked_fields?: string[]
}

/**
 * Grounded success. A1's `ok()` DERIVES `grounded` from the citations, so a result
 * that asserts a hotel fact must always pass them: no citation, no claim.
 */
export function toolOk<T>(data: T, opts: EnvelopeOptions = {}): ToolResult<T> {
  return ok(data, opts)
}

/**
 * Operational success: the tool worked and is reporting on ITSELF, not on the
 * hotel. Intent routing, "I could not verify who this is yet", "I need a
 * confirmation number". There is no policy, property, reservation or guest record
 * behind these, so there is nothing honest to cite, and treating them as
 * ungrounded would push Sol to escalate a question it should simply ask.
 *
 * NEVER use this for a policy, rate, availability or stay fact. Those go through
 * `toolOk` with citations, or they do not go out at all.
 */
export function toolState<T>(data: T, opts: EnvelopeOptions = {}): ToolResult<T> {
  return {
    ok: true,
    data,
    grounded: true,
    ...(opts.citations?.length ? { citations: opts.citations } : {}),
    ...(opts.masked_fields?.length ? { masked_fields: opts.masked_fields } : {}),
  }
}

/** Hard failure: no answer, and the agent must escalate rather than improvise. */
export function toolFail(error: string, opts: EnvelopeOptions = {}): ToolResult<never> {
  return fail<never>(error, opts)
}

/**
 * We have data, but it does not ground the question that was actually asked
 * (a rate plan no written policy covers, a value quarantined as impossible).
 * `grounded: false` obliges the agent to say it cannot confirm and to escalate.
 */
export function toolUngrounded<T>(data: T, opts: EnvelopeOptions = {}): ToolResult<T> {
  return { ...toolOk(data, opts), grounded: false }
}

export { tryGetDb as getDatabase }
