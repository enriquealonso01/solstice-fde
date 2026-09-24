// Internal types for the group rules engine.
// The externally visible atom is `RuleVerdict` from shared/types.ts. Everything here
// exists so that a threshold is a NUMBER IN A TABLE, never a sentence in a prompt.

import type { DateRange, RuleVerdict } from '../../../shared/types'
import type { Weekday } from './dates'

/** Stable identifiers. They appear in verdicts, in the audit log, and in the UI,
 *  so renaming one is a breaking change. Add, do not rename. */
export const RULE_IDS = [
  'GRP-COMPLETENESS',
  'GRP-BLACKOUT',
  'GRP-ROOMS-CAP',
  'GRP-DISCOUNT-CEILING',
  'GRP-MEETING-CAPACITY',
  'GRP-INVENTORY',
  'GRP-LEAD-TIME',
  'GRP-OVERFLOW-ROUTING',
  'GRP-INSURANCE-CERT',
  'GRP-DATA-QUALITY',
  'GRP-SEASONAL-RATE-NOTE',
] as const

export type RuleId = (typeof RULE_IDS)[number]

/** A seasonal window expressed as data. `months` and `weekdays` are both
 *  membership tests against each NIGHT of the stay; a stay matches when at least
 *  one of its nights satisfies both. */
export interface SeasonWindow {
  /** 1-12, inclusive. */
  months: number[]
  /** 0 = Sunday .. 6 = Saturday. Empty means "every day of the week". */
  weekdays: Weekday[]
}

/** A seasonal discount ceiling that overrides the property's general ceiling
 *  while the window applies. Lifted out of the free-text `notes` column. */
export interface SeasonalDiscountRule {
  /** Short key used in verdict text and in the UI, e.g. 'ski-weekend'. */
  key: string
  /** Read aloud in `human_reason`, so write it as a person would say it. */
  label: string
  window: SeasonWindow
  /** The ceiling that applies inside the window, in whole percentage points. */
  max_discount_pct: number
  /** Where this came from, so the panel can see we did not invent it. */
  source_note: string
}

/** A seasonal note that affects RATES rather than the discount ceiling.
 *  Advisory only: we surface it, we never silently reprice off an approximation. */
export interface SeasonalRateNote {
  key: string
  label: string
  window: SeasonWindow
  /** Approximate direction and size, as written in the notes. Never applied automatically. */
  approx_change_pct: number
  source_note: string
}

/** Lead time required before arrival once a block exceeds `over_rooms` rooms. */
export interface LeadTimeRule {
  over_rooms: number
  min_days: number
  /** Severity as data. The notes say a big block at this hotel "needs" two weeks, which the
   *  generated ruleset reads as a hard requirement; flip this to 'flag' in one line if the
   *  business would rather it were a GM conversation. */
  on_violation: 'flag' | 'fail'
  source_note: string
}

/** Blocks above `over_rooms` get referred elsewhere. The referral target is NOT in the
 *  property directory, which is the whole point: we surface the referral and refuse to
 *  invent inventory or a rate for a property we have no record of. */
export interface OverflowRoutingRule {
  over_rooms: number
  /** Free text exactly as the hotel wrote it. We do not turn this into a property code. */
  refer_to: string
  source_note: string
}

/** Documentation that must be on file before a category of group can be confirmed. */
export interface RequiredDocumentRule {
  key: string
  label: string
  /** Matched case-insensitively against the inquiry's event_type and special_requests. */
  applies_when_matches: string[]
  source_note: string
}

/** Everything the engine knows about one property, as data.
 *  This is the live control surface. Changing the Phoenix discount ceiling from 15 to 12
 *  is a one-line edit to `max_discount_auto_approve_pct` in thresholds.ts. */
export interface PropertyRuleSet {
  property_code: string
  property_name: string
  /** Rooms at or below this auto-approve without a human. */
  group_block_auto_approve_max_rooms: number
  /** Percent, whole points. Rooms discounted at or below this auto-approve. */
  max_discount_auto_approve_pct: number
  /** People. A general session larger than this physically does not fit. */
  max_meeting_capacity: number
  blackout_dates: DateRange[]
  /** Sellable rooms by room-type label, used for the inventory check. */
  inventory: Record<string, number>
  seasonal_discount_rules: SeasonalDiscountRule[]
  seasonal_rate_notes: SeasonalRateNote[]
  lead_time?: LeadTimeRule
  overflow_routing?: OverflowRoutingRule
  required_documents: RequiredDocumentRule[]
}

export type Decision = 'auto_approve' | 'needs_approval' | 'blocked'

export interface EvaluationResult {
  inquiry_id: string
  property_code: string
  decision: Decision
  verdicts: RuleVerdict[]
  /** The ceiling that actually applied, after any seasonal override. */
  effective_discount_pct_ceiling: number
  /** Non-empty means we must not produce a priced proposal at all. */
  pricing_blocked_by: RuleId[]
  /** Things the rep must chase before the block can be confirmed. */
  required_follow_ups: string[]
  /** Referrals we surface without inventing inventory for the target. */
  referrals: string[]
  /** Rate columns on the property master that failed validation and were set aside. */
  quarantined_fields: string[]
  /** Questions to ask before this inquiry can be priced at all. Empty when complete. */
  clarifying_questions: string[]
}

export function verdict(
  rule_id: RuleId,
  status: RuleVerdict['status'],
  actual: string | number,
  threshold: string | number,
  human_reason: string,
): RuleVerdict {
  return { rule_id, status, actual, threshold, human_reason }
}
