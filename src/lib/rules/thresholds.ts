// ============================================================================
//  THE CONTROL SURFACE
// ============================================================================
//  Every number the group booking engine enforces lives in this one table.
//  Nothing in this file is prose, and no threshold is ever restated inside a prompt.
//
//  When the panel asks us to drop the Phoenix discount ceiling from 15% to 12%, the
//  edit is exactly one line:
//
//      'SOL-PHX': { ... max_discount_auto_approve_pct: 15, ... }
//                                                     ^^ change to 12
//
//  Nothing is recompiled into a prompt, no wording is rewritten, and every proposal
//  evaluated after the edit reports the new threshold in its verdicts and in the
//  sentence a rep reads aloud to the customer.
//
//  Seeded from data/solstice-properties.csv. `verifyAgainstProperties()` below proves
//  the table has not drifted away from the export, and a test asserts it.
// ============================================================================

import type { Property } from '../../../shared/types'
import {
  CHICAGO_LEAD_TIME,
  COLUMBUS_YOUTH_INSURANCE,
  DENVER_SKI_WEEKENDS,
  PHOENIX_OFF_PEAK,
  PROVIDENCE_OVERFLOW,
  SACRAMENTO_LEGISLATURE_WEEKS,
} from './seasonal'
import type { PropertyRuleSet } from './types'

