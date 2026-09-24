// One session, watched live: transcript on the left, the agent's tool trace beside it,
// the supervisor ladder on the right.
//
// Both streams are the same rows the archive reads. There is one transcript path in this
// system, not a live one and a stored one, which is why the archive can never disagree
// with what the supervisor watched happen.

import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import AdminShell from '@/components/admin/AdminShell'
import SupervisorLadder from '@/components/admin/SupervisorLadder'
import {
  AccessNotice,
  ChannelChip,
  EmptyState,
  ErrorNote,
  GroundedChip,
  Panel,
  PanelHeader,
  SessionStatusChip,
  SourceChip,
} from '@/components/admin/ui'
import { useNow, useSession, useStickToBottom, useToolTrace, useTranscript } from '@/components/admin/useAdminData'
import {
  clockTime,
  duration,
  intentLabel,
  type MessageRow,
  type ToolInvocationRow,
} from '@/components/admin/mockData'

const ROLE_STYLE: Record<MessageRow['role'], { rail: string; label: string; tone: string }> = {
  user: { rail: 'border-l-solstice-ink', label: 'Guest', tone: 'text-solstice-ink' },
  assistant: { rail: 'border-l-solstice-ember', label: 'Sol', tone: 'text-solstice-ink' },
  system: { rail: 'border-l-solstice-stone', label: 'System', tone: 'italic text-solstice-stone' },
  supervisor: { rail: 'border-l-solstice-gold', label: 'Supervisor', tone: 'text-solstice-ink' },
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const { row: session, source, loading, access } = useSession(id)
  const transcript = useTranscript(id)
  const trace = useToolTrace(id)
  const now = useNow(1000)

  const transcriptRef = useStickToBottom<HTMLDivElement>(transcript.rows.length)
  const traceRef = useStickToBottom<HTMLDivElement>(trace.rows.length)

  const ungrounded = useMemo(() => trace.rows.filter((t) => t.grounded === false).length, [trace.rows])

  if (loading) {
    return (
      <AdminShell title="Session">
        <Panel>
          <EmptyState title="Loading session…" />
        </Panel>
      </AdminShell>
    )
  }

  if (access) {
    return (
      <AdminShell title="Session">
        <AccessNotice problem={access} />
      </AdminShell>
    )
  }

  if (!session) {
    return (
      <AdminShell title="Session not found">
        <Panel>
          <EmptyState
            title="No such session"
            body="It may have been purged, or your role cannot read it. RLS decides that, not this page."
          />
        </Panel>
        <Link to="/admin/sessions" className="btn-ghost mt-4 inline-flex">
          Back to live sessions
        </Link>
      </AdminShell>
    )
  }

  const elapsed = duration(
    session.started_at,
    session.status === 'ended' && session.ended_at ? new Date(session.ended_at).getTime() : now,
  )

  return (
    <AdminShell
      title={session.guest_label ?? 'Unidentified guest'}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <ChannelChip channel={session.channel} />
          <SessionStatusChip status={session.status} />
          <span className="chip bg-solstice-sand/60 capitalize text-solstice-slate">{intentLabel(session.intent)}</span>
          <span className="tabular-nums text-solstice-stone">{elapsed}</span>
          {session.phone_masked ? <span className="text-solstice-stone">· {session.phone_masked}</span> : null}
        </span>
      }
      actions={
        <>
          <SourceChip source={source} />
          <Link to="/admin/sessions" className="btn-ghost">
            All sessions
          </Link>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-12">
        {/* transcript */}
        <Panel className="flex min-h-[28rem] flex-col xl:col-span-5">
          <PanelHeader
            title="Transcript"
            right={
              session.status === 'active' ? (
                <span className="chip bg-emerald-50 text-emerald-800">
                  <span className="sol-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  streaming
                </span>
              ) : (
                <span className="text-xs font-normal text-solstice-stone">{transcript.rows.length} turns</span>
              )
            }
          />
          <div ref={transcriptRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
            {transcript.rows.length === 0 ? (
              <EmptyState title="No turns yet" body="Voice transcripts arrive one conversation turn at a time." />
            ) : (
              transcript.rows.map((m) => {
                const style = ROLE_STYLE[m.role]
                return (
                  <div key={m.id} className={`sol-rise border-l-2 pl-3 ${style.rail}`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-solstice-stone">{style.label}</span>
                      <span className="text-[11px] tabular-nums text-solstice-stone/70">{clockTime(m.created_at)}</span>
                    </div>
                    <p className={`mt-0.5 text-sm leading-relaxed ${style.tone}`}>{m.content}</p>
                  </div>
                )
              })
            )}
          </div>
          <div className="border-t border-solstice-sand px-4 py-2">
            <ErrorNote message={transcript.error} />
          </div>
        </Panel>

        {/* tool trace */}
        <Panel className="flex min-h-[28rem] flex-col xl:col-span-4">
          <PanelHeader
            title="Tool trace"
            right={
              ungrounded > 0 ? (
                <span className="chip bg-rose-50 text-rose-800">{ungrounded} ungrounded</span>
              ) : (
                <span className="text-xs font-normal text-solstice-stone">{trace.rows.length} calls</span>
              )
            }
          />
          <div ref={traceRef} className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
            {trace.rows.length === 0 ? (
              <EmptyState title="No tool calls yet" body="Every tool the agent runs lands here with its masked arguments." />
            ) : (
              trace.rows.map((t) => <TraceEntry key={t.id} entry={t} />)
            )}
          </div>
          <div className="border-t border-solstice-sand px-4 py-2 text-[11px] leading-relaxed text-solstice-stone">
            Arguments are masked in the tool layer before they are written, never in the UI. A
            <span className="mx-1 font-medium text-rose-700">not grounded</span>
            result obliges Sol to escalate rather than improvise.
          </div>
        </Panel>

        {/* supervisor */}
        <div className="space-y-4 xl:col-span-3">
          <SupervisorLadder
            sessionId={session.id}
            channel={session.channel}
            status={session.status}
          />
          <Panel>
            <PanelHeader title="Session facts" />
            <dl className="space-y-2 p-4 text-sm">
              <Fact label="Session id" value={session.id} mono />
              <Fact label="Channel" value={session.channel} />
              <Fact label="Started" value={clockTime(session.started_at)} />
              <Fact label="Guest id" value={session.guest_id ?? 'not identified'} />
              <Fact label="Call control id" value={session.call_control_id ?? 'n/a (chat)'} mono />
              <Fact label="Telnyx conversation" value={session.telnyx_conversation_id ?? 'n/a (chat)'} mono />
            </dl>
          </Panel>
        </div>
      </div>
    </AdminShell>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-solstice-stone">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-xs text-solstice-slate ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  )
}

function TraceEntry({ entry }: { entry: ToolInvocationRow }) {
  const args = Object.entries(entry.args_masked ?? {})
  return (
    <div className="sol-rise rounded-md border border-solstice-sand bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-sm font-medium text-solstice-ink">{entry.tool}</code>
        <span className="flex items-center gap-1.5">
          <GroundedChip grounded={entry.grounded} />
          {entry.latency_ms !== null ? (
            <span className="chip bg-solstice-sand/60 tabular-nums text-solstice-slate">{entry.latency_ms} ms</span>
          ) : null}
        </span>
      </div>

      {args.length > 0 ? (
        <dl className="mt-2 space-y-0.5 rounded bg-solstice-cream px-2 py-1.5 font-mono text-[11px] leading-relaxed">
          {args.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 text-solstice-stone">{k}</dt>
              <dd className="min-w-0 break-all text-solstice-slate">{formatArg(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {entry.result_summary ? (
        <p className="mt-2 text-xs leading-relaxed text-solstice-slate">{entry.result_summary}</p>
      ) : null}
      <p className="mt-1 text-[11px] tabular-nums text-solstice-stone/70">{clockTime(entry.created_at)}</p>
    </div>
  )
}

function formatArg(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}
