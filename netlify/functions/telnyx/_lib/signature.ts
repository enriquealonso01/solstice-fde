// Telnyx webhook signature verification (Ed25519).
//
// Telnyx signs `${telnyx-timestamp}|${raw request body}` with an Ed25519 key and sends:
//   telnyx-signature-ed25519 : base64 signature
//   telnyx-timestamp         : unix seconds
// The matching public key is the base64 "Public Key" from Mission Control -> API Keys,
// stored as TELNYX_PUBLIC_KEY.
//
// Node's crypto.verify needs a KeyObject, and Telnyx hands out a bare 32-byte Ed25519 key, so we
// wrap it in the fixed SPKI DER prefix for Ed25519 before importing it.

import { createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto'

/** DER prefix for an Ed25519 SubjectPublicKeyInfo carrying a 32-byte raw key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export const TELNYX_SIGNATURE_HEADER = 'telnyx-signature-ed25519'
export const TELNYX_TIMESTAMP_HEADER = 'telnyx-timestamp'

export interface SignatureCheck {
  ok: boolean
  reason?: string
  /** true when verification was deliberately skipped because no public key is configured */
  skipped?: boolean
}

export interface VerifyArgs {
  rawBody: string
  signature: string | null
  timestamp: string | null
  publicKeyBase64: string | null
  /** Replay window in seconds. Telnyx retries for a while, so keep this generous but finite. */
  toleranceSeconds?: number
  /** When true, a missing public key is a hard failure instead of a skip. */
  required?: boolean
}

export function verifyTelnyxSignature(args: VerifyArgs): SignatureCheck {
  const { rawBody, signature, timestamp, publicKeyBase64, toleranceSeconds = 600, required = false } = args

  if (!publicKeyBase64) {
    if (required) return { ok: false, reason: 'TELNYX_PUBLIC_KEY is not configured' }
    // Local `netlify dev` and the pre-funding dry runs have no key yet. Fail open ONLY here,
    // and the handler logs loudly so this can never pass silently in production.
    return { ok: true, skipped: true, reason: 'TELNYX_PUBLIC_KEY not set, signature not verified' }
  }

  if (!signature) return { ok: false, reason: `missing ${TELNYX_SIGNATURE_HEADER} header` }
  if (!timestamp) return { ok: false, reason: `missing ${TELNYX_TIMESTAMP_HEADER} header` }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'timestamp header is not a number' }
  const ageSeconds = Math.abs(Date.now() / 1000 - ts)
  if (ageSeconds > toleranceSeconds) {
    return { ok: false, reason: `timestamp is ${Math.round(ageSeconds)}s old, outside the ${toleranceSeconds}s window` }
  }

  let keyObject
  try {
    const raw = Buffer.from(publicKeyBase64, 'base64')
    if (raw.length !== 32) {
      return { ok: false, reason: `TELNYX_PUBLIC_KEY decoded to ${raw.length} bytes, expected 32` }
    }
    keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    })
  } catch (err) {
    return { ok: false, reason: `could not import TELNYX_PUBLIC_KEY: ${(err as Error).message}` }
  }

  let sigBuf: Buffer
  try {
    sigBuf = Buffer.from(signature, 'base64')
  } catch {
    return { ok: false, reason: 'signature header is not valid base64' }
  }
  if (sigBuf.length !== 64) {
    return { ok: false, reason: `signature decoded to ${sigBuf.length} bytes, expected 64` }
  }

  const signed = Buffer.from(`${timestamp}|${rawBody}`, 'utf8')
  let valid = false
  try {
    valid = cryptoVerify(null, signed, keyObject, sigBuf)
  } catch (err) {
    return { ok: false, reason: `verification threw: ${(err as Error).message}` }
  }

  return valid ? { ok: true } : { ok: false, reason: 'signature does not match request body' }
}

/** Constant-time string compare for the shared secrets we use on our own endpoints. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
