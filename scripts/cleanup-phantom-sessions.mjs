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
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL_ = env.SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const execute = process.argv.includes('--delete')

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
// demo screen, embarrassing. Anything with no activity for 30 minutes is over.
const STALE_MINUTES = 30
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
