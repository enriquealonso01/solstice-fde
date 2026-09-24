// GET /api/cost  — what this system has actually cost, and what it would cost at scale.
//
// Every figure is either MEASURED (our own turn_metrics rows, our own session records, the live
// Telnyx balance) or DERIVED from the rate card in shared/costRates.ts. Nothing is invented at
// runtime, and the response labels which is which so the page can too.
//
// Admin only: spend is not something a concierge supervisor or a sales rep needs to see.
import type { Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import {
  CACHE_MULTIPLIERS,
  MODEL_RATES,
  PLATFORM_RATES,
  RATES_VERIFIED_ON,
  TELNYX_RATES,
  modelCost,
  projectMonthly,
  type TokenUsage,
} from '../../shared/costRates'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

/** Verifies the caller as an admin, using their own token so RLS still applies. */
async function requireAdmin(req: Request): Promise<{ ok: true; email: string } | { ok: false; res: Response }> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, res: json({ ok: false, error: 'SUPABASE_URL or SUPABASE_ANON_KEY is not set on this deploy.' }, 503) }
  }
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { ok: false, res: json({ ok: false, error: 'Sign in as an administrator to see costs.' }, 401) }

  const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData } = await asUser.auth.getUser()
  if (!userData?.user) return { ok: false, res: json({ ok: false, error: 'That session is no longer valid.' }, 401) }

  const { data: profile } = await asUser.from('profiles').select('role, email').eq('id', userData.user.id).single()
  if (profile?.role !== 'admin') {
    return { ok: false, res: json({ ok: false, error: 'Costs are visible to administrators only.' }, 403) }
  }
  return { ok: true, email: profile.email as string }
}

function serviceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

async function telnyxBalance(): Promise<{ balance: number; currency: string } | null> {
  const key = process.env.TELNYX_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.telnyx.com/v2/balance', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { balance?: string; currency?: string } }
    return {
      balance: Number.parseFloat(body.data?.balance ?? '0'),
      currency: body.data?.currency ?? 'USD',
    }
  } catch {
    return null
  }
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const db = serviceClient()
  if (!db) return json({ ok: false, error: 'Supabase is not configured on this deploy.' }, 503)

  // ---------------------------------------------------------------- measured model usage
  const { data: metrics } = await db
    .from('tool_invocations')
    .select('args_masked, created_at')
    .eq('tool', 'turn_metrics')
    .order('created_at', { ascending: false })
    .limit(1000)

  const byModel = new Map<string, TokenUsage & { turns: number }>()
  let earliest: string | null = null

  for (const row of metrics ?? []) {
    const a = (row.args_masked ?? {}) as Record<string, unknown>
    const model = typeof a.model === 'string' ? a.model : 'unknown'
    const entry = byModel.get(model) ?? { input: 0, output: 0, cache_read: 0, cache_write: 0, turns: 0 }
    entry.input += Number(a.input_tokens ?? 0)
    entry.output += Number(a.output_tokens ?? 0)
    entry.cache_read += Number(a.cache_read_tokens ?? 0)
    entry.cache_write += Number(a.cache_write_tokens ?? 0)
    entry.turns += 1
    byModel.set(model, entry)
    const at = row.created_at as string
    if (!earliest || at < earliest) earliest = at
  }

  const models = [...byModel.entries()].map(([model, usage]) => {
    const cost = modelCost(model, usage)
    return {
      model,
      turns: usage.turns,
      input_tokens: usage.input,
      output_tokens: usage.output,
      cache_read_tokens: usage.cache_read,
      cache_write_tokens: usage.cache_write,
      usd: cost,
      rate: MODEL_RATES[model] ?? null,
      /** Cache reads are the cheap path; this is the share of input tokens served from cache. */
      cache_hit_ratio:
        usage.input + usage.cache_read > 0 ? usage.cache_read / (usage.input + usage.cache_read) : 0,
    }
  })

  const modelUsd = models.reduce((sum, m) => sum + (m.usd ?? 0), 0)

  // ---------------------------------------------------------------- measured traffic
  const countOf = async (table: string, filters: Record<string, string> = {}) => {
    let q = db.from(table).select('*', { count: 'exact', head: true })
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
    const { count } = await q
    return count ?? 0
  }

  const [voiceSessions, chatSessions, proposalsSent] = await Promise.all([
    countOf('sessions', { channel: 'voice' }),
    countOf('sessions', { channel: 'chat' }),
    countOf('proposals', { status: 'sent' }),
  ])

  // Call minutes, measured from the session records themselves.
  const { data: calls } = await db
    .from('sessions')
    .select('started_at, ended_at')
    .eq('channel', 'voice')
    .not('ended_at', 'is', null)
    .limit(1000)

  const callSeconds = (calls ?? []).reduce((sum, c) => {
    const started = new Date(c.started_at as string).getTime()
    const ended = new Date(c.ended_at as string).getTime()
    const delta = (ended - started) / 1000
    return sum + (Number.isFinite(delta) && delta > 0 ? delta : 0)
  }, 0)
  const callMinutes = callSeconds / 60

  const telephonyUsd = callMinutes * (TELNYX_RATES.voice_ai.usd + TELNYX_RATES.pstn.usd)
  const emailUsd = proposalsSent * TELNYX_RATES.email.usd

  const conversations = voiceSessions + chatSessions
  const costPerConversation = conversations > 0 ? (modelUsd + telephonyUsd + emailUsd) / conversations : 0

  // ---------------------------------------------------------------- projection
  const properties = Number.parseInt(new URL(req.url).searchParams.get('properties') ?? '140', 10)
  const perDay = Number.parseFloat(new URL(req.url).searchParams.get('per_day') ?? '40')
  const projection = projectMonthly({
    properties,
    conversations_per_property_per_day: perDay,
    cost_per_conversation: costPerConversation,
    voice_share: voiceSessions / Math.max(conversations, 1),
  })

  return json({
    ok: true,
    measured_since: earliest,
    rates_verified_on: RATES_VERIFIED_ON,
    models,
    totals: {
      model_usd: modelUsd,
      telephony_usd: telephonyUsd,
      email_usd: emailUsd,
      all_usd: modelUsd + telephonyUsd + emailUsd,
    },
    traffic: {
      voice_sessions: voiceSessions,
      chat_sessions: chatSessions,
      conversations,
      call_minutes: callMinutes,
      proposals_sent: proposalsSent,
      cost_per_conversation: costPerConversation,
    },
    telnyx: await telnyxBalance(),
    projection: { ...projection, properties, conversations_per_property_per_day: perDay },
    rate_card: {
      models: MODEL_RATES,
      cache: CACHE_MULTIPLIERS,
      telnyx: TELNYX_RATES,
      platform: PLATFORM_RATES,
    },
  })
}
