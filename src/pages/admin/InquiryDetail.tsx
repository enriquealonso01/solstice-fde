// One group inquiry, as a project view.
//
// Order is deliberate: what we were asked for, what the rules said about it, what that
// prices to, and only then the letter that would go out. A rep should never read the
// proposal before reading the verdicts.
//
// A flagged proposal is visibly un-sendable. The send button does not merely fail, it
// is locked with the reason printed next to it, and unlocking it requires a written
// justification that is kept on the record.

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import AdminShell, { useStaffRole } from '@/components/admin/AdminShell'
import ConversationThread from '@/components/admin/ConversationThread'
import InquiryAssistant from '@/components/admin/InquiryAssistant'
import {
  CollapsiblePanel,
  AccessNotice,
  EmptyState,
  Field,
  Panel,
  PanelHeader,
  ProposalPdfLink,
  ProposalStatusChip,
  SeverityChip,
  SourceBadge,
  SourceChip,
  VerdictChip,
} from '@/components/admin/ui'
import { accessToken, useInquiry } from '@/components/admin/useAdminData'
import {
  money,
  renderProposalBody,
  shortDate,
  verdictSeverity,
  type InquiryRow,
  type Pricing,
  type ProposalRow,
} from '@/components/admin/mockData'
import { APPROVER_ROLES } from '@/lib/rules/types'

type Decision = 'send' | 'submit_for_approval' | 'approve' | 'override' | 'reject'

const NEEDS_JUSTIFICATION: Decision[] = ['approve', 'override', 'reject']

const DECISION_LABEL: Record<Decision, string> = {
  send: 'Accept and send',
  submit_for_approval: 'Submit for approval',
  approve: 'Approve at the compliant rate',
  override: 'Override and grant what was asked',
  reject: 'Reject',
}

interface LogEntry {
  id: string
  action: Decision
  justification: string | null
  at: string
  simulated: boolean
}

/** canSend's live answer from GET /api/group/proposals, which re-checks the rules as of today. */
interface SendGate {
  allowed: boolean
  needs_approval: boolean
  blocking: string[]
  reason: string
}

/** The server's send gate for one proposal, or null when there is no backend to ask. */
function useSendGate(proposalId: string | undefined, status: string | undefined): SendGate | null {
  const [gate, setGate] = useState<SendGate | null>(null)
  useEffect(() => {
    if (!proposalId) return
    let alive = true
    void (async () => {
      const token = await accessToken()
      if (!token) return
      try {
        const res = await fetch(`/api/group/proposals?proposal_id=${encodeURIComponent(proposalId)}`, {
          headers: { authorization: `Bearer ${token}` },
        })
        const body = (await res.json()) as { proposals?: { send_gate?: SendGate }[] }
        if (alive) setGate(body.proposals?.[0]?.send_gate ?? null)
      } catch {
        // No backend: the stored verdicts are all there is to go on.
      }
    })()
    return () => {
      alive = false
    }
  }, [proposalId, status])
  return gate
}

/**
 * Posts one decision. A refusal keeps the server's own sentence (not an approver, your own
 * proposal, a physical limit), which postJson swaps for a generic line on a 403 or 503.
 * `reachable: false` means no backend answered at all.
 */
