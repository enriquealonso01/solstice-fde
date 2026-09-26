// The rules that exist only as prose in the `notes` column of data/solstice-properties.csv.
//
// Every other per-property number comes from the CSV's own columns (see thresholds.ts). These
// are hand-coded because no column holds them; each carries its CSV note verbatim as
// `source_note`, and single-source.test.ts fails if the CSV note, the source_note and the
// numbers here stop agreeing. get_property_info reads them through describeNoteRules().
//
// Notes deliberately not encoded: SOL-AUS "SXSW week is a hard blackout" is already enforced
// by its blackout_dates column, and the SOL-NSH, SOL-TPA and SOL-CLT notes state no rule.

import { monthOf, stayNights, weekdayOf } from './dates'
import type {
  LeadTimeRule,
  OverflowRoutingRule,
  PropertyRuleSet,
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
  on_violation: 'fail',
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

// ---------------------------------------------------------------- which property carries which

/** The note rules a property carries. Limited to these fields so a note rule can never
 *  override a number that comes from a CSV column. */
export type NoteRules = Partial<
  Pick<
    PropertyRuleSet,
    'seasonal_discount_rules' | 'seasonal_rate_notes' | 'lead_time' | 'overflow_routing' | 'required_documents'
  >
>

export const NOTE_RULES: Record<string, NoteRules> = {
  'SOL-CHI': { lead_time: CHICAGO_LEAD_TIME },
  'SOL-DEN': { seasonal_discount_rules: [DENVER_SKI_WEEKENDS] },
  'SOL-PHX': { seasonal_rate_notes: [PHOENIX_OFF_PEAK] },
  'SOL-SAC': { seasonal_discount_rules: [SACRAMENTO_LEGISLATURE_WEEKS] },
  'SOL-CMH': { required_documents: [COLUMBUS_YOUTH_INSURANCE] },
  'SOL-PVD': { overflow_routing: PROVIDENCE_OVERFLOW },
}

export interface NoteRuleSummary {
  kind: 'seasonal_discount_cap' | 'seasonal_rate_note' | 'required_document' | 'group_lead_time' | 'overflow_referral'
  rule: string
  detail: object
}

/** A property's note rules as get_property_info shows them to the model, so chat and voice
 *  state the same numbers the group engine enforces. */
export function describeNoteRules(propertyCode: string): NoteRuleSummary[] {
  const r = NOTE_RULES[propertyCode] ?? {}
  const out: NoteRuleSummary[] = []
  for (const s of r.seasonal_discount_rules ?? []) {
    const rule = `The group discount ceiling is ${s.max_discount_pct}% on a ${s.label}.`
    out.push({ kind: 'seasonal_discount_cap', rule, detail: s })
  }
  for (const s of r.seasonal_rate_notes ?? []) {
    const size = `${Math.abs(s.approx_change_pct)}% ${s.approx_change_pct < 0 ? 'lower' : 'higher'}`
    const rule = `${s.label}: rates run about ${size}. Directional only: never compute a quoted rate from it.`
    out.push({ kind: 'seasonal_rate_note', rule, detail: s })
  }
  for (const d of r.required_documents ?? []) {
    const rule = `A ${d.label} must be on file before the block is confirmed.`
    out.push({ kind: 'required_document', rule, detail: d })
  }
  if (r.lead_time) {
    const rule = `Group requests over ${r.lead_time.over_rooms} rooms need at least ${r.lead_time.min_days} days of lead time.`
    out.push({ kind: 'group_lead_time', rule, detail: r.lead_time })
  }
  if (r.overflow_routing) {
    const rule =
      `Blocks over ${r.overflow_routing.over_rooms} rooms are routed to ${r.overflow_routing.refer_to}. ` +
      'It is NOT in our directory: refer without quoting inventory, rates or availability for it.'
    out.push({ kind: 'overflow_referral', rule, detail: { ...r.overflow_routing, target_in_directory: false } })
  }
  return out
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
