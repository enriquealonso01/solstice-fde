// PII masking. The single source of truth for the whole system.
//
// `scripts/data/build.mjs` imports THIS module directly (Node 24 strips the types at load),
// so the masking applied to data at rest and the masking applied to live voice/chat input
// cannot drift apart. Do not fork these functions into the build script.
//
// Rule of the house (AGENTS.md #6): masking happens in the tool/data layer, never in a prompt.
// Nothing that leaves this layer should carry a full email, a full phone, or more than the
// last four digits of a payment card.

/** `laura.bennett@example.com` -> `l***@example.com` */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return ''
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${trimmed[0]}***${trimmed.slice(at)}`
}

/** `312-555-0148` -> `***-***-0148`. Every digit but the last four is masked and the
 *  original separators are preserved, so `+13125550148` -> `+*******0148`.
 *
 *  Idempotent: a value that already contains mask characters is returned untouched. Without
 *  that guard a second pass would see only four digits left, mask those too, and silently
 *  turn `***-***-0148` into `***-***-****`. Records get masked more than once in practice
 *  (maskArgs over an already-masked guest row is the obvious case). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const trimmed = phone.trim()
  if (trimmed.includes('*')) return trimmed
  const digitCount = (trimmed.match(/\d/g) ?? []).length
  if (digitCount === 0) return ''
  if (digitCount <= 4) return trimmed.replace(/\d/g, '*')
  const keepFrom = digitCount - 4
  let seen = 0
  let out = ''
  for (const ch of trimmed) {
    if (ch >= '0' && ch <= '9') {
      out += seen >= keepFrom ? ch : '*'
      seen += 1
    } else {
      out += ch
    }
  }
  return out
}

/** Defensive: whatever arrives, only the final four digits survive. */
export function last4(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const digits = String(value).replace(/\D/g, '')
  return digits.slice(-4)
}

/** For speech and prose. Never read a full card number aloud. */
export function spokenCard(value: string | number | null | undefined): string {
  const tail = last4(value)
  return tail ? `the card ending in ${tail}` : 'the card on file'
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 10-digit North American numbers with optional country code and common separators.
// Deliberately does not match ISO dates (4-2-2 digits).
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g
// 13 to 19 digits, optionally grouped by spaces or hyphens: a card number. Removed before the
// phone pattern runs, which would otherwise keep a card's first digits and its last four.
const CARD_IN_TEXT = /\d(?:[ -]?\d){12,18}/g

/** Mask PII found inside free text: transcript excerpts, guest notes, tool results. */
export function redactText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(EMAIL_IN_TEXT, (m) => maskEmail(m))
    .replace(CARD_IN_TEXT, '[card number removed]')
    .replace(PHONE_IN_TEXT, (m) => maskPhone(m))
}

const EMAIL_KEY = /e-?mail/i
const PHONE_KEY = /(phone|mobile|msisdn|caller_?id|from_number|to_number|^from$|^to$)/i
const CARD_KEY = /(card|pan|payment|cc_?num|account_number|last_?4)/i
const SECRET_KEY = /(^|_)(api_?key|apikey|token|secret|password|passwd|authorization|auth|credential|signature|sig)(_|$)/i

export type MaskKind = 'email' | 'phone' | 'card' | 'secret' | 'text'

function classify(key: string): MaskKind | null {
  if (SECRET_KEY.test(key)) return 'secret'
  if (EMAIL_KEY.test(key)) return 'email'
  if (PHONE_KEY.test(key)) return 'phone'
  if (CARD_KEY.test(key)) return 'card'
  return null
}

function maskScalar(kind: MaskKind | null, value: unknown): unknown {
  if (kind === 'secret') return '[redacted]'
  if (value === null || value === undefined) return value
  if (kind === 'email') return maskEmail(String(value))
  if (kind === 'phone') return maskPhone(String(value))
  if (kind === 'card') return last4(typeof value === 'number' ? value : String(value))
  if (typeof value === 'string') return redactText(value)
  return value
}

/** Recursively mask a structure. Returns the masked copy plus the dotted paths that were
 *  touched, which is exactly what `tool_invocations.args_masked` and
 *  `ToolResult.masked_fields` want. Anything already masked stays masked (idempotent). */
export function maskArgs(input: unknown): { masked: unknown; masked_fields: string[] } {
  const fields: string[] = []

  function walk(value: unknown, path: string, inheritedKind: MaskKind | null): unknown {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`, inheritedKind))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const kind = classify(k)
        const childPath = path ? `${path}.${k}` : k
        if (kind && (typeof v === 'string' || typeof v === 'number')) fields.push(childPath)
        out[k] = walk(v, childPath, kind)
      }
      return out
    }
    return maskScalar(inheritedKind, value)
  }

  return { masked: walk(input, '', null), masked_fields: [...new Set(fields)] }
}

/** Convenience for log lines and `console` calls in serverless handlers. */
export function safeLog(label: string, payload: unknown): void {
  const { masked } = maskArgs(payload)
  // eslint-disable-next-line no-console -- serverless functions log to the Netlify stream
  console.log(label, JSON.stringify(masked))
}
