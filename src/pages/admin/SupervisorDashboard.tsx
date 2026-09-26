// Concierge supervisor: the live grid.
// Subscribed to postgres_changes on `sessions`, so a call or chat that starts on the
// guest half of the split screen appears here inside about a second.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from '@/components/admin/AdminShell'
import SupervisorAudioStatus from '@/components/admin/SupervisorAudioStatus'
import {
  AccessNotice,
  ChannelChip,
  EmptyState,
  ErrorNote,
  Metric,
  Panel,
  PanelHeader,
  SessionStatusChip,
  SourceChip,
} from '@/components/admin/ui'
import { postJson, SESSION_FETCH_LIMIT, sessionViewIsTruncated, useNow, useSessions } from '@/components/admin/useAdminData'
import { useOpenEscalations } from '@/components/admin/useAdminData'
import {
  duration,
  intentLabel,
  isLive,
  sessionClockEnd,
  shortDate,
  clockTime,
  type EscalationRow,
  type SessionRow,
} from '@/components/admin/mockData'
import {
  deriveSessionTags,
  sessionMatchesTags,
  TAG_CHIP_CLASS,
  TAG_LABELS,
  type SessionTag,
} from '@/components/admin/sessionTags'

type ChannelFilter = 'all' | 'voice' | 'chat'

/** localStorage key for the archive's hide-unidentified toggle (default ON). */
const HIDE_UNIDENTIFIED_KEY = 'solstice.archive.hideUnidentified'

/**
 * The tag filter, as data: each button selects one tag; `all` selects none (= show everything).
 * Order is triage order — what needs a human first reads left to right.
 */
const TAG_FILTERS: Array<{ key: 'all' | SessionTag; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: TAG_LABELS.attention },
  { key: 'requested', label: TAG_LABELS.requested },
  { key: 'handled', label: TAG_LABELS.handled },
  { key: 'finished', label: TAG_LABELS.finished },
]

