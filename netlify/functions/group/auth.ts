// Access control for the group function.
//
// TWO KINDS OF CALLER, TWO KINDS OF PROOF. Conflating them is how you end up with either a
// machine that cannot call you or an inquiry pipeline anyone can read.
//
//   1. The Telnyx assistant, calling POST /api/group/tool mid-conversation. It is a machine with
//      no user behind it, so it proves itself with a shared secret. Same header and same env var
//      as netlify/functions/tools/index.ts, because the provisioning script bakes the .env value
//      into the assistant config and the two must not drift.
//
//   2. A signed-in member of staff, whose browser is reading the inbox or pressing send. They
//      prove themselves with their Supabase session, and we then check their role against the
//      same rule RLS enforces in the database: group sales and admin see group work, concierge
//      does not. The UI's convenience is not the access control; this is, and the database says
//      it again underneath.
//
// A missing TOOL_WEBHOOK_SECRET leaves route 1 open, matching tools/index.ts, because a machine
// caller that cannot authenticate is better than a demo that silently stops working. A missing
// Supabase configuration does NOT leave route 2 open: failing open on the staff routes is the
// exact hole this file exists to close, so it returns 503 and says what is unset.

import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import type { StaffRole } from '../../../shared/types'
import { missingDbEnv, tryGetDb } from '../_lib/db'

export interface AuthOk {
  ok: true
  /** 'assistant' for the shared-secret caller, otherwise the staff member's profile id. */
  actor: string
  role: StaffRole | 'assistant'
}

export interface AuthErr {
  ok: false
  error: string
  status: 401 | 403 | 503
}

export type AuthResult = AuthOk | AuthErr

function env(name: string): string | null {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : null
}

/** Length-independent, constant-time string compare. A plain `===` leaks the length of the
 *  matching prefix through timing; it is a small leak against a 32-byte secret, but this is
 *  four lines and removes the argument entirely. */
export function secretsMatch(supplied: string | null, expected: string): boolean {
  if (!supplied) return false
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // timingSafeEqual throws on a length mismatch, so compare fixed-width digests of both.
  if (a.length !== b.length) {
    // Still do the work, so a wrong-length guess costs the same as a right-length one.
    const pad = Buffer.alloc(Math.max(a.length, b.length))
    const other = Buffer.alloc(pad.length)
    a.copy(pad)
    b.copy(other)
    timingSafeEqual(pad, other)
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * Route 1: the assistant-facing tool endpoint.
 * Accepts `x-solstice-tool-key: <secret>` or `Authorization: Bearer <secret>`, exactly as
 * netlify/functions/tools/index.ts does, because the Telnyx assistant sends one config to both.
 */
export function authorizeToolCaller(req: Request): AuthResult {
  const expected = env('TOOL_WEBHOOK_SECRET')
  if (!expected) {
    // Matches tools/index.ts. Production sets this; the health probe reports whether it is set.
    return { ok: true, actor: 'assistant', role: 'assistant' }
  }
  const supplied =
    req.headers.get('x-solstice-tool-key') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null

  if (!secretsMatch(supplied?.trim() ?? null, expected)) {
    return {
      ok: false,
      error: 'Unauthorized. Send x-solstice-tool-key or Authorization: Bearer <TOOL_WEBHOOK_SECRET>.',
      status: 401,
    }
  }
  return { ok: true, actor: 'assistant', role: 'assistant' }
}

/** Mirrors `inq_read` / `prop_read` / `audit_read` in supabase/schema.sql. Concierge is
 *  deliberately excluded from group sales, in the database and here. */
export const GROUP_ROLES: StaffRole[] = ['group_sales', 'admin']

/**
 * Route 2: the browser-facing staff endpoints.
 * Verifies the Supabase access token as the user, then reads their role from `profiles`.
 */
export async function authorizeStaff(
  req: Request,
  allowed: StaffRole[] = GROUP_ROLES,
  /**
   * What to say on a 403. Defaults to the group-sales sentence because that is this function's
   * first caller, but the same token check now guards the concierge side too, and telling a
   * concierge supervisor they "cannot see group sales" when they tried to answer a guest chat
   * would be a confusing lie about which rule stopped them.
   */
  deniedMessage?: string,
): Promise<AuthResult> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
  if (!token) {
    return {
      ok: false,
      error: 'Authorization: Bearer <supabase access token> is required.',
      status: 401,
    }
  }

  const url = env('SUPABASE_URL')
  const anonKey = env('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    return {
      ok: false,
      error: 'SUPABASE_URL / SUPABASE_ANON_KEY are not set on this deploy, so no session can be verified.',
      status: 503,
    }
  }

  // Validate the token as the user, never as the service role.
  let userId: string
  try {
    const asUser = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await asUser.auth.getUser(token)
    if (error || !data?.user) {
      return { ok: false, error: 'Invalid or expired session token.', status: 401 }
    }
    userId = data.user.id
  } catch (err) {
    return {
      ok: false,
      error: `Could not verify the session: ${err instanceof Error ? err.message : String(err)}`,
      status: 503,
    }
  }

  const db = tryGetDb()
  if (!db) {
    return {
      ok: false,
      error: `Supabase is not configured: ${missingDbEnv().join(' and ')} unset.`,
      status: 503,
    }
  }

  const profile = await db.from('profiles').select('role').eq('id', userId).limit(1)
  if (profile.error) {
    return { ok: false, error: `Could not read profile: ${profile.error.message}`, status: 503 }
  }

  const role = (profile.data?.[0] as { role?: StaffRole } | undefined)?.role
  if (!role || !allowed.includes(role)) {
    return {
      ok: false,
      error:
        deniedMessage ??
        'This role cannot see group sales. Group sales inquiries are readable by group_sales and admin only, which is what row level security enforces in the database as well.',
      status: 403,
    }
  }

  return { ok: true, actor: userId, role }
}