async function postDecision(body: Record<string, unknown>): Promise<{ ok: boolean; reachable: boolean; error: string | null }> {
  const token = await accessToken()
  if (!token) return { ok: false, reachable: true, error: 'Your session has expired. Sign in again.' }
  let res: Response
  try {
    res = await fetch('/api/group/proposal-action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, reachable: false, error: null }
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!data) return { ok: false, reachable: res.status !== 404, error: `The server answered HTTP ${res.status}.` }
  if (!res.ok || data.ok === false) {
    return { ok: false, reachable: true, error: data.error ?? `The server answered HTTP ${res.status}.` }
  }
  return { ok: true, reachable: true, error: null }
}

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>()
  const { inquiry, proposal, source, loading, access, patchProposal } = useInquiry(id)
  const { role } = useStaffRole()
  const gate = useSendGate(proposal?.id, proposal?.status)
  const [log, setLog] = useState<LogEntry[]>([])
  const [prompt, setPrompt] = useState<Decision | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const severity = useMemo(() => (proposal ? verdictSeverity(proposal.verdicts) : 'flag'), [proposal])

  if (loading) {
    return (
      <AdminShell title="Inquiry">
        <Panel>
          <EmptyState title="Loading inquiry…" />
        </Panel>
      </AdminShell>
    )
  }

  if (access) {
    return (
      <AdminShell title="Group inquiry">
        <AccessNotice problem={access} />
      </AdminShell>
    )
  }

  if (!inquiry) {
    return (
      <AdminShell title="Inquiry not found">
        <Panel>
          <EmptyState title="No such inquiry" body="It may have been deleted, or your role may not be allowed to see it." />
        </Panel>
        <Link to="/admin/inquiries" className="btn-ghost mt-4 inline-flex">
          Back to the inbox
        </Link>
      </AdminShell>
    )
  }

  const p = inquiry.payload
  const channel: 'email' | 'sms' | 'none' = p.contact_email ? 'email' : p.contact_phone ? 'sms' : 'none'
  const approved = proposal?.status === 'approved'
  const alreadySent = proposal?.status === 'sent'
  const rejected = proposal?.status === 'rejected'
  // When the server answers, its live gate decides; the stored verdicts are the offline fallback.
  const sendLocked =
    !proposal || rejected || channel === 'none' || (gate ? !gate.allowed : severity !== 'clear' && !approved)
  // The server decides (checkApproval); this only stops offering a button that will be refused.
  const notApprover = !(role && APPROVER_ROLES.includes(role))
  const hardStop = gate !== null && !gate.allowed && !gate.needs_approval
  const approveLock = notApprover
    ? 'Only a general manager can approve a block outside this property’s limits. Submit it for approval instead.'
    : hardStop
      ? gate.reason
      : null

  const lockReason = !proposal
    ? 'There is no proposal yet. The inquiry is still missing information from the guest.'
    : rejected
      ? 'This proposal was rejected. Nothing goes out from a rejected record.'
      : channel === 'none'
        ? 'There is neither an email address nor a phone number on this inquiry, so there is nowhere to send it.'
        : gate && !alreadySent
          ? gate.allowed ? null : gate.reason
          : severity !== 'clear' && !approved
            ? `${proposal.verdicts.filter((v) => v.status !== 'pass').length} rule verdict(s) are outstanding. A general manager has to approve it before it can be sent.`
            : null

  async function commit(action: Decision, justification: string | null) {
    if (!proposal || !inquiry) return
    setBusy(true)
    setActionError(null)
    const res = await postDecision({
      inquiry_id: inquiry.id,
      proposal_id: proposal.id,
      action,
      justification,
      ...(action === 'override' && proposal.pricing.requested_discount_pct !== undefined
        ? { override_discount_pct: proposal.pricing.requested_discount_pct }
        : {}),
    })
    // A refusal is shown as the server worded it, and nothing changes on screen. Only the server
    // can approve, so an approval is never simulated, even with no backend.
    if (!res.ok && (res.reachable || action === 'approve')) {
      setActionError(res.error ?? 'Approving needs the server, and it could not be reached.')
      setBusy(false)
      setPrompt(null)
      return
    }
    const simulated = !res.ok

    // Optimistic local transition so the surface is demonstrable with or without the endpoint.
    if (action === 'submit_for_approval') patchProposal({ status: 'awaiting_approval' })
    if (action === 'approve') patchProposal({ status: 'approved' })
    if (action === 'reject') patchProposal({ status: 'rejected' })
    if (action === 'override') {
      const requested = proposal.pricing.requested_discount_pct
      patchProposal({
        status: 'awaiting_approval',
        pricing: requested === undefined ? proposal.pricing : reprice(proposal.pricing, requested),
      })
    }
    if (action === 'send') {
      patchProposal({
        status: 'sent',
        sent_via: channel === 'sms' ? 'sms' : 'email',
        sent_to: p.contact_email ?? p.contact_phone,
        sent_at: new Date().toISOString(),
      })
    }

    setLog((l) => [
      { id: `log-${Date.now()}`, action, justification, at: new Date().toISOString(), simulated },
      ...l,
    ])
    setBusy(false)
    setPrompt(null)
  }

  function request(action: Decision) {
    if (NEEDS_JUSTIFICATION.includes(action)) setPrompt(action)
    else void commit(action, null)
  }

  return (
    <AdminShell
      title={p.company_name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-solstice-stone">{inquiry.inquiry_code}</span>
          <SourceBadge source={inquiry.source} />
          {proposal ? <ProposalStatusChip status={proposal.status} /> : null}
          {proposal ? <SeverityChip severity={severity} /> : null}
          <span className="text-solstice-stone">
            {p.contact_name}
            {p.contact_email ? ` · ${p.contact_email}` : p.contact_phone ? ` · ${p.contact_phone}` : ''}
          </span>
        </span>
      }
      actions={
        <>
          <SourceChip source={source} />
          <Link to="/admin/inquiries" className="btn-ghost">
            Inbox
          </Link>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {/* actions */}
          <Panel>
            <PanelHeader
              title="Decision"
              right={
                <span className="text-xs font-normal text-solstice-stone">
                  Delivery: {channel === 'email' ? 'branded email + PDF' : channel === 'sms' ? 'SMS with a link to the PDF' : 'no channel'}
                </span>
              }
            />
            <div className="p-4">
              {lockReason ? (
                <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span aria-hidden className="mt-0.5 font-semibold">Locked</span>
                  <span>{lockReason}</span>
                </p>
              ) : alreadySent ? (
                <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  Sent {proposal?.sent_via === 'sms' ? 'by SMS' : 'by email'} to {proposal?.sent_to} on{' '}
                  {shortDate(proposal?.sent_at ?? null)}.
                </p>
              ) : (
                <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  Inside every rule for this property. One click sends it.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={sendLocked || alreadySent || busy}
                  onClick={() => request('send')}
                  title={lockReason ?? undefined}
                >
                  {DECISION_LABEL.send}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!proposal || busy || proposal.status !== 'draft'}
                  onClick={() => request('submit_for_approval')}
                >
                  {DECISION_LABEL.submit_for_approval}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!proposal || busy || approved || alreadySent || rejected || approveLock !== null}
                  onClick={() => request('approve')}
                  title={approveLock ?? undefined}
                >
                  Approve
                </button>
                {proposal?.pricing.requested_discount_pct !== undefined ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy || alreadySent || rejected}
                    onClick={() => request('override')}
                  >
                    Override to {proposal.pricing.requested_discount_pct}%
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-ghost text-rose-700"
                  disabled={!proposal || busy || alreadySent || rejected}
                  onClick={() => request('reject')}
                >
                  Reject
                </button>
              </div>

              {notApprover && proposal && severity !== 'clear' && !approved && !alreadySent && !rejected ? (
                <p className="mt-3 text-xs text-solstice-stone">{approveLock}</p>
              ) : null}

              {actionError ? (
                <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {actionError} Nothing was changed.
                </p>
              ) : null}

              {log.length > 0 ? (
                <ul className="mt-4 space-y-1.5 border-t border-solstice-sand pt-3 text-xs">
                  {log.map((e) => (
                    <li key={e.id} className="text-solstice-slate">
                      <span className="font-medium">{DECISION_LABEL[e.action]}</span>
                      {e.justification ? <span className="text-solstice-stone"> — “{e.justification}”</span> : null}
                      <span className="text-solstice-stone">
                        {' '}
                        · {new Date(e.at).toLocaleTimeString('en-US')}
                        {e.simulated ? ' · recorded on this device only, not sent' : ' · written to the audit trail'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Panel>

          {/* parsed requirements */}
          <Panel>
            <PanelHeader
              title="Parsed requirements"
              right={
                inquiry.missing_fields.length > 0 ? (
                  <span className="chip bg-sky-50 text-sky-800">{inquiry.missing_fields.length} missing</span>
                ) : (
                  <span className="chip bg-emerald-50 text-emerald-800">complete</span>
                )
              }
            />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              <Field label="Property" value={`${p.property_name} (${p.preferred_property_code})`} />
              <Field label="Event" value={p.event_type} />
              <Field label="Arrival" value={shortDate(p.arrival_date)} />
              <Field label="Departure" value={shortDate(p.departure_date)} />
              <Field label="Nights" value={p.nights ?? '—'} />
              <Field label="Rooms" value={p.rooms_requested ?? '—'} />
              <Field label="Room type" value={p.room_type_preference ?? '—'} />
              <Field label="Discount asked" value={p.requested_discount_pct === null ? '—' : `${p.requested_discount_pct}%`} />
              <Field label="Budget / night" value={p.stated_budget_per_night === null ? '—' : `$${p.stated_budget_per_night}`} />
              <Field label="Meeting space" value={p.meeting_space_needed ? `${p.meeting_capacity_needed ?? '?'} people` : 'not needed'} />
              <Field label="Alternate property" value={p.alternate_property_ok ? 'acceptable' : 'no'} />
              <Field label="Contact" value={p.contact_email ?? p.contact_phone ?? 'none captured'} />
            </dl>
            {p.special_requests ? (
              <p className="border-t border-solstice-sand px-4 py-3 text-sm text-solstice-slate">
                <span className="text-xs uppercase tracking-wide text-solstice-stone">Special requests</span>
                <br />
                {p.special_requests}
              </p>
            ) : null}
            {inquiry.missing_fields.length > 0 ? (
              <p className="border-t border-solstice-sand bg-sky-50/50 px-4 py-3 text-sm text-sky-900">
                Still needed from {p.contact_name}: {inquiry.missing_fields.join(', ')}. Sol drafts the clarifying
                questions rather than guessing a proposal from an incomplete request.
              </p>
            ) : null}
          </Panel>

          {/* verdicts */}
          <CollapsiblePanel
            title="Rule verdicts"
            summary={
              proposal
                ? `${proposal.verdicts.filter((v) => v.status !== 'pass').length} need attention of ${proposal.verdicts.length}`
                : 'not run yet'
            }
            right={
              proposal ? (
                <span className="text-xs font-normal text-solstice-stone">
                  {proposal.verdicts.filter((v) => v.status === 'pass').length} pass ·{' '}
                  {proposal.verdicts.filter((v) => v.status === 'flag').length} flag ·{' '}
                  {proposal.verdicts.filter((v) => v.status === 'fail').length} fail
                </span>
              ) : null
            }
          >
            {!proposal ? (
              <EmptyState title="No verdicts yet" body="The rules engine runs once the request is complete." />
            ) : (
              <ul className="divide-y divide-solstice-sand">
                {proposal.verdicts.map((v) => (
                  <li key={v.rule_id} className="flex gap-3 px-4 py-3">
                    <span className="mt-0.5 shrink-0">
                      <VerdictChip status={v.status} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <code className="text-xs text-solstice-stone">{v.rule_id}</code>
                        <span className="text-xs tabular-nums text-solstice-slate">
                          actual <strong className="font-medium">{v.actual}</strong> · threshold{' '}
                          <strong className="font-medium">{v.threshold}</strong>
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-solstice-ink">{v.human_reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CollapsiblePanel>

          {/* pricing */}
          {proposal ? (
            <CollapsiblePanel
              title="Pricing"
              summary={`${money(proposal.pricing.total_cents)} · ${proposal.pricing.discount_pct}% off`}
              right={<span className="text-xs font-normal text-solstice-stone">Integer cents, computed from property base rates</span>}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-solstice-sand text-left text-xs uppercase tracking-wide text-solstice-stone">
                    <th className="px-4 py-2 font-medium">Room type</th>
                    <th className="px-4 py-2 font-medium">Rooms</th>
                    <th className="px-4 py-2 font-medium">Nights</th>
                    <th className="px-4 py-2 font-medium">Nightly</th>
                    <th className="px-4 py-2 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.pricing.line_items.map((l) => (
                    <tr key={l.room_type} className="border-b border-solstice-sand/60">
                      <td className="px-4 py-2.5 text-solstice-ink">{l.room_type}</td>
                      <td className="px-4 py-2.5 tabular-nums text-solstice-slate">{l.rooms}</td>
                      <td className="px-4 py-2.5 tabular-nums text-solstice-slate">{l.nights}</td>
                      <td className="px-4 py-2.5 tabular-nums text-solstice-slate">{money(l.nightly_rate_cents)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-solstice-slate">{money(l.line_total_cents)}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-solstice-sand/60">
                    <td colSpan={4} className="px-4 py-2 text-solstice-stone">
                      Subtotal
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-solstice-slate">
                      {money(proposal.pricing.subtotal_cents)}
                    </td>
                  </tr>
                  <tr className="border-b border-solstice-sand/60">
                    <td colSpan={4} className="px-4 py-2 text-solstice-stone">
                      Group discount, {proposal.pricing.discount_pct}%
                      {proposal.pricing.requested_discount_pct !== undefined &&
                      proposal.pricing.requested_discount_pct !== proposal.pricing.discount_pct ? (
                        <span className="ml-2 chip bg-amber-50 text-amber-900">
                          {proposal.pricing.requested_discount_pct}% requested
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-solstice-slate">
                      −{money(proposal.pricing.discount_cents)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-3 font-medium text-solstice-ink">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right font-display text-xl tabular-nums text-solstice-ink">
                      {money(proposal.pricing.total_cents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CollapsiblePanel>
          ) : null}

          {/* proposal artifact */}
          {proposal ? (
            <CollapsiblePanel
              title="Generated proposal"
              summary={`${proposal.status} · ${proposal.pdf_path ? 'PDF ready' : 'no PDF yet'}`}
              right={<ProposalPdfLink pdfPath={proposal.pdf_path} />}
            >
              <pre className="whitespace-pre-wrap px-5 py-4 font-sans text-sm leading-relaxed text-solstice-ink">
                {proposal.body ?? renderProposalBody(inquiry, proposal)}
              </pre>
            </CollapsiblePanel>
          ) : null}

          {/* everything we have said to this customer, and everything they said to us */}
          <ConversationThread inquiry={inquiry} />
        </div>

        <div className="xl:col-span-4">
          <InquiryAssistant inquiry={inquiry} proposal={proposal} />
        </div>
      </div>

      {prompt ? (
        <JustificationDialog
          action={prompt}
          inquiry={inquiry}
          proposal={proposal}
          busy={busy}
          onCancel={() => setPrompt(null)}
          onConfirm={(text) => void commit(prompt, text)}
        />
      ) : null}
    </AdminShell>
  )
}

function reprice(pricing: Pricing, discount_pct: number): Pricing {
  const discount_cents = Math.round((pricing.subtotal_cents * discount_pct) / 100)
  return {
    ...pricing,
    discount_pct,
    discount_cents,
    total_cents: pricing.subtotal_cents - discount_cents,
  }
}

function JustificationDialog({
  action,
  inquiry,
  proposal,
  busy,
  onCancel,
  onConfirm,
}: {
  action: Decision
  inquiry: InquiryRow
  proposal: ProposalRow | null
  busy: boolean
  onCancel: () => void
  onConfirm: (justification: string) => void
}) {
  const [text, setText] = useState('')
  const requested = proposal?.pricing.requested_discount_pct

  const context =
    action === 'override'
      ? `You are granting ${requested}% instead of the ${proposal?.pricing.discount_pct}% this property auto-approves. Say why, in words a GM would accept.`
      : action === 'approve'
        ? `You are approving ${inquiry.inquiry_code} at the compliant rate. Record what made the flagged items acceptable.`
        : `You are rejecting ${inquiry.inquiry_code}. Record the reason; the guest-facing reply is written from it.`

  function submit(e: FormEvent) {
    e.preventDefault()
    if (text.trim()) onConfirm(text.trim())
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-solstice-ink/40 px-4">
      <form onSubmit={submit} className="panel sol-rise w-full max-w-lg p-5">
        <h2 className="font-display text-2xl text-solstice-ink">{DECISION_LABEL[action]}</h2>
        <p className="mt-1 text-sm leading-relaxed text-solstice-stone">{context}</p>
        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wide text-solstice-stone">Justification (required)</span>
          <textarea
            autoFocus
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1.5 w-full resize-none rounded-md border border-solstice-sand bg-white px-3 py-2 text-sm outline-none transition focus:border-solstice-ember focus:ring-1 focus:ring-solstice-ember"
            placeholder="e.g. Repeat client, third block this year, worth the extra two points."
          />
        </label>
        <p className="mt-2 text-xs text-solstice-stone">
          This is recorded in the audit trail with your user id. Overrides are readable forever.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
            {busy ? 'Recording…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  )
}
