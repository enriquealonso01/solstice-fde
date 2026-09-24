// Non-reversible lookup keys.
//
// Masking at rest destroys the join key: once a phone is stored as `***-***-0148` you can no
// longer match an inbound caller ID against it, and the last four digits alone are ambiguous
// (G10001 and G10020 in the provided data BOTH end in 0148). So alongside the masked display
// value we store a one-way hash of the normalised identifier. Caller ID comes in, gets
// normalised and hashed, and matches exactly. The stored data still contains no phone number.
//
// Honest limitation to state on stage: a 10-digit phone space is small enough to brute-force
// against an unsalted hash. The pepper below is a build-time constant because the generated
// JSON is committed and has to hash identically at runtime. In production the reference data
// lives in Postgres, not in a repo, and the pepper comes from a secret that is rotated with
// the data. For a demo dataset of 24 fictional guests this is the right amount of machinery.

import { createHash } from 'node:crypto'

const PEPPER = 'solstice-fde:v1'

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
  return createHash('sha256').update(`${PEPPER}:${value}`).digest('hex').slice(0, 32)
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
