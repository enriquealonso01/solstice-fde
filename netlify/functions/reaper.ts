// Scheduled sweep: close conversations that ended without telling anybody.
//
// A chat ends with a closed tab, which sends no event, so nothing ever stamped `ended_at` on a web
// session. The supervisor's "Active now" tile had reached 308. The rule lives in
// netlify/functions/_lib/reap.ts and is shared with the on-demand route; this file is only the
// timer.
//
// WHY A SCHEDULED FUNCTION AND ALSO A ROUTE. Netlify does not serve a scheduled function over
// HTTP — a request to it in production is a 404 — so this file cannot double as the button the
// dashboard presses. `POST /api/supervisor/reap` is that button. The timer keeps the database
// honest while nobody is looking; the route makes the supervisor's own screen correct the instant
// they open it, which is the moment that actually matters.
//
// Every ten minutes, not every minute. The sweep reads one row per open session, and the thing it
// prevents is a tile being stale by tens of minutes, not by ten.

import type { Config } from '@netlify/functions'
import { reapStaleSessions } from './_lib/reap'

export default async function handler(): Promise<Response> {
  const result = await reapStaleSessions({ actor: 'system:reaper' })
  if (!result.ok) {
    // Logged rather than thrown. A failed sweep is a stale tile; a thrown scheduled function is a
    // retry storm and an alert, for the same stale tile.
    console.warn(`[solstice] scheduled sweep did not run: ${result.error}`)
    return new Response(result.error ?? 'sweep failed', { status: 200 })
  }
  if (result.closed.length > 0) {
    console.log(
      `[solstice] closed ${result.closed.length} idle session(s) of ${result.examined} open: ` +
        result.closed.map((c) => `${c.channel}/${c.id.slice(0, 8)} idle ${c.idle_minutes}m`).join(', '),
    )
  }
  return new Response(`closed ${result.closed.length} of ${result.examined}`, { status: 200 })
}

export const config: Config = {
  schedule: '*/10 * * * *',
}
