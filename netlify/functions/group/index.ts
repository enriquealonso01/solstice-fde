// Entry point for the `group` Netlify function.
//
// Netlify publishes a directory inside netlify/functions/ as ONE function whose entry is
// index.ts; the siblings are bundled helpers, not endpoints of their own. netlify.toml already
// maps /api/* -> /.netlify/functions/:splat and passes trailing segments through, so:
//
//   POST /api/group/tool          -> any GROUP_TOOL by name, { tool, args }
//   POST /api/group/assistant     -> the per-inquiry side chat, { inquiry_id, message }
//   POST /api/group/approve       -> a named human approves an over-authority proposal
//   POST /api/group/reject        -> ...or turns it down
//   POST /api/group/send          -> shorthand for the send_proposal tool
//   GET  /api/group/inquiries     -> the inbox
//   GET  /api/group/proposals     -> everything generated this session
//   GET  /api/group/pdf/<id>.pdf  -> the hosted PDF, which is what the SMS link points at
//   GET  /api/group               -> health probe for the Backend Map
//
// Like voice/index.ts we do NOT set `export const config = { path }`: a v2 path config would
// move the function off /.netlify/functions/ and fight the redirect in netlify.toml, which is
// not ours to edit.
//
// Every tool call writes a `tool_invocations` row so the work shows up in the trace next to the
// conversation that caused it. When the caller is the voice assistant mid-call it passes
// `call_control_id`, and we bind the trace to that session rather than orphaning it.

import type { Context } from '@netlify/functions'
import type { ToolResult } from '../../../shared/types'
import { GROUP_TOOLS, type GroupTool } from '../../../shared/toolContracts'
import { recordToolInvocation, tryGetDb } from '../_lib/db'
import { findSessionByCallControlId } from '../telnyx/_lib/sessions'
import { maskArgs } from '../_lib/mask'
import { auditLog, recentAudit } from '../_delivery/audit'
import { currentSourceName, loadInquiries, loadProperties } from './_deps'
import { runAssistant, buildSuggestions, ASSISTANT_MODEL, type AssistantTurn } from './assistant'
import { findProposalByInquiry, getProposal, listProposals } from './store'
import { pdfFilename } from './proposal'
import {
  approve,
  buildInquiryRow,
  check_availability,
  create_inquiry,
  createdInquiries,
  draft_clarifying_questions,
  evaluate_group_rules,
  find_alternates,
  generate_proposal,
  override_proposal,
  parse_inquiry,
  price_block,
  reject,
  send_proposal,
  submit_for_approval,
  validate_property_data,
} from './tools'

type AnyArgs = Record<string, unknown>

// Local copies rather than an import from another function's private `_lib`. Four lines is a
// cheaper price than a cross-function coupling that breaks whenever that directory is moved.
function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function readJsonBody<T>(req: Request): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let text: string
  try {
    text = await req.text()
  } catch (err) {
    return { ok: false, error: `could not read request body: ${(err as Error).message}` }
  }
  if (!text.trim()) return { ok: false, error: 'request body is empty' }
  try {
    return { ok: true, value: JSON.parse(text) as T }
  } catch {
    return { ok: false, error: 'request body is not valid JSON' }
  }
}

