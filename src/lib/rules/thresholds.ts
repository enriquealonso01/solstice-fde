// The per-property rule table the group engine enforces.
//
// Every number in it comes from data/solstice-properties.csv, through `npm run data:build`
// (data/generated/properties.json). The CSV is the one place to change a rooms cap, discount
// ceiling, meeting capacity or blackout; docs/live-modification.md walks the edit. The rules that
// exist only in the free-text notes are attached from seasonal.ts.
//
// properties.json is imported here rather than through netlify/functions/_lib/data.ts because
// this module also runs in the browser, where data.ts (guest and inquiry records) must not ship.

import propertiesJson from '../../../data/generated/properties.json'
import type { Property } from '../../../shared/types'
import { NOTE_RULES } from './seasonal'
import type { PropertyRuleSet } from './types'

/** One property's rules: its CSV row's numbers plus any rules lifted from its notes. */
export function ruleSetFor(property: Property): PropertyRuleSet {
  return {
    property_code: property.property_code,
    property_name: property.property_name,
    group_block_auto_approve_max_rooms: property.group_block_auto_approve_max_rooms,
    max_discount_auto_approve_pct: property.max_discount_auto_approve_pct,
    max_meeting_capacity: property.max_meeting_capacity,
    blackout_dates: property.blackout_dates.map((range) => ({ ...range })),
    inventory: { ...property.inventory },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    required_documents: [],
    ...NOTE_RULES[property.property_code],
  }
}

export const PROPERTY_RULES: Record<string, PropertyRuleSet> = Object.fromEntries(
  // The cast only restores unions (market_type) the JSON import widens to string.
  (propertiesJson as unknown as Property[]).map((property) => [property.property_code, ruleSetFor(property)]),
)

export function getPropertyRules(propertyCode: string): PropertyRuleSet | null {
  return PROPERTY_RULES[propertyCode] ?? null
}
