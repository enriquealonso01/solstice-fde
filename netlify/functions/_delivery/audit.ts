// Audit. Every delivery attempt is written down, including the ones that fail.
//
// A demo where the send silently does nothing is worse than a demo where the send visibly
// fails, so this module records the attempt BEFORE the provider is called and updates it with
// the outcome. Telnyx currently sits at a $0.00 balance, which means every live send is going
// to fail; the audit trail is how that failure stays explainable instead of mysterious.
//
// Contacts are masked here, at the data layer, never in a prompt (AGENTS.md #6).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { maskEmail, maskPhone } from '../_lib/mask'

export interface AuditEntry {
  id: string
  action: string
  subject: string
  detail: Record<string, unknown>
  created_at: string
  /** false when the row could not be persisted; it still exists in memory. */
  persisted: boolean
}

/** In-memory mirror. Survives for the life of the function instance and is what the tests and
 *  the local demo read when Supabase is not configured. Bounded so a long demo cannot grow
 *  without limit. */
const MEMORY_LIMIT = 500
const memory: AuditEntry[] = []

let cachedClient: SupabaseClient | null | undefined

function getClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    cachedClient = null
    return null
  }
  try {
    cachedClient = createClient(url, key, { auth: { persistSession: false } })
  } catch {
    cachedClient = null
  }
  return cachedClient
}

/** Test seam: drop the cached client so a test can flip env vars. */
export function resetAuditClient(): void {
  cachedClient = undefined
}

function nextId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  return g.crypto?.randomUUID?.() ?? `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** Masks anything that looks like a contact detail before it is written anywhere. */
export function maskContactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (value === null || value === undefined) {
      out[key] = value
      continue
    }
    if (typeof value === 'string' && /email/i.test(key)) out[key] = maskEmail(value)
    else if (typeof value === 'string' && /(phone|msisdn|to_number|from_number)/i.test(key))
      out[key] = maskPhone(value)
    else if (value && typeof value === 'object' && !Array.isArray(value))
      out[key] = maskContactDetail(value as Record<string, unknown>)
    else out[key] = value
  }
  return out
}

/** Writes one audit row. Never throws: an audit failure must not take a send down with it. */
export async function auditLog(
  action: string,
  subject: string,
  detail: Record<string, unknown> = {},
): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: nextId(),
    action,
    subject,
    detail: maskContactDetail(detail),
    created_at: new Date().toISOString(),
    persisted: false,
  }

  const client = getClient()
  if (client) {
    try {
      const { error } = await client
        .from('audit_log')
        .insert({ action: entry.action, subject: entry.subject, detail: entry.detail })
      entry.persisted = !error
      if (error) entry.detail = { ...entry.detail, audit_persist_error: error.message }
    } catch (err) {
      entry.detail = { ...entry.detail, audit_persist_error: describeError(err) }
    }
  }

  memory.push(entry)
  if (memory.length > MEMORY_LIMIT) memory.splice(0, memory.length - MEMORY_LIMIT)
  return entry
}

export function recentAudit(limit = 50, action?: string): AuditEntry[] {
  const rows = action ? memory.filter((e) => e.action === action) : memory
  return rows.slice(-limit).reverse()
}

/** Test seam. */
export function clearAuditMemory(): void {
  memory.length = 0
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'unknown error'
  }
}