/** The tool table. Exactly the eleven names in shared/toolContracts.ts, no more. */
const TOOL_TABLE: Record<GroupTool, (args: AnyArgs) => Promise<ToolResult<unknown>>> = {
  parse_inquiry: (a) => parse_inquiry(a),
  validate_property_data: (a) => validate_property_data(a as { property_code: string }),
  check_availability: (a) => check_availability(a as { property_code: string }),
  evaluate_group_rules: (a) => evaluate_group_rules(a),
  price_block: (a) => price_block(a),
  find_alternates: (a) => find_alternates(a as { inquiry_id: string }),
  draft_clarifying_questions: (a) => draft_clarifying_questions(a),
  generate_proposal: (a) => generate_proposal(a as { inquiry_id: string }),
  submit_for_approval: (a) => submit_for_approval(a as { proposal_id: string }),
  send_proposal: (a) => send_proposal(a as { proposal_id: string }),
  create_inquiry: (a) => create_inquiry(a as never),
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const route = segments[segments.length - 1] ?? ''
  const parent = segments[segments.length - 2] ?? ''

  // /api/group/pdf/<proposal_id>.pdf
  if (parent === 'pdf' || route === 'pdf') {
    return servePdf(route === 'pdf' ? (url.searchParams.get('proposal_id') ?? '') : route)
  }

  switch (route) {
    case 'tool':
      return handleTool(req)
    case 'assistant':
      return handleAssistant(req)
    case 'approve':
      return handleApproval(req, 'approve')
    case 'reject':
      return handleApproval(req, 'reject')
    case 'send':
      return handleSend(req)
    case 'proposal-action':
    case 'proposal_action':
      return handleProposalAction(req)
    case 'inquiries':
      return handleInquiries()
    case 'proposals':
      return handleProposals()
    case 'audit':
      return json({ ok: true, entries: recentAudit(50) })
    case 'group':
    case '':
      return health()
    default:
      return json(
        {
          ok: false,
          error: `unknown group route "${route}"`,
          routes: [
            '/api/group/tool',
            '/api/group/assistant',
            '/api/group/approve',
            '/api/group/reject',
            '/api/group/send',
            '/api/group/proposal-action',
            '/api/group/inquiries',
            '/api/group/proposals',
            '/api/group/audit',
            '/api/group/pdf/<proposal_id>.pdf',
          ],
        },
        404,
      )
  }
}

function health(): Response {
  return json({
    ok: true,
    service: 'group',
    data_source: currentSourceName(),
    tools: GROUP_TOOLS,
    assistant_model: ASSISTANT_MODEL,
    configured: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      telnyx: Boolean(process.env.TELNYX_API_KEY?.trim()),
      supabase: Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      demo_mode: (process.env.DEMO_MODE ?? 'true').toLowerCase() !== 'false',
    },
  })
}

// ---------------------------------------------------------------- tool dispatch

interface ToolRequest {
  tool?: string
  args?: AnyArgs
  /** Set when the voice assistant calls mid-call, so the trace binds to that session. */
  call_control_id?: string
  session_id?: string
  actor?: string
}

