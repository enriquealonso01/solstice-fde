// The rules the hotel buried in free text.
//
// The properties export carries four operational rules that exist only as English prose in the
// `notes` column. A prompt that "reads the notes carefully" will apply them inconsistently, so
// they are lifted here into structured data with the original sentence attached as `source_note`.
// The engine reads the structure; the sentence is kept so a human can audit the translation.
//
//   SOL-DEN  "Ski-season weekends (Dec-Feb, Thu-Sun) run at reduced group discount ceiling of 8%."
//   SOL-SAC  "State-legislature session weeks (Jan-May, weekdays) run at reduced discount ceiling of 8%."
//   SOL-CHI  "group requests over 25 rooms need 2+ weeks lead time."
//   SOL-PVD  "blocks over 15 rooms should be routed to Boston-area sister property instead."
//   SOL-CMH  "verify insurance certificate for youth groups."
//   SOL-PHX  "Rate drops ~20% June-Aug (off-peak)."  <- advisory only, never auto-applied

import { monthOf, stayNights, weekdayOf } from './dates'
import type {
  LeadTimeRule,
  OverflowRoutingRule,
  RequiredDocumentRule,
  SeasonalDiscountRule,
  SeasonalRateNote,
  SeasonWindow,
} from './types'

// ---------------------------------------------------------------- seasonal discount ceilings

export const DENVER_SKI_WEEKENDS: SeasonalDiscountRule = {
  key: 'ski-weekend',
  label: 'ski-season weekend',
  window: { months: [12, 1, 2], weekdays: [4, 5, 6, 0] }, // Thu, Fri, Sat, Sun
  max_discount_pct: 8,
  source_note: 'Ski-season weekends (Dec-Feb, Thu-Sun) run at reduced group discount ceiling of 8%.',
}

export const SACRAMENTO_LEGISLATURE_WEEKS: SeasonalDiscountRule = {
  key: 'legislature-session',
  label: 'state-legislature session week',
  window: { months: [1, 2, 3, 4, 5], weekdays: [1, 2, 3, 4, 5] }, // Mon-Fri
  max_discount_pct: 8,
  source_note:
    'State-legislature session weeks (Jan-May, weekdays) run at reduced discount ceiling of 8%.',
}

// ---------------------------------------------------------------- advisory rate notes

export const PHOENIX_OFF_PEAK: SeasonalRateNote = {
  key: 'phoenix-off-peak',
  label: 'Phoenix off-peak summer window',
  window: { months: [6, 7, 8], weekdays: [] },
  approx_change_pct: -20,
  source_note: 'Rate drops ~20% June-Aug (off-peak); best value window for large blocks.',
}

// ---------------------------------------------------------------- lead time

export const CHICAGO_LEAD_TIME: LeadTimeRule = {
  over_rooms: 25,
  min_days: 14,
  source_note:
    'Highest-demand property in the portfolio; group requests over 25 rooms need 2+ weeks lead time.',
}

// ---------------------------------------------------------------- overflow routing

export const PROVIDENCE_OVERFLOW: OverflowRoutingRule = {
  over_rooms: 15,
  refer_to: 'the Boston-area sister property',
  source_note:
    'Smallest property in the portfolio; blocks over 15 rooms should be routed to Boston-area sister property instead.',
}

// ---------------------------------------------------------------- required documents

export const COLUMBUS_YOUTH_INSURANCE: RequiredDocumentRule = {
  key: 'youth-insurance-certificate',
  label: 'certificate of insurance for the youth group',
  applies_when_matches: ['youth', 'student', 'school', 'marching band', 'minor'],
  source_note: 'Popular with university-affiliated group travel; verify insurance certificate for youth groups.',
}

// ---------------------------------------------------------------- evaluators

/** True when at least one night of the stay falls inside the window.
 *  An empty `weekdays` list means the window ignores the day of the week. */
export function windowCoversStay(window: SeasonWindow, arrival: Date, departure: Date): boolean {
  return stayNights(arrival, departure).some((night) => nightMatchesWindow(window, night))
}

export function nightMatchesWindow(window: SeasonWindow, night: Date): boolean {
  if (!window.months.includes(monthOf(night))) return false
  if (window.weekdays.length === 0) return true
  return window.weekdays.includes(weekdayOf(night))
}

export interface AppliedCeiling {
  pct: number
  /** null when the property's general ceiling applied unchanged. */
  seasonal: SeasonalDiscountRule | null
}

/** The ceiling that actually governs this stay: the tightest of the property's general
 *  ceiling and every seasonal ceiling whose window the stay touches. Tightest wins, always;
 *  a seasonal rule can only ever reduce what a rep may give away. */
export function effectiveDiscountCeiling(
  generalCeilingPct: number,
  seasonalRules: SeasonalDiscountRule[],
  arrival: Date | null,
  departure: Date | null,
): AppliedCeiling {
  if (!arrival || !departure) return { pct: generalCeilingPct, seasonal: null }
  let pct = generalCeilingPct
  let seasonal: SeasonalDiscountRule | null = null
  for (const rule of seasonalRules) {
    if (!windowCoversStay(rule.window, arrival, departure)) continue
    if (rule.max_discount_pct < pct) {
      pct = rule.max_discount_pct
      seasonal = rule
    }
  }
  return { pct, seasonal }
}

/** Matches a required-document rule against what the inquiry actually says. */
export function documentRuleApplies(
  rule: RequiredDocumentRule,
  ...haystacks: (string | null | undefined)[]
): boolean {
  const text = haystacks.filter(Boolean).join(' ').toLowerCase()
  if (!text) return false
  return rule.applies_when_matches.some((needle) => text.includes(needle.toLowerCase()))
}
