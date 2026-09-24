// Entry point for the `group` Netlify function.
//
// Netlify publishes a directory inside netlify/functions/ as ONE function whose entry is
// index.ts; the siblings are bundled helpers, not endpoints of their own. netlify.toml already
// maps /api/* -> /.netlify/functions/:splat and passes trailing segments through, so:
//
//   POST /api/group/tool            secret   any GROUP_TOOL by name, { tool, args }
//   POST /api/group/assistant       staff    the per-inquiry side chat, { inquiry_id, message }
//   POST /api/group/proposal-action staff    send | submit_for_approval | approve | override | reject
//   POST /api/group/proposal-edit   staff    rewrite the PROSE of a proposal, never the numbers
//   POST /api/group/follow-up       staff    draft the "we need a few more details" message
//   POST /api/group/follow-up-action staff   approve | send | discard that message
//   GET  /api/group/communications  staff    the conversation thread for one enquiry
//   POST /api/group/approve         staff    a named human approves an over-authority proposal
//   POST /api/group/reject          staff    ...or turns it down
//   POST /api/group/send            staff    shorthand for the send_proposal tool
//   GET  /api/group/inquiries       staff    the inbox
//   GET  /api/group/proposals       staff    everything generated this session
//   GET  /api/group/audit           staff    recent audit rows
//   GET  /api/group/pdf/<id>.pdf    token    fallback PDF host; the real link is Storage
//   GET  /api/group                 open     health probe for the Backend Map
//
// "secret" is TOOL_WEBHOOK_SECRET, the same header the concierge tool layer takes, because the
// Telnyx assistant is provisioned once and calls both. "staff" is a Supabase session whose
// profile role is group_sales or admin, which is the same rule RLS enforces on these tables.
// See auth.ts.
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
import { authorizeStaff, authorizeToolCaller, type AuthOk } from './auth'
import { currentSourceName, loadInquiries, loadProperties } from './_deps'
import { runAssistant, buildSuggestions, ASSISTANT_MODEL, type AssistantTurn } from './assistant'
import { findProposalByInquiry, getProposal, listProposals, tokenMatches } from './store'
import { pdfFilename } from './proposal'
import { getCommunications } from './communications'
import { actOnFollowUp, draftFollowUp, type FollowUpAction } from './followUps'
import {
  approve,
  buildInquiryRow,
  edit_proposal,
  check_availability,
  create_inquiry,
  update_inquiry,
  createdInquiries,
  draft_clarifying_questions,
  evaluate_group_rules,
  find_alternates,
  generate_proposal,
  materialiseProposal,
  override_proposal,
  parse_inquiry,
  price_block,
  reject,
  send_proposal,
  submit_for_approval,
  validate_property_data,
} from './tools'

type AnyArgs = Record<string, unknown>

/** Who a decision is recorded against. A caller may supply a display name for the UI, but the
 *  verified profile id is always what ends up in the audit row, so "who approved this" cannot
 *  be set by whoever sends the request. */
function attribution(supplied: string | undefined, staff: AuthOk): string {
  const label = supplied?.trim()
  return label ? `${label} (${staff.role}, ${staff.actor})` : `${staff.role} ${staff.actor}`
}

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
  update_inquiry: (a) => update_inquiry(a as never),
}

/**
 * ACCESS CONTROL, in one place so it cannot be forgotten on a new route.
 *
 *   /api/group/tool          shared secret  (the Telnyx assistant, a machine with no user)
 *   everything else          Supabase session + group_sales|admin  (a signed-in member of staff)
 *   /api/group/pdf/...       the proposal's own capability token, or a staff session
 *   GET /api/group           open: a health probe that reports booleans and no customer data
 *
 * See auth.ts for why the two callers prove themselves differently.
 */
