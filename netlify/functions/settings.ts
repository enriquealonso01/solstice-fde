// GET  /api/settings — the editable settings (any signed-in staff member)
// POST /api/settings — change one (administrators only)
//
// Enrique: "set the phone number that Sol forwards the call to when the user asks for a
// supervisor or front desk". That number used to live only in the deploy environment
// (`TELNYX_TRANSFER_TARGET`, falling back to `DEMO_PHONE`) — see
// netlify/functions/tools/escalation.ts, which reads the `app_settings` row FIRST and keeps the
// environment as its fallback, so this table can be empty before migration 008 runs and nothing
// breaks. A table row rather than an env var because a redeploy is not how a hotel changes the
// number the front desk answers.
//
// Audit: every change lands in `audit_log`, same as the supervisor's actions do — a settings
// change that affects what guests hear on the phone should be attributable.
import type { Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

/** The one editable setting today, with its plain-English presentation. Keeping the catalogue
 *  here (not in the page) means a new setting is one row here plus one LABEL entry over there. */
const FORWARD_KEY = 'supervisor_forward_phone'

/** E.164: optional +, then 8–15 digits. This is what Telnyx dials, so a typo here is a dropped
 *  transfer — validate before saving rather than finding out mid-call. */
const E164 = /^\+?[0-9]{8,15}$/

async function caller(req: Request) {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return { error: json({ ok: false, error: 'Supabase is not configured on this deploy.' }, 503) }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { error: json({ ok: false, error: 'Sign in to view settings.' }, 401) }

  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData } = await db.auth.getUser()
  if (!userData?.user) return { error: json({ ok: false, error: 'That session is no longer valid.' }, 401) }

  const { data: profile } = await db.from('profiles').select('role, email, id').eq('id', userData.user.id).single()
  return { db, role: profile?.role as string | undefined, email: profile?.email as string | undefined, actor: userData.user.id }
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  const who = await caller(req)
  if ('error' in who && who.error) return who.error
  const { db, role, email, actor } = who as {
    db: ReturnType<typeof createClient>; role?: string; email?: string; actor: string
  }

  if (req.method === 'GET') {
    const { data, error } = await db.from('app_settings').select('key, value, updated_by, updated_at').eq('key', FORWARD_KEY).maybeSingle()
    if (error) return json({ ok: false, error: error.message }, 500)
    const row = (data ?? null) as { key: string; value: string | null; updated_by: string | null; updated_at: string | null } | null

    // Staff and their roles (RLS `profiles_self` lets a non-admin read only their own row, so
    // the list below comes back short for them — the page hides the editor when can_change is
    // false, and the database is the enforcement either way).
    const { data: staff, error: staffError } = await db
      .from('profiles')
      .select('id, email, full_name, role')
      .order('created_at', { ascending: true })
    if (staffError) return json({ ok: false, error: staffError.message }, 500)

    return json({
      ok: true,
      can_change: role === 'admin',
      forward: {
        value: row?.value ?? null,
        source: row?.value ? 'database' : 'environment',
        env_fallback: process.env.TELNYX_TRANSFER_TARGET ? 'set' : process.env.DEMO_PHONE ? 'demo_fallback' : 'none',
        updated_by: row?.updated_by ?? null,
        updated_at: row?.updated_at ?? null,
      },
      users: (staff ?? []) as { id: string; email: string; full_name: string | null; role: string }[],
    })
  }

  if (req.method === 'POST') {
    if (role !== 'admin') return json({ ok: false, error: 'Only a super admin can change settings.' }, 403)

    const body = (await req.json().catch(() => ({}))) as { key?: string; value?: string | null; user_id?: string; role?: string }

    // Changing a person's role. Same admin-only gate as every other write here; RLS
    // `profiles_admin_write` is the enforcement if this check ever drifted.
    if (body.key === 'user_role') {
      if (!body.user_id || !body.role) return json({ ok: false, error: 'A person and their new role are both required.' }, 400)
      const VALID_ROLES = ['concierge', 'group_sales', 'gm', 'admin'] as const
      if (!(VALID_ROLES as readonly string[]).includes(body.role)) {
        return json({ ok: false, error: 'That role is not one this hotel issues.' }, 400)
      }
      // Guard the last-admin case in application code as well as in judgement: demoting the only
      // administrator locks every remaining settings change behind a database session.
      if (body.role !== 'admin' && body.user_id === actor) {
        const { count, error: countError } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
        if (countError) return json({ ok: false, error: countError.message }, 500)
        if ((count ?? 0) <= 1) return json({ ok: false, error: 'You are the only super admin. Promote someone else first.' }, 409)
      }
      const { error } = await db.from('profiles').update({ role: body.role } as never).eq('id', body.user_id)
      if (error) return json({ ok: false, error: error.message }, 500)
      await db.from('audit_log').insert({ actor, action: 'settings.role_changed', subject: body.user_id, detail: { to: body.role, by: email ?? 'admin' } } as never)
      return json({ ok: true, key: 'user_role', value: body.role, effect: 'Their access changes the next time they sign in.' })
    }

    if (body.key !== FORWARD_KEY) return json({ ok: false, error: `Unknown setting. Valid keys: ${FORWARD_KEY}, user_role.` }, 400)

    // Normalise: strip spaces, dashes, parens and dots so "(305) 786-6217" saves as E.164-shaped
    // digits. An empty value is a deliberate clear — the function then falls back to the env var.
    const raw = typeof body.value === 'string' ? body.value.replace(/[\s\-().]/g, '') : ''
    if (raw && !E164.test(raw)) {
      return json({ ok: false, error: 'That does not read as a phone number. Use digits, optionally starting with + — e.g. +13057866217.' }, 400)
    }
    const value = raw || null

    const settingsRow = { key: FORWARD_KEY, value, updated_by: email ?? 'admin', updated_at: new Date().toISOString() }
    const { error } = await db
      .from('app_settings')
      .upsert(settingsRow as never, { onConflict: 'key' })
    if (error) return json({ ok: false, error: error.message }, 500)

    // Attributable, same rule as every other human action in this system. The row shape is named
    // for the same reason flags.ts names FlagRow: no generated Database types, so PostgREST
    // inserts infer as `never` without it.
    const auditRow = { actor, action: 'settings.changed', subject: FORWARD_KEY, detail: { actor_role: role, value_set: value !== null } }
    await db.from('audit_log').insert(auditRow as never)

    return json({ ok: true, key: FORWARD_KEY, value, effect: value !== null
      ? 'Sol will hand supervisor calls to this number from the next call onward.'
      : 'Cleared. The deploy-environment number (if any) is used again.' })
  }

  return json({ ok: false, error: 'Use GET to read settings or POST to change one.' }, 405)
}
