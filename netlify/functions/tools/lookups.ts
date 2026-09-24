/**
 * Record resolution for the concierge tools.
 *
 * The lookups themselves belong to the data layer (`_lib/data.ts`); this file owns the business
 * question on top of them: "which record did the guest mean, and have we actually proved it is
 * theirs?" Those are two different questions and only the second one is a guardrail.
 */
import type { Guest, Property, Reservation } from '../../../shared/types'
import {
  findGuestsByName,
  getGuest,
  getGuestByEmail,
  getGuestByPhone,
  getProperty,
  getReservation,
  listReservationsForGuest,
} from './_deps'
import { loadProperties } from './_deps'
import { normalizeText } from './helpers'

export async function findReservationById(reservationId: string): Promise<Reservation | null> {
  return getReservation(reservationId)
}

export async function findGuestById(guestId: string): Promise<Guest | null> {
  return getGuest(guestId)
}

export async function findPropertyByCode(propertyCode: string): Promise<Property | null> {
  return getProperty(propertyCode)
}

export type PropertyResolution =
  | { status: 'found'; property: Property; matched_on: 'code' | 'city' | 'name' }
  | { status: 'ambiguous'; candidates: Array<{ property_code: string; property_name: string; city: string }> }
  | { status: 'not_found' }

/**
 * Guests say "the Columbus hotel", not "SOL-CMH", and a caller on the phone certainly does.
 * Resolve a code, a city or a property name, and return `ambiguous` rather than picking when
 * more than one fits: telling someone the wrong hotel's facts is a quiet way to be wrong.
 */
export async function resolveProperty(input: string): Promise<PropertyResolution> {
  const raw = input.trim()
  if (raw === '') return { status: 'not_found' }

  const direct = getProperty(raw) ?? getProperty(`SOL-${raw.replace(/^sol-/i, '')}`)
  if (direct) return { status: 'found', property: direct, matched_on: 'code' }

  const needle = normalizeText(raw)
  const all = await loadProperties()

  const byCity = all.filter((p) => normalizeText(p.city) === needle || needle.includes(normalizeText(p.city)))
  if (byCity.length === 1) return { status: 'found', property: byCity[0], matched_on: 'city' }
  if (byCity.length > 1) return { status: 'ambiguous', candidates: byCity.map(describe) }

  const byName = all.filter((p) => normalizeText(p.property_name).includes(needle) || needle.includes(normalizeText(p.property_name)))
  if (byName.length === 1) return { status: 'found', property: byName[0], matched_on: 'name' }
  if (byName.length > 1) return { status: 'ambiguous', candidates: byName.map(describe) }

  return { status: 'not_found' }
}

function describe(p: Property): { property_code: string; property_name: string; city: string } {
  return { property_code: p.property_code, property_name: p.property_name, city: p.city }
}

export async function reservationsForGuest(guestId: string): Promise<Reservation[]> {
  return listReservationsForGuest(guestId.trim().toUpperCase())
}

/**
 * Chooses the stay a guest is most likely asking about when they give a guest id and no
 * reservation id: the one in progress, else the next one starting, else the most recent one
 * that ended.
 */
export function pickRelevantReservation(reservations: Reservation[], now: Date): Reservation | null {
  if (reservations.length === 0) return null
  const live = reservations.filter((r) => r.status === 'Checked-in')
  if (live.length > 0) return live[0]

  const active = reservations.filter((r) => r.status === 'Confirmed')
  const upcoming = active
    .filter((r) => new Date(`${r.check_in_date}T00:00:00Z`).getTime() >= now.getTime())
    .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))
  if (upcoming.length > 0) return upcoming[0]

  const past = [...reservations].sort((a, b) => b.check_out_date.localeCompare(a.check_out_date))
  return past[0] ?? null
}

// ------------------------------------------------------------------ identity resolution

export interface IdentityQuery {
  guest_id?: string
  reservation_id?: string
  phone?: string
  email?: string
  last_name?: string
  first_name?: string
}