export const PROPERTY_RULES: Record<string, PropertyRuleSet> = {
  'SOL-CHI': {
    property_code: 'SOL-CHI',
    property_name: 'Solstice Chicago Riverwalk',
    group_block_auto_approve_max_rooms: 25,
    max_discount_auto_approve_pct: 12,
    max_meeting_capacity: 300,
    blackout_dates: [
      { start: '2026-07-02', end: '2026-07-06' },
      { start: '2026-12-28', end: '2027-01-02' },
    ],
    inventory: { 'Standard King': 90, 'Standard Double': 60, 'Deluxe King': 40, Suite: 20, 'Accessible King': 10 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    lead_time: CHICAGO_LEAD_TIME,
    required_documents: [],
  },

  'SOL-AUS': {
    property_code: 'SOL-AUS',
    property_name: 'Solstice Austin Congress Ave',
    group_block_auto_approve_max_rooms: 30,
    max_discount_auto_approve_pct: 15,
    max_meeting_capacity: 220,
    blackout_dates: [{ start: '2027-03-10', end: '2027-03-19' }],
    inventory: { 'Standard King': 70, 'Standard Double': 50, 'Deluxe King': 35, Suite: 20, 'Accessible King': 5 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    required_documents: [],
  },

  'SOL-DEN': {
    property_code: 'SOL-DEN',
    property_name: 'Solstice Denver Union Station',
    group_block_auto_approve_max_rooms: 25,
    max_discount_auto_approve_pct: 12,
    max_meeting_capacity: 180,
    blackout_dates: [{ start: '2026-08-01', end: '2026-08-05' }],
    inventory: { 'Standard King': 60, 'Standard Double': 45, 'Deluxe King': 30, Suite: 20, 'Accessible King': 5 },
    seasonal_discount_rules: [DENVER_SKI_WEEKENDS],
    seasonal_rate_notes: [],
    required_documents: [],
  },

  'SOL-NSH': {
    property_code: 'SOL-NSH',
    property_name: 'Solstice Nashville Music Row',
    group_block_auto_approve_max_rooms: 20,
    max_discount_auto_approve_pct: 10,
    max_meeting_capacity: 150,
    blackout_dates: [{ start: '2026-06-06', end: '2026-06-09' }],
    inventory: { 'Standard King': 55, 'Standard Double': 40, 'Deluxe King': 30, Suite: 20, 'Accessible King': 5 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    required_documents: [],
  },

  'SOL-TPA': {
    property_code: 'SOL-TPA',
    property_name: 'Solstice Tampa Bayshore',
    group_block_auto_approve_max_rooms: 35,
    max_discount_auto_approve_pct: 15,
    max_meeting_capacity: 320,
    blackout_dates: [{ start: '2027-02-05', end: '2027-02-09' }],
    inventory: { 'Standard King': 80, 'Standard Double': 55, 'Deluxe King': 40, Suite: 25, 'Accessible King': 10 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    required_documents: [],
  },

  'SOL-PHX': {
    property_code: 'SOL-PHX',
    property_name: 'Solstice Phoenix Camelback',
    group_block_auto_approve_max_rooms: 35,
    max_discount_auto_approve_pct: 15,
    max_meeting_capacity: 350,
    blackout_dates: [{ start: '2027-01-15', end: '2027-01-19' }],
    inventory: { 'Standard King': 95, 'Standard Double': 65, 'Deluxe King': 45, Suite: 25, 'Accessible King': 10 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [PHOENIX_OFF_PEAK],
    required_documents: [],
  },

  'SOL-CLT': {
    property_code: 'SOL-CLT',
    property_name: 'Solstice Charlotte Uptown',
    group_block_auto_approve_max_rooms: 25,
    max_discount_auto_approve_pct: 12,
    max_meeting_capacity: 200,
    blackout_dates: [],
    inventory: { 'Standard King': 65, 'Standard Double': 45, 'Deluxe King': 30, Suite: 25, 'Accessible King': 5 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    required_documents: [],
  },

  'SOL-SAC': {
    property_code: 'SOL-SAC',
    property_name: 'Solstice Sacramento Capitol',
    group_block_auto_approve_max_rooms: 20,
    max_discount_auto_approve_pct: 10,
    max_meeting_capacity: 140,
    blackout_dates: [{ start: '2027-05-03', end: '2027-05-07' }],
    inventory: { 'Standard King': 50, 'Standard Double': 40, 'Deluxe King': 25, Suite: 20, 'Accessible King': 5 },
    seasonal_discount_rules: [SACRAMENTO_LEGISLATURE_WEEKS],
    seasonal_rate_notes: [],
    required_documents: [],
  },

  'SOL-CMH': {
    property_code: 'SOL-CMH',
    property_name: 'Solstice Columbus Short North',
    group_block_auto_approve_max_rooms: 20,
    max_discount_auto_approve_pct: 10,
    max_meeting_capacity: 120,
    blackout_dates: [{ start: '2026-09-04', end: '2026-09-07' }],
    inventory: { 'Standard King': 50, 'Standard Double': 35, 'Deluxe King': 25, Suite: 15, 'Accessible King': 5 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    required_documents: [COLUMBUS_YOUTH_INSURANCE],
  },

  'SOL-PVD': {
    property_code: 'SOL-PVD',
    property_name: 'Solstice Providence Waterplace',
    group_block_auto_approve_max_rooms: 15,
    max_discount_auto_approve_pct: 10,
    max_meeting_capacity: 100,
    blackout_dates: [],
    inventory: { 'Standard King': 45, 'Standard Double': 35, 'Deluxe King': 20, Suite: 15, 'Accessible King': 5 },
    seasonal_discount_rules: [],
    seasonal_rate_notes: [],
    overflow_routing: PROVIDENCE_OVERFLOW,
    required_documents: [],
  },
}

export function getPropertyRules(propertyCode: string): PropertyRuleSet | null {
  return PROPERTY_RULES[propertyCode] ?? null
}

export function knownPropertyCodes(): string[] {
  return Object.keys(PROPERTY_RULES)
}

export interface RuleTableDrift {
  property_code: string
  field: string
  table_value: string | number
  export_value: string | number
}

/** Cross-checks the control surface against the property export. If someone edits the CSV
 *  and forgets this table (or the reverse), this reports it instead of letting the engine
 *  quietly enforce a stale number. A test asserts the list is empty. */
export function verifyAgainstProperties(properties: Property[]): RuleTableDrift[] {
  const drift: RuleTableDrift[] = []
  for (const property of properties) {
    const rules = PROPERTY_RULES[property.property_code]
    if (!rules) {
      drift.push({
        property_code: property.property_code,
        field: 'property_code',
        table_value: 'missing from PROPERTY_RULES',
        export_value: property.property_code,
      })
      continue
    }
    const checks: [string, string | number, string | number][] = [
      ['property_name', rules.property_name, property.property_name],
      [
        'group_block_auto_approve_max_rooms',
        rules.group_block_auto_approve_max_rooms,
        property.group_block_auto_approve_max_rooms,
      ],
      [
        'max_discount_auto_approve_pct',
        rules.max_discount_auto_approve_pct,
        property.max_discount_auto_approve_pct,
      ],
      ['max_meeting_capacity', rules.max_meeting_capacity, property.max_meeting_capacity],
      [
        'blackout_dates',
        rules.blackout_dates.map((r) => `${r.start}..${r.end}`).join(';'),
        property.blackout_dates.map((r) => `${r.start}..${r.end}`).join(';'),
      ],
    ]
    for (const [field, tableValue, exportValue] of checks) {
      if (tableValue !== exportValue) {
        drift.push({
          property_code: property.property_code,
          field,
          table_value: tableValue,
          export_value: exportValue,
        })
      }
    }
  }
  return drift
}