export default function SupervisorDashboard() {
  const { rows, source, loading, error, access } = useSessions()
  const escalations = useOpenEscalations()
  const now = useNow(1000)
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [tagFilter, setTagFilter] = useState<'all' | SessionTag>('all')
  // Archive clutter: hundreds of agent-loop test rows carry no guest identity at all.
  // Default ON (a supervisor wants guests, not test traffic); remembered per browser.
  const [hideUnidentified, setHideUnidentified] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(HIDE_UNIDENTIFIED_KEY) !== 'false'
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDE_UNIDENTIFIED_KEY, String(hideUnidentified))
    } catch {
      // Private mode / storage disabled: the toggle still works, it just does not persist.
    }
  }, [hideUnidentified])

  // Close conversations that ended without an event, once, when a supervisor opens this screen.
  //
  // A web chat ends with a closed tab, which sends nothing, so nothing ever stamped `ended_at` on a
  // chat session and this tile counted every conversation the system had ever held. There is a
  // scheduled sweep (netlify/functions/reaper.ts) that keeps the database honest between visits;
  // this call is what makes the number right the moment somebody looks at it, which is the moment
  // that matters. Fire and forget: the rows come back through Realtime, and a failed sweep is a
  // slightly stale tile, not something to interrupt a supervisor about.
  useEffect(() => {
    void postJson('/api/supervisor/reap', {})
  }, [])

  // One shared clock value re-tags the whole board, so the >24h attention rule moves in step
  // everywhere and the derivation stays a pure function of (session, escalations, now).
  const tagsBySession = useMemo(() => {
    const map = new Map<string, SessionTag[]>()
    for (const s of rows) map.set(s.id, deriveSessionTags(s, escalations.rows as EscalationRow[], now))
    return map
  }, [rows, escalations.rows, now])

  const filtered = useMemo(
    () =>
      rows.filter((s) => {
        if (channelFilter !== 'all' && s.channel !== channelFilter) return false
        return sessionMatchesTags(
          tagsBySession.get(s.id) ?? [],
          new Set<SessionTag>(tagFilter === 'all' ? [] : [tagFilter]),
        )
      }),
    [rows, channelFilter, tagFilter, tagsBySession],
  )
  const truncated = sessionViewIsTruncated(rows.length)
  const live = filtered.filter(isLive)
  const archived = filtered.filter((s) => !isLive(s))
  // The toggle only shapes the archive: an unidentified row that is live RIGHT NOW is a real
  // conversation in progress, and hiding it from the grid could strand a supervisor mid-handoff.
  const visibleArchived = hideUnidentified ? archived.filter((s) => !isUnidentified(s)) : archived

  // Counts come from ALL rows, not the filtered view, so a filter button never hides itself:
  // selecting "Supervisor requested" must not make the other counters read zero.
  const tagCounts = useMemo(() => {
    const counts: Record<'all' | SessionTag, number> = { all: rows.length, attention: 0, requested: 0, handled: 0, finished: 0 }
    for (const s of rows) for (const t of tagsBySession.get(s.id) ?? []) counts[t] += 1
    return counts
  }, [rows, tagsBySession])

  const voiceCount = rows.filter((s) => isLive(s) && s.channel === 'voice').length
  const chatCount = rows.filter((s) => isLive(s) && s.channel === 'chat').length
  // A finished call that a human took over stays `taken_over` in the archive on purpose. This
  // tile counts who is on a conversation RIGHT NOW, so it has to ask both questions.
  const takenOver = rows.filter((s) => s.status === 'taken_over' && isLive(s)).length

  if (access) {
    return (
      <AdminShell title="Live sessions">
        <AccessNotice problem={access} />
      </AdminShell>
    )
  }

  return (
    <AdminShell
      title="Live sessions"
      subtitle="Every call and chat Sol is handling right now, streaming from Supabase Realtime."
      actions={<SourceChip source={source} />}
    >
      <div className="mb-4">
        <SupervisorAudioStatus />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Active now"
          value={live.length}
          hint={
            truncated
              ? `${voiceCount} voice · ${chatCount} chat · newest ${SESSION_FETCH_LIMIT} only`
              : `${voiceCount} voice · ${chatCount} chat`
          }
        />
        <Metric label="Human in control" value={takenOver} hint="Supervisor took the call" />
        <Metric label="Archived" value={rows.filter((s) => !isLive(s)).length} hint="Full transcript retained" />
        {/* The hint used to print the three Postgres table names. It is the right evidence — this
            page is subscribed, not polling — but a concierge supervisor does not read table names.
            Same three streams, said in their words. */}
        <Metric
          label="Realtime"
          value={source === 'live' ? 'Connected' : 'Sample data'}
          hint="conversations, messages and actions, live"
        />
      </div>

      {/* One click to a triage queue. The tag filter drives the live grid AND the archive below. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TAG_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTagFilter(key)}
            aria-pressed={tagFilter === key}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tagFilter === key
                ? 'bg-solstice-ink text-white'
                : 'border border-solstice-sand text-solstice-stone hover:bg-solstice-sand/40'
            }`}
          >
            {label}
            <span className="ml-1.5 tabular-nums opacity-70">{tagCounts[key]}</span>
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-solstice-sand" aria-hidden="true" />
        {(['all', 'voice', 'chat'] as ChannelFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setChannelFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              channelFilter === f
                ? 'bg-solstice-ink text-white'
                : 'border border-solstice-sand text-solstice-stone hover:bg-solstice-sand/40'
            }`}
          >
            {f === 'all' ? 'All channels' : f === 'voice' ? 'Voice' : 'Chat'}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <ErrorNote message={error} />
      </div>

      {loading ? (
        <Panel>
          <EmptyState title="Loading sessions…" />
        </Panel>
      ) : live.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing live right now"
            body="Start a chat or call the support number on the guest side and it will appear here."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {live.map((s) => (
            <SessionCard key={s.id} session={s} tags={tagsBySession.get(s.id) ?? []} now={now} />
          ))}
        </div>
      )}

      <Panel className="mt-6">
        <PanelHeader
          title="Archive"
          right={
            <span className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-normal text-solstice-stone">
                <input
                  type="checkbox"
                  checked={hideUnidentified}
                  onChange={(e) => setHideUnidentified(e.target.checked)}
                  className="accent-solstice-ink"
                />
                Hide unidentified
              </label>
              <span className="text-xs font-normal text-solstice-stone">{visibleArchived.length} ended</span>
            </span>
          }
        />
        {visibleArchived.length === 0 ? (
          // An empty Archive used to be ambiguous: it looked the same whether nothing had ended or
          // the fetch window had simply not reached back far enough. Say which one it is — and
          // whether the hide-unidentified toggle is what emptied it.
          <EmptyState
            title={
              archived.length > 0
                ? 'All ended sessions are unidentified guests'
                : truncated
                  ? 'No ended sessions in the most recent conversations'
                  : 'No ended sessions yet'
            }
            body={archived.length > 0 ? 'Turn off "Hide unidentified" to see them.' : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-solstice-sand text-left text-xs uppercase tracking-wide text-solstice-stone">
                <th className="px-4 py-2 font-medium">Guest</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">Intent</th>
                <th className="px-4 py-2 font-medium">Needs</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Length</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleArchived.map((s) => (
                <tr key={s.id} className="border-b border-solstice-sand/60 last:border-0">
                  <td className="px-4 py-2.5 text-solstice-ink">{s.guest_label ?? 'Unidentified'}</td>
                  <td className="px-4 py-2.5">
                    <ChannelChip channel={s.channel} />
                  </td>
                  <td className="px-4 py-2.5 capitalize text-solstice-stone">{intentLabel(s.intent, s.status)}</td>
                  <td className="px-4 py-2.5">
                    <SessionTagChips tags={tagsBySession.get(s.id) ?? []} />
                  </td>
                  <td className="px-4 py-2.5 text-solstice-stone">
                    {shortDate(s.started_at)} · {clockTime(s.started_at)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-solstice-stone">
                    {s.ended_at ? duration(s.started_at, new Date(s.ended_at).getTime()) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link to={`/admin/sessions/${s.id}`} className="btn-ghost">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </AdminShell>
  )
}

/** True when the row carries no guest identity at all — agent-loop test traffic, not a guest. */
function isUnidentified(s: Pick<SessionRow, 'guest_id' | 'guest_label'>): boolean {
  return s.guest_id === null && s.guest_label === null
}

/** The tag chips, in triage order. Usually one tag; an urgent escalation shows two. */
function SessionTagChips({ tags }: { tags: SessionTag[] }) {
  const order: SessionTag[] = ['attention', 'requested', 'handled', 'finished']
  return (
    <span className="flex flex-wrap gap-1">
      {order
        .filter((t) => tags.includes(t))
        .map((t) => (
          <span key={t} className={`chip ${TAG_CHIP_CLASS[t]}`}>
            {TAG_LABELS[t]}
          </span>
        ))}
    </span>
  )
}

function SessionCard({ session, tags, now }: { session: SessionRow; tags: SessionTag[]; now: number }) {
  return (
    <Link
      to={`/admin/sessions/${session.id}`}
      className="panel block p-4 transition hover:border-solstice-stone/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-xl text-solstice-ink">{session.guest_label ?? 'Unidentified guest'}</div>
          <div className="mt-0.5 truncate text-xs text-solstice-stone">
            {session.phone_masked ?? (session.guest_id ? `Guest ${session.guest_id}` : 'No identity yet')}
          </div>
        </div>
        <span className="shrink-0 font-display text-2xl tabular-nums text-solstice-slate">
          {duration(session.started_at, sessionClockEnd(session, now))}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ChannelChip channel={session.channel} />
        <SessionStatusChip status={session.status} />
        <span className="chip bg-solstice-sand/60 capitalize text-solstice-slate">{intentLabel(session.intent, session.status)}</span>
      </div>

      <div className="mt-2">
        <SessionTagChips tags={tags} />
      </div>

      {!isLive(session) ? null : session.status === 'taken_over' ? (
        <div className="mt-3 text-xs text-solstice-ink">
          A supervisor is {session.channel === 'voice' ? 'on this call' : 'answering this chat'}.
        </div>
      ) : tags.includes('attention') ? null : (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
          <span className="sol-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Sol is handling this
        </div>
      )}
    </Link>
  )
}
