// Entry point for the `voice` Netlify function.
//
// WHY A DISPATCHER INSTEAD OF TWO FUNCTION FILES
// Netlify treats a directory inside netlify/functions/ as ONE function, whose entry point is
// index.ts (or <dirname>.ts); sibling files are bundled as helpers, not published as their own
// endpoints. So `voice/supervisor.ts` on its own would never get a URL. netlify.toml already
// redirects /api/* -> /.netlify/functions/:splat, and Netlify passes trailing path segments
// through to the matched function, which gives us:
//
//   POST /api/voice/supervisor    -> supervisor.ts   (listen | whisper | barge | takeover)
//   POST /api/voice/credentials   -> credentials.ts  (short-lived @telnyx/webrtc login_token)
//   GET  /api/voice               -> this file, a health probe for the Backend Map
//
// We deliberately do NOT set `export const config = { path: ... }`: a v2 path config can move the
// function off its default /.netlify/functions/ URL, which would fight the existing /api/*
// redirect in netlify.toml. netlify.toml is not ours to edit (AGENTS.md rule 3).

import type { Context } from '@netlify/functions'
import { json } from '../telnyx/_lib/http'
import { envOrNull } from '../telnyx/_lib/env'
import { handleSupervisor, SUPERVISOR_ACTIONS } from './supervisor'
import { handleCredentials } from './credentials'

export default async function handler(req: Request, _context: Context): Promise<Response> {
  const route = lastSegment(new URL(req.url).pathname)

  switch (route) {
    case 'supervisor':
      return handleSupervisor(req)
    case 'credentials':
    case 'credential':
    case 'token':
      return handleCredentials(req)
    case 'voice':
    case '':
      return health()
    default:
      return json(
        {
          ok: false,
          error: `unknown voice route "${route}"`,
          routes: ['/api/voice/supervisor', '/api/voice/credentials'],
        },
        404,
      )
  }
}

function health(): Response {
  return json({
    ok: true,
    service: 'voice',
    routes: {
      '/api/voice/supervisor': { method: 'POST', body: { session_id: 'uuid', action: SUPERVISOR_ACTIONS } },
      '/api/voice/credentials': { method: 'POST', auth: 'Bearer <supabase access token>' },
    },
    configured: {
      assistant: Boolean(envOrNull('TELNYX_ASSISTANT_ID')),
      call_control_app: Boolean(envOrNull('TELNYX_CALL_CONTROL_APP_ID')),
      phone_number: Boolean(envOrNull('TELNYX_PHONE_NUMBER')),
      webrtc_credential: Boolean(envOrNull('TELNYX_TELEPHONY_CREDENTIAL_ID')),
    },
  })
}

/**
 * `/api/voice/supervisor` arrives as `/.netlify/functions/voice/supervisor`, and in `netlify dev`
 * sometimes with a trailing slash. Take the last non-empty segment either way.
 */
function lastSegment(pathname: string): string {
  const parts = pathname.split('/').filter((p) => p.length > 0)
  return parts[parts.length - 1] ?? ''
}
