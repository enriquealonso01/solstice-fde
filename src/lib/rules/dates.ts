// Date helpers for the group rules engine.
// Every date in the provided data is a plain calendar date ('YYYY-MM-DD') with no timezone.
// We parse to UTC midnight so that a rule never changes its answer because the server
// running it happens to sit in a different timezone than the hotel.

import type { DateRange } from '../../../shared/types'

/** 0 = Sunday .. 6 = Saturday. Matches Date.prototype.getUTCDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parses 'YYYY-MM-DD' to a UTC-midnight Date. Returns null for anything else,
 *  including the empty strings the inquiry export uses for "not supplied". */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!ISO_DATE.test(trimmed)) return null
  const ms = Date.parse(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  return new Date(ms)
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Human-facing date, e.g. "14 September 2026". Used inside `human_reason`,
 *  which has to survive being read aloud to a non-technical stakeholder. */
export function speakDate(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parseDate(value ?? null)
  if (!date) return 'an unspecified date'
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const DAY_MS = 86_400_000

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Midnight UTC on the same calendar day, so "today" compares cleanly with a parsed date. */
export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

/** Nights in a stay. Arrival 09-14 / departure 09-16 is 2 nights. */
export function nightsBetween(arrival: Date, departure: Date): number {
  return Math.max(0, daysBetween(arrival, departure))
}

/** The calendar date each night of the stay *begins* on. A guest arriving 09-14 and
 *  leaving 09-16 occupies the nights of the 14th and the 15th, not the 16th. */
export function stayNights(arrival: Date, departure: Date): Date[] {
  const nights: Date[] = []
  const count = nightsBetween(arrival, departure)
  for (let i = 0; i < count; i += 1) nights.push(addDays(arrival, i))
  return nights
}

export function weekdayOf(date: Date): Weekday {
  return date.getUTCDay() as Weekday
}

/** 1-12. */
export function monthOf(date: Date): number {
  return date.getUTCMonth() + 1
}

/** Inclusive on both ends, which is how the properties export writes blackout ranges. */
export function isWithinRange(date: Date, range: DateRange): boolean {
  const start = parseDate(range.start)
  const end = parseDate(range.end)
  if (!start || !end) return false
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime()
}

/** True when any night of the stay falls inside the range. A guest who checks out on
 *  the first blackout morning has not occupied a blackout night, so they do not collide. */
export function stayOverlapsRange(arrival: Date, departure: Date, range: DateRange): boolean {
  return stayNights(arrival, departure).some((night) => isWithinRange(night, range))
}

/** Parses the properties export's blackout column: 'none scheduled' or
 *  '2026-07-02 to 2026-07-06; 2026-12-28 to 2027-01-02'. */
export function parseBlackoutDates(raw: string | null | undefined): DateRange[] {
  if (!raw) return []
  const text = raw.trim()
  if (!text || /^none/i.test(text)) return []
  const ranges: DateRange[] = []
  for (const chunk of text.split(';')) {
    const [start, end] = chunk.split(/\s+to\s+/i).map((part) => part.trim())
    if (!start) continue
    const startDate = parseDate(start)
    const endDate = parseDate(end ?? start)
    if (!startDate || !endDate) continue
    ranges.push({ start: formatDate(startDate), end: formatDate(endDate) })
  }
  return ranges
}

export function describeRange(range: DateRange): string {
  return `${speakDate(range.start)} through ${speakDate(range.end)}`
}
