// Super admin: both surfaces at a glance, plus the only place roles are granted.

import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from '@/components/admin/AdminShell'
import { supabase } from '@/lib/supabase'
import {
  AccessNotice,
  ChannelChip,
  EmptyState,
  ErrorNote,
  Metric,
  Panel,
  PanelHeader,
  ProposalStatusChip,
  SessionStatusChip,
  SeverityChip,
  SourceChip,
} from '@/components/admin/ui'
import {
  ACCESS_MESSAGE,
  classifyDbError,
  useAuditLog,
  useIdentity,
  useInquiries,
  useInvites,
  useMembers,
  useNow,
  useProposals,
  useSessions,
} from '@/components/admin/useAdminData'
import { duration, intentLabel, money, shortDate, verdictSeverity, type ProposalRow } from '@/components/admin/mockData'
import type { StaffRole } from '../../../shared/types'

const ROLES: { value: StaffRole; label: string; scope: string }[] = [
  { value: 'concierge', label: 'Concierge supervisor', scope: 'Conversations only. Cannot read group inquiries.' },
  { value: 'group_sales', label: 'Group sales', scope: 'Group inquiries only. Cannot read guest conversations.' },
  { value: 'gm', label: 'General manager', scope: 'Group inquiries, and the only role that can approve a block outside the property limits.' },
  { value: 'admin', label: 'Super admin', scope: 'Both surfaces, invites, and the system map.' },
]

/** The staff_role column cannot hold 'gm' until migration 006 runs; until then the gm login gets
 *  it from scripts/seed-users.mjs. Set to true once 006 is applied. */
const GM_IN_DATABASE = false

function RoleOptions() {
  return ROLES.map((r) =>
    r.value === 'gm' && !GM_IN_DATABASE ? (
      <option key={r.value} value={r.value} disabled>
        {r.label} (after migration 006)
      </option>
    ) : (
      <option key={r.value} value={r.value}>
        {r.label}
      </option>
    ),
  )
}

