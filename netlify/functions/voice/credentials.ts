// Short-lived WebRTC credential mint.  POST /api/voice/credentials
//
// The browser supervisor registers with @telnyx/webrtc. It must NEVER hold the SIP password:
// anything shipped to the browser is public, and a leaked SIP credential is a free long-distance
// line on Enrique's card. So the client asks this endpoint for a JWT that Telnyx mints on demand
// and that expires on its own.
//
//   import { TelnyxRTC } from '@telnyx/webrtc'
//   const r = await fetch('/api/voice/credentials', {
//     method: 'POST',
//     headers: { Authorization: `Bearer ${supabaseAccessToken}` },
//   }).then((x) => x.json())
//   const client = new TelnyxRTC({ login_token: r.login_token })
//   client.connect()
//
// Once connected, the browser is reachable at r.sip_uri, which is exactly what
// netlify/functions/voice/supervisor.ts dials as the supervisor leg.
//
// Access control: a Supabase access token for a `concierge` or `admin` profile. Group Sales must
// not be able to open an audio path into a guest call; schema.sql already says so for the
// transcript tables, and this endpoint says the same thing for the audio.

import { createClient } from '@supabase/supabase-js'
import { json } from '../telnyx/_lib/http'
import { envOrNull, supervisorSipUri } from '../telnyx/_lib/env'
import { mintWebrtcToken } from '../telnyx/_lib/telnyxClient'
import { missingDbEnv, tryGetDb } from '../_lib/db'

export interface VoiceCredentialResponse {
  ok: boolean
  /** JWT for TelnyxRTC({ login_token }). Short-lived; the browser re-fetches on expiry. */
  login_token?: string
  /** Where this browser will be reachable once registered. supervisor.ts dials exactly this. */
  sip_uri?: string
  sip_username?: string
  /** Read from the JWT's own `exp` claim, not guessed. Telnyx currently issues ~24h tokens. */
  expires_in_seconds?: number
  expires_at?: string
  error?: string
}

/**
 * Read the `exp` claim so the browser can refresh before the token dies, and so we report the
 * real lifetime rather than an assumed one. Telnyx issues roughly 24h tokens today; that is not
 * as short as the name "short-lived" suggests, and the honest mitigation is that the token is
 * scoped to one credential, carries no SIP password, and is revoked by deleting the credential.
 */
function tokenExpiry(jwt: string): { expires_in_seconds?: number; expires_at?: string } {
  const parts = jwt.split('.')
  if (parts.length !== 3) return {}
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { exp?: number }
    if (typeof claims.exp !== 'number') return {}
    return {
      expires_in_seconds: Math.max(0, claims.exp - Math.floor(Date.now() / 1000)),
      expires_at: new Date(claims.exp * 1000).toISOString(),
    }
  } catch {
    return {}
  }
}

const ALLOWED_ROLES = new Set(['concierge', 'admin'])

export async function handleCredentials(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json<VoiceCredentialResponse>({ ok: false, error: 'method_not_allowed' }, 405)
  }

  const credentialId = envOrNull('TELNYX_TELEPHONY_CREDENTIAL_ID')
  if (!credentialId) {
    return json<VoiceCredentialResponse>(
      {
        ok: false,
        error:
          'TELNYX_TELEPHONY_CREDENTIAL_ID is not set. Run `node scripts/telnyx/provision.mjs` and copy .env into the Netlify site env.',
      },
      503,
    )
  }

  const auth = await authoriseSupervisor(req)
  if (!auth.ok) return json<VoiceCredentialResponse>({ ok: false, error: auth.error }, auth.status)

  const minted = await mintWebrtcToken(credentialId)
  if (!minted.ok) {
    return json<VoiceCredentialResponse>({ ok: false, error: `Telnyx token mint failed: ${minted.error}` }, 502)
  }

  const token = typeof minted.data === 'string' ? minted.data.trim() : String(minted.data ?? '').trim()
  if (!token) {
    return json<VoiceCredentialResponse>({ ok: false, error: 'Telnyx returned an empty token' }, 502)
  }

  let sipUri: string
  try {
    sipUri = supervisorSipUri()
  } catch (err) {
    return json<VoiceCredentialResponse>({ ok: false, error: (err as Error).message }, 503)
  }

  return json<VoiceCredentialResponse>(
    {
      ok: true,
      login_token: token,
      sip_uri: sipUri,
      sip_username: envOrNull('TELNYX_SIP_USERNAME') ?? undefined,
      ...tokenExpiry(token),
    },
    200,
    // Belt and braces: never let a CDN or browser cache a credential.
    { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  )
}

// ---------------------------------------------------------------- auth

interface AuthOk {
  ok: true
  userId: string
  role: string
}
interface AuthErr {
  ok: false
  error: string
  status: number
}

async function authoriseSupervisor(req: Request): Promise<AuthOk | AuthErr> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
  if (!token) {
    return { ok: false, error: 'Authorization: Bearer <supabase access token> is required', status: 401 }
  }

  const url = envOrNull('SUPABASE_URL')
  const anonKey = envOrNull('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    return { ok: false, error: 'SUPABASE_URL / SUPABASE_ANON_KEY are not set on this deploy', status: 503 }
  }

  // Validate the token as the user, not as the service role.
  const asUser = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await asUser.auth.getUser(token)
  if (error || !data?.user) {
    return { ok: false, error: 'invalid or expired session token', status: 401 }
  }

  const sb = tryGetDb()
  if (!sb) {
    return { ok: false, error: `Supabase is not configured: ${missingDbEnv().join(' and ')} unset.`, status: 503 }
  }

  const profile = await sb.from('profiles').select('role').eq('id', data.user.id).limit(1)
  if (profile.error) {
    return { ok: false, error: `could not read profile: ${profile.error.message}`, status: 503 }
  }
  const role = (profile.data?.[0] as { role?: string } | undefined)?.role
  if (!role || !ALLOWED_ROLES.has(role)) {
    return {
      ok: false,
      error: 'this role cannot join a guest call; concierge or admin required',
      status: 403,
    }
  }

  return { ok: true, userId: data.user.id, role }
}