export default async function handler(req: Request, _context: Context): Promise<Response> {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const route = segments[segments.length - 1] ?? ''
  const parent = segments[segments.length - 2] ?? ''

  // /api/group/pdf/<proposal_id>.pdf?t=<token>
  if (parent === 'pdf' || route === 'pdf') {
    const id = route === 'pdf' ? (url.searchParams.get('proposal_id') ?? '') : route
    return servePdf(req, id, url.searchParams.get('t'))
  }

  // Route 1: the assistant-facing tool endpoint.
  if (route === 'tool') {
    const auth = authorizeToolCaller(req)
    if (!auth.ok) return json({ ok: false, grounded: false, error: auth.error }, auth.status)
    return handleTool(req)
  }

  // Health stays open. It reports which services are configured, as booleans, and nothing else.
  if (route === 'group' || route === '') return health()

  // Route 2: everything else is staff-only, checked before the route is even dispatched.
  const staff = await authorizeStaff(req)
  if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)

  switch (route) {
    case 'assistant':
      return handleAssistant(req, staff)
    case 'approve':
      return handleApproval(req, 'approve', staff)
    case 'reject':
      return handleApproval(req, 'reject', staff)
    case 'send':
      return handleSend(req, staff)
    case 'proposal-action':
    case 'proposal_action':
      return handleProposalAction(req, staff)
    case 'proposal-edit':
    case 'proposal_edit':
      return handleProposalEdit(req, staff)
    case 'follow-up':
    case 'follow_up':
      return handleFollowUpDraft(req, staff)
    case 'follow-up-action':
    case 'follow_up_action':
      return handleFollowUpAction(req, staff)
    case 'communications':
      return handleCommunications(url)
    case 'inquiries':
      return handleInquiries()
    case 'proposals':
      return await handleProposals()
    case 'audit':
      return json({ ok: true, entries: recentAudit(50) })
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
            '/api/group/proposal-edit',
            '/api/group/follow-up',
            '/api/group/follow-up-action',
            '/api/group/communications?inquiry_id=<code>',
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
    // What each route requires, so a misconfigured deploy is visible rather than silently open.
    secured: {
      'POST /api/group/tool': process.env.TOOL_WEBHOOK_SECRET?.trim()
        ? 'x-solstice-tool-key'
        : 'OPEN — TOOL_WEBHOOK_SECRET is not set on this deploy',
      'staff routes': 'Supabase bearer token, role group_sales or admin',
      'GET /api/group/pdf/<id>.pdf': 'per-proposal access token, or a staff session',
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
  if (input.tool === 'create_inquiry' || input.tool === 'update_inquiry' || input.tool === 'send_proposal') {
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

async function handleAssistant(req: Request, staff: AuthOk): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<AssistantRequest>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const { inquiry_id, message, history, call_control_id, session_id } = body.value
  if (!inquiry_id) return json({ ok: false, error: 'inquiry_id is required' }, 400)
  if (!message?.trim()) return json({ ok: false, error: 'message is required' }, 400)

  const startedAt = Date.now()
  // The assistant acts AS the signed-in rep: every approval, edit and send it performs is
  // attributed to them in audit_log, exactly as if they had pressed the button themselves.
  const reply = await runAssistant({ inquiry_id, message, history, actor: attribution(undefined, staff) })
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

async function handleApproval(
  req: Request,
  action: 'approve' | 'reject',
  staff: AuthOk,
): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{
    proposal_id?: string
    actor?: string
    note?: string
    reason?: string
  }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  const { proposal_id, note, reason } = body.value
  if (!proposal_id) return json({ ok: false, error: 'proposal_id is required' }, 400)

  // Attribution comes from the verified session, not from the body. A caller can supply a
  // display name, but it can never stand in for who actually signed this off.
  const actor = attribution(body.value.actor, staff)

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
async function handleProposalAction(req: Request, staff: AuthOk): Promise<Response> {
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
  const actor = attribution(body.value.actor, staff)
  let proposalId = body.value.proposal_id

  if (!action) return json({ ok: false, error: 'action is required' }, 400)

  // The UI knows the inquiry; the proposal id is optional when there is only one.
  if (!proposalId && inquiry_id) {
    proposalId = (await findProposalByInquiry(inquiry_id))?.proposal_id
  }
  if (!proposalId) {
    return json(
      { ok: false, error: 'No proposal has been generated for this inquiry yet.' },
      404,
    )
  }

  await auditLog(`proposal.action.${action}`, `proposal:${proposalId}`, {
    inquiry_id: inquiry_id ?? null,
    action,
    actor,
    actor_id: staff.actor,
    actor_role: staff.role,
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

  const current = await getProposal(result.data?.proposal_id ?? proposalId)
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

/**
 * PROSE ONLY. The numbers are not in the accepted shape at all, and an attempt to send one is
 * refused with the reason rather than quietly ignored, because a rep who thinks they changed
 * the total and did not is worse off than one who was told no.
 */
async function handleProposalEdit(req: Request, staff: AuthOk): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{
    proposal_id?: string
    inquiry_id?: string
    edits?: Record<string, unknown>
    justification?: string
    actor?: string
  }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)

  let proposalId = body.value.proposal_id
  if (!proposalId && body.value.inquiry_id) {
    proposalId = (await findProposalByInquiry(body.value.inquiry_id))?.proposal_id
  }
  if (!proposalId) {
    return json({ ok: false, error: 'No proposal has been generated for this enquiry yet.' }, 404)
  }

  const result = await edit_proposal({
    proposal_id: proposalId,
    edits: (body.value.edits ?? {}) as never,
    justification: body.value.justification ?? '',
    actor: attribution(body.value.actor, staff),
  })

  return json(
    result.ok
      ? { ok: true, ...result.data }
      : { ok: false, error: result.error },
    result.ok ? 200 : 400,
  )
}

async function handleFollowUpDraft(req: Request, staff: AuthOk): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{ inquiry_id?: string }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)
  if (!body.value.inquiry_id) return json({ ok: false, error: 'inquiry_id is required' }, 400)

  const result = await draftFollowUp(body.value.inquiry_id)
  if (!result.ok || !result.follow_up) {
    return json({ ok: false, error: result.error }, 400)
  }
  const f = result.follow_up
  await auditLog('follow_up.requested', `follow_up:${f.follow_up_id}`, {
    inquiry_id: f.inquiry_id,
    actor: attribution(undefined, staff),
    channel: f.channel,
  })
  return json({
    ok: true,
    follow_up_id: f.follow_up_id,
    channel: f.channel,
    subject: f.subject,
    body: f.body,
    missing_fields: f.missing_fields,
    status: f.status,
    persisted: f.persisted,
    human_summary: result.human_summary,
  })
}

async function handleFollowUpAction(req: Request, staff: AuthOk): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{
    follow_up_id?: string
    action?: string
    edited_body?: string
    justification?: string
    actor?: string
  }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)
  const { follow_up_id, action, edited_body, justification } = body.value
  if (!follow_up_id) return json({ ok: false, error: 'follow_up_id is required' }, 400)
  if (!action || !['approve', 'send', 'discard'].includes(action)) {
    return json(
      { ok: false, error: `unknown action "${action ?? ''}"`, actions: ['approve', 'send', 'discard'] },
      400,
    )
  }

  const result = await actOnFollowUp({
    follow_up_id,
    action: action as FollowUpAction,
    actor: attribution(body.value.actor, staff),
    edited_body,
    justification: justification ?? null,
  })

  return json(
    {
      ok: result.ok,
      status: result.status ?? null,
      follow_up_id: result.follow_up_id ?? follow_up_id,
      error: result.ok ? undefined : result.error,
      human_summary: result.human_summary ?? result.error ?? null,
    },
    result.ok ? 200 : 400,
  )
}

