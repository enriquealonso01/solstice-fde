// The side chat a sales rep gets on every inquiry.
//
// Scope is the guardrail: the assistant is bound to ONE inquiry id, injected server-side. No
// tool it can call takes an inquiry id as an argument, so it cannot be talked into acting on
// somebody else's booking, and it cannot answer a threshold question from memory because the
// thresholds only exist behind `evaluate_group_rules`.
//
// The approval gate is not restated here as an instruction. `send_proposal` enforces it in the
// state machine, so an assistant that tries to send a flagged proposal gets a refusal from the
// tool, not from its own good manners.

import Anthropic from '@anthropic-ai/sdk'
import type { GroupInquiry, ToolResult } from '../../../shared/types'
import { loadInquiry, loadProperty } from './_deps'
import {
  check_availability,
  draft_clarifying_questions,
  evaluate_group_rules,
  find_alternates,
  generate_proposal,
  price_block,
  send_proposal,
  submit_for_approval,
  validate_property_data,
  findProposalByInquiry,
} from './tools'

/** Verified working 2026-09-24. Responses may open with a `thinking` block, so never index
 *  content[0] blindly. */
export const ASSISTANT_MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 1600
const MAX_TOOL_ROUNDS = 5

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantTrace {
  tool: string
  args: Record<string, unknown>
  ok: boolean
  grounded: boolean
  summary: string
  latency_ms: number
}

export interface AssistantReply {
  ok: boolean
  reply: string
  /** Next things worth asking, offered as one-click chips. Derived from the state of the
   *  enquiry, not from the model, so they cost nothing and never contradict the verdicts. */
  suggestions?: string[]
  trace: AssistantTrace[]
  model: string
  error?: string
}

const SYSTEM = `You are Sol, the group sales assistant at Solstice Hotels. You are talking to a Solstice sales rep on the inside of the system, not to a customer.

How you work:
- You are bound to one enquiry. Every tool you have already knows which one, so never ask for an enquiry reference and never assume you can look at another.
- Never state a room cap, a discount ceiling, a blackout window, a meeting capacity or a rate from memory. Those live in the rules engine. Call evaluate_group_rules and quote what it returns.
- If a tool comes back with ok:false or grounded:false, say plainly what you cannot confirm and what would need to happen. Do not fill the gap yourself. Inventing a rate or an availability figure is the worst thing you can do here.
- When the rules engine returns decision_options, lay them out as the choice they are: what each one costs, who has to approve it, and what the tradeoff is. Do not pick for the rep unless they ask.
- If a proposal needs an approval, say so and stop. Do not try to send it; the send will be refused anyway and the rep deserves a straight answer rather than a failed attempt.
- Talk like a colleague: short, specific, no hedging, no bullet-point salad unless you are genuinely listing options.`

type ToolHandler = (inquiryId: string, input: Record<string, unknown>) => Promise<ToolResult<unknown>>

