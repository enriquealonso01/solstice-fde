// GET  /api/flags  — what is currently switched off (any signed-in staff member)
// POST /api/flags  — switch a dependency off or on (administrators only)
//
// This is the control surface for the failure-injection demo. Reads are open to staff because a
// supervisor watching an agent refuse to answer needs to know whether the PMS is genuinely down
// or somebody flipped a switch for a demo.
import type { Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { invalidateFlagCache, OUTAGE_REASON, type FlagKey } from './_lib/flags'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

const VALID: FlagKey[] = ['pms_offline', 'reservations_offline', 'policy_source_offline']

/** The client is constructed without a generated Database type, so PostgREST rows infer as
 *  `never`. Naming the row shape here is more honest than scattering casts at each call site. */
interface FlagRow {
  key: string
  enabled: boolean
  note: string | null
  updated_by: string | null
  updated_at: string | null
}

async function caller(req: Request) {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return { error: json({ ok: false, error: 'Supabase is not configured on this deploy.' }, 503) }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { error: json({ ok: false, error: 'Sign in to view system switches.' }, 401) }

  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData } = await db.auth.getUser()
  if (!userData?.user) return { error: json({ ok: false, error: 'That session is no longer valid.' }, 401) }

  const { data: profile } = await db.from('profiles').select('role, email').eq('id', userData.user.id).single()
  return { db, role: profile?.role as string | undefined, email: profile?.email as string | undefined }
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  const who = await caller(req)
  if ('error' in who && who.error) return who.error
  const { db, role, email } = who as { db: ReturnType<typeof createClient>; role?: string; email?: string }

  if (req.method === 'GET') {
    const { data, error } = await db.from('demo_flags').select('key, enabled, note, updated_by, updated_at')
    if (error) return json({ ok: false, error: error.message }, 500)
    const rows = (data ?? []) as unknown as FlagRow[]
    return json({
      ok: true,
      can_change: role === 'admin',
      flags: rows.map((f) => ({ ...f, spoken_reason: OUTAGE_REASON[f.key as FlagKey] ?? null })),
      any_active: rows.some((f) => f.enabled === true),
    })
  }

  if (req.method === 'POST') {
    if (role !== 'admin') return json({ ok: false, error: 'Only an administrator can change system switches.' }, 403)

    const body = (await req.json().catch(() => ({}))) as { key?: string; enabled?: boolean }
    if (!body.key || !VALID.includes(body.key as FlagKey)) {
      return json({ ok: false, error: `Unknown switch. Valid keys: ${VALID.join(', ')}.` }, 400)
    }

    // Written as the caller, so row level security is the thing enforcing admin-only writes.
    const patch: Partial<FlagRow> = {
      enabled: body.enabled === true,
      updated_by: email ?? 'admin',
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('demo_flags').update(patch as never).eq('key', body.key)
    if (error) return json({ ok: false, error: error.message }, 500)

    // This instance can forget its cache; other instances expire within 3 seconds on their own.
    invalidateFlagCache()

    return json({
      ok: true,
      key: body.key,
      enabled: body.enabled === true,
      effect: body.enabled === true ? OUTAGE_REASON[body.key as FlagKey] : 'Dependency restored.',
    })
  }

  return json({ ok: false, error: 'Use GET to read switches or POST to change one.' }, 405)
}
