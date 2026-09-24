// Exports the live Telnyx AI Assistant to a committed JSON file.
//
// The challenge asks for "native export files from your platform of choice". This is that file:
// the real assistant as Telnyx holds it, tools and all, so a reviewer can see the actual agent
// configuration rather than our description of it.
//
// The shared tool secret is REDACTED. Provisioning injects it from TOOL_WEBHOOK_SECRET, so the
// export stays reproducible without publishing a credential that unlocks the guest data tools.
//
//   node scripts/telnyx/export-assistant.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const { TELNYX_API_KEY, TELNYX_ASSISTANT_ID, TOOL_WEBHOOK_SECRET } = env
if (!TELNYX_API_KEY || !TELNYX_ASSISTANT_ID) {
  console.error('TELNYX_API_KEY and TELNYX_ASSISTANT_ID must be set in .env')
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

/** Any string carrying the shared secret is replaced wholesale, at any depth. */
function scrub(node) {
  if (typeof node === 'string') {
    return TOOL_WEBHOOK_SECRET && node.includes(TOOL_WEBHOOK_SECRET) ? REDACTION : node
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

mkdirSync(resolve(root, 'exports'), { recursive: true })
const out = resolve(root, 'exports', 'telnyx-assistant.json')
writeFileSync(out, `${serialised}\n`)

const tools = (clean.tools ?? []).map((t) => t?.webhook?.name ?? t?.type).filter(Boolean)
console.log(`Wrote exports/telnyx-assistant.json`)
console.log(`  model        : ${clean.model}`)
console.log(`  voice        : ${clean.voice_settings?.voice ?? '(default)'}`)
console.log(`  instructions : ${(clean.instructions ?? '').length} chars`)
console.log(`  tools        : ${tools.length}`)
console.log(`  secret leaked: no`)
