/**
 * Record resolution for the concierge tools.
 *
 * The lookups themselves belong to the data layer (`_lib/data.ts`); this file owns the business
 * question on top of them: "which record did the guest mean, and have we actually proved it is
 * theirs?" Those are two different questions and only the second one is a guardrail.
 */
import type { Guest, Property, Reservation } from '../../../shared/types'
import {
  getGuest,
  getGuestByEmail,
  getGuestByPhone,
  getProperty,
  getReservation,
  listReservationsForGuest,
  loadProperties,
  type GuestLookup,
} from './_deps'
import { normalizeText, nowFrom, optString, type ToolArgs, type ToolContext } from './helpers'

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

// ------------------------------------------------------------------ identity

/** What a remote guest can prove about themselves. */
export type IdentityFactor = 'confirmation_number' | 'last_name' | 'phone' | 'email'

/**
 * A guest is verified only when BOTH factors of one pair match the same profile. A confirmation
 * number alone is not proof: they are sequential (R55001, R55002, ...), so anyone can type one.
 */
export const VERIFICATION_FACTOR_PAIRS: ReadonlyArray<readonly [IdentityFactor, IdentityFactor]> = [
  ['confirmation_number', 'last_name'],
  ['confirmation_number', 'phone'],
  ['confirmation_number', 'email'],
]

const FACTOR_WORDS: Record<IdentityFactor, string> = {
  confirmation_number: 'the confirmation number',
  last_name: 'the last name on the booking',
  phone: 'the phone number on file',
  email: 'the email on file',
}

/** The pairs as the agent should ask for them, so the instructions change with the pairs. */
export const FACTOR_PAIRS_IN_WORDS = VERIFICATION_FACTOR_PAIRS.map(([a, b]) => `${FACTOR_WORDS[a]} and ${FACTOR_WORDS[b]}`).join('; or ')

export type IdentityClaim = Partial<Record<IdentityFactor, string>>

export interface VerifiedIdentity {
  guest: Guest
  matched_on: IdentityFactor[]
}

/**
 * The one profile that satisfies a factor pair, or null. It never says why not: an unknown number
 * and a wrong surname must look the same to whoever is asking.
 */
export function verifyIdentity(claim: IdentityClaim): VerifiedIdentity | null {
  const byReservation = claim.confirmation_number ? getReservation(claim.confirmation_number) : null
  const byPhone = claim.phone ? exactMatch(getGuestByPhone(claim.phone)) : null
  const byEmail = claim.email ? exactMatch(getGuestByEmail(claim.email)) : null

  const candidates = new Set(
    [byReservation?.guest_id, byPhone?.guest_id, byEmail?.guest_id].filter((id): id is string => Boolean(id)),
  )
  const verified: VerifiedIdentity[] = []
  for (const guestId of candidates) {
    const guest = getGuest(guestId)
    if (!guest) continue
    const matched = new Set<IdentityFactor>()
    if (byReservation?.guest_id === guestId) matched.add('confirmation_number')
    if (byPhone?.guest_id === guestId) matched.add('phone')
    if (byEmail?.guest_id === guestId) matched.add('email')
    if (claim.last_name && sameSurname(claim.last_name, guest.last_name)) matched.add('last_name')
    if (VERIFICATION_FACTOR_PAIRS.some(([a, b]) => matched.has(a) && matched.has(b))) {
      verified.push({ guest, matched_on: [...matched] })
    }
  }
  return verified.length === 1 ? verified[0] : null
}

/** The full number or address on file. Four digits of a phone prove nothing. */
function exactMatch(hit: GuestLookup): Guest | null {
  return hit.status === 'found' && hit.matched_on !== 'last4' ? hit.guest : null
}

/**
 * "Kalinski", "Robert Kalinski" and "Kalinski, Robert" match a Kalinski; "Kalin" does not. Only the
 * end of the name is compared, so one attempt can never test several surnames at once.
 */
function sameSurname(given: string, onFile: string): boolean {
  const name = (s: string) => normalizeText(s.normalize('NFD').replace(/\p{M}/gu, '').replace(/-/g, ' '))
  const f = name(onFile)
  const g = name(given.includes(',') ? given.slice(0, given.indexOf(',')) : given)
  return f !== '' && (g === f || g.endsWith(` ${f}`))
}

// ------------------------------------------------ records a tool may return

const NOT_VERIFIED_REFUSAL = `The guest is not verified on this conversation, so no booking detail can be read. Call identify_guest with ${FACTOR_PAIRS_IN_WORDS}.`

function sameId(a: string, b: string | undefined): boolean {
  return b !== undefined && a.trim().toUpperCase() === b.trim().toUpperCase()
}

/** A guest_id from the model is honoured only when it is the verified guest. Returns the refusal, or null. */
export function foreignGuestId(args: ToolArgs, ctx: ToolContext): string | null {
  const claimed = optString(args, 'guest_id')
  if (!claimed || sameId(claimed, ctx.guest_id)) return null
  return `guest_id ${claimed} is not the guest verified on this conversation. Leave guest_id out: the verified guest is applied automatically.`
}

/**
 * The verified guest's booking: the one named, else their most relevant stay. Every tool that takes
 * a reservation_id from the model goes through this. A number that does not exist and one that
 * belongs to someone else get the same refusal.
 */
export async function reservationOfVerifiedGuest(
  args: ToolArgs,
  ctx: ToolContext,
): Promise<{ reservation: Reservation } | { error: string }> {
  const foreign = foreignGuestId(args, ctx)
  if (foreign) return { error: foreign }
  if (!ctx.guest_id) return { error: NOT_VERIFIED_REFUSAL }

  const named = optString(args, 'reservation_id') ?? optString(args, 'confirmation_number')
  if (!named) {
    const stay = pickRelevantReservation(await reservationsForGuest(ctx.guest_id), nowFrom(ctx))
    return stay ? { reservation: stay } : { error: 'The verified guest has no reservations on file.' }
  }

  const reservation = await findReservationById(named)
  if (reservation && sameId(reservation.guest_id, ctx.guest_id)) return { reservation }
  return {
    error: `${named} is not a booking on the verified guest's profile. If they mean another booking, verify it with identify_guest first; never guess.`,
  }
}

/**
 * For tools where a booking is only context (comp authority, escalation): the named booking when it
 * is the verified guest's, otherwise none. Those tools still answer; they just attach nothing unproven.
 */
export async function attachableReservation(args: ToolArgs, ctx: ToolContext): Promise<Reservation | null> {
  const named = optString(args, 'reservation_id') ?? optString(args, 'confirmation_number')
  if (!named || !ctx.guest_id) return null
  const owned = await reservationOfVerifiedGuest(args, ctx)
  return 'reservation' in owned ? owned.reservation : null
}