export default function AdminHome() {
  const sessions = useSessions()
  const inquiries = useInquiries()
  const proposals = useProposals()
  const audit = useAuditLog()
  const members = useMembers()
  const identity = useIdentity()
  const now = useNow(1000)

  const proposalByInquiry = useMemo(() => {
    const map = new Map<string, ProposalRow>()
    for (const p of proposals.rows) if (!map.has(p.inquiry_id)) map.set(p.inquiry_id, p)
    return map
  }, [proposals.rows])

  const liveSessions = sessions.rows.filter((s) => s.status !== 'ended')
  const attention = inquiries.rows
    .map((inq) => ({ inq, proposal: proposalByInquiry.get(inq.id) ?? null }))
    .filter(({ proposal }) => !proposal || verdictSeverity(proposal.verdicts) !== 'clear')
    .filter(({ proposal }) => proposal?.status !== 'sent')

  const access = sessions.access ?? inquiries.access ?? proposals.access ?? members.access
  if (access) {
    return (
      <AdminShell title="Overview">
        <AccessNotice problem={access} />
      </AdminShell>
    )
  }

  return (
    <AdminShell
      title={`Good ${greeting()}, ${identity.email?.split('@')[0] ?? 'there'}`}
      subtitle="Everything both scoped roles see, plus who is allowed to see it."
      actions={
        <>
          <SourceChip source={sessions.source === 'live' && inquiries.source === 'live' ? 'live' : 'demo'} />
          <Link to="/admin/backend" className="btn-primary">
            How it works
          </Link>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Live sessions" value={liveSessions.length} hint="voice and chat, right now" />
        <Metric label="Needs a decision" value={attention.length} hint="group inquiries" />
        <Metric
          label="Sent this cycle"
          value={proposals.rows.filter((p) => p.status === 'sent').length}
          hint="proposals delivered"
        />
        <Metric label="Staff accounts" value={members.rows.length} hint="each one sees only its own work" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* concierge surface */}
        <Panel>
          <PanelHeader
            title="Concierge · live now"
            right={
              <Link to="/admin/sessions" className="text-xs font-normal text-accent hover:underline">
                Open dashboard
              </Link>
            }
          />
          {liveSessions.length === 0 ? (
            <EmptyState title="Nothing live" body="Calls and chats appear here the moment they start." />
          ) : (
            <ul className="divide-y divide-line">
              {liveSessions.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <Link to={`/admin/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas/70">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {s.guest_label ?? 'Unidentified guest'}
                      </span>
                      <span className="block truncate text-xs capitalize text-muted">{intentLabel(s.intent, s.status)}</span>
                    </span>
                    <ChannelChip channel={s.channel} />
                    <SessionStatusChip status={s.status} />
                    <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted">
                      {duration(s.started_at, now)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* group surface */}
        <Panel>
          <PanelHeader
            title="Group sales · needs a decision"
            right={
              <Link to="/admin/inquiries" className="text-xs font-normal text-accent hover:underline">
                Open inbox
              </Link>
            }
          />
          {attention.length === 0 ? (
            <EmptyState title="Nothing waiting on a human" body="Every open inquiry is inside the rules." />
          ) : (
            <ul className="divide-y divide-line">
              {attention.slice(0, 5).map(({ inq, proposal }) => (
                <li key={inq.id}>
                  <Link to={`/admin/inquiries/${inq.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas/70">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{inq.payload.company_name}</span>
                      <span className="block truncate text-xs text-muted">
                        {inq.inquiry_code} · {inq.payload.property_name} · {inq.payload.rooms_requested ?? '—'} rooms
                      </span>
                    </span>
                    {proposal ? (
                      <>
                        <SeverityChip severity={verdictSeverity(proposal.verdicts)} />
                        <ProposalStatusChip status={proposal.status} />
                        <span className="w-24 shrink-0 text-right text-sm tabular-nums text-muted">
                          {money(proposal.pricing.total_cents)}
                        </span>
                      </>
                    ) : (
                      <span className="chip bg-info-soft text-info">{inq.missing_fields.length} missing</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Members members={members} />
        </div>
        <Panel>
          <PanelHeader title="Recent decisions" />
          {audit.rows.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-line text-sm">
              {audit.rows.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <div className="text-ink">
                    <span className="font-medium">{a.actor_label ?? a.actor ?? 'staff member'}</span> ·{' '}
                    {a.action.replace(/[._]/g, ' ')}
                  </div>
                  <div className="text-xs text-muted">
                    {a.subject} · {shortDate(a.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminShell>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

function Members({ members }: { members: ReturnType<typeof useMembers> }) {
  const invites = useInvites()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('concierge')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [roleOverride, setRoleOverride] = useState<Record<string, StaffRole>>({})

  async function invite(e: FormEvent) {
    e.preventDefault()
    const clean = email.trim().toLowerCase()
    if (!clean) return
    setBusy(true)
    setNote(null)
    const { error } = await supabase.from('invites').insert({ email: clean, granted_role: role, status: 'pending' })
    if (error) {
      const access = classifyDbError(error)
      if (access) {
        // Refused on credentials. A local row here would look like a granted invite that
        // nobody was ever sent, which is the kind of thing an admin only discovers later.
        setNote(`${ACCESS_MESSAGE[access]} No invite was created.`)
        setBusy(false)
        return
      }
      // Table not applied yet. Keep the demo moving and say exactly what happened.
      invites.addLocal({
        id: `local-${Date.now()}`,
        email: clean,
        granted_role: role,
        status: 'pending (local)',
        created_at: new Date().toISOString(),
      })
      setNote(`Recorded locally only, not in the database: ${error.message}`)
    } else {
      invites.refresh()
      setNote(`Invite queued for ${clean} as ${role.replace('_', ' ')}.`)
    }
    setEmail('')
    setBusy(false)
  }

  async function changeRole(id: string, previous: StaffRole, next: StaffRole) {
    setRoleOverride((r) => ({ ...r, [id]: next }))
    const { error } = await supabase.from('profiles').update({ role: next }).eq('id', id)
    if (!error) {
      setNote('Role updated.')
      return
    }
    // Snap the control back, so the dropdown never shows a grant that did not happen.
    setRoleOverride((r) => ({ ...r, [id]: previous }))
    const access = classifyDbError(error)
    setNote(access ? `${ACCESS_MESSAGE[access]} The role was not changed.` : `Role change not persisted: ${error.message}`)
  }

  return (
    <Panel>
      <PanelHeader
        title="Members and access"
        right={<span className="text-xs font-normal text-muted">{members.rows.length} accounts · {invites.rows.length} invites</span>}
      />

      <form onSubmit={(e) => void invite(e)} className="flex flex-wrap items-end gap-2 border-b border-line p-4">
        <label className="min-w-[14rem] flex-1">
          <span className="eyebrow">Invite by email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@solsticehotels.com"
            className="mt-1.5 w-full rounded-md border border-line bg-card px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </label>
        <label>
          <span className="eyebrow">Grant role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="mt-1.5 rounded-md border border-line bg-card px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
          >
            <RoleOptions />
          </select>
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          Send invite
        </button>
        <p className="w-full text-xs text-muted">{ROLES.find((r) => r.value === role)?.scope}</p>
        {note ? <p className="w-full text-xs text-muted">{note}</p> : null}
        <div className="w-full">
          <ErrorNote message={members.error} />
        </div>
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left eyebrow">
            <th className="px-4 py-2 font-medium">Member</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Added</th>
          </tr>
        </thead>
        <tbody>
          {members.rows.map((m) => (
            <tr key={m.id} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-2.5">
                <div className="text-ink">{m.full_name ?? m.email}</div>
                <div className="text-xs text-muted">{m.email}</div>
              </td>
              <td className="px-4 py-2.5">
                <select
                  value={roleOverride[m.id] ?? m.role}
                  onChange={(e) => void changeRole(m.id, roleOverride[m.id] ?? m.role, e.target.value as StaffRole)}
                  className="rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                >
                  <RoleOptions />
                </select>
              </td>
              <td className="px-4 py-2.5 text-muted">{shortDate(m.created_at)}</td>
            </tr>
          ))}
          {invites.rows.map((i) => (
            <tr key={i.id} className="border-b border-line/60 bg-canvas/50 last:border-0">
              <td className="px-4 py-2.5">
                <div className="text-muted">{i.email}</div>
                <div className="text-xs text-muted">invite {i.status}</div>
              </td>
              <td className="px-4 py-2.5 capitalize text-muted">{i.granted_role.replace('_', ' ')}</td>
              <td className="px-4 py-2.5 text-muted">{shortDate(i.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