async function handleTool(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<ToolRequest>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const { tool, args = {}, call_control_id, session_id, actor } = body.value
  if (!tool || !(GROUP_TOOLS as readonly string[]).includes(tool)) {
    return json({ ok: false, error: `unknown group tool "${tool ?? ''}"`, tools: GROUP_TOOLS }, 404)
  }

  const startedAt = Date.now()
  let result: ToolResult<unknown>
  try {
    result = await TOOL_TABLE[tool as GroupTool](args)
  } catch (err) {
    result = {
      ok: false,
      grounded: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
  const latency = Date.now() - startedAt
  result.latency_ms = latency

  await trace({
    tool,
    args,
    result,
    latency,
    call_control_id,
    session_id,
    actor: actor ?? null,
  })

  return json(result, result.ok ? 200 : 200)
}

/** Writes the tool_invocations row. Binds to a live voice session when the caller gives us a
 *  call_control_id; otherwise the row is unbound, which is still better than no row. */
async function trace(input: {
  tool: string
  args: AnyArgs
  result: ToolResult<unknown>
  latency: number
  call_control_id?: string
  session_id?: string
  actor: string | null
}): Promise<void> {
  const { masked } = maskArgs(input.args)
  const summary = summariseResult(input.result)

  try {
    let sessionId = input.session_id ?? null
    if (!sessionId && input.call_control_id) {
      const db = tryGetDb()
      if (db) {
        const session = await findSessionByCallControlId(db, input.call_control_id)
        sessionId = session?.id ?? null
      }
    }
    await recordToolInvocation({
      session_id: sessionId,
      tool: input.tool,
      args_masked: masked ?? {},
      result_summary: summary,
      grounded: input.result.grounded,
      latency_ms: input.latency,
    })
  } catch {
    // A trace write must never take a tool call down with it.
  }

  // Approvals, overrides and sends are audited separately by the tools themselves. What we add
  // here is the bare fact that a group tool ran, which is what the Backend Map counts.
  if (input.tool === 'create_inquiry' || input.tool === 'send_proposal') {
    await auditLog(`group.${input.tool}`, `tool:${input.tool}`, {
      ok: input.result.ok,
      grounded: input.result.grounded,
      latency_ms: input.latency,
      call_control_id: input.call_control_id ?? null,
      actor: input.actor,
    })
  }
}

function summariseResult(result: ToolResult<unknown>): string {
  if (!result.ok) return `refused: ${result.error ?? 'no reason given'}`
  const data = result.data as Record<string, unknown> | undefined
  for (const key of ['human_summary', 'summary', 'human_reason']) {
    const value = data?.[key]
    if (typeof value === 'string') return value.slice(0, 500)
  }
  return 'ok'
}

// ---------------------------------------------------------------- side chat

interface AssistantRequest {
  inquiry_id?: string
  message?: string
  history?: AssistantTurn[]
  call_control_id?: string
  session_id?: string
}

async function handleAssistant(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<AssistantRequest>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const { inquiry_id, message, history, call_control_id, session_id } = body.value
  if (!inquiry_id) return json({ ok: false, error: 'inquiry_id is required' }, 400)
  if (!message?.trim()) return json({ ok: false, error: 'message is required' }, 400)

  const startedAt = Date.now()
  const reply = await runAssistant({ inquiry_id, message, history })
  const latency = Date.now() - startedAt

  // One trace row per tool the assistant actually called, so the rep sees the same trace the
  // concierge supervisor sees on a call.
  for (const step of reply.trace) {
    await trace({
      tool: step.tool,
      args: { ...step.args, inquiry_id },
      result: { ok: step.ok, grounded: step.grounded, data: { human_summary: step.summary } },
      latency: step.latency_ms,
      call_control_id,
      session_id,
      actor: 'group_sales_side_chat',
    })
  }

  const suggestions = await buildSuggestions(inquiry_id).catch(() => [])
  return json({ ...reply, suggestions, inquiry_id, latency_ms: latency })
}

// ---------------------------------------------------------------- approvals and sends

async function handleApproval(req: Request, action: 'approve' | 'reject'): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{
    proposal_id?: string
    actor?: string
    note?: string
    reason?: string
  }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const { proposal_id, actor, note, reason } = body.value
  if (!proposal_id) return json({ ok: false, error: 'proposal_id is required' }, 400)
  if (!actor?.trim()) {
    return json(
      { ok: false, error: 'An approval has to be attributed to a person. Send `actor`.' },
      400,
    )
  }

  const result =
    action === 'approve'
      ? await approve({ proposal_id, approved_by: actor, note })
      : await reject({ proposal_id, rejected_by: actor, reason: reason ?? 'no reason given' })

  return json(result, result.ok ? 200 : 404)
}

/**
 * The one endpoint the group sales screen posts every decision to.
 *
 *   { inquiry_id, proposal_id, action, justification, override_discount_pct? }
 *
 * Every action writes an audit_log row, including the ones that are refused, because "the agent
 * tried to send a flagged proposal and was stopped" is exactly the line the panel will want to
 * see. `override` re-prices at the requested discount and still leaves the approval gate shut.
 */
async function handleProposalAction(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{
    inquiry_id?: string
    proposal_id?: string
    action?: string
    justification?: string | null
    override_discount_pct?: number
    actor?: string
  }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const { inquiry_id, action, justification, override_discount_pct } = body.value
  const actor = body.value.actor?.trim() || 'group sales'
  let proposalId = body.value.proposal_id

  if (!action) return json({ ok: false, error: 'action is required' }, 400)

  // The UI knows the inquiry; the proposal id is optional when there is only one.
  if (!proposalId && inquiry_id) {
    proposalId = findProposalByInquiry(inquiry_id)?.proposal_id
  }
  if (!proposalId) {
    return json(
      { ok: false, error: 'No proposal has been generated for this enquiry yet.' },
      404,
    )
  }

  await auditLog(`proposal.action.${action}`, `proposal:${proposalId}`, {
    inquiry_id: inquiry_id ?? null,
    action,
    actor,
    justification: justification ?? null,
    override_discount_pct: override_discount_pct ?? null,
  })

  let result: ToolResult<{ status?: string; proposal_id?: string }>
  switch (action) {
    case 'send':
      result = (await send_proposal({ proposal_id: proposalId, actor })) as ToolResult<{
        status?: string
      }>
      break
    case 'submit_for_approval':
      result = await submit_for_approval({
        proposal_id: proposalId,
        submitted_by: actor,
        note: justification ?? undefined,
      })
      break
    case 'approve':
      result = await approve({
        proposal_id: proposalId,
        approved_by: actor,
        note: justification ?? undefined,
      })
      break
    case 'reject':
      result = await reject({
        proposal_id: proposalId,
        rejected_by: actor,
        reason: justification ?? 'no reason given',
      })
      break
    case 'override':
      result = await override_proposal({
        proposal_id: proposalId,
        actor,
        justification: justification ?? '',
        discount_pct: override_discount_pct,
      })
      break
    default:
      return json(
        {
          ok: false,
          error: `unknown action "${action}"`,
          actions: ['send', 'submit_for_approval', 'approve', 'override', 'reject'],
        },
        400,
      )
  }

  const current = getProposal(result.data?.proposal_id ?? proposalId)
  return json({
    ok: result.ok,
    status: current?.status ?? result.data?.status ?? null,
    proposal_id: current?.proposal_id ?? proposalId,
    error: result.ok ? undefined : result.error,
    // Safe to put in front of a salesperson either way.
    human_summary:
      (result.data as { human_summary?: string } | undefined)?.human_summary ?? result.error ?? null,
  })
}

async function handleSend(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{ proposal_id?: string; actor?: string }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)
  if (!body.value.proposal_id) return json({ ok: false, error: 'proposal_id is required' }, 400)

  const result = await send_proposal({
    proposal_id: body.value.proposal_id,
    actor: body.value.actor ?? null,
  })
  return json(result)
}

