// SOL-PVD ships `base_rate_suite = -395`. A negative nightly rate is the kind of thing that
// silently turns into a negative line total and a proposal that PAYS the guest to stay.
// These tests pin the three things that stop that: the value is flagged, the raw value is
// preserved for audit, and the only sanctioned pricing path refuses to return it.

import { describe, it, expect } from 'vitest'

import {
  assertGeneratedData,
  getDataQuality,
  getProperty,
  getPropertyRate,
  isQuarantined,
  listProperties,
} from '../../../netlify/functions/_lib/data'
import { grounded, ok } from '../../../netlify/functions/_lib/result'

describe('SOL-PVD base_rate_suite = -395', () => {
  it('is flagged on the property record', () => {
    const pvd = getProperty('SOL-PVD')
    expect(pvd).not.toBeNull()
    expect(pvd!.data_quality_flags).toContain('base_rate_suite_negative')
  })

  it('keeps the raw value for auditability instead of silently rewriting it', () => {
    expect(getProperty('SOL-PVD')!.base_rate_suite).toBe(-395)
  })

  it('refuses to price a suite at SOL-PVD', () => {
    const rate = getPropertyRate('SOL-PVD', 'Suite')
    expect(rate.ok).toBe(false)
    if (rate.ok) throw new Error('unreachable')
    expect(rate.flag).toBe('base_rate_suite_negative')
    expect(rate.reason).toMatch(/quarantined/i)
    // The refusal has to point somewhere, or the agent has nothing to offer the guest.
    expect(rate.reason).toMatch(/Owen Fitzgerald/)
  })

  it('still prices the room classes that are fine', () => {
    const standard = getPropertyRate('SOL-PVD', 'Standard King')
    expect(standard.ok).toBe(true)
    if (!standard.ok) throw new Error('unreachable')
    expect(standard.nightly_rate).toBe(159)
    expect(standard.nightly_rate_cents).toBe(15900)

    const deluxe = getPropertyRate('SOL-PVD', 'Deluxe King')
    expect(deluxe.ok).toBe(true)
    if (!deluxe.ok) throw new Error('unreachable')
    expect(deluxe.nightly_rate).toBe(189)
  })

  it('reports the quarantine as a blocker with a remediation', () => {
    const record = getDataQuality().quarantined_values.find(
      (q) => q.ref === 'property:SOL-PVD' && q.field === 'base_rate_suite',
    )
    expect(record).toBeDefined()
    expect(record!.raw_value).toBe(-395)
    expect(record!.severity).toBe('blocker')
    expect(record!.remediation).toMatch(/Do not patch it in code/i)
  })

  it('is the only quarantined rate in the portfolio', () => {
    const negatives = listProperties().filter((p) =>
      p.data_quality_flags.some((f) => /^base_rate_\w+_(negative|zero|missing)$/.test(f)),
    )
    expect(negatives.map((p) => p.property_code)).toEqual(['SOL-PVD'])
  })

  it('isQuarantined only fires for the bad field', () => {
    expect(isQuarantined('SOL-PVD', 'base_rate_suite')).toBe(true)
    expect(isQuarantined('SOL-PVD', 'base_rate_standard')).toBe(false)
    expect(isQuarantined('SOL-CHI', 'base_rate_suite')).toBe(false)
  })
})

describe('no other property carries a broken number', () => {
  it('every unflagged base rate is a positive number', () => {
    for (const property of listProperties()) {
      for (const field of ['base_rate_standard', 'base_rate_deluxe', 'base_rate_suite'] as const) {
        if (property.data_quality_flags.some((f) => f.startsWith(`${field}_`))) continue
        expect(property[field], `${property.property_code}.${field}`).toBeGreaterThan(0)
      }
    }
  })

  it('inventory adds up to total_rooms everywhere', () => {
    for (const property of listProperties()) {
      const sum = Object.values(property.inventory).reduce((a, b) => a + b, 0)
      expect(sum, property.property_code).toBe(property.total_rooms)
    }
  })

  it('the generated files pass every union and referential check', () => {
    expect(assertGeneratedData()).toEqual([])
  })
})

describe('the envelope cannot launder a refusal into a confident answer', () => {
  it('grounded() downgrades itself when no citation is supplied', () => {
    const result = grounded({ nightly_rate: -395 }, [])
    expect(result.grounded).toBe(false)
    expect(result.error).toMatch(/named no source/i)
  })

  it('ok() without citations is not grounded either', () => {
    expect(ok({ anything: true }).grounded).toBe(false)
  })
})