/** The scoped tool surface. Note what is NOT here: nothing takes an inquiry_id. */
const TOOLS: {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  run: ToolHandler
}[] = [
  {
    name: 'evaluate_group_rules',
    description:
      'Run every booking rule against this enquiry. Returns one verdict per rule with the number asked for, the number allowed, and a sentence you can read aloud. Also returns decision_options when the only problem is the discount. Call this before answering any question about what is or is not allowed.',
    input_schema: { type: 'object', properties: {} },
    run: (inquiry_id) => evaluate_group_rules({ inquiry_id }),
  },
  {
    name: 'price_block',
    description:
      'Price the room block. Omit discount_pct to price at the most we are allowed to approve for these dates.',
    input_schema: {
      type: 'object',
      properties: {
        discount_pct: { type: 'number', description: 'Whole percentage points, e.g. 15.' },
      },
    },
    run: (inquiry_id, input) =>
      price_block({ inquiry_id, discount_pct: input.discount_pct as number | undefined }),
  },
  {
    name: 'find_alternates',
    description:
      'Other dates at the same hotel, and other Solstice hotels over the same dates, that clear every requirement. Use when the answer to the original request is no.',
    input_schema: { type: 'object', properties: {} },
    run: (inquiry_id) => find_alternates({ inquiry_id }),
  },
  {
    name: 'draft_clarifying_questions',
    description:
      'The questions that must be answered before this enquiry can be quoted, plus a ready-to-send email body.',
    input_schema: { type: 'object', properties: {} },
    run: (inquiry_id) => draft_clarifying_questions({ inquiry_id }),
  },
  {
    name: 'check_availability',
    description:
      'Whether the building physically holds this many of the requested room type. It cannot tell you what is sold on specific nights; that comes from the property management system.',
    input_schema: { type: 'object', properties: {} },
    run: async (inquiry_id) => {
      const inquiry = await loadInquiry(inquiry_id)
      if (!inquiry) return { ok: false, grounded: false, error: 'enquiry not found' }
      return check_availability({
        property_code: inquiry.preferred_property_code,
        room_type: inquiry.room_type_preference,
        rooms: inquiry.rooms_requested,
        arrival_date: inquiry.arrival_date,
        departure_date: inquiry.departure_date,
      })
    },
  },
  {
    name: 'validate_property_data',
    description: 'Check the hotel record for impossible rates that have been quarantined.',
    input_schema: { type: 'object', properties: {} },
    run: async (inquiry_id) => {
      const inquiry = await loadInquiry(inquiry_id)
      if (!inquiry) return { ok: false, grounded: false, error: 'enquiry not found' }
      return validate_property_data({ property_code: inquiry.preferred_property_code })
    },
  },
  {
    name: 'generate_proposal',
    description:
      'Produce the branded proposal and the PDF. Pass discount_pct when the rep has chosen one of the decision options; otherwise it prices at the compliant ceiling.',
    input_schema: {
      type: 'object',
      properties: {
        discount_pct: { type: 'number', description: 'Whole percentage points.' },
        chosen_option: {
          type: 'string',
          description: 'approve_at_ceiling | escalate_to_gm | counter_with_value_add',
        },
      },
    },
    run: (inquiry_id, input) =>
      generate_proposal({
        inquiry_id,
        discount_pct: input.discount_pct as number | undefined,
        chosen_option: input.chosen_option as string | undefined,
      }),
  },
  {
    name: 'submit_for_approval',
    description: 'Send the current proposal to an approver, with an optional note.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string' } },
    },
    run: async (inquiry_id, input) => {
      const proposal = findProposalByInquiry(inquiry_id)
      if (!proposal) {
        return { ok: false, grounded: false, error: 'There is no proposal on this enquiry yet.' }
      }
      return submit_for_approval({
        proposal_id: proposal.proposal_id,
        submitted_by: (input.submitted_by as string | undefined) ?? null,
        note: input.note as string | undefined,
      })
    },
  },
  {
    name: 'send_proposal',
    description:
      'Send the current proposal to the customer. Refuses if it carries a flag and has not been approved.',
    input_schema: { type: 'object', properties: {} },
    run: async (inquiry_id) => {
      const proposal = findProposalByInquiry(inquiry_id)
      if (!proposal) {
        return { ok: false, grounded: false, error: 'There is no proposal on this enquiry yet.' }
      }
      return send_proposal({ proposal_id: proposal.proposal_id })
    },
  },
]

function summarise(result: ToolResult<unknown>): string {
  if (!result.ok) return `refused: ${result.error ?? 'no reason given'}`
  const data = result.data as Record<string, unknown> | undefined
  const human = data?.human_summary ?? data?.summary ?? data?.human_reason
  if (typeof human === 'string') return human.slice(0, 400)
  return 'ok'
}

async function buildContext(inquiry: GroupInquiry): Promise<string> {
  const property = await loadProperty(inquiry.preferred_property_code)
  return [
    `Enquiry ${inquiry.inquiry_id} from ${inquiry.company_name} (${inquiry.contact_name}).`,
    `Hotel requested: ${property?.property_name ?? inquiry.preferred_property_code}.`,
    `Event: ${inquiry.event_type}. Arrival ${inquiry.arrival_date ?? 'not given'}, departure ${inquiry.departure_date ?? 'not given'}.`,
    `Rooms: ${inquiry.rooms_requested ?? 'not given'} ${inquiry.room_type_preference ?? ''}. Discount asked for: ${inquiry.requested_discount_pct ?? 'none stated'}%.`,
    `Meeting headcount: ${inquiry.meeting_capacity_needed ?? 'none'}. Special requests: ${inquiry.special_requests ?? 'none'}.`,
    inquiry.contact_email
      ? 'They gave us an email address, so the proposal would go out by email.'
      : 'They gave us a phone number and no email, so the proposal would go out by text with a link.',
  ].join('\n')
}

