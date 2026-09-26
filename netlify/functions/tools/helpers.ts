/**
 * Small shared helpers for the concierge tool layer: citation builders, clock
 * handling, date math and argument coercion.
 *
 * STATED ASSUMPTION (also in agent/sol.md): the provided exports carry no
 * timezone. All dates and times are treated as property-local and compared
 * without conversion. A real PMS integration would attach the property timezone.
 */
import type { Channel, Citation } from '../../../shared/types'
import { POLICY_INDEX, ROOM_CLASS_LADDER, ACCESSIBLE_ROOM_TYPES, type RoomClass } from './rules'

export interface ToolContext {
  session_id?: string
  channel: Channel
  /** Overrides the clock, so demos and tests are reproducible. ISO 8601. */
  now?: string
  /** Set once `identify_guest` has verified who we are talking to. */
  guest_id?: string
}

// ------------------------------------------------------------------- the clock

export function nowFrom(ctx?: ToolContext): Date {
  const override = ctx?.now ?? process.env.DEMO_NOW
  if (override) {
    const parsed = new Date(override)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

/** `2026-06-22` + `11:00` -> a Date. Property-local, compared without conversion. */
export function atLocalTime(dateISO: string, localTime: string): Date {
  return new Date(`${dateISO}T${localTime.length === 5 ? localTime : '00:00'}:00Z`)
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000)
}

/**
 * `now` as a calendar date. UTC, because the data carries no property timezone (see the header),
 * so at a US property the date turns over a few hours before local midnight.
 */
export function todayISO(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export type StayPhase = 'upcoming' | 'in_house' | 'ended'

/** Where `now` falls against a stay, by `todayISO` date. Checkout day still counts as in house. */
export function stayPhase(checkInDate: string, checkOutDate: string, now: Date): StayPhase {
  const today = todayISO(now)
  if (checkOutDate < today) return 'ended'
  if (checkInDate > today) return 'upcoming'
  return 'in_house'
}

export function isValidDateISO(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
}

/** Human-readable, deliberately unambiguous, no locale surprises. */
export function describeInstant(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' (property local)'
}

export function localTimeToMinutes(localTime: string): number {
  const [h, m] = localTime.split(':').map((n) => Number.parseInt(n, 10))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

export function minutesToLocalTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "1pm", "1:00 PM", "13:00" -> "13:00". Returns null when it cannot be parsed. */
export function normalizeTime(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/\s+/g, '')
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/)
  if (!m) return null
  let hours = Number.parseInt(m[1], 10)
  const minutes = m[2] ? Number.parseInt(m[2], 10) : 0
  const suffix = m[3]
  if (hours > 23 || minutes > 59) return null
  if (suffix === 'pm' && hours < 12) hours += 12
  if (suffix === 'am' && hours === 12) hours = 0
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// ---------------------------------------------------------------- citations

export function policyCitation(sectionId: string | number): Citation {
  const id = String(sectionId)
  const entry = POLICY_INDEX.find((p) => p.section_id === id)
  return {
    source: 'policy',
    ref: `policy:${id}`,
    label: entry ? `Policy ${id} — ${entry.title}` : `Policy ${id}`,
  }
}

export function propertyCitation(propertyCode: string, propertyName?: string): Citation {
  return {
    source: 'property',
    ref: `property:${propertyCode}`,
    label: propertyName ? `${propertyName} (${propertyCode}) property record` : `${propertyCode} property record`,
  }
}

export function reservationCitation(reservationId: string): Citation {
  return { source: 'reservation', ref: `reservation:${reservationId}`, label: `Reservation ${reservationId}` }
}

export function guestCitation(guestId: string): Citation {
  return { source: 'guest', ref: `guest:${guestId}`, label: `Guest profile ${guestId}` }
}

/** De-duplicates by `ref`, preserving first-seen order. */
export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const c of citations) {
    if (seen.has(c.ref)) continue
    seen.add(c.ref)
    out.push(c)
  }
  return out
}

// ------------------------------------------------------------ argument coercion
// The same tool layer is reached from the Claude chat loop AND from Telnyx voice
// webhooks, so arguments arrive as untyped JSON either way. Coerce defensively
// here rather than trusting the caller.

export type ToolArgs = Record<string, unknown>

export function optString(args: ToolArgs, key: string): string | undefined {
  const v = args[key]
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? t : undefined
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return undefined
}

export function optNumber(args: ToolArgs, key: string): number | undefined {
  const v = args[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[$,]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export function optBoolean(args: ToolArgs, key: string): boolean | undefined {
  const v = args[key]
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (['true', 'yes', 'y', '1'].includes(t)) return true
    if (['false', 'no', 'n', '0'].includes(t)) return false
  }
  return undefined
}

export function optStringArray(args: ToolArgs, key: string): string[] | undefined {
  const v = args[key]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v.trim() !== '') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return undefined
}

/** Dollars in, integer cents out. Accepts 45, "45", "$45.00". */
export function toCents(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Math.round(value * 100)
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

// --------------------------------------------------------------- room classes

export function isAccessibleRoom(roomType: string): boolean {
  const t = roomType.trim().toLowerCase()
  return ACCESSIBLE_ROOM_TYPES.some((a) => a.toLowerCase() === t) || t.includes('accessible')
}

export function roomClassIndex(roomType: string): number {
  const t = roomType.trim().toLowerCase()
  return ROOM_CLASS_LADDER.findIndex((c) => c.toLowerCase() === t)
}

/** The next room class up the ladder, or null at the top / off the ladder. */
export function nextRoomClass(roomType: string): RoomClass | null {
  const idx = roomClassIndex(roomType)
  if (idx < 0 || idx >= ROOM_CLASS_LADDER.length - 1) return null
  return ROOM_CLASS_LADDER[idx + 1]
}

// ------------------------------------------------------------------ text utils

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s@.+-]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Last 10 digits, so 401-555-0164, (401) 555-0164 and +14015550164 all match. */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}