// ---------------------------------------------------------------- reads

/** Rows in the shape the admin inbox renders: `InquiryRow` with a denormalised payload, so
 *  the detail view never has to join to show a hotel name or a night count. */
async function handleInquiries(): Promise<Response> {
  const [inquiries, properties] = await Promise.all([loadInquiries(), loadProperties()])
  const all = [...inquiries, ...createdInquiries()]
  const rows = await Promise.all(all.map((inquiry) => buildInquiryRow(inquiry)))
  return json({
    ok: true,
    source: currentSourceName(),
    inquiries: rows,
    properties: properties.map((p) => ({
      property_code: p.property_code,
      property_name: p.property_name,
      city: p.city,
      state: p.state,
    })),
  })
}

/** Rows in the shape the admin proposal view renders: `ProposalRow`, money in integer cents. */
function handleProposals(): Response {
  return json({
    ok: true,
    proposals: listProposals().map((p) => ({
      id: p.proposal_id,
      proposal_id: p.proposal_id,
      inquiry_id: p.inquiry_id,
      status: p.status,
      verdicts: p.verdicts,
      pricing: p.pricing,
      pdf_path: p.pdf_path,
      pdf_url: p.pdf_url,
      sent_via: p.sent_via,
      sent_to: p.sent_to,
      sent_at: p.sent_at,
      created_at: p.history[0]?.at ?? new Date().toISOString(),
      approved_by: p.approved_by,
      approved_at: p.approved_at,
      history: p.history,
    })),
  })
}

/** Serves the PDF the SMS link points at. `<proposal_id>.pdf` or `?proposal_id=`. */
function servePdf(idSegment: string): Response {
  const proposalId = idSegment.replace(/\.pdf$/i, '')
  const proposal = proposalId ? getProposal(proposalId) : null
  if (!proposal?.pdf_bytes) {
    return json(
      {
        ok: false,
        error: `No proposal PDF is being held for "${proposalId}". Proposal PDFs live in Supabase Storage once it is configured; this in-memory copy only survives for the life of the function instance.`,
      },
      404,
    )
  }
  return new Response(new Uint8Array(proposal.pdf_bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdfFilename(proposal.document)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