export async function runAssistant(args: {
  inquiry_id: string
  message: string
  history?: AssistantTurn[]
  apiKey?: string | null
}): Promise<AssistantReply> {
  const apiKey = args.apiKey ?? process.env.ANTHROPIC_API_KEY?.trim() ?? null
  const trace: AssistantTrace[] = []

  const inquiry = await loadInquiry(args.inquiry_id)
  if (!inquiry) {
    return {
      ok: false,
      reply: `I cannot find an enquiry with the reference ${args.inquiry_id}.`,
      trace,
      model: ASSISTANT_MODEL,
      error: 'inquiry_not_found',
    }
  }
  if (!apiKey) {
    return {
      ok: false,
      reply:
        'The assistant is not available on this environment because no Anthropic API key is configured. Everything else on this enquiry, including the rule checks and the proposal, still works.',
      trace,
      model: ASSISTANT_MODEL,
      error: 'ANTHROPIC_API_KEY is not set',
    }
  }

  const client = new Anthropic({ apiKey })
  const context = await buildContext(inquiry)

  // `any` here is deliberate and narrow: the SDK's message-param union is large and we only
  // ever push shapes it accepts. Typing it fully would add noise without adding safety.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    ...(args.history ?? []).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: args.message },
  ]

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await client.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: MAX_TOKENS,
        system: `${SYSTEM}\n\nThe enquiry you are bound to:\n${context}`,
        messages,
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
      })

      // Never assume content[0] is text: a response can open with a thinking block.
      const blocks = response.content ?? []
      const toolUses = blocks.filter((b) => b.type === 'tool_use')

      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const text = blocks
          .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        return {
          ok: true,
          reply: text || 'I do not have anything to add on that.',
          trace,
          model: ASSISTANT_MODEL,
        }
      }

      messages.push({ role: 'assistant', content: blocks })

      const results: unknown[] = []
      for (const use of toolUses) {
        const block = use as { id: string; name: string; input?: Record<string, unknown> }
        const tool = TOOLS.find((t) => t.name === block.name)
        const startedAt = Date.now()
        let result: ToolResult<unknown>
        if (!tool) {
          result = { ok: false, grounded: false, error: `no such tool: ${block.name}` }
        } else {
          try {
            result = await tool.run(args.inquiry_id, block.input ?? {})
          } catch (err) {
            result = {
              ok: false,
              grounded: false,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }
        const latency = Date.now() - startedAt
        trace.push({
          tool: block.name,
          args: block.input ?? {},
          ok: result.ok,
          grounded: result.grounded,
          summary: summarise(result),
          latency_ms: latency,
        })
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: !result.ok,
          content: JSON.stringify(trimForModel(result)).slice(0, 12_000),
        })
      }
      messages.push({ role: 'user', content: results })
    }

    return {
      ok: false,
      reply:
        'I went round in circles on that one and stopped rather than keep calling tools. Ask me again more specifically, or check the rule verdicts on the right.',
      trace,
      model: ASSISTANT_MODEL,
      error: 'max_tool_rounds',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reply: `I could not reach the model just then, so I have not answered. The rule verdicts and the proposal on this enquiry are unaffected. (${message})`,
      trace,
      model: ASSISTANT_MODEL,
      error: message,
    }
  }
}

/** Deterministic follow-ups, keyed off where this enquiry actually is. No model call. */
export async function buildSuggestions(inquiryId: string): Promise<string[]> {
  const evaluation = await evaluate_group_rules({ inquiry_id: inquiryId })
  const proposal = findProposalByInquiry(inquiryId)
  const out: string[] = []

  if (evaluation.ok && evaluation.data) {
    const data = evaluation.data
    if (data.clarifying_questions.length > 0) {
      out.push('Draft the questions we need to send back')
    }
    if (data.decision_options.length > 0) {
      for (const option of data.decision_options) out.push(option.label)
    }
    if (data.decision === 'blocked' && data.clarifying_questions.length === 0) {
      out.push('What can we offer them instead?')
    }
    if (data.referrals.length > 0) out.push('How do we word the referral to the customer?')
    if (data.required_follow_ups.length > 0) out.push('What do we still need before we can confirm?')
  }

  if (!proposal && evaluation.ok && evaluation.data?.decision === 'auto_approve') {
    out.push('Draft the proposal')
  }
  if (proposal && proposal.status === 'awaiting_approval') {
    out.push('Why can this not go out yet?')
    out.push('Submit it for approval')
  }
  if (proposal && (proposal.status === 'approved' || proposal.status === 'draft')) {
    out.push('Send it')
  }

  out.push('Walk me through the rule verdicts')
  return [...new Set(out)].slice(0, 5)
}

/** The proposal HTML is tens of kilobytes and the model does not need it. Strip the bulk
 *  before it goes back over the wire. */
function trimForModel(result: ToolResult<unknown>): ToolResult<unknown> {
  const data = result.data as Record<string, unknown> | undefined
  if (!data || typeof data !== 'object') return result
  const { html: _html, text: _text, pdf_bytes: _bytes, ...rest } = data as Record<string, unknown>
  return { ...result, data: rest }
}