export type IdentityResult =
  /** Verified: a strong factor matched exactly one record. */
  | { status: 'found'; guest: Guest; matched_on: string[] }
  /** More than one person fits. NEVER pick one; ask. */
  | { status: 'ambiguous'; count: number; reason: string; disambiguator: string }
  /** Exactly one person fits, but only on a name, which is not proof of anything. */
  | { status: 'needs_second_factor'; reason: string; disambiguator: string }
  | { status: 'not_found'; reason: string }

const CONFIRMATION = 'confirmation_number'

/**
 * Identity resolution, in strength order. A name is never a verification factor: the provided
 * data holds two unrelated guests called Michael Smith, and the phone lookup returns `ambiguous`
 * rather than guessing when only the last four digits are known, because two pairs of guests
 * share theirs. Attaching the wrong reservation to a caller is the worst failure this system
 * has, so every uncertain path ends in a question rather than a record.
 */
export async function resolveIdentity(query: IdentityQuery): Promise<IdentityResult> {
  if (query.guest_id) {
    const guest = getGuest(query.guest_id)
    return guest
      ? { status: 'found', guest, matched_on: ['guest_id'] }
      : { status: 'not_found', reason: `No guest profile ${query.guest_id}.` }
  }

  if (query.reservation_id) {
    const reservation = getReservation(query.reservation_id)
    if (!reservation) {
      return {
        status: 'not_found',
        reason: `No reservation ${query.reservation_id}. Ask the guest to re-read the confirmation number from their booking email.`,
      }
    }
    const guest = getGuest(reservation.guest_id)
    if (!guest) return { status: 'not_found', reason: `Reservation ${reservation.reservation_id} has no guest profile attached.` }
    const matched = ['reservation_id']
    if (query.last_name && normalizeText(guest.last_name) === normalizeText(query.last_name)) matched.push('last_name')
    return { status: 'found', guest, matched_on: matched }
  }

  if (query.phone) {
    const hit = getGuestByPhone(query.phone)
    if (hit.status === 'found') return { status: 'found', guest: hit.guest, matched_on: ['phone', hit.matched_on] }
    if (hit.status === 'ambiguous') {
      return { status: 'ambiguous', count: hit.candidates.length, reason: hit.reason, disambiguator: CONFIRMATION }
    }
    if (!query.email && !query.last_name && !query.first_name) return { status: 'not_found', reason: hit.reason }
  }

  if (query.email) {
    const hit = getGuestByEmail(query.email)
    if (hit.status === 'found') return { status: 'found', guest: hit.guest, matched_on: ['email'] }
    if (hit.status === 'ambiguous') {
      return { status: 'ambiguous', count: hit.candidates.length, reason: hit.reason, disambiguator: CONFIRMATION }
    }
    if (!query.last_name && !query.first_name) return { status: 'not_found', reason: hit.reason }
  }

  const name = [query.first_name, query.last_name].filter(Boolean).join(' ').trim()
  if (name) {
    const hits = findGuestsByName(name)
    if (hits.length === 0) {
      return {
        status: 'not_found',
        reason: `No guest profile matches "${name}". Ask the guest to confirm the spelling, or for the confirmation number.`,
      }
    }
    if (hits.length > 1) {
      return {
        status: 'ambiguous',
        count: hits.length,
        reason: `${hits.length} guest profiles match that name. Ask for the confirmation number, or the phone number or email on the booking, before releasing any stay detail.`,
        disambiguator: CONFIRMATION,
      }
    }
    return {
      status: 'needs_second_factor',
      reason:
        'A name alone is not enough to verify a guest, even when only one profile matches. Ask for the confirmation number, or the phone number or email on the booking, before releasing any stay detail.',
      disambiguator: CONFIRMATION,
    }
  }

  return { status: 'not_found', reason: 'No identifying detail supplied.' }
}
