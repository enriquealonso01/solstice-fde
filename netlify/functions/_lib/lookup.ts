// Non-reversible lookup keys.
//
// Masking at rest destroys the join key: once a phone is stored as `***-***-0148` you can no
// longer match an inbound caller ID against it, and the last four digits alone are ambiguous
// (G10001 and G10020 in the provided data BOTH end in 0148). So alongside the masked display
// value we store a peppered one-way hash of the normalised identifier. The stored data still
// contains no phone number.
//
// The pepper comes from LOOKUP_PEPPER so it can be rotated without a code change. It must equal the
// value data/generated/guests.json was built with (scripts/data/build.mjs), or no phone or email
// will match at runtime.

import { createHash } from 'node:crypto'

/** Tests only: the pepper the committed data/generated/guests.json was built with. */
const TEST_PEPPER = 'solstice-fde:v1'

function pepper(): string {
  const configured = process.env.LOOKUP_PEPPER?.trim()
  if (configured) return configured
  if (process.env.VITEST) return TEST_PEPPER
  throw new Error(
    'LOOKUP_PEPPER is not set. Set it to the pepper data/generated/guests.json was built with; ' +
      'without it no phone number or email can be matched to a guest.',
  )
}

/** '(312) 555-0148', '+1 312 555 0148' and '3125550148' all normalise to '3125550148'. */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  let digits = String(phone).replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  return digits
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

function hash(value: string): string {
  return createHash('sha256').update(`${pepper()}:${value}`).digest('hex').slice(0, 32)
}

/** '' when there is nothing to hash, so callers can tell "no phone" from "no match". */
export function phoneLookupKey(phone: string | null | undefined): string {
  const normalized = normalizePhone(phone)
  return normalized.length >= 7 ? hash(`phone:${normalized}`) : ''
}

export function emailLookupKey(email: string | null | undefined): string {
  const normalized = normalizeEmail(email)
  return normalized.includes('@') ? hash(`email:${normalized}`) : ''
}
