// PII masking. AGENTS.md rule 6: nothing unmasked is ever logged or handed to a prompt.
// Masking happens here, in the data layer, so no prompt can be edited into leaking.

/** Digits only, last 10, for matching a caller ID against the guest export. */
export function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

/** "+13125550148" -> "(***) ***-0148". Never returns the full number. */
export function maskPhone(raw: string | null | undefined): string {
  const d = phoneDigits(raw)
  if (!d) return '(unknown caller)'
  return `(***) ***-${d.slice(-4)}`
}

/** "laura.bennett@example.com" -> "l***t@example.com" */
export function maskEmail(raw: string | null | undefined): string {
  if (!raw || !raw.includes('@')) return '(no email)'
  const [local, domain] = raw.split('@')
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`
  return `${local[0]}***${local[local.length - 1]}@${domain}`
}

/** Payment digits are already last-4 in the export; this guarantees we never widen that. */
export function maskCardLast4(raw: string | null | undefined): string {
  if (!raw) return '****'
  const d = raw.replace(/\D/g, '')
  return `**** ${d.slice(-4)}`
}

const SENSITIVE_KEYS = /(^|_)(phone|email|password|token|secret|card|payment|last4|api_key|authorization)($|_)/i

/**
 * Recursively mask an object before it goes into `tool_invocations.args_masked` or a log line.
 * Unknown keys pass through; known-sensitive keys are reduced to a masked form.
 */
export function maskObject(input: unknown, depth = 0): unknown {
  if (depth > 6 || input === null || input === undefined) return input
  if (Array.isArray(input)) return input.map((v) => maskObject(v, depth + 1))
  if (typeof input !== 'object') return input

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && SENSITIVE_KEYS.test(key)) {
      if (/email/i.test(key)) out[key] = maskEmail(value)
      else if (/phone/i.test(key)) out[key] = maskPhone(value)
      else if (/last4|card|payment/i.test(key)) out[key] = maskCardLast4(value)
      else out[key] = '***redacted***'
    } else {
      out[key] = maskObject(value, depth + 1)
    }
  }
  return out
}

/** Log helper that refuses to print raw objects that might carry PII. */
export function safeLog(label: string, payload?: unknown): void {
  if (payload === undefined) {
    console.log(`[solstice] ${label}`)
    return
  }
  console.log(`[solstice] ${label}`, JSON.stringify(maskObject(payload)))
}
