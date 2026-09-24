// Data validation and quarantine.
//
// SOL-PVD ships `base_rate_suite = -395`. A negative nightly rate is not a discount, it is a
// corrupt cell, and an agent that prices off it produces a proposal that PAYS the customer to
// stay. We detect the impossible value, quarantine the field so pricing cannot reach it, and
// surface it as a verdict instead of silently substituting a number we made up.

import type { Property } from '../../../shared/types'

export type RateField = 'base_rate_standard' | 'base_rate_deluxe' | 'base_rate_suite'

export const RATE_FIELDS: RateField[] = ['base_rate_standard', 'base_rate_deluxe', 'base_rate_suite']

/** The plausible band for a nightly rack rate, in dollars. Outside it, we do not trust the cell.
 *  Data, like everything else here: widen it in one line if the portfolio adds a resort. */
export const RATE_SANITY_BAND = { min_usd: 1, max_usd: 5_000 }

export interface QuarantinedField {
  field: RateField
  value: number
  reason: 'negative' | 'zero' | 'implausible' | 'not_a_number'
  human_reason: string
}

export interface PropertyValidation {
  property_code: string
  ok: boolean
  quarantined: QuarantinedField[]
  /** Fields safe to price from. */
  usable_rate_fields: RateField[]
}

function classify(value: number): QuarantinedField['reason'] | null {
  if (!Number.isFinite(value)) return 'not_a_number'
  if (value < 0) return 'negative'
  if (value === 0) return 'zero'
  if (value < RATE_SANITY_BAND.min_usd || value > RATE_SANITY_BAND.max_usd) return 'implausible'
  return null
}

function explain(field: RateField, value: number, reason: QuarantinedField['reason']): string {
  const label = RATE_FIELD_LABELS[field]
  switch (reason) {
    case 'negative':
      return `The stored ${label} for this hotel is ${value} dollars a night, which is impossible, so we have set it aside rather than quote from it. Any ${label.replace(' rate', '')} pricing has to come from the revenue team.`
    case 'zero':
      return `The stored ${label} for this hotel is zero, which cannot be right, so we have set it aside rather than quote a free room. Any ${label.replace(' rate', '')} pricing has to come from the revenue team.`
    case 'implausible':
      return `The stored ${label} for this hotel is ${value} dollars a night, which falls outside the ${RATE_SANITY_BAND.min_usd} to ${RATE_SANITY_BAND.max_usd} dollar range we treat as believable, so we have set it aside pending a check by the revenue team.`
    default:
      return `The stored ${label} for this hotel is not a usable number, so we have set it aside rather than quote from it.`
  }
}

export const RATE_FIELD_LABELS: Record<RateField, string> = {
  base_rate_standard: 'standard room rate',
  base_rate_deluxe: 'deluxe room rate',
  base_rate_suite: 'suite rate',
}

export function validatePropertyData(property: Property): PropertyValidation {
  const quarantined: QuarantinedField[] = []
  const usable: RateField[] = []

  for (const field of RATE_FIELDS) {
    const value = Number(property[field])
    const reason = classify(value)
    if (reason) {
      quarantined.push({ field, value, reason, human_reason: explain(field, value, reason) })
    } else {
      usable.push(field)
    }
  }

  return {
    property_code: property.property_code,
    ok: quarantined.length === 0,
    quarantined,
    usable_rate_fields: usable,
  }
}

export function isQuarantined(validation: PropertyValidation, field: RateField): boolean {
  return validation.quarantined.some((q) => q.field === field)
}
