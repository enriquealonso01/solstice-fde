// Group sales: the inbox.
// One row per inbound inquiry, badged by what the rules engine said about it.
// Concierge accounts cannot read this table at all; the policy is in the database.

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminShell from '@/components/admin/AdminShell'
import {
  AccessNotice,
  EmptyState,
  ErrorNote,
  Metric,
  Panel,
  PanelHeader,
  ProposalStatusChip,
  SeverityChip,
  SourceBadge,
  SourceChip,
} from '@/components/admin/ui'
import { useInquiries, useProposals } from '@/components/admin/useAdminData'
import { money, shortDate, verdictSeverity, type InquiryRow, type ProposalRow } from '@/components/admin/mockData'

type StatusFilter = 'all' | 'needs_decision' | 'ready' | 'sent'

export default function GroupInbox() {
  const inquiries = useInquiries()
  const proposals = useProposals()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  const byInquiry = useMemo(() => {
    const map = new Map<string, ProposalRow>()
    for (const p of proposals.rows) if (!map.has(p.inquiry_id)) map.set(p.inquiry_id, p)
    return map
  }, [proposals.rows])

  const decorated = useMemo(
    () =>
      inquiries.rows.map((inq) => {
        const proposal = byInquiry.get(inq.id) ?? null
        const severity = proposal ? verdictSeverity(proposal.verdicts) : 'flag'
        return { inq, proposal, severity }
      }),
    [inquiries.rows, byInquiry],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return decorated.filter(({ inq, proposal, severity }) => {
      if (filter === 'needs_decision' && severity === 'clear') return false
      if (filter === 'ready' && !(severity === 'clear' && proposal && proposal.status !== 'sent')) return false
      if (filter === 'sent' && proposal?.status !== 'sent') return false
      if (!q) return true
      // Null-safe on purpose: a live row can be missing any of these (INQ-2004 has no dates and
      // no phone), and one undefined here threw inside render, which unmounted the whole app.
      return [
        inq.inquiry_code,
        inq.payload.company_name,
        inq.payload.contact_name,
        inq.payload.contact_email,
        inq.payload.contact_phone,
        inq.payload.property_name,
        inq.payload.preferred_property_code,
      ]
        .filter((v): v is string => typeof v === 'string')
        .some((v) => v.toLowerCase().includes(q))
    })
  }, [decorated, query, filter])

  const needsDecision = decorated.filter((d) => d.severity !== 'clear' && d.proposal?.status !== 'sent').length
  const readyToSend = decorated.filter((d) => d.severity === 'clear' && d.proposal && d.proposal.status !== 'sent').length
  const sent = decorated.filter((d) => d.proposal?.status === 'sent').length
  const awaitingGuest = inquiries.rows.filter((i) => i.missing_fields.length > 0 && !byInquiry.get(i.id)).length

  if (inquiries.access) {
    return (
      <AdminShell title="Group inquiries">
        <AccessNotice problem={inquiries.access} />
      </AdminShell>
    )
  }

  return (
    <AdminShell
      title="Group inquiries"
      subtitle="Every inbound request, whether it came through the portal or arrived on a call with Sol."
      actions={<SourceChip source={inquiries.source} />}
    >
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Open inquiries" value={inquiries.rows.length} />
        <Metric label="Needs a decision" value={needsDecision} hint="Rules flagged or failed" />
        <Metric label="Ready to send" value={readyToSend} hint="Within every rule" />
        <Metric label="Awaiting the guest" value={awaitingGuest} hint="Clarifying questions out" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ['all', 'All'],
            ['needs_decision', 'Needs a decision'],
            ['ready', 'Ready to send'],
            ['sent', 'Sent'],
          ] as [StatusFilter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              filter === value
                ? 'bg-solstice-ink text-white'
                : 'border border-solstice-sand text-solstice-stone hover:bg-solstice-sand/40'
            }`}
          >
            {label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, contact, property or code"
          className="ml-auto w-72 rounded-md border border-solstice-sand bg-white px-3 py-1.5 text-sm outline-none transition focus:border-solstice-ember focus:ring-1 focus:ring-solstice-ember"
        />
      </div>

      <div className="mb-4">
        <ErrorNote message={inquiries.error} />
      </div>

      <Panel>
        <PanelHeader title="Inbox" right={<span className="text-xs font-normal text-solstice-stone">{visible.length} shown</span>} />
        {inquiries.loading ? (
          <EmptyState title="Loading inquiries…" />
        ) : visible.length === 0 ? (
          <EmptyState title="Nothing matches" body="Clear the search or pick a different filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-solstice-sand text-left text-xs uppercase tracking-wide text-solstice-stone">
                  <th className="px-4 py-2 font-medium">Inquiry</th>
                  <th className="px-4 py-2 font-medium">Property</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2 font-medium">Rooms</th>
                  <th className="px-4 py-2 font-medium">Discount</th>
                  <th className="px-4 py-2 font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Rules</th>
                  <th className="px-4 py-2 font-medium">Proposal</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map(({ inq, proposal, severity }) => (
                  <InboxRow key={inq.id} inquiry={inq} proposal={proposal} severity={severity} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AdminShell>
  )
}

function InboxRow({
  inquiry,
  proposal,
  severity,
}: {
  inquiry: InquiryRow
  proposal: ProposalRow | null
  severity: 'clear' | 'flag' | 'fail'
}) {
  const p = inquiry.payload
  const requested = p.requested_discount_pct
  const priced = proposal?.pricing.discount_pct
  const navigate = useNavigate()
  const href = `/admin/inquiries/${inquiry.id}`

  // The whole row is the target; the Open link stays for keyboard and screen-reader users.
  return (
    <tr
      onClick={() => navigate(href)}
      className="cursor-pointer border-b border-solstice-sand/60 transition last:border-0 hover:bg-solstice-cream/60"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-solstice-stone">{inquiry.inquiry_code}</span>
          <SourceBadge source={inquiry.source} />
        </div>
        <div className="mt-0.5 font-medium text-solstice-ink">{p.company_name}</div>
        <div className="text-xs text-solstice-stone">
          {p.contact_name}
          {p.contact_email ? ` · ${p.contact_email}` : p.contact_phone ? ` · ${p.contact_phone} (phone only)` : ''}
        </div>
      </td>
      <td className="px-4 py-3 text-solstice-slate">
        <div>{p.property_name}</div>
        <div className="font-mono text-xs text-solstice-stone">{p.preferred_property_code}</div>
      </td>
      <td className="px-4 py-3 text-solstice-slate">
        {p.arrival_date ? (
          <>
            <div>{shortDate(p.arrival_date)}</div>
            <div className="text-xs text-solstice-stone">{p.nights ?? '—'} nights</div>
          </>
        ) : (
          <span className="text-solstice-stone">not given</span>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums text-solstice-slate">{p.rooms_requested ?? '—'}</td>
      <td className="px-4 py-3 tabular-nums text-solstice-slate">
        {requested === null || requested === undefined ? (
          '—'
        ) : priced !== undefined && priced !== requested ? (
          <span>
            <span className="text-solstice-stone line-through">{requested}%</span>{' '}
            <span className="font-medium text-solstice-ink">{priced}%</span>
          </span>
        ) : (
          `${requested}%`
        )}
      </td>
      <td className="px-4 py-3 tabular-nums text-solstice-slate">
        {proposal ? money(proposal.pricing.total_cents) : '—'}
      </td>
      <td className="px-4 py-3">
        {proposal ? (
          <SeverityChip severity={severity} />
        ) : (
          <span className="chip bg-sky-50 text-sky-800">{inquiry.missing_fields.length} missing</span>
        )}
      </td>
      <td className="px-4 py-3">{proposal ? <ProposalStatusChip status={proposal.status} /> : <span className="text-xs text-solstice-stone">none yet</span>}</td>
      <td className="px-4 py-3 text-right">
        <Link to={href} className="btn-ghost" onClick={(e) => e.stopPropagation()}>
          Open
        </Link>
      </td>
    </tr>
  )
}
