/**
 * The tool registry: one place that knows every tool's contract, its handler, and
 * how to describe what it just did.
 *
 * RUNTIME-NEUTRAL ON PURPOSE. Nothing here imports the Anthropic SDK or anything
 * Telnyx. The Claude chat loop converts `TOOL_SPECS` into Anthropic tool
 * definitions; the Telnyx assistant config is generated from the same specs. That
 * is the mechanism, not the aspiration, behind "voice and chat cannot drift".
 */
import { CONCIERGE_TOOLS, type ConciergeTool, type ToolSpec } from '../../../shared/toolContracts'
import type { ToolResult } from '../../../shared/types'
import { getDatabase, maskArgs, toolFail } from './_deps'
import type { ToolArgs, ToolContext } from './helpers'

import { getReservation, identifyGuest } from './identity'
import { getPolicy, getPropertyInfo } from './policy'
import { bookAmenity, checkLateCheckout, checkUpgradeEligibility } from './stayBenefits'
import { checkCompAuthority, checkServiceRecoveryEligibility } from './recovery'
import { createEscalation, transferToHuman } from './escalation'
import { classifyIntent } from './routing'
import { isOffline, OUTAGE_REASON, type FlagKey } from '../_lib/flags'

export type ToolHandler = (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>

// ------------------------------------------------------------------- contracts

/**
 * Typed as `Record<ConciergeTool, ...>` so that adding a name to CONCIERGE_TOOLS
 * without implementing it is a compile error, not a runtime surprise.
 */
const CONCIERGE_HANDLERS: Record<ConciergeTool, ToolHandler> = {
  identify_guest: identifyGuest,
  get_reservation: getReservation,
  get_policy: getPolicy,
  check_late_checkout: checkLateCheckout,
  check_upgrade_eligibility: checkUpgradeEligibility,
  book_amenity: bookAmenity,
  check_service_recovery_eligibility: checkServiceRecoveryEligibility,
  check_comp_authority: checkCompAuthority,
  get_property_info: getPropertyInfo,
  create_escalation: createEscalation,
  transfer_to_human: transferToHuman,
}

const CONCIERGE_SPECS: ToolSpec[] = [
  {
    name: 'identify_guest',
    description:
      'Find the guest we are speaking to. A name alone is never enough to verify anyone: call this with a confirmation number, or the phone number or email on the booking. Returns masked contact details only. Call this before any tool that reveals stay detail.',
    parameters: {
      confirmation_number: { type: 'string', description: 'Reservation or confirmation number, e.g. R55004.' },
      last_name: { type: 'string', description: "The guest's surname." },
      first_name: { type: 'string', description: "The guest's first name." },
      phone: { type: 'string', description: 'Phone number the guest gave, or the caller ID on a voice call.' },
      email: { type: 'string', description: 'Email address the guest gave.' },
      guest_id: { type: 'string', description: 'Internal guest id, when already known.' },
    },
  },
  {
    name: 'get_reservation',
    description:
      'Read one stay: dates, room type, rate plan, status, and the cancellation terms that follow from the rate plan. Never returns card details. Use it before answering anything about a specific booking.',
    parameters: {
      reservation_id: { type: 'string', description: 'Reservation or confirmation number.' },
      guest_id: { type: 'string', description: 'Verified guest id; returns the most relevant stay.' },
    },
  },
  {
    name: 'get_policy',
    description:
      'Look up the front desk policy reference. Returns the operative rule, machine-readable facts, and a citation. If nothing matches, it says so and you must not answer from memory.',
    parameters: {
      query: { type: 'string', description: 'What the guest asked about, in their words.' },
      section_id: { type: 'string', description: 'A specific policy section number.' },
    },
  },
  {
    name: 'check_late_checkout',
    description:
      'Decide a late checkout request against Policy 1 and the Policy 6 tier benefits. Returns whether the time may be promised or only offered; only a tier guarantee is ever promised. A stay that has ended or was cancelled gets nothing.',
    parameters: {
      reservation_id: { type: 'string', description: 'Reservation or confirmation number.', required: true },
      requested_time: { type: 'string', description: 'The clock time the guest asked for, as "h:mm pm" or "HH:MM".' },
    },
  },
  {
    name: 'check_upgrade_eligibility',
    description:
      'Decide an upgrade request against the Policy 6 tier benefits. Upgrades depend on same-day inventory, so the answer is eligibility, never a promise. A stay that has ended or was cancelled gets nothing.',
    parameters: {
      reservation_id: { type: 'string', description: 'Reservation or confirmation number.', required: true },
    },
  },
  {
    name: 'book_amenity',
    description:
      'Request a service against a stay: turndown, hypoallergenic bedding, a wake-up call, a ground-floor room, connecting rooms, a rollaway bed or a celebration amenity. Refuses anything not in the catalogue rather than inventing a service or a price.',
    parameters: {
      reservation_id: { type: 'string', description: 'Reservation or confirmation number.', required: true },
      amenity: { type: 'string', description: 'What the guest asked for, in their words.', required: true },
      when: { type: 'string', description: 'Date or time the guest wants it, if they said.' },
    },
  },
  {
    name: 'check_service_recovery_eligibility',
    description:
      'Work out whether a stay problem is still inside the Policy 5 service recovery window (its length is returned by this tool). The window runs from checkout; a complaint the guest raised during the stay counts as made and does not expire because they followed up later.',
    parameters: {
      reservation_id: { type: 'string', description: 'Reservation or confirmation number.', required: true },
      issue_reported_at: { type: 'string', description: 'When the guest first raised the issue, ISO date or timestamp.' },
      issue_raised_during_stay: { type: 'string', description: 'true if they told housekeeping or the front desk while still in house.' },
    },
  },
  {
    name: 'check_comp_authority',
    description:
      'Decide whether a proposed comp is inside the Policy 7 front-desk comp authority (returned by this tool). Pass EVERY issue on the stay: several small ones are summed before the limit is tested. A full comped night always needs a manager.',
    parameters: {
      items: { type: 'array', description: 'List of {description, amount} in dollars, one per issue on this stay.' },
      amount: { type: 'number', description: 'A single amount in dollars, when there is only one issue.' },
      comp_night: { type: 'string', description: 'true if a full night is being comped.' },
      reservation_id: { type: 'string', description: 'Reservation or confirmation number.' },
      prior_stay_comps: { type: 'number', description: 'Dollars comped on a PREVIOUS stay, for context only.' },
    },
  },
  {
    name: 'get_property_info',
    description:
      'Facts about one Solstice property. Deliberately carries no parking price: there is no chain-wide parking rate, so it returns the refusal and the right thing to say instead. Also quarantines impossible values in the property record rather than repeating them.',
    parameters: {
      property_code: {
        type: 'string',
        description: 'Property code (SOL-CHI), or the city or hotel name the guest used ("Columbus", "Denver Union Station"). Ambiguous names come back as a question, never a guess.',
        required: true,
      },
      topic: { type: 'string', description: 'What the guest wants to know, so the tool can flag refusals such as parking.' },
    },
  },
  {
    name: 'create_escalation',
    description:
      'Raise this to a human under the Policy 15 matrix and build the context packet they receive. Safety, threats and law enforcement route straight to the GM and Regional Security, any hour.',
    parameters: {
      summary: { type: 'string', description: 'One line: what happened and what the guest wants.', required: true },
      category: { type: 'string', description: 'refund, dispute, medical, legal, safety, authority_exceeded or other.' },
      reservation_id: { type: 'string', description: 'Reservation or confirmation number.' },
      attempted_resolutions: { type: 'array', description: 'What you already tried or offered.' },
      transcript_excerpt: { type: 'string', description: 'The few lines a human needs to understand the tone.' },
      recommended_action: { type: 'string', description: 'What you think should happen next.' },
    },
  },
  {
    name: 'transfer_to_human',
    description:
      'Hand the guest to a person: a warm transfer on a call, a supervisor takeover in chat. Returns the context read-back. If no transfer route is configured it says so plainly so you never pretend a handoff happened.',
    parameters: {
      reason: { type: 'string', description: 'Why a human is needed, in one line.', required: true },
      escalation_id: { type: 'string', description: 'The escalation this handoff belongs to, if one exists.' },
      category: { type: 'string', description: 'Escalation category, to route the authority correctly.' },
    },
  },
]

const ROUTING_SPECS: ToolSpec[] = [
  {
    name: 'classify_intent',
    description:
      'Decide whether a message is a personal concierge question, a group booking request, or a safety escalation. Policy 13 bars the concierge side from approving, pricing or discounting a group block, so a group request has to be routed, not answered.',
    parameters: {
      utterance: { type: 'string', description: 'The guest message to classify.', required: true },
    },
  },
]

// ---------------------------------------------------------------- the registry

const handlers = new Map<string, ToolHandler>()
const specs = new Map<string, ToolSpec>()

for (const spec of [...CONCIERGE_SPECS, ...ROUTING_SPECS]) specs.set(spec.name, spec)
for (const name of CONCIERGE_TOOLS) handlers.set(name, CONCIERGE_HANDLERS[name])
handlers.set('classify_intent', classifyIntent)

/**
 * Extension point for the group booking tool layer: it can mount its own tools
 * into the same registry without either side editing the other's files.
 */
export function registerTools(newSpecs: ToolSpec[], newHandlers: Record<string, ToolHandler>): void {
  for (const spec of newSpecs) specs.set(spec.name, spec)
  for (const [name, handler] of Object.entries(newHandlers)) handlers.set(name, handler)
}

export function toolSpecs(): ToolSpec[] {
  return [...specs.values()]
}

export function hasTool(name: string): boolean {
  return handlers.has(name)
}

// ------------------------------------------------- spec -> JSON Schema, once

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

function jsonType(declared: string): string {
  const t = declared.toLowerCase()
  if (t === 'array') return 'array'
  if (t === 'number' || t === 'integer') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

export function specToDefinition(spec: ToolSpec): ToolDefinition {
  const properties: Record<string, { type: string; description: string }> = {}
  const required: string[] = []
  for (const [key, param] of Object.entries(spec.parameters)) {
    properties[key] = { type: jsonType(param.type), description: param.description }
    if (param.required) required.push(key)
  }
  return { name: spec.name, description: spec.description, input_schema: { type: 'object', properties, required } }
}

export function toolDefinitions(): ToolDefinition[] {
  return toolSpecs().map(specToDefinition)
}

// --------------------------------------------------------------- invocation

/**
 * Which upstream each tool depends on. Used only by failure injection: taking the PMS offline must
 * stop the tools that genuinely need live inventory, and leave the ones that do not still working,
 * because a system where everything fails at once teaches a panel nothing.
 */
const DEPENDENCY_OF: Record<string, FlagKey> = {
  // Needs live, same-day inventory.
  check_late_checkout: 'pms_offline',
  check_upgrade_eligibility: 'pms_offline',
  book_amenity: 'pms_offline',
  // Needs the reservation record itself.
  identify_guest: 'reservations_offline',
  get_reservation: 'reservations_offline',
  // Needs the policy reference.
  get_policy: 'policy_source_offline',
  check_service_recovery_eligibility: 'policy_source_offline',
  check_comp_authority: 'policy_source_offline',
}

export async function runTool(name: string, args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now()
  const handler = handlers.get(name)

  if (!handler) {
    return {
      ...toolFail(
        `The tool "${name}" is not mounted in this runtime. Do not answer as though it ran. Say you cannot complete that here and offer to put a colleague on it.`,
      ),
      latency_ms: Date.now() - started,
    }
  }

  // Failure injection, checked here rather than inside each tool so there is exactly one seam and
  // a new tool inherits it. An injected outage returns the SAME shape a real one would: ungrounded,
  // with a reason the agent can say out loud. It must be indistinguishable to everything downstream,
  // otherwise the demo proves nothing about the real failure path.
  const dependency = DEPENDENCY_OF[name]
  if (dependency && (await isOffline(dependency))) {
    return {
      ...toolFail(
        `${OUTAGE_REASON[dependency]} Tell the guest plainly that you cannot confirm this right now, do not guess, and offer to have a colleague follow up.`,
      ),
      latency_ms: Date.now() - started,
    }
  }

  try {
    const result = await handler(args ?? {}, ctx)
    return { ...result, latency_ms: Date.now() - started }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ...toolFail(`${name} failed: ${message}. Treat this as ungrounded: say you cannot confirm it and offer a human.`),
      latency_ms: Date.now() - started,
    }
  }
}

// ------------------------------------------------------------------- masking

/**
 * Arguments are masked BEFORE they are written anywhere a human can read them.
 * The masking itself is A1's `_lib/mask.maskArgs`, which is also what the data
 * build uses, so what the trace shows and what the data stores cannot drift.
 */
export function maskToolArgs(args: ToolArgs): unknown {
  return maskArgs(args ?? {}).masked
}

// ------------------------------------------------------- human-readable chips

const RUNNING_LABELS: Record<string, string> = {
  identify_guest: 'Looking up your booking',
  get_reservation: 'Reading your reservation',
  get_policy: 'Checking the policy',
  check_late_checkout: 'Checking late checkout',
  check_upgrade_eligibility: 'Checking upgrade eligibility',
  book_amenity: 'Sending the request to the property',
  check_service_recovery_eligibility: 'Checking the service recovery window',
  check_comp_authority: 'Checking what the front desk can authorise',
  get_property_info: 'Checking the property record',
  create_escalation: 'Bringing a manager in',
  transfer_to_human: 'Getting a colleague',
  classify_intent: 'Working out how to help',
}

export function runningLabel(name: string): string {
  return RUNNING_LABELS[name] ?? `Running ${name}`
}

/** Chip wording for a stay-benefit decision code, e.g. eligible_subject_to_availability. */
function decisionLabel(decision: unknown): string {
  if (decision === 'eligible_subject_to_availability') return 'eligible, subject to availability'
  if (decision === 'stay_ended') return 'stay has ended'
  return typeof decision === 'string' ? decision.replace(/_/g, ' ') : 'checked'
}

/** The one-line "done" summary shown in the guest chip and the supervisor trace. */
export function summarize(name: string, result: ToolResult): string {
  if (!result.ok) return `${runningLabel(name)}: could not confirm`
  const data = (result.data ?? {}) as Record<string, unknown>

  switch (name) {
    case 'identify_guest': {
      if (data.verified === true) {
        const guest = data.guest as Record<string, unknown> | undefined
        return `Verified ${guest?.first_name ?? 'guest'} ${guest?.last_name ?? ''} (${guest?.loyalty_tier ?? 'no tier'})`.trim()
      }
      return data.ambiguous === true ? `${data.matches} records match, needs a confirmation number` : 'Not verified yet'
    }
    case 'get_reservation': {
      const r = data.reservation as Record<string, unknown> | undefined
      return r ? `${r.reservation_id}: ${r.room_type} at ${r.property_code}, ${r.check_in_date} to ${r.check_out_date}` : 'Reservation read'
    }
    case 'get_policy': {
      const sections = (data.sections ?? []) as Array<Record<string, unknown>>
      return sections.length > 0 ? `Policy ${sections.map((s) => s.section_id).join(', ')} — ${sections[0].title}` : 'No matching policy'
    }
    case 'check_late_checkout':
      return `Late checkout ${String(data.requested_time ?? '')}: ${decisionLabel(data.decision)}`.trim()
    case 'check_upgrade_eligibility':
      return `Upgrade to ${String(data.target_room_class ?? 'next class')}: ${decisionLabel(data.decision)}`
    case 'book_amenity':
      return `${String((data.amenity as Record<string, unknown> | undefined)?.label ?? 'Request')}: ${String(data.status ?? 'requested')}`
    case 'check_service_recovery_eligibility':
      return data.eligible === true
        ? `Inside the ${String(data.window_hours)}-hour service recovery window`
        : `Outside the ${String(data.window_hours)}-hour window (${String(data.hours_after_checkout_at_complaint)}h after checkout)`
    case 'check_comp_authority':
      return `${String(data.total_display ?? '')} — ${data.within_front_desk_authority === true ? 'inside front desk authority' : 'needs AGM or GM'}`
    case 'get_property_info': {
      const p = data.property as Record<string, unknown> | undefined
      return data.answering === 'parking' ? `${p?.property_code ?? 'Property'}: no chain-wide parking rate` : `${p?.property_name ?? 'Property'} record`
    }
    case 'create_escalation':
      return `Escalation ${String(data.escalation_id ?? '')} to ${String(data.authority_required ?? 'a manager')}`
    case 'transfer_to_human':
      return data.transfer_available === true ? 'Handing over to a colleague' : 'No transfer route configured; manager callback'
    case 'classify_intent':
      return `Intent: ${String(data.intent ?? 'unclear')}`
    default:
      return result.grounded ? 'Done' : 'Could not confirm'
  }
}

// ----------------------------------------------------------- persistence

/**
 * Writes one row to `tool_invocations`. The supervisor dashboard reads this table
 * over Supabase Realtime, which is how "everything the agent does is observable"
 * stops being a claim. Never throws: a logging failure must not break a guest.
 */
/**
 * Writes the classified intent onto the session, so the supervisor console can label the
 * conversation.
 *
 * Four admin surfaces read `sessions.intent` and nothing wrote it, so every session ever recorded
 * rendered as "classifying…" — that is what `intentLabel(null)` returns. `classify_intent` had the
 * answer the whole time; it only ever reached the tool trace. It lives here rather than in either
 * runtime because BOTH channels call this tool and both need the same row updated: chat through
 * `chat.ts`, telephony through the `/api/tools` webhook.
 *
 * Never throws, and never blocks a turn. A label is not worth failing a conversation for, which is
 * also why the original omission was silent.
 */
export async function recordClassifiedIntent(
  ctx: ToolContext,
  name: string,
  result: ToolResult,
): Promise<void> {
  if (name !== 'classify_intent' || !result.ok) return
  const classified = (result.data as { intent?: unknown } | undefined)?.intent
  if (typeof classified !== 'string' || !classified) return
  try {
    const db = getDatabase()
    if (!db || !ctx.session_id) return
    await db.from('sessions').update({ intent: classified }).eq('id', ctx.session_id)
  } catch {
    // the conversation matters more than the label
  }
}

export async function recordToolInvocation(
  ctx: ToolContext,
  name: string,
  args: ToolArgs,
  result: ToolResult,
): Promise<void> {
  try {
    const db = getDatabase()
    if (!db || !ctx.session_id) return
    await db.from('tool_invocations').insert({
      session_id: ctx.session_id,
      tool: name,
      args_masked: maskToolArgs(args),
      result_summary: summarize(name, result),
      grounded: result.grounded,
      latency_ms: result.latency_ms ?? null,
    })
  } catch {
    // Intentionally swallowed. Observability is not worth a dropped conversation.
  }
}
