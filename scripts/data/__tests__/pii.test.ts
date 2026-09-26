// AGENTS.md #6: never log or expose unmasked PII. Masking happens in the data layer, which
// means it has to be true of the data AT REST, not just of what a prompt remembers to hide.

import { afterEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { maskArgs, maskEmail, maskPhone, last4, redactText } from '../../../netlify/functions/_lib/mask'
import { phoneLookupKey } from '../../../netlify/functions/_lib/lookup'
import { getGuest, getGuestByPhone, getReservation, listGuests } from '../../../netlify/functions/_lib/data'
import { generatedDir } from '../lib/paths.mjs'

describe('masking primitives', () => {
  it('masks emails to a single leading character', () => {
    expect(maskEmail('laura.bennett@example.com')).toBe('l***@example.com')
    expect(maskEmail('sarah@blueanchorevents.com')).toBe('s***@blueanchorevents.com')
    expect(maskEmail('')).toBe('')
    expect(maskEmail(null)).toBe('')
  })

  it('keeps only the last four digits of a phone, preserving the shape', () => {
    expect(maskPhone('312-555-0148')).toBe('***-***-0148')
    expect(maskPhone('+13125550148')).toBe('+*******0148')
    expect(maskPhone('(312) 555-0148')).toBe('(***) ***-0148')
  })

  it('never returns more than four digits from a card', () => {
    expect(last4('4417')).toBe('4417')
    expect(last4('4111111111114417')).toBe('4417')
  })

  it('redacts PII found inside free text', () => {
    const redacted = redactText('Call Laura on 312-555-0148 or email laura.bennett@example.com')
    expect(redacted).toContain('***-***-0148')
    expect(redacted).toContain('l***@example.com')
    expect(redacted).not.toContain('312-555-0148')
  })

  it('masks a nested argument object and reports which paths it touched', () => {
    const { masked, masked_fields } = maskArgs({
      guest: { email: 'laura.bennett@example.com', phone: '312-555-0148' },
      payment: { card_number: '4111111111114417' },
      api_key: 'sk-live-do-not-log-this',
      note: 'reach me on 312-555-0148',
      rooms: 12,
    })
    const out = masked as Record<string, any>
    expect(out.guest.email).toBe('l***@example.com')
    expect(out.guest.phone).toBe('***-***-0148')
    expect(out.payment.card_number).toBe('4417')
    expect(out.api_key).toBe('[redacted]')
    expect(out.note).toContain('***-***-0148')
    expect(out.rooms).toBe(12)
    expect(masked_fields).toEqual(
      expect.arrayContaining(['guest.email', 'guest.phone', 'payment.card_number', 'api_key']),
    )
  })

  it('is idempotent, so re-masking an already-masked value is safe', () => {
    expect(maskEmail(maskEmail('laura.bennett@example.com'))).toBe('l***@example.com')
    expect(maskPhone(maskPhone('312-555-0148'))).toBe('***-***-0148')
  })
})

describe('the generated files carry no recoverable PII', () => {
  const guestsRaw = readFileSync(resolve(generatedDir, 'guests.json'), 'utf8')
  const reservationsRaw = readFileSync(resolve(generatedDir, 'reservations.json'), 'utf8')

  it('guests.json contains no full email address', () => {
    // Every address in the source data is <something>@example.com. A masked one is `x***@`.
    const unmasked = guestsRaw.match(/"[a-z][a-z0-9._%+-]{2,}@[a-z0-9.-]+"/gi) ?? []
    expect(unmasked).toEqual([])
  })

  it('guests.json contains no phone number with more than four visible digits', () => {
    for (const guest of listGuests()) {
      expect(guest.phone_masked.replace(/\D/g, ''), guest.guest_id).toHaveLength(4)
    }
  })

  it('reservations.json carries only last-four payment digits', () => {
    expect(reservationsRaw).not.toMatch(/"payment_last4":\s*"\d{5,}"/)
  })

  it('the shared-source guarantee holds: the build masked with the runtime functions', () => {
    // If the build script ever forked its own masking, these would drift.
    expect(getGuest('G10001')!.email_masked).toBe(maskEmail('laura.bennett@example.com'))
    expect(getGuest('G10001')!.phone_masked).toBe(maskPhone('312-555-0148'))
    expect(getReservation('R55001')!.payment_last4).toBe(last4('4417'))
  })
})

describe('identifying a caller without storing their number', () => {
  it('matches a full inbound number exactly', () => {
    const result = getGuestByPhone('+1 312 555 0148')
    expect(result.status).toBe('found')
    if (result.status !== 'found') throw new Error('unreachable')
    expect(result.guest.guest_id).toBe('G10001')
    expect(result.matched_on).toBe('phone')
  })

  it('normalises formatting before matching', () => {
    expect(phoneLookupKey('(312) 555-0148')).toBe(phoneLookupKey('3125550148'))
    expect(phoneLookupKey('+13125550148')).toBe(phoneLookupKey('312-555-0148'))
  })

  // The provided data contains two last-four collisions: 0148 and 0177. Guessing between
  // them would attach the wrong reservation to a caller, which is the worst failure this
  // system can have.
  it('refuses to guess when only the last four digits are known', () => {
    const result = getGuestByPhone('0148')
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') throw new Error('unreachable')
    expect(result.candidates.map((g) => g.guest_id).sort()).toEqual(['G10001', 'G10020'])
    expect(result.reason).toMatch(/confirmation number/i)
  })

  it('says so plainly when there is no match', () => {
    const result = getGuestByPhone('305-555-9999')
    expect(result.status).toBe('not_found')
    if (result.status !== 'not_found') throw new Error('unreachable')
    expect(result.reason).toMatch(/confirmation number|name on the reservation/i)
  })

  it('every guest hashes to a unique key even where last four collide', () => {
    const keys = listGuests().map((g) => g.phone_lookup)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('the lookup pepper', () => {
  const saved = { pepper: process.env.LOOKUP_PEPPER, vitest: process.env.VITEST }
  afterEach(() => {
    for (const [key, value] of [['LOOKUP_PEPPER', saved.pepper], ['VITEST', saved.vitest]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('comes from LOOKUP_PEPPER, so a different pepper gives a different key', () => {
    const before = phoneLookupKey('312-555-0148')
    process.env.LOOKUP_PEPPER = 'another-pepper'
    expect(phoneLookupKey('312-555-0148')).not.toBe(before)
  })

  it('is required outside the test runner: a missing pepper fails loudly instead of never matching', () => {
    delete process.env.LOOKUP_PEPPER
    delete process.env.VITEST
    expect(() => phoneLookupKey('312-555-0148')).toThrow(/LOOKUP_PEPPER/)
    expect(() => getGuestByPhone('+1 312 555 0148')).toThrow(/LOOKUP_PEPPER/)
  })
})