/** The conversation thread. Never 404: an enquiry nobody has written to has an empty thread. */
async function handleCommunications(url: URL): Promise<Response> {
  const inquiryId = url.searchParams.get('inquiry_id')?.trim()
  if (!inquiryId) return json({ ok: false, error: 'inquiry_id is required', items: [] }, 400)
  const result = await getCommunications(inquiryId)
  return json({ ok: true, ...result })
}

async function handleSend(req: Request, staff: AuthOk): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const body = await readJsonBody<{ proposal_id?: string; actor?: string }>(req)
  if (!body.ok) return json({ ok: false, error: body.error }, 400)
  if (!body.value.proposal_id) return json({ ok: false, error: 'proposal_id is required' }, 400)

  const result = await send_proposal({
    proposal_id: body.value.proposal_id,
    actor: attribution(body.value.actor, staff),
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

/** Rows in the shape the admin proposal view renders: `ProposalRow`, money in integer cents.
 *  Read from the `proposals` table, so a proposal generated by one request is visible to the
 *  next one and to every other function instance. */
async function handleProposals(): Promise<Response> {
  const proposals = await listProposals()
  return json({
    ok: true,
    persisted: proposals.every((p) => p.persisted),
    proposals: proposals.map((p) => ({
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
      created_at: p.created_at,
      approved_by: p.approved_by,
      approved_at: p.approved_at,
      revision: p.revision,
      persisted: p.persisted,
    })),
  })
}

/**
 * The FALLBACK PDF route, used only when Supabase Storage is not configured.
 *
 * The customer's email and text link at the public `proposals` bucket, whose object path
 * carries the proposal's random access token. This route serves the same bytes out of memory
 * and is gated on the same token, so a customer with no login can open their own proposal and
 * nobody can walk PRP-0001, PRP-0002, PRP-0003 and read the pipeline. A signed-in member of
 * group sales or admin can also open it without the token, which is what the admin preview uses.
 */
async function servePdf(req: Request, idSegment: string, token: string | null): Promise<Response> {
  const proposalId = idSegment.replace(/\.pdf$/i, '')
  const proposal = proposalId ? await getProposal(proposalId) : null

  // Answer identically whether the proposal is missing or the token is wrong, so this route
  // cannot be used to discover which proposal ids exist.
  const notFound = json(
    {
      ok: false,
      error: `No proposal PDF is available at this link. Proposal PDFs live in the Supabase Storage "proposals" bucket; this route only holds a copy for the life of a function instance, and it needs the access token from the original email or text.`,
    },
    404,
  )

  if (!proposal) return notFound

  if (!tokenMatches(proposal, token)) {
    const staff = await authorizeStaff(req)
    if (!staff.ok) return notFound
  }

  // Re-render from the stored pricing when this instance has no cached copy, so the fallback
  // route works from any instance rather than only the one that generated the proposal.
  const materialised = await materialiseProposal(proposal)
  if (!materialised?.pdfBytes) return notFound

  return new Response(new Uint8Array(materialised.pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdfFilename(materialised.document)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
