// Exports the live Telnyx AI Assistant to a committed JSON file.
//
// The challenge asks for "native export files from your platform of choice". This is that file:
// the real assistant as Telnyx holds it, tools and all, so a reviewer can see the actual agent
// configuration rather than our description of it. Read-only: one GET, nothing is sent to Telnyx.
//
// The shared tool secret is REDACTED. Provisioning injects it from TOOL_WEBHOOK_SECRET, so the
// export stays reproducible without publishing a credential that unlocks the guest data tools.
//
//   node scripts/telnyx/export-assistant.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../data/lib/env.mjs'
import { compileInstructions } from './provision.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// A reviewer has no .env; loadEnv returns quietly and the check below says what is missing.
loadEnv()

const { TELNYX_API_KEY, TELNYX_ASSISTANT_ID, TOOL_WEBHOOK_SECRET } = process.env
if (!TELNYX_API_KEY || !TELNYX_ASSISTANT_ID) {
  console.error('TELNYX_API_KEY and TELNYX_ASSISTANT_ID must be set in .env')
  console.error('Reading rather than re-exporting? exports/telnyx-assistant.json is already committed.')
  process.exit(1)
}

const res = await fetch(`https://api.telnyx.com/v2/ai/assistants/${TELNYX_ASSISTANT_ID}`, {
  headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
})
if (!res.ok) {
  console.error(`Telnyx returned ${res.status}: ${await res.text()}`)
  process.exit(1)
}

const assistant = await res.json()
const REDACTION = 'REDACTED_INJECTED_FROM_TOOL_WEBHOOK_SECRET'

/**
 * SIP credential usernames are redacted by pattern, not by looking a value up in `.env`: every
 * `sip:<user>@sip.telnyx.com` loses its local part, whatever key it appears under.
 */
const SIP_URI = /sip:[^@"\s]+@sip\.telnyx\.com/g
const SIP_REDACTION = 'sip:REDACTED_TRANSFER_TARGET@sip.telnyx.com'

/** Any string carrying the shared secret is replaced wholesale, at any depth. */
function scrub(node) {
  if (typeof node === 'string') {
    if (TOOL_WEBHOOK_SECRET && node.includes(TOOL_WEBHOOK_SECRET)) return REDACTION
    return node.replace(SIP_URI, SIP_REDACTION)
  }
  if (Array.isArray(node)) return node.map(scrub)
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, scrub(v)]))
  }
  return node
}

const clean = scrub(assistant)
clean._export = {
  exported_at: new Date().toISOString(),
  source: 'GET /v2/ai/assistants/{id}',
  note: 'Native Telnyx export. Regenerate with scripts/telnyx/export-assistant.mjs. The shared tool secret is redacted; scripts/telnyx/provision.mjs injects it from TOOL_WEBHOOK_SECRET.',
}

const serialised = JSON.stringify(clean, null, 2)
if (TOOL_WEBHOOK_SECRET && serialised.includes(TOOL_WEBHOOK_SECRET)) {
  console.error('ABORTED: the secret survived redaction. Not writing the file.')
  process.exit(1)
}

// Refuse to write a file that still carries an addressable SIP credential.
const leakedSip = serialised.match(/sip:(?!REDACTED_TRANSFER_TARGET)[^@"\s]+@sip\.telnyx\.com/)
if (leakedSip) {
  console.error(`ABORTED: an unredacted SIP target survived redaction (${leakedSip[0].slice(0, 12)}…). Not writing the file.`)
  process.exit(1)
}

mkdirSync(resolve(root, 'exports'), { recursive: true })
const out = resolve(root, 'exports', 'telnyx-assistant.json')
writeFileSync(out, `${serialised}\n`)

const compiled = compileInstructions(readFileSync(resolve(root, 'agent', 'sol.md'), 'utf8')).instructions
const live = clean.instructions ?? ''
const tools = (clean.tools ?? []).map((t) => t?.webhook?.name ?? t?.type).filter(Boolean)
console.log(`Wrote exports/telnyx-assistant.json`)
console.log(`  model        : ${clean.model}`)
console.log(`  voice        : ${clean.voice_settings?.voice ?? '(default)'}`)
console.log(`  instructions : ${live.length} chars`)
console.log(
  `  matches sol.md: ${live === compiled ? 'yes' : `NO, agent/sol.md compiles to ${compiled.length} chars; run provision.mjs --instructions-only`}`,
)
console.log(`  tools        : ${tools.length}`)
console.log(`  secret leaked: no`)
