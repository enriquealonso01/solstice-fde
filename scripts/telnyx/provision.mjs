#!/usr/bin/env node
/**
 * Solstice FDE — Telnyx provisioning.
 *
 *   node scripts/telnyx/provision.mjs [flags]
 *
 * Idempotent and re-runnable. Every resource is looked up by a stable name before it is created,
 * so a second run reports SKIPPED instead of creating a duplicate assistant or a second SIP
 * connection. Read scripts/telnyx/README.md for the run order.
 *
 * What it does, in order:
 *   1. preflight        — API key, account balance, agent/sol.md, shared/toolContracts.ts
 *   2. call control app — the voice application whose webhook_event_url is /api/telnyx
 *   3. phone number     — REUSES the number in TELNYX_PHONE_NUMBER and repoints it at (2).
 *                         --buy opts into purchasing a fresh US local number instead.
 *   4. assistant "Sol"  — instructions compiled from agent/sol.md, webhook tools registered
 *                         against the deployed /api/ endpoints
 *   5. SIP connection   — Credential Connection for the browser supervisor leg
 *   6. WebRTC credential— on-demand telephony credential; /api/voice/credentials mints JWTs from it
 *   7. attach number    — binds the number to Sol
 *   8. webhooks         — transcript + insights delivery, confirmed on the call control app
 *   9. .env             — writes the resulting ids back without disturbing other keys
 *
 * Flags:
 *   --dry-run        Make NO network calls. Parse everything, print the plan. Safe at $0 balance.
 *   --check          Preflight only: verify the API key and print the account balance. One call.
 *   --buy            Purchase a new US local number instead of reusing TELNYX_PHONE_NUMBER.
 *   --area-code=305  Area code to search when --buy is set. Default 305 (Miami).
 *   --base-url=URL   Public origin for webhook URLs. Default $PUBLIC_BASE_URL, then $URL.
 *   --refresh        Update an existing assistant's instructions and tools from agent/sol.md.
 *   --force          Continue past a zero/low balance warning.
 *   --no-env-write   Print what would go into .env instead of writing it.
 *   --integration-secret
 *                    Store TOOL_WEBHOOK_SECRET as a Telnyx integration secret and reference it
 *                    from the tool headers instead of embedding the literal value. UNVERIFIED
 *                    placeholder syntax: prove it on a funded call before relying on it.
 *
 * Deliberately NOT a retry loop. Telnyx charges real money and this account is small. Every step
 * makes at most one attempt (two only where an API revision changed a verb), reports the failure
 * in plain language, and carries on to the steps that are still possible.
 */

import { readFile, writeFile, copyFile, access } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const ENV_PATH = join(REPO_ROOT, '.env')
const SOL_MD_PATH = join(REPO_ROOT, 'agent', 'sol.md')
const TOOL_CONTRACTS_PATH = join(REPO_ROOT, 'shared', 'toolContracts.ts')

const TELNYX_API = 'https://api.telnyx.com/v2'

// Stable names. Lookups key off these, which is what makes the script idempotent.
const NAMES = {
  callControlApp: 'Solstice FDE - Sol Voice',
  assistant: 'Sol',
  credentialConnection: 'Solstice FDE - Supervisor WebRTC',
  telephonyCredential: 'solstice-supervisor-webrtc',
  insightGroup: 'Solstice FDE - Call Insights',
}

const INTEGRATION_SECRET_ID = 'solstice-tool-key'

// The number Enrique already owns. JARVIS is retired, so repointing it is approved.
const DEFAULT_REUSE_NUMBER = '+13057866217'

const DEFAULT_GREETING = "Hi, I'm Sol. I'm here to help with anything you need."

// ---------------------------------------------------------------------------- cli + logging

const argv = process.argv.slice(2)
const flags = {
  dryRun: argv.includes('--dry-run'),
  check: argv.includes('--check'),
  buy: argv.includes('--buy'),
  refresh: argv.includes('--refresh') || argv.includes('--refresh-instructions'),
  force: argv.includes('--force'),
  noEnvWrite: argv.includes('--no-env-write'),
  integrationSecret: argv.includes('--integration-secret'),
  areaCode: valueOf('--area-code') ?? '305',
  baseUrl: valueOf('--base-url'),
}

function valueOf(name) {
  const hit = argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : null
}

const summary = []
function record(step, status, detail) {
  summary.push({ step, status, detail })
  const icon = { CREATED: '+', REUSED: '=', SKIPPED: '-', FAILED: 'x', PLANNED: '?' }[status] ?? ' '
  console.log(`  [${icon}] ${status.padEnd(7)} ${step}${detail ? ` — ${detail}` : ''}`)
}
function section(title) {
  console.log(`\n${title}`)
  console.log('-'.repeat(Math.max(title.length, 40)))
}

// ---------------------------------------------------------------------------- env file

/** Parse .env into an ordered list of lines plus a key map. Comments and blanks are preserved. */
async function readEnvFile() {
  let text = ''
  try {
    text = await readFile(ENV_PATH, 'utf8')
  } catch {
    text = ''
  }
  const lines = text.split(/\r?\n/)
  const values = {}
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) values[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { lines, values, existed: text.length > 0 }
}

/**
 * Rewrite .env in place: replace the value of any key we own, append the rest under a marked
 * section. Every other line, comment and blank is left byte-identical.
 */
async function writeEnvFile(updates) {
  const { lines, existed } = await readEnvFile()
  const remaining = new Map(Object.entries(updates))
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/)
    if (!m) return line
    const key = m[2]
    if (!remaining.has(key)) return line
    const value = remaining.get(key)
    remaining.delete(key)
    return `${m[1]}${key}=${value}`
  })

  if (remaining.size > 0) {
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('')
    out.push('# Written by scripts/telnyx/provision.mjs')
    for (const [key, value] of remaining) out.push(`${key}=${value}`)
    out.push('')
  }

  if (existed) {
    await copyFile(ENV_PATH, `${ENV_PATH}.bak`)
  }
  await writeFile(ENV_PATH, out.join('\n'), 'utf8')
}

// ---------------------------------------------------------------------------- telnyx client

let apiKey = null
let callCount = 0

/** One request, one attempt, never throws. */
async function api(path, { method = 'GET', body, query } = {}) {
  if (flags.dryRun) {
    return { ok: false, status: 0, error: 'dry-run: no network call made', dryRun: true }
  }
  const url = new URL(`${TELNYX_API}${path.startsWith('/') ? path : `/${path}`}`)
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v))

  callCount += 1
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, status: 0, error: `network error: ${err.message}` }
  }

  const text = await res.text()
  let parsed = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  if (!res.ok) {
    const errs = parsed?.errors
    const msg = Array.isArray(errs)
      ? errs.map((e) => [e.code, e.title, e.detail].filter(Boolean).join(': ')).join(' | ')
      : typeof parsed === 'string'
        ? parsed.slice(0, 400)
        : `HTTP ${res.status}`
    return { ok: false, status: res.status, error: msg, detail: parsed }
  }
  return { ok: true, status: res.status, data: parsed?.data ?? parsed, meta: parsed?.meta }
}

