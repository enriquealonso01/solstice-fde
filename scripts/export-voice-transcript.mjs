// Exports a real phone conversation from the database to transcripts/.
//
// The chat transcripts are captured by replaying against the live API. A voice transcript cannot
// be replayed: it happened on a phone, once. This reads what Telnyx streamed to us during the
// call, alongside the tools Sol actually ran, so the exported file is evidence rather than a
// reconstruction.
//
//   node scripts/export-voice-transcript.mjs [session_id_prefix]
import { writeFileSync, mkdirSync } from 'node:fs'
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
  console.error('')
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.')
  console.error('  Add them to .env (see .env.example). Both are in Supabase > Project Settings > API.')
  console.error('')
  process.exit(1)
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const get = async (path) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${res.status} on ${path}: ${await res.text()}`)
  return res.json()
}

const wanted = process.argv[2]

// Pick the richest voice call unless one was named: the best evidence is the longest exchange.
const sessions = await get('sessions?channel=eq.voice&select=*&order=started_at.desc&limit=25')
let chosen = null
let best = -1
for (const s of sessions) {
  if (wanted && !s.id.startsWith(wanted)) continue
  const msgs = await get(`messages?session_id=eq.${s.id}&select=role&limit=200`)
  const userTurns = msgs.filter((m) => m.role === 'user').length
  if (userTurns > best) {
    best = userTurns
    chosen = s
  }
}
if (!chosen || best <= 0) {
  console.error('No voice session with any guest speech was found.')
  process.exit(1)
}

const messages = await get(`messages?session_id=eq.${chosen.id}&select=*&order=created_at.asc&limit=200`)
const tools = await get(`tool_invocations?session_id=eq.${chosen.id}&select=*&order=created_at.asc&limit=200`)

/** Tool rows whose names start with `voice.` or `supervisor.` are call plumbing, not agent work. */
const agentTools = tools.filter((t) => !/^(voice|supervisor)\./.test(t.tool) && t.tool !== 'turn_metrics')

const started = new Date(chosen.started_at)
const ended = chosen.ended_at ? new Date(chosen.ended_at) : null
const seconds = ended ? Math.round((ended.getTime() - started.getTime()) / 1000) : null

const L = []
L.push('# Voice call: a real conversation with Sol', '')
L.push('**What this shows:** the same agent as the chat transcripts, reached by telephone. Every line')
L.push('below was streamed to us by Telnyx while the call was in progress, which is what makes the')
L.push('supervisor console live rather than a post-call replay.', '')
L.push(`- Channel: telephone, inbound to ${env.TELNYX_PHONE_NUMBER ?? 'the Solstice support line'}`)
L.push(`- Caller: ${chosen.guest_label ?? 'unidentified'} (number masked at the data layer)`)
L.push(`- Started: ${chosen.started_at}`)
if (seconds !== null) L.push(`- Duration: ${Math.floor(seconds / 60)}m ${seconds % 60}s`)
L.push(`- Session: \`${chosen.id}\``)
L.push('')
L.push('---', '')

for (const m of messages) {
  if (m.role === 'system') continue
  const who = m.role === 'user' ? '**Guest:**' : m.role === 'supervisor' ? '**Supervisor:**' : '**Sol:**'
  L.push(`${who} ${String(m.content).trim()}`, '')
}

if (agentTools.length) {
  L.push('---', '', '## Tools Sol ran during this call', '')
  for (const t of agentTools) {
    // State the flag, do not interpret it. An earlier version asserted that every ungrounded
    // result forced an escalation, which was not true of the calls below and misread the file.
    const grounded = t.grounded === false ? ' _(returned ungrounded)_' : ''
    const ms = t.latency_ms ? ` · ${t.latency_ms}ms` : ''
    L.push(`- \`${t.tool}\`${t.result_summary ? ` — ${t.result_summary}` : ''}${ms}${grounded}`)
  }
  L.push('')
}

L.push('---', '')
L.push('Arguments are masked at the tool layer before they are stored, which is why the caller number')
L.push('appears redacted above. Nothing here was edited by hand.')

mkdirSync(resolve(root, 'transcripts'), { recursive: true })
const out = resolve(root, 'transcripts', 'voice-call.md')
writeFileSync(out, `${L.join('\n')}\n`)
console.log(`Wrote transcripts/voice-call.md`)
console.log(`  session ${chosen.id}  ·  ${messages.length} messages  ·  ${agentTools.length} agent tool calls`)
