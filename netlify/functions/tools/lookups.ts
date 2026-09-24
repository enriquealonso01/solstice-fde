/**
 * Record resolution shared by several concierge tools. Thin on purpose: the data
 * layer (A1) owns loading and masking; this file owns "which record did the guest
 * mean", which is a business question, not a data question.
 */
import type { Guest, Property, Reservation } from '../../../shared/types'
import { loadGuests, loadProperties, loadReservations } from './_deps'
import { normalizeText, phoneKey } from './helpers'

export async function findReservationById(reservationId: string): Promise<Reservation | null> {
  const wanted = reservationId.trim().toUpperCase()
  const all = await loadReservations()
  return all.find((r) => r.reservation_id.toUpperCase() === wanted) ?? null
}

export async function findGuestById(guestId: string): Promise<Guest | null> {
  const wanted = guestId.trim().toUpperCase()
  const all = await loadGuests()
  return all.find((g) => g.guest_id.toUpperCase() === wanted) ?? null
}

export async function findPropertyByCode(propertyCode: string): Promise<Property | null> {
  const wanted = propertyCode.trim().toUpperCase()
  const all = await loadProperties()
  return all.find((p) => p.property_code.toUpperCase() === wanted) ?? null
}

export async function reservationsForGuest(guestId: string): Promise<Reservation[]> {
  const wanted = guestId.trim().toUpperCase()
  const all = await loadReservations()
  return all.filter((r) => r.guest_id.toUpperCase() === wanted)
}

/**
 * Chooses the stay a guest is most likely asking about when they give a guest id
 * and no reservation id: the one in progress, else the next one starting, else
 * the most recent one that ended.
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

// ------------------------------------------------------------------ identity match

export interface IdentityQuery {
  guest_id?: string
  reservation_id?: string
  phone?: string
  email?: string
  last_name?: string
  first_name?: string
}

export interface IdentityMatch {
  guest: Guest
  /** Which fields actually matched. Drives the verification rule. */
  matched_on: string[]
}

/**
 * Masked contact fields are all the data layer gives us, which is the point: we
 * match on a masked value by comparing the masked form of the input, so no raw
 * email or phone ever needs to be held in the tool layer.
 */
function maskedContains(maskedValue: string, rawInput: string): boolean {
  const digitsIn = phoneKey(rawInput)
  if (digitsIn.length >= 4) {
    const digitsStored = maskedValue.replace(/\D/g, '')
    if (digitsStored.length >= 4 && digitsIn.endsWith(digitsStored.slice(-4))) return true
  }
  const a = normalizeText(maskedValue).replace(/\*/g, '')
  const b = normalizeText(rawInput)
  if (a.length >= 3 && b.includes(a.split(' ')[0])) return true
  // Email: compare the domain and the leading character, which survive masking.
  if (maskedValue.includes('@') && rawInput.includes('@')) {
    const [maskedLocal, maskedDomain] = maskedValue.split('@')
    const [rawLocal, rawDomain] = rawInput.split('@')
    if (maskedDomain?.toLowerCase() === rawDomain?.toLowerCase()) {
      const firstStored = maskedLocal?.replace(/\*/g, '')[0]
      const firstRaw = rawLocal?.[0]
      if (firstStored && firstRaw && firstStored.toLowerCase() === firstRaw.toLowerCase()) return true
    }
  }
  return false
}

export async function matchGuests(query: IdentityQuery): Promise<IdentityMatch[]> {
  const guests = await loadGuests()
  const reservations = await loadReservations()

  if (query.guest_id) {
    const g = guests.find((x) => x.guest_id.toUpperCase() === query.guest_id!.trim().toUpperCase())
    return g ? [{ guest: g, matched_on: ['guest_id'] }] : []
  }

  if (query.reservation_id) {
    const wanted = query.reservation_id.trim().toUpperCase()
    const r = reservations.find((x) => x.reservation_id.toUpperCase() === wanted)
    if (!r) return []
    const g = guests.find((x) => x.guest_id === r.guest_id)
    if (!g) return []
    const matched = ['reservation_id']
    if (query.last_name && normalizeText(g.last_name) === normalizeText(query.last_name)) matched.push('last_name')
    return [{ guest: g, matched_on: matched }]
  }

  const results: IdentityMatch[] = []
  for (const g of guests) {
    const matched: string[] = []
    if (query.phone && g.phone_masked && maskedContains(g.phone_masked, query.phone)) matched.push('phone')
    if (query.email && g.email_masked && maskedContains(g.email_masked, query.email)) matched.push('email')
    if (query.last_name && normalizeText(g.last_name) === normalizeText(query.last_name)) matched.push('last_name')
    if (query.first_name && normalizeText(g.first_name) === normalizeText(query.first_name)) matched.push('first_name')
    if (matched.length > 0) results.push({ guest: g, matched_on: matched })
  }

  // Strongest match first: a phone or email hit outranks a name hit.
  const weight = (m: IdentityMatch) =>
    (m.matched_on.includes('phone') ? 4 : 0) +
    (m.matched_on.includes('email') ? 4 : 0) +
    (m.matched_on.includes('last_name') ? 1 : 0) +
    (m.matched_on.includes('first_name') ? 1 : 0)
  return results.sort((a, b) => weight(b) - weight(a))
}