// ---------------------------------------------------------------------------- sol.md compile

const STRIP_BLOCK = /<!--\s*voice:exclude\s*-->[\s\S]*?<!--\s*\/voice:exclude\s*-->/g
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

const MAX_INSTRUCTION_CHARS = 30000

/**
 * Compile agent/sol.md into the voice runtime's instructions.
 *
 * agent/sol.md is owned by another agent and is the SINGLE agent definition (plans/01, D11).
 * Compiling rather than copying means the file can carry chat-only material without it bloating
 * the voice prompt: anything between <!-- voice:exclude --> and <!-- /voice:exclude --> is
 * dropped, HTML comments are dropped, front matter is dropped.
 *
 * It deliberately does NOT inline business rules. Rules live in src/lib/rules/ as data and reach
 * the assistant through the webhook tools, so a threshold change is a one-line edit, not a
 * re-provision. AGENTS.md is explicit about that.
 */
function compileInstructions(markdown) {
  let out = markdown
    .replace(FRONT_MATTER, '')
    .replace(STRIP_BLOCK, '')
    .replace(HTML_COMMENT, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  let truncated = false
  if (out.length > MAX_INSTRUCTION_CHARS) {
    out = `${out.slice(0, MAX_INSTRUCTION_CHARS)}\n\n[truncated at ${MAX_INSTRUCTION_CHARS} characters]`
    truncated = true
  }
  return { instructions: out, truncated }
}

/** Pull a greeting out of a "## Greeting" section if sol.md defines one. */
function extractGreeting(markdown) {
  const m =
    markdown.match(/^#{1,6}\s*Greeting\s*$([\s\S]*?)(?=^#{1,6}\s)/im) ??
    markdown.match(/^#{1,6}\s*Greeting\s*$([\s\S]*)/im)
  if (!m) return null
  const block = m[1]
  const quoted = block.match(/["“]([^"”]{10,300})["”]/)
  if (quoted) return quoted[1].trim()
  const firstLine = block
    .split(/\r?\n/)
    .map((l) => l.replace(/^[>\-*\s]+/, '').trim())
    .find((l) => l.length > 10)
  return firstLine ?? null
}

const PLACEHOLDER_INSTRUCTIONS = `You are Sol, the front-desk assistant for Solstice Hotel Group.

PLACEHOLDER INSTRUCTIONS. agent/sol.md was not present when this assistant was provisioned.
Re-run: node scripts/telnyx/provision.mjs --refresh

Hard rules that apply regardless:
- Never state a policy, rate, fee, or availability from memory. Call a tool. If the tool returns
  grounded:false, say you cannot confirm it and escalate. Never improvise a hotel fact.
- Never read back a full phone number, email address, or payment card number. The data layer
  already masks them; keep them masked out loud.
- If the guest asks for something beyond your authority, use create_escalation and tell the guest
  a human will follow up. Do not promise an outcome you cannot verify.`

// ---------------------------------------------------------------------------- tool registry

/**
 * Tool names are read from shared/toolContracts.ts at provision time, so the Telnyx assistant and
 * the Claude chat runtime cannot drift apart on which tools exist. That file is the contract
 * (AGENTS.md rule 3 makes it off-limits to edit here).
 *
 * Parameter shapes below are this script's best reading of shared/types.ts. The tools function
 * owns the real request shape; if it diverges, fix it HERE and re-run with --refresh.
 */
function parseToolNames(source) {
  const grab = (constName) => {
    const m = source.match(new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`, 'm'))
    if (!m) return []
    return [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
  }
  return {
    concierge: grab('CONCIERGE_TOOLS'),
    group: grab('GROUP_TOOLS'),
    routing: grab('ROUTING_TOOLS'),
  }
}

const S = (description, required = false) => ({ type: 'string', description, required })
const N = (description, required = false) => ({ type: 'number', description, required })
const B = (description, required = false) => ({ type: 'boolean', description, required })

const TOOL_SPECS = {
  classify_intent: {
    description: 'Decide whether the caller needs concierge help with an existing stay or wants to discuss a group booking. Call this first on every call.',
    params: { utterance: S('What the caller just said, verbatim.', true) },
  },
  identify_guest: {
    description: 'Look up the caller in the guest directory by name, confirmation number, or the caller ID already on the call. Call this before discussing any reservation detail.',
    params: {
      name: S('Full name as the caller gave it.'),
      confirmation_number: S('Reservation or confirmation number, e.g. R55001.'),
      phone: S('Caller phone number in E.164 if the caller offers a different one than they are calling from.'),
    },
  },
  get_reservation: {
    description: 'Fetch a reservation: dates, property, room type, rate plan, status. Never state a reservation detail without calling this.',
    params: {
      reservation_id: S('Reservation id, e.g. R55001.'),
      guest_id: S('Guest id, e.g. G10001, when the reservation id is unknown.'),
    },
  },
  get_policy: {
    description: 'Retrieve the exact front-desk policy text for a topic. Every policy answer must come from here, with the citation it returns.',
    params: {
      topic: S('Policy topic, e.g. cancellation, late checkout, pets, smoking, deposit, no-show.', true),
      property_code: S('Property code when the policy may vary by property, e.g. SOL-CHI.'),
    },
  },
  check_late_checkout: {
    description: 'Determine whether a late checkout can be granted for a reservation, and any fee, from the policy and the guest loyalty tier.',
    params: {
      reservation_id: S('Reservation id.', true),
      requested_time: S('Requested checkout time, e.g. "2pm".', true),
    },
  },
  check_upgrade_eligibility: {
    description: 'Determine whether a guest qualifies for a room upgrade, and on what terms.',
    params: {
      reservation_id: S('Reservation id.', true),
      target_room_type: S('Room type the guest asked for, if they named one.'),
    },
  },
  book_amenity: {
    description: 'Record a request for an on-property amenity or service against a reservation.',
    params: {
      reservation_id: S('Reservation id.', true),
      amenity: S('What the guest wants, e.g. late breakfast, crib, airport shuttle.', true),
      date: S('Date the guest wants it, ISO 8601.'),
      party_size: N('Number of people, when relevant.'),
    },
  },
  check_service_recovery_eligibility: {
    description: 'Check what service recovery is permitted for a described problem before offering the guest anything.',
    params: {
      reservation_id: S('Reservation id.', true),
      issue: S('What went wrong, in the guest own words.', true),
    },
  },
  check_comp_authority: {
    description: 'Check whether a proposed comp or refund amount is inside front-desk authority. Call this BEFORE offering money back.',
    params: {
      amount_cents: N('Proposed amount in integer cents.', true),
      reason: S('Why the comp is being considered.', true),
      reservation_id: S('Reservation id.'),
    },
  },
  get_property_info: {
    description: 'Fetch validated facts about a property: address, amenities, meeting space, general manager. Data quality flags come back with it.',
    params: {
      property_code: S('Property code, e.g. SOL-PVD.', true),
      field: S('Specific field of interest, when the caller asked something narrow.'),
    },
  },
  create_escalation: {
    description: 'Hand a problem to a human with a full context packet. Use this whenever a tool returns grounded:false, or the request exceeds your authority.',
    params: {
      category: S('One of: refund, dispute, medical, legal, safety, authority_exceeded, other.', true),
      summary: S('One or two sentences a human can act on.', true),
      severity: S('low, normal, high, or critical. Default normal.'),
      recommended_action: S('What you would do if you had the authority.'),
    },
  },
  parse_inquiry: {
    description: 'Turn what a caller said about a group booking into the structured inquiry fields, and report which required fields are still missing.',
    params: { text: S('Everything the caller has said about the group so far.', true) },
  },
  validate_property_data: {
    description: 'Validate a property record before pricing off it. Returns quarantine flags for impossible values.',
    params: { property_code: S('Property code.', true) },
  },
  check_availability: {
    description: 'Check whether a room block is available. This is a net-new service: the provided exports carry no inventory by date, so availability is never guessed.',
    params: {
      property_code: S('Property code.', true),
      arrival_date: S('Arrival date, ISO 8601.', true),
      departure_date: S('Departure date, ISO 8601.', true),
      rooms: N('Number of rooms requested.', true),
      room_type: S('Preferred room type.'),
    },
  },
  evaluate_group_rules: {
    description: 'Run the group booking rules against an inquiry and return a verdict per rule. Never assert a rule outcome without this.',
    params: { inquiry_id: S('Inquiry id, e.g. INQ-2009.', true) },
  },
  price_block: {
    description: 'Price a room block from validated property rates.',
    params: {
      inquiry_id: S('Inquiry id.', true),
      discount_pct: N('Discount percentage to model, when exploring an option.'),
    },
  },
  find_alternates: {
    description: 'Find alternate properties that could take a block the preferred property cannot.',
    params: {
      property_code: S('The property that cannot take it.', true),
      rooms: N('Rooms needed.', true),
      arrival_date: S('Arrival date, ISO 8601.'),
      departure_date: S('Departure date, ISO 8601.'),
    },
  },
  draft_clarifying_questions: {
    description: 'Produce the shortest set of questions that would complete an incomplete inquiry.',
    params: { inquiry_id: S('Inquiry id.', true) },
  },
  generate_proposal: {
    description: 'Generate a proposal document for an inquiry.',
    params: {
      inquiry_id: S('Inquiry id.', true),
      discount_pct: N('Discount to apply, when a human has chosen one.'),
    },
  },
  submit_for_approval: {
    description: 'Route a proposal to a human for approval. Use when the rules return a flag rather than a clean pass.',
    params: {
      proposal_id: S('Proposal id.', true),
      note: S('What the human needs to decide.'),
    },
  },
  send_proposal: {
    description: 'Send an approved proposal to the contact, picking email or SMS from the contact data available.',
    params: {
      proposal_id: S('Proposal id.', true),
      channel: S('Force a channel: email or sms. Omit to let the adapter choose.'),
    },
  },
  create_inquiry: {
    description:
      'Open a group inquiry as soon as you have an email address or a phone number. Call this ONCE per caller, with only what you have so far; do not wait for the full picture. Everything they tell you afterwards goes to update_inquiry. Nothing here is required except one way to reach them.',
    params: {
      contact_phone: S('Phone number, if that is all we have.'),
      company_name: S('Company or organisation name, if known yet.'),
      contact_name: S('Who is calling, if known yet.'),
      event_type: S('What the event is, e.g. Corporate Retreat, Wedding Block.'),
      preferred_property_code: S('Property code the caller asked for.'),
      arrival_date: S('Arrival date, ISO 8601.'),
      departure_date: S('Departure date, ISO 8601.'),
      rooms_requested: N('Rooms requested.'),
      requested_discount_pct: N('Discount the caller asked for, as a percentage.'),
      meeting_capacity_needed: N('Meeting capacity needed, in people.'),
      special_requests: S('Anything else the caller asked for.'),
      contact_email: S('Email address. Ask for this FIRST and open the inquiry on it.'),
      alternate_property_ok: B('Whether the caller would consider another property.'),
    },
  },
  update_inquiry: {
    description:
      'Add what the caller just told you to an inquiry that is already open. Use this for every answer after create_inquiry, one at a time. The result carries next_question, which is the only thing you should ask next.',
    params: {
      inquiry_id: S('The inquiry reference returned by create_inquiry, e.g. INQ-2011.', true),
      contact_email: S('Email address.'),
      contact_phone: S('Phone number.'),
      company_name: S('Company or organisation name.'),
      contact_name: S('Who the proposal should be addressed to.'),
      event_type: S('What the event is, e.g. Corporate Retreat, Wedding Block.'),
      preferred_property_code: S('Property code the caller asked for.'),
      arrival_date: S('Arrival date, ISO 8601.'),
      departure_date: S('Departure date, ISO 8601.'),
      rooms_requested: N('Rooms requested.'),
      requested_discount_pct: N('Discount the caller asked for, as a percentage.'),
      meeting_capacity_needed: N('Meeting capacity needed, in people.'),
      special_requests: S('Anything else the caller asked for.'),
      alternate_property_ok: B('Whether the caller would consider another property.'),
    },
  },
}

/**
 * Auth header for every webhook tool.
 *
 * /api/tools/<name> enforces TOOL_WEBHOOK_SECRET: it accepts `x-solstice-tool-key: <secret>` or
 * `authorization: Bearer <secret>`, and returns 401 without one. Registering tools without this
 * header means every tool call Sol makes on a live call 401s, which is silent death for the voice
 * path -- the model just gets an error body back and has nothing to ground an answer on.
 *
 * The literal value is the DEFAULT because it is verifiable: after provisioning we read the
 * assistant back and confirm the header is attached, and the endpoint itself can be curled with
 * the same header. `--integration-secret` instead stores the token in Telnyx
 * (POST /v2/integration_secrets, type bearer) and emits a {{integration_secret.<id>}} reference,
 * which keeps the secret out of the assistant config but CANNOT be verified without a live call:
 * if the placeholder syntax is wrong it fails exactly the way we are fixing. Use it once there is
 * a funded call to prove it with, not before.
 */
function authHeaders(secret, integrationSecretIdentifier) {
  const headers = [{ name: 'X-Solstice-Source', value: 'telnyx-assistant' }]
  if (integrationSecretIdentifier) {
    headers.push({ name: 'x-solstice-tool-key', value: `{{integration_secret.${integrationSecretIdentifier}}}` })
  } else if (secret) {
    headers.push({ name: 'x-solstice-tool-key', value: secret })
  }
  return headers
}

function specProperties(spec) {
  const properties = {}
  const required = []
  for (const [param, def] of Object.entries(spec.params)) {
    properties[param] = { type: def.type, description: def.description }
    if (def.required) required.push(param)
  }
  return { properties, required }
}

/**
 * Concierge + routing tools: one URL per tool, flat arguments.
 * The dispatcher reads the tool name from the last path segment and treats session_id /
 * call_control_id as control keys rather than arguments.
 */
function buildWebhookTool(name, toolsBaseUrl, headers) {
  const spec = TOOL_SPECS[name]
  if (!spec) return null
  const { properties, required } = specProperties(spec)
  // The tools function needs to know which call it is serving. Telnyx substitutes the dynamic
  // variable at call time; the tools layer falls back to telnyx_conversation_id if absent.
  properties.call_control_id = {
    type: 'string',
    description: 'Always pass {{call_control_id}} so the tool can attach its trace to this call.',
  }

  return {
    type: 'webhook',
    webhook: {
      name,
      description: spec.description,
      url: `${toolsBaseUrl}/${name}`,
      method: 'POST',
      headers,
      body_parameters: { type: 'object', properties, required },
    },
  }
}

/**
 * Group tools live behind a DIFFERENT dispatcher with a different body shape.
 * netlify/functions/tools/registry.ts mounts only CONCIERGE_TOOLS + ROUTING_TOOLS, so a group
 * tool posted to /api/tools/<name> comes back 404 "Unknown tool". The group dispatcher takes
 * every group tool on one URL:  POST /api/group/tool  { tool, args, call_control_id }.
 * `enum` pins the tool name to a single legal value so the model cannot mis-address the call.
 */
function buildGroupWebhookTool(name, groupToolUrl, headers) {
  const spec = TOOL_SPECS[name]
  if (!spec) return null
  const { properties, required } = specProperties(spec)

  return {
    type: 'webhook',
    webhook: {
      name,
      description: spec.description,
      url: groupToolUrl,
      method: 'POST',
      headers,
      body_parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: [name], description: `Always exactly "${name}".` },
          args: { type: 'object', description: 'The arguments for this tool.', properties, required },
          call_control_id: {
            type: 'string',
            description: 'Always pass {{call_control_id}} so the tool can attach its trace to this call.',
          },
        },
        required: ['tool', 'args'],
      },
    },
  }
}

function buildToolList(toolNames, urls, transferTarget, headers) {
  const tools = []
  const skipped = []
  const groupNames = new Set(toolNames.group)
  for (const name of [...toolNames.routing, ...toolNames.concierge, ...toolNames.group]) {
    // transfer_to_human is a native Telnyx handoff, not a webhook. plans/02: transfer targets can
    // be a phone number or a SIP URI, and warm_transfer_acceptance only works under
    // ai_assistant_start, which is our path.
    if (name === 'transfer_to_human') {
      if (!transferTarget) {
        skipped.push(`${name} (DEMO_PHONE not set)`)
        continue
      }
      // 25s, not 5s: a human needs time to pick up. At 5 seconds the caller hears "I'm having
      // trouble connecting you" before the phone has finished its first ring.
      tools.push({
        type: 'transfer',
        timeout_ms: 25000,
        transfer: {
          targets: [{ to: transferTarget, name: 'Solstice front desk' }],
          custom_headers: [],
          warm_transfer_instructions:
            'Summarise the guest, the reservation, what has been tried, and the exact ask. Then hand over.',
        },
      })
      continue
    }
    const tool = groupNames.has(name)
      ? buildGroupWebhookTool(name, urls.groupTool, headers)
      : buildWebhookTool(name, urls.tools, headers)
    if (tool) tools.push(tool)
    else skipped.push(`${name} (no parameter spec in provision.mjs)`)
  }
  tools.push({ type: 'hangup', hangup: { description: 'End the call once the guest confirms there is nothing else.' } })
  return { tools, skipped }
}

/**
 * Telnyx integration secrets live at /v2/integration_secrets (NOT /v2/ai/integration_secrets,
 * which 404s). Creating one is safe and idempotent by identifier. Whether a webhook tool header
 * resolves `{{integration_secret.<identifier>}}` is NOT documented anywhere we could verify, which
 * is why this is opt-in behind --integration-secret.
 */
async function ensureIntegrationSecret(secret) {
  if (!secret) {
    record('integration secret', 'SKIPPED', 'TOOL_WEBHOOK_SECRET unset')
    return null
  }
  if (flags.dryRun) {
    record('integration secret', 'PLANNED', `POST /v2/integration_secrets identifier=${INTEGRATION_SECRET_ID}`)
    return INTEGRATION_SECRET_ID
  }

  const list = await api('/integration_secrets', { query: { 'page[size]': 100 } })
  const existing = list.ok ? (list.data ?? []).find((x) => x.identifier === INTEGRATION_SECRET_ID) : null
  if (existing) {
    record('integration secret', 'REUSED', `identifier ${INTEGRATION_SECRET_ID}`)
    return INTEGRATION_SECRET_ID
  }

  const created = await api('/integration_secrets', {
    method: 'POST',
    body: { identifier: INTEGRATION_SECRET_ID, type: 'bearer', token: secret },
  })
  if (!created.ok) {
    record('integration secret', 'FAILED', `${created.error}; falling back to the literal header value`)
    return null
  }
  record('integration secret', 'CREATED', `identifier ${INTEGRATION_SECRET_ID}`)
  return INTEGRATION_SECRET_ID
}

// ---------------------------------------------------------------------------- steps

async function stepPreflight(env) {
  section('1. Preflight')

  apiKey = env.TELNYX_API_KEY || process.env.TELNYX_API_KEY || null
  if (!apiKey) {
    record('TELNYX_API_KEY', 'FAILED', 'not found in .env or the environment')
    throw new Error('Cannot continue without TELNYX_API_KEY.')
  }
  record('TELNYX_API_KEY', 'REUSED', `${apiKey.slice(0, 7)}... (${apiKey.length} chars)`)

  if (flags.dryRun) {
    record('balance', 'PLANNED', 'GET /v2/balance (skipped, --dry-run)')
    return { balance: null }
  }

  const bal = await api('/balance')
  if (!bal.ok) {
    record('balance', 'FAILED', bal.error)
    if (!flags.force) throw new Error('Balance check failed. The API key may be wrong. Re-run with --force to ignore.')
    return { balance: null }
  }
  const available = Number(bal.data?.available_credit ?? 0)
  const currency = bal.data?.currency ?? 'USD'
  record('balance', 'REUSED', `${available.toFixed(2)} ${currency} available`)
  if (available <= 0 && !flags.force) {
    throw new Error(
      'Account balance is zero. Provisioning and calls will fail. Fund the account, or re-run with --force to attempt anyway.',
    )
  }
  if (available < 2 && flags.buy) {
    console.warn('  !  Balance is under $2 and --buy is set. A number purchase plus first month may not clear.')
  }
  return { balance: available }
}

async function stepCallControlApp(baseUrl) {
  section('2. Call Control Application')
  const webhookUrl = `${baseUrl}/api/telnyx`

  if (flags.dryRun) {
    record(NAMES.callControlApp, 'PLANNED', `webhook_event_url=${webhookUrl}`)
    return { id: '<dry-run>', webhookUrl }
  }

  const list = await api('/call_control_applications', {
    query: { 'filter[application_name][contains]': 'Solstice', 'page[size]': 50 },
  })
  const existing = list.ok ? (list.data ?? []).find((a) => a.application_name === NAMES.callControlApp) : null

  if (existing) {
    if (existing.webhook_event_url !== webhookUrl) {
      const patched = await api(`/call_control_applications/${existing.id}`, {
        method: 'PATCH',
        body: { webhook_event_url: webhookUrl, webhook_api_version: '2', active: true },
      })
      if (patched.ok) record(NAMES.callControlApp, 'REUSED', `id ${existing.id}, webhook repointed to ${webhookUrl}`)
      else record(NAMES.callControlApp, 'FAILED', `exists (${existing.id}) but repoint failed: ${patched.error}`)
    } else {
      record(NAMES.callControlApp, 'REUSED', `id ${existing.id}`)
    }
    return { id: existing.id, webhookUrl }
  }

  const created = await api('/call_control_applications', {
    method: 'POST',
    body: {
      application_name: NAMES.callControlApp,
      webhook_event_url: webhookUrl,
      webhook_api_version: '2',
      active: true,
      anchorsite_override: 'Latency',
      first_command_timeout: true,
      first_command_timeout_secs: 30,
      webhook_timeout_secs: 25,
    },
  })
  if (!created.ok) {
    record(NAMES.callControlApp, 'FAILED', created.error)
    return { id: null, webhookUrl }
  }
  record(NAMES.callControlApp, 'CREATED', `id ${created.data.id}`)
  return { id: created.data.id, webhookUrl }
}

async function stepPhoneNumber(env, connectionId) {
  section('3. Phone number')

  const reuseTarget = env.TELNYX_PHONE_NUMBER || DEFAULT_REUSE_NUMBER

  if (flags.buy) {
    return buyNumber(connectionId)
  }

  if (flags.dryRun) {
    record(reuseTarget, 'PLANNED', `reuse and repoint to connection ${connectionId}`)
    return { number: reuseTarget, id: '<dry-run>' }
  }

  const found = await api('/phone_numbers', { query: { 'filter[phone_number]': reuseTarget } })
  if (!found.ok) {
    record(reuseTarget, 'FAILED', `lookup failed: ${found.error}`)
    return { number: null, id: null }
  }
  const row = (found.data ?? [])[0]
  if (!row) {
    record(reuseTarget, 'FAILED', 'not owned by this Telnyx account. Set TELNYX_PHONE_NUMBER, or re-run with --buy.')
    return { number: null, id: null }
  }

  if (row.connection_id === connectionId) {
    record(row.phone_number, 'REUSED', `id ${row.id}, already on the Sol call control app`)
    return { number: row.phone_number, id: row.id }
  }

  // Repointing away from the retired JARVIS connection. Approved by Enrique.
  const patched = await api(`/phone_numbers/${row.id}`, {
    method: 'PATCH',
    body: { connection_id: connectionId },
  })
  if (!patched.ok) {
    record(row.phone_number, 'FAILED', `owned (id ${row.id}) but repoint failed: ${patched.error}`)
    return { number: row.phone_number, id: row.id }
  }
  record(row.phone_number, 'REUSED', `id ${row.id}, repointed from connection ${row.connection_id} to ${connectionId}`)
  return { number: row.phone_number, id: row.id }
}

async function buyNumber(connectionId) {
  if (flags.dryRun) {
    record('new US local number', 'PLANNED', `search area code ${flags.areaCode}, then POST /v2/number_orders`)
    return { number: null, id: null }
  }

  const search = await api('/available_phone_numbers', {
    query: {
      'filter[country_code]': 'US',
      'filter[national_destination_code]': flags.areaCode,
      'filter[features][]': 'voice',
      'filter[limit]': 5,
    },
  })
  if (!search.ok || !(search.data ?? []).length) {
    record('number search', 'FAILED', search.ok ? `no numbers free in area code ${flags.areaCode}` : search.error)
    return { number: null, id: null }
  }
  const candidate = search.data[0].phone_number

  const order = await api('/number_orders', {
    method: 'POST',
    body: { phone_numbers: [{ phone_number: candidate }], connection_id: connectionId },
  })
  if (!order.ok) {
    record(candidate, 'FAILED', `purchase failed: ${order.error}`)
    return { number: null, id: null }
  }
  record(candidate, 'CREATED', `ordered, order id ${order.data.id}. Numbers can take a minute to become active.`)
  return { number: candidate, id: order.data?.phone_numbers?.[0]?.id ?? null }
}

async function stepAssistant(env, baseUrl, sol) {
  section('4. AI Assistant "Sol"')

  const urls = {
    tools: env.TOOLS_BASE_URL || `${baseUrl}/api/tools`,
    groupTool: env.GROUP_TOOL_URL || `${baseUrl}/api/group/tool`,
  }
  let toolNames = { concierge: [], group: [], routing: [] }
  try {
    toolNames = parseToolNames(await readFile(TOOL_CONTRACTS_PATH, 'utf8'))
  } catch (err) {
    record('shared/toolContracts.ts', 'FAILED', err.message)
  }

  const secret = env.TOOL_WEBHOOK_SECRET || process.env.TOOL_WEBHOOK_SECRET || null
  const integrationSecretId = flags.integrationSecret ? await ensureIntegrationSecret(secret) : null
  if (!secret) {
    console.warn('  !  TOOL_WEBHOOK_SECRET is not set. Tools will be registered WITHOUT an auth header.')
    console.warn('     /api/tools enforces the secret when it is set in the Netlify env, so if it is set')
    console.warn('     there and not here, every tool call Sol makes will 401. Set it in .env and re-run.')
    record('tool auth header', 'SKIPPED', 'TOOL_WEBHOOK_SECRET unset')
  } else {
    record(
      'tool auth header',
      'REUSED',
      integrationSecretId
        ? `x-solstice-tool-key -> {{integration_secret.${integrationSecretId}}}`
        : `x-solstice-tool-key -> TOOL_WEBHOOK_SECRET (${secret.length} chars, value not printed)`,
    )
  }

  const headers = authHeaders(secret, integrationSecretId)
  // TRANSFER_TARGET, not DEMO_PHONE. Enrique demos by calling from DEMO_PHONE, so using it as the
  // transfer destination tries to connect him to himself and fails while he is on the line.
  // Point it at a second number, or at the browser supervisor's SIP URI so the handoff visibly
  // lands in the staff console on screen.
  const transferTarget = env.TRANSFER_TARGET || env.TELNYX_SIP_URI || env.DEMO_PHONE || null
  const { tools, skipped } = buildToolList(toolNames, urls, transferTarget, headers)
  record('tools compiled', 'REUSED', `${tools.length} tools`)
  console.log(`      concierge + routing -> ${urls.tools}/<name>   (flat body)`)
  console.log(`      group               -> ${urls.groupTool}   ({ tool, args })`)
  if (skipped.length) console.log(`      skipped: ${skipped.join(', ')}`)

  const model = env.TELNYX_ASSISTANT_MODEL || 'openai/gpt-4o'
  const greeting = env.TELNYX_ASSISTANT_GREETING || sol.greeting || DEFAULT_GREETING

  const body = {
    name: NAMES.assistant,
    model,
    description: 'Solstice Hotel Group front-desk assistant. One agent definition, two runtimes.',
    instructions: sol.instructions,
    greeting,
    tools,
    voice_settings: { voice: env.TELNYX_ASSISTANT_VOICE || 'Telnyx.KokoroTTS.af' },
    transcription: { model: env.TELNYX_TRANSCRIPTION_MODEL || 'distil-whisper/distil-large-v2' },
    telephony_settings: { supports_unauthenticated_web_calls: true },
  }

  if (flags.dryRun) {
    record(NAMES.assistant, 'PLANNED', `model ${model}, ${tools.length} tools, ${sol.instructions.length} chars of instructions`)
    return { id: '<dry-run>', greeting }
  }

  // Warn early if the configured model is not one this account can use.
  const models = await api('/ai/models')
  if (models.ok && Array.isArray(models.data)) {
    const ids = models.data.map((m) => m.id ?? m.name).filter(Boolean)
    if (ids.length && !ids.includes(model)) {
      console.warn(`  !  Model "${model}" is not in GET /v2/ai/models. Available: ${ids.slice(0, 12).join(', ')}`)
      console.warn('     Set TELNYX_ASSISTANT_MODEL in .env and re-run with --refresh.')
    }
  }

  const list = await api('/ai/assistants', { query: { 'page[size]': 100 } })
  const existing = list.ok ? (list.data ?? []).find((a) => a.name === NAMES.assistant) : null

  if (existing && !flags.refresh) {
    record(NAMES.assistant, 'REUSED', `id ${existing.id} (pass --refresh to push agent/sol.md again)`)
    return { id: existing.id, greeting }
  }

  if (existing) {
    // The update verb moved between API revisions; try POST, then PUT. Two attempts, not a loop.
    let updated = await api(`/ai/assistants/${existing.id}`, { method: 'POST', body })
    if (!updated.ok && [404, 405].includes(updated.status)) {
      updated = await api(`/ai/assistants/${existing.id}`, { method: 'PUT', body })
    }
    if (!updated.ok) {
      record(NAMES.assistant, 'FAILED', `exists (${existing.id}) but refresh failed: ${updated.error}`)
      return { id: existing.id, greeting }
    }
    record(NAMES.assistant, 'REUSED', `id ${existing.id}, instructions and ${tools.length} tools refreshed`)
    return { id: existing.id, greeting }
  }

  const created = await api('/ai/assistants', { method: 'POST', body })
  if (!created.ok) {
    record(NAMES.assistant, 'FAILED', created.error)
    return { id: null, greeting }
  }
  record(NAMES.assistant, 'CREATED', `id ${created.data.id}, ${tools.length} tools`)
  return { id: created.data.id, greeting }
}

async function stepSipConnection(env, baseUrl) {
  section('5. Credential SIP Connection (browser supervisor)')

  const userName = env.TELNYX_SIP_USERNAME || `solstice${randomBytes(3).toString('hex')}`
  const password = env.TELNYX_SIP_PASSWORD || randomBytes(18).toString('base64url')

  if (flags.dryRun) {
    record(NAMES.credentialConnection, 'PLANNED', 'POST /v2/credential_connections')
    return { id: '<dry-run>', userName, password }
  }

  const list = await api('/credential_connections', { query: { 'page[size]': 100 } })
  const existing = list.ok ? (list.data ?? []).find((c) => c.connection_name === NAMES.credentialConnection) : null

  if (existing) {
    // Make sure SIP URI calling is on: without it the supervisor leg cannot reach the browser.
    if (existing.sip_uri_calling_preference !== 'unrestricted') {
      const patched = await api(`/credential_connections/${existing.id}`, {
        method: 'PATCH',
        body: { sip_uri_calling_preference: 'unrestricted' },
      })
      record(
        NAMES.credentialConnection,
        patched.ok ? 'REUSED' : 'FAILED',
        patched.ok
          ? `id ${existing.id}, SIP URI calling enabled`
          : `id ${existing.id} but could not enable SIP URI calling: ${patched.error}`,
      )
    } else {
      record(NAMES.credentialConnection, 'REUSED', `id ${existing.id}`)
    }
    return { id: existing.id, userName: existing.user_name ?? userName, password }
  }

  const created = await api('/credential_connections', {
    method: 'POST',
    body: {
      connection_name: NAMES.credentialConnection,
      user_name: userName,
      password,
      // This is the API equivalent of the "Receive SIP URI calls" toggle in the portal.
      sip_uri_calling_preference: 'unrestricted',
      webhook_event_url: `${baseUrl}/api/telnyx`,
      webhook_api_version: '2',
      active: true,
      anchorsite_override: 'Latency',
      inbound: { ani_number_format: '+E.164' },
    },
  })
  if (!created.ok) {
    record(NAMES.credentialConnection, 'FAILED', created.error)
    return { id: null, userName, password }
  }
  record(NAMES.credentialConnection, 'CREATED', `id ${created.data.id}, user ${created.data.user_name ?? userName}`)
  return { id: created.data.id, userName: created.data.user_name ?? userName, password }
}

async function stepWebrtcCredential(connectionId) {
  section('6. WebRTC credential (short-lived token source)')

  if (flags.dryRun) {
    record(NAMES.telephonyCredential, 'PLANNED', 'POST /v2/telephony_credentials')
    return { id: '<dry-run>', sipUsername: '<dry-run>', sipPassword: null }
  }
  if (!connectionId) {
    record(NAMES.telephonyCredential, 'SKIPPED', 'no credential connection to attach to')
    return { id: null, sipUsername: null, sipPassword: null }
  }

  const list = await api('/telephony_credentials', { query: { 'page[size]': 100 } })
  const existing = list.ok ? (list.data ?? []).find((c) => c.name === NAMES.telephonyCredential) : null
  if (existing) {
    record(NAMES.telephonyCredential, 'REUSED', `id ${existing.id}, sip user ${existing.sip_username}`)
    return { id: existing.id, sipUsername: existing.sip_username, sipPassword: existing.sip_password ?? null }
  }

  const created = await api('/telephony_credentials', {
    method: 'POST',
    body: { connection_id: connectionId, name: NAMES.telephonyCredential },
  })
  if (!created.ok) {
    record(NAMES.telephonyCredential, 'FAILED', created.error)
    return { id: null, sipUsername: null, sipPassword: null }
  }
  record(NAMES.telephonyCredential, 'CREATED', `id ${created.data.id}, sip user ${created.data.sip_username}`)
  return { id: created.data.id, sipUsername: created.data.sip_username, sipPassword: created.data.sip_password ?? null }
}

async function stepAttachNumber(assistantId, phoneNumber, callControlAppId) {
  section('7. Attach the number to Sol')

  if (!phoneNumber || !assistantId) {
    record('attach number', 'SKIPPED', 'need both a number and an assistant id')
    return
  }
  if (flags.dryRun) {
    record('attach number', 'PLANNED', `${phoneNumber} -> assistant ${assistantId}`)
    return
  }

  // The number reaches Sol through OUR call control application, not through Telnyx's direct
  // assistant answering. That is deliberate: the direct assignment makes Telnyx answer the call
  // itself, which means no call.initiated for us, which means no ai_assistant_start with
  // send_message_history_updates, which means NO LIVE TRANSCRIPT. plans/02 is built on the
  // ai_assistant_start path, so the call control binding is the real attachment.
  record('number -> call control app', 'REUSED', `${phoneNumber} on application ${callControlAppId}`)

  // Still register the association on the assistant so it shows in the Telnyx portal and in the
  // exported assistant JSON deliverable. Non-fatal: our routing does not depend on it.
  const assigned = await api(`/ai/assistants/${assistantId}/phone_numbers`, {
    method: 'POST',
    body: { phone_number: phoneNumber },
  })
  if (assigned.ok) {
    record('number -> assistant record', 'CREATED', `${phoneNumber} registered on assistant ${assistantId}`)
  } else if (assigned.status === 422 || assigned.status === 409) {
    record('number -> assistant record', 'REUSED', 'already assigned')
  } else {
    record('number -> assistant record', 'SKIPPED', `${assigned.error} (routing still works via the call control app)`)
  }
}

async function stepWebhooks(assistantId, webhookUrl) {
  section('8. Transcript + insights webhooks')

  if (flags.dryRun) {
    record('transcript webhook', 'PLANNED', webhookUrl)
    record('insights webhook', 'PLANNED', webhookUrl)
    return
  }

  // Transcripts and conversation events are Call Control events. They are delivered to the call
  // control application's webhook_event_url, which step 2 already set and verified:
  //   call.ai_gather.message_history_updated   (live, once per turn)
  //   call.conversation.ended
  //   call.conversation_insights.generated
  record('transcript webhook', 'REUSED', `${webhookUrl} <- call.ai_gather.message_history_updated`)
  record('conversation webhook', 'REUSED', `${webhookUrl} <- call.conversation.ended`)

  if (!assistantId) {
    record('insights', 'SKIPPED', 'no assistant id')
    return
  }

  // Insights only fire if the assistant has an insight group attached. Optional, non-fatal:
  // the endpoint shape has moved between API revisions and nothing else depends on it.
  const groups = await api('/ai/insight-groups', { query: { 'page[size]': 100 } })
  let groupId = groups.ok ? (groups.data ?? []).find((g) => g.name === NAMES.insightGroup)?.id : null

  if (!groupId && groups.ok) {
    const created = await api('/ai/insight-groups', {
      method: 'POST',
      body: { name: NAMES.insightGroup, description: 'Post-call summary and outcome for the Solstice archive.' },
    })
    if (created.ok) groupId = created.data?.id
  }

  if (!groupId) {
    record('insights group', 'SKIPPED', 'could not list or create an insight group; call.conversation_insights.generated will not fire')
    record('insights handler', 'REUSED', `${webhookUrl} is ready to receive them if enabled in the portal`)
    return
  }

  let patched = await api(`/ai/assistants/${assistantId}`, {
    method: 'POST',
    body: { insight_settings: { insight_group_id: groupId } },
  })
  if (!patched.ok && [404, 405].includes(patched.status)) {
    patched = await api(`/ai/assistants/${assistantId}`, {
      method: 'PUT',
      body: { insight_settings: { insight_group_id: groupId } },
    })
  }
  record(
    'insights group',
    patched.ok ? 'CREATED' : 'FAILED',
    patched.ok ? `${groupId} attached to assistant` : `group ${groupId} exists but attach failed: ${patched.error}`,
  )
}

/**
 * Read the assistant back and confirm every webhook tool actually carries the auth header.
 * This is the check that would have caught the 401 break: registration succeeding is not the same
 * as the header being attached. Header NAMES are printed; values never are.
 */
async function stepVerifyTools(assistantId, expectedHeader) {
  section('9. Verify registered tools')

  if (flags.dryRun || !assistantId || assistantId === '<dry-run>') {
    record('verify tools', 'SKIPPED', 'needs a live assistant id')
    return
  }

  const got = await api(`/ai/assistants/${assistantId}`)
  if (!got.ok) {
    record('verify tools', 'FAILED', got.error)
    return
  }

  const tools = got.data?.tools ?? []
  const webhookTools = tools.filter((t) => t.type === 'webhook')
  const missing = []
  const urlCounts = {}

  for (const t of webhookTools) {
    const hook = t.webhook ?? {}
    const names = (hook.headers ?? []).map((h) => (h.name ?? '').toLowerCase())
    if (!names.includes(expectedHeader.toLowerCase())) missing.push(hook.name ?? '(unnamed)')
    urlCounts[hook.url] = (urlCounts[hook.url] ?? 0) + 1
  }

  record('tools on assistant', 'REUSED', `${tools.length} total, ${webhookTools.length} webhook`)
  for (const [url, count] of Object.entries(urlCounts)) console.log(`      ${count} -> ${url}`)

  if (missing.length === 0 && webhookTools.length > 0) {
    record(`header ${expectedHeader}`, 'REUSED', `present on all ${webhookTools.length} webhook tools`)
  } else if (webhookTools.length === 0) {
    record(`header ${expectedHeader}`, 'FAILED', 'no webhook tools are registered on this assistant')
  } else {
    record(`header ${expectedHeader}`, 'FAILED', `MISSING on ${missing.length}: ${missing.slice(0, 8).join(', ')}`)
  }
}

// ---------------------------------------------------------------------------- main

async function main() {
  console.log('Solstice FDE — Telnyx provisioning')
  console.log(`repo: ${REPO_ROOT}`)
  if (flags.dryRun) console.log('MODE: --dry-run, no network calls will be made')

  const { values: env } = await readEnvFile()
  const baseUrl = (flags.baseUrl || env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || env.URL || 'https://solstice-fde.netlify.app').replace(/\/+$/, '')
  console.log(`base url: ${baseUrl}`)

  const pre = await stepPreflight(env)
  if (flags.check) {
    console.log('\n--check only. Nothing was provisioned.')
    return
  }

  // Compile the agent definition before touching anything remote, so a missing sol.md is a loud
  // warning at the top rather than a surprise halfway through.
  let sol = { instructions: PLACEHOLDER_INSTRUCTIONS, greeting: null, source: 'placeholder' }
  try {
    await access(SOL_MD_PATH)
    const md = await readFile(SOL_MD_PATH, 'utf8')
    const compiled = compileInstructions(md)
    sol = { instructions: compiled.instructions, greeting: extractGreeting(md), source: 'agent/sol.md' }
    console.log(`agent/sol.md: compiled ${compiled.instructions.length} chars${compiled.truncated ? ' (TRUNCATED)' : ''}`)
  } catch {
    console.warn('\n  !  agent/sol.md not found. Sol will be created with PLACEHOLDER instructions.')
    console.warn('     Once Agent A3 lands the file, re-run: node scripts/telnyx/provision.mjs --refresh\n')
  }

  const app = await stepCallControlApp(baseUrl)
  const number = await stepPhoneNumber(env, app.id)
  const assistant = await stepAssistant(env, baseUrl, sol)
  const sip = await stepSipConnection(env, baseUrl)
  const webrtc = await stepWebrtcCredential(sip.id)
  await stepAttachNumber(assistant.id, number.number, app.id)
  await stepWebhooks(assistant.id, app.webhookUrl)
  await stepVerifyTools(assistant.id, 'x-solstice-tool-key')

  // ------------------------------------------------------------------ .env
  section('10. .env')
  const updates = {}
  const set = (k, v) => {
    if (v !== null && v !== undefined && v !== '' && v !== '<dry-run>') updates[k] = v
  }
  set('TELNYX_ASSISTANT_ID', assistant.id)
  set('TELNYX_PHONE_NUMBER', number.number)
  // The browser registers as the WebRTC credential, so that is the identity the supervisor leg is
  // dialled at. The credential connection's own user/password stay as the break-glass login.
  set('TELNYX_SIP_USERNAME', webrtc.sipUsername || sip.userName)
  set('TELNYX_SIP_PASSWORD', webrtc.sipPassword || sip.password)
  set('TELNYX_CALL_CONTROL_APP_ID', app.id)
  set('TELNYX_SIP_CONNECTION_ID', sip.id)
  set('TELNYX_TELEPHONY_CREDENTIAL_ID', webrtc.id)
  set(
    'TELNYX_SIP_URI',
    webrtc.sipUsername && webrtc.sipUsername !== '<dry-run>' ? `sip:${webrtc.sipUsername}@sip.telnyx.com` : null,
  )
  set('PUBLIC_BASE_URL', baseUrl)

  if (Object.keys(updates).length === 0) {
    record('.env', 'SKIPPED', 'nothing resolved to write')
  } else if (flags.noEnvWrite || flags.dryRun) {
    record('.env', 'PLANNED', 'would write:')
    for (const [k, v] of Object.entries(updates)) {
      console.log(`      ${k}=${/PASSWORD|KEY/.test(k) ? '***' : v}`)
    }
  } else {
    await writeEnvFile(updates)
    record('.env', 'CREATED', `${Object.keys(updates).length} keys written, backup at .env.bak`)
    for (const k of Object.keys(updates)) console.log(`      ${k}`)
  }

  // ------------------------------------------------------------------ summary
  section('Summary')
  const counts = summary.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {})
  console.log(
    `  ${Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}  (${callCount} Telnyx API calls)`,
  )
  const failures = summary.filter((s) => s.status === 'FAILED')
  if (failures.length) {
    console.log('\n  FAILED steps:')
    for (const f of failures) console.log(`    - ${f.step}: ${f.detail}`)
  }

  console.log('\n  Manual steps only Enrique can do:')
  console.log(`    1. Telnyx portal -> SIP Connections -> "${NAMES.credentialConnection}":`)
  console.log('       confirm "Receive SIP URI calls" is ENABLED. Without it the browser supervisor')
  console.log('       leg cannot be reached and listen/whisper/barge all fail.')
  console.log('    2. Copy the new .env keys into the Netlify site environment (Site settings ->')
  console.log('       Environment variables), then redeploy. Functions read process.env, not .env.')
  console.log('    3. Telnyx portal -> API Keys -> copy the Public Key into TELNYX_PUBLIC_KEY.')
  console.log('       Until it is set, the webhook accepts UNVERIFIED requests and logs a warning.')
  if (sol.source === 'placeholder') {
    console.log('    4. agent/sol.md is missing. Re-run with --refresh once it exists.')
  }
  if (pre.balance !== null && pre.balance < 5) {
    console.log(`\n  Balance is ${pre.balance.toFixed(2)}. Enough to test, not enough to leave calls running.`)
  }
  console.log('')
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`)
  process.exitCode = 1
})
