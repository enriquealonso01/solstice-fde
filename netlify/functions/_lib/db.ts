// Supabase service-role client for serverless functions.
//
// SERVICE ROLE BYPASSES RLS. It exists here because functions act on behalf of an anonymous
// guest who has no session: writing a `sessions` row, streaming `messages`, logging a tool
// call. It must never be handed to the browser -- the browser gets the anon key from
// vite.config.ts and is governed by the policies in supabase/schema.sql.
//
// Per AGENTS.md the schema may not be applied yet. Nothing here crashes on a missing table:
// it returns a message that says exactly what to run.

import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'

const URL_VAR = 'SUPABASE_URL'
const KEY_VAR = 'SUPABASE_SERVICE_ROLE_KEY'

let cached: SupabaseClient | null = null

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value.trim() : undefined
}

export function isDbConfigured(): boolean {
  return Boolean(readEnv(URL_VAR) && readEnv(KEY_VAR))
}

export function missingDbEnv(): string[] {
  return [URL_VAR, KEY_VAR].filter((name) => !readEnv(name))
}

/** Throws with an actionable message when the environment is not wired up. */
export function getDb(): SupabaseClient {
  if (cached) return cached

  const missing = missingDbEnv()
  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} unset. ` +
        `Set ${missing.join(' and ')} in .env for local runs (see .env.example), and in ` +
        `Netlify under Site configuration > Environment variables for the deploy. ` +
        `${KEY_VAR} is the service_role key from Supabase > Project Settings > API; it must never be exposed to the browser.`,
    )
  }

  cached = createClient(readEnv(URL_VAR) as string, readEnv(KEY_VAR) as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'solstice-fde' } },
  })
  return cached
}

/** For code paths that should degrade rather than fail, e.g. best-effort trace logging. */
export function tryGetDb(): SupabaseClient | null {
  try {
    return getDb()
  } catch {
    return null
  }
}

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202'])

export function isMissingTable(error: PostgrestError | null | undefined): boolean {
  if (!error) return false
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

/** Turns a Postgrest error into something a human can act on. */
export function describeDbError(error: PostgrestError | null | undefined, context: string): string {
  if (!error) return `${context}: unknown database error.`
  if (isMissingTable(error)) {
    return (
      `${context}: the Supabase schema has not been applied yet (${error.message}). ` +
      `Run \`node scripts/data/apply-schema.mjs\`, or paste supabase/schema.sql into the ` +
      `Supabase SQL editor, then \`node scripts/data/seed.mjs\`.`
    )
  }
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) {
    return `${context}: blocked by row-level security (${error.message}). Check the policies in supabase/schema.sql and which key this caller used.`
  }
  return `${context}: ${error.message}${error.hint ? ` (${error.hint})` : ''}`
}

export const EXPECTED_TABLES = [
  'profiles',
  'invites',
  'sessions',
  'messages',
  'tool_invocations',
  'escalations',
  'inquiries',
  'proposals',
  'audit_log',
  'properties',
  'guests',
  'reservations',
  'policies',
] as const

/** Cheap probe used by seeding, health checks and the backend map's status dots. */
export async function checkSchema(): Promise<{ ok: boolean; missing: string[]; error?: string }> {
  if (!isDbConfigured()) {
    return { ok: false, missing: [...EXPECTED_TABLES], error: `Supabase not configured: ${missingDbEnv().join(', ')} unset.` }
  }
  const db = getDb()
  const missing: string[] = []
  for (const table of EXPECTED_TABLES) {
    const { error } = await db.from(table).select('*', { count: 'exact', head: true }).limit(1)
    if (isMissingTable(error)) missing.push(table)
    else if (error && error.code !== '42501') {
      return { ok: false, missing, error: describeDbError(error, `probing ${table}`) }
    }
  }
  return { ok: missing.length === 0, missing }
}

/** Best-effort trace write. A failure here must never fail the guest's turn, so it logs and
 *  moves on: the tool result still reaches the guest, the admin trace just misses a row. */
export async function recordToolInvocation(row: {
  session_id: string | null
  tool: string
  args_masked: unknown
  result_summary: string
  grounded: boolean
  latency_ms: number | null
}): Promise<void> {
  const db = tryGetDb()
  if (!db) return
  const { error } = await db.from('tool_invocations').insert(row)
  if (error) console.warn(describeDbError(error, 'recordToolInvocation'))
}
