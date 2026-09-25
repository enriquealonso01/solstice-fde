// POST /api/voice/client-state — the browser tells the server what its SIP client is doing.
//
// The supervisor ladder failed twice with the server side looking healthy: Telnyx accepted the
// dial, the leg opened, and two seconds later it was gone. Everything after that happens inside
// a browser we cannot see, and asking the operator to read a console mid-demo is not a debugging
// strategy.
//
// So the client reports its own state here and it lands in `tool_invocations` next to the leg
// events. "Registration never completed" and "registered but never answered" then look different
// in the trace, which is the whole difference between the two remaining explanations.
import { createClient } from '@supabase/supabase-js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

const STATES = [
  'requesting',
  'connecting',
  'registered',
  'ringing',
  'live',
  'error',
  'forbidden',
  'unavailable',
  'unsupported',
  'answered',
  'answer_failed',
] as const

type ClientState = (typeof STATES)[number]

/** Plain-language summary, so the trace reads without knowing the state machine. */
const MEANING: Record<ClientState, string> = {
  requesting: 'Browser is asking for SIP credentials',
  connecting: 'Browser has credentials and is connecting to Telnyx',
  registered: 'Browser is REGISTERED and can receive a supervisor leg',
  ringing: 'Browser is being rung by the supervisor leg',
  live: 'Browser answered: supervisor audio is flowing',
  error: 'Browser SIP client errored',
  forbidden: 'This role may not open a supervisor leg',
  unavailable: 'Credentials endpoint unreachable or unconfigured',
  unsupported: 'This browser cannot do WebRTC here',
  answered: 'Browser accepted the inbound leg',
  answer_failed: 'Browser was rung but answering failed',
}

export async function handleClientState(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405)

  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) return json({ ok: false, error: 'Supabase is not configured.' }, 503)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ ok: false, error: 'Sign in first.' }, 401)

  const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData } = await asUser.auth.getUser()
  if (!userData?.user) return json({ ok: false, error: 'Session expired.' }, 401)

  const body = (await req.json().catch(() => ({}))) as {
    state?: string
    detail?: string
    session_id?: string | null
  }
  const state = body.state as ClientState
  if (!STATES.includes(state)) return json({ ok: false, error: `Unknown state "${body.state}".` }, 400)

  const db = createClient(url, service, { auth: { persistSession: false } })
  // Written with the service role because the point is an operational trace, not user data, and
  // it must survive a session whose RLS view of `tool_invocations` is narrower.
  await db.from('tool_invocations').insert({
    session_id: body.session_id ?? null,
    tool: 'supervisor.client',
    args_masked: { state, detail: body.detail ?? null, user: userData.user.email ?? null },
    result_summary: `${MEANING[state]}${body.detail ? `: ${body.detail}` : ''}`,
    grounded: null,
  })

  return json({ ok: true, recorded: state })
}
