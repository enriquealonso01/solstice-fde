// Removes sessions that were never conversations.
//
// Before the webhook learned to recognise a supervisor leg, dialling one created a `sessions` row
// as though somebody had phoned in. Those rows have no messages and are attributed to our OWN
// number, and three of them are still marked `active`, so the supervisor dashboard shows phantom
// live calls. That is the worst thing to have on screen during a demo.
//
// The bug is fixed (netlify/functions/telnyx/_lib/legs.ts uses a positive allowlist), so this is a
// one-time tidy rather than a recurring job.
//
//   node scripts/cleanup-phantom-sessions.mjs            # dry run, prints what it would delete
//   node scripts/cleanup-phantom-sessions.mjs --delete   # actually deletes
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './data/lib/env.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// loadEnv tolerates a missing .env and falls back to the shell. The reader that used to be here
// called readFileSync on .env unguarded, so with no .env this file threw ENOENT while it was
// still being evaluated -- before the checks below could name what was missing.
loadEnv()
const env = process.env

const URL_ = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  // Named in SUBMISSION.md's pre-send checklist as `npm run demo:tidy`, so it is run under time
  // pressure minutes before submitting. A stack trace is the wrong answer at that moment.
  console.error('')
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.')
  console.error('  Add them to .env (see .env.example). Both are in Supabase > Project Settings > API.')
  console.error('')
  process.exit(1)
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const execute = process.argv.includes('--delete')

/**
 * How many minutes of silence mean a session is over. 30 by default, overridable with
 * `--minutes N`, because the default is wrong for the one moment this script exists for.
 *
 * Measured on 2026-09-26, hours before the demo: 251 sessions, 228 of them still `active`. A
 * 30-minute sweep closes 179 and LEAVES 49 on screen -- and that tile is the first number a panel
 * sees when beat 3 opens. docs/demo-runbook.md already warns that a tidy at 10:55 is undone by
 * agent traffic at 10:56; the floor is the other half of the same problem, and it bites even when
 * the loop has been stopped.
 *
 * The default stays 30 because that is the honest answer to "is this conversation over" for a real
 * guest who closed a tab. A lower value is an operator asserting "there are no real guests right
 * now", which is true in a rehearsal and nowhere else, so it has to be typed on purpose.
 */
function staleMinutes() {
  const i = process.argv.indexOf('--minutes')
  if (i === -1) return 30
  const raw = Number(process.argv[i + 1])
  if (!Number.isFinite(raw) || raw < 1) {
    throw new Error(`--minutes needs a number of minutes, 1 or more. Got: ${process.argv[i + 1]}`)
  }
  return raw
}

/** Last four digits of our own number: a session attributed to it was never a guest. */
const OWN_TAIL = (env.TELNYX_PHONE_NUMBER ?? '').slice(-4)
if (!OWN_TAIL) throw new Error('TELNYX_PHONE_NUMBER must be set so we know which number is ours')

const get = async (path) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${res.status} on ${path}: ${await res.text()}`)
  return res.json()
}

const sessions = await get('sessions?select=id,channel,guest_label,status,started_at&order=started_at.desc&limit=500')

const doomed = []
for (const s of sessions) {
  // Two independent conditions, both required. Either alone would risk deleting a real call:
  // a guest can hang up before speaking, and our own number could in principle be dialled.
  const isOurs = (s.guest_label ?? '').includes(OWN_TAIL)
  if (!isOurs) continue
  const msgs = await get(`messages?session_id=eq.${s.id}&select=id&limit=1`)
  if (msgs.length > 0) continue
  doomed.push(s)
}

console.log(`${sessions.length} sessions examined`)
console.log(`${doomed.length} phantom(s) found: attributed to our own number, zero messages\n`)
for (const s of doomed) {
  console.log(`  ${s.started_at.slice(11, 19)}  ${s.status.padEnd(7)}  ${s.guest_label ?? '-'}`)
}

if (!doomed.length) console.log('\nNo phantom sessions to remove.')
else if (!execute) console.log('\nDry run. Re-run with --delete to remove these.')

// No early exit here. An earlier version returned as soon as there were no phantoms, which
// skipped the stale sweep below precisely when it was the only thing left to do.
let removed = 0
for (const s of execute ? doomed : []) {
  // tool_invocations and messages cascade on session delete per the schema.
  const res = await fetch(`${URL_}/rest/v1/sessions?id=eq.${s.id}`, { method: 'DELETE', headers: H })
  if (res.ok) removed += 1
  else console.error(`  failed to delete ${s.id}: ${res.status} ${await res.text()}`)
}
console.log(`\nDeleted ${removed} of ${doomed.length}.`)

// ---------------------------------------------------------------- stale "active" sessions
//
// A chat session is opened on the first message and nothing ever closes it: there is no hangup
// event on the web the way there is on a phone call. Left alone, the supervisor dashboard fills
// with conversations that ended hours ago but still read as live, which is both wrong and, on a
// demo screen, embarrassing. Anything silent for STALE_MINUTES is over -- 30 by default, or
// whatever `--minutes` said. staleMinutes() above explains why the default is not lower.
const STALE_MINUTES = staleMinutes()
const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()

const stillActive = await get('sessions?status=eq.active&select=id,channel,started_at&limit=500')
const stale = []
for (const s of stillActive) {
  const last = await get(`messages?session_id=eq.${s.id}&select=created_at&order=created_at.desc&limit=1`)
  const lastAt = last[0]?.created_at ?? s.started_at
  if (lastAt < cutoff) stale.push({ ...s, lastAt })
}

console.log(`\n${stillActive.length} session(s) still marked active; ${stale.length} idle for over ${STALE_MINUTES} minutes`)
if (stale.length && execute) {
  let closed = 0
  for (const s of stale) {
    const res = await fetch(`${URL_}/rest/v1/sessions?id=eq.${s.id}`, {
      method: 'PATCH',
      headers: { ...H, Prefer: 'return=minimal' },
      // ended_at is the last thing that actually happened, not "now": a transcript that claims a
      // conversation ran until the cleanup script ran would be a lie in the archive.
      body: JSON.stringify({ status: 'ended', ended_at: s.lastAt }),
    })
    if (res.ok) closed += 1
  }
  console.log(`Closed ${closed} stale session(s).`)
} else if (stale.length) {
  console.log('Dry run: re-run with --delete to close these too.')
}
