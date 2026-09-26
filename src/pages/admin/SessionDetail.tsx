// One session, watched live: transcript on the left, the agent's tool trace beside it,
// the supervisor ladder on the right.
//
// Both streams are the same rows the archive reads. There is one transcript path in this
// system, not a live one and a stored one, which is why the archive can never disagree
// with what the supervisor watched happen.

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AdminShell from '@/components/admin/AdminShell'
import ChatIntervention from '@/components/admin/ChatIntervention'
import SupervisorLadder from '@/components/admin/SupervisorLadder'
import { SolMark } from '@/components/chat/glyphs'
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
  isLive,
  sessionClockEnd,
  type MessageAttachment,
  type MessageRow,
  type SessionStatus,
  type ToolInvocationRow,
} from '@/components/admin/mockData'

/**
 * The transcript is a conversation, not an audit log.
 *
 * Reads in the same bubble language as the live chat (guest right, hotel left), so a supervisor
 * reading an archive sees what the guest saw. Colour is kept for at-a-glance orientation via a
 * small avatar mark per role, but it no longer draws rails down the page. The clock stays as the
 * quiet timestamp under each bubble — provenance, not eyebrow labels. Colour tokens only.
 */
const ROLE_STYLE: Record<MessageRow['role'], { mark: string; label: string; align: string; bubble: string; tone: string }> = {
  user: {
    mark: 'bg-info/15 text-ink',
    label: 'Guest',
    align: 'justify-end',
    bubble: 'rounded-2xl rounded-br-md bg-hero text-hero-text',
    tone: '',
  },
  assistant: {
    mark: 'bg-line text-ink',
    label: 'Sol',
    align: 'justify-start',
    bubble: 'rounded-2xl rounded-bl-md border border-line bg-card',
    tone: 'text-muted',
  },
  system: {
    mark: 'bg-faint/20 text-muted',
    label: 'System',
    align: 'justify-start',
    bubble: 'rounded-2xl rounded-bl-md border border-dashed border-line bg-canvas',
    tone: 'italic text-muted',
  },
  supervisor: {
    mark: 'bg-warn-soft text-ink',
    label: 'Front desk',
    align: 'justify-start',
    bubble: 'rounded-2xl rounded-bl-md border border-warn/40 bg-card',
    tone: 'text-muted',
  },
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const { row: session, source, loading, access } = useSession(id)
  const transcript = useTranscript(id)
  const trace = useToolTrace(id)
  const now = useNow(1000)

  // Realtime carries the status change back within about a second, but the supervisor pressed the
  // button and should not watch it not happen for that second.
  const [statusOverride, setStatusOverride] = useState<SessionStatus | null>(null)

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
            body="It may have been removed, or your role is not allowed to see it. That is decided in the database, not on this page."
          />
        </Panel>
        <Link to="/admin/sessions" className="btn-ghost mt-4 inline-flex">
          Back to live sessions
        </Link>
      </AdminShell>
    )
  }

  const elapsed = duration(session.started_at, sessionClockEnd(session, now))
  const liveNow = isLive(session)
  const status: SessionStatus = statusOverride ?? session.status

  return (
    <AdminShell
      title={session.guest_label ?? 'Unidentified guest'}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <ChannelChip channel={session.channel} />
          <SessionStatusChip status={status} />
          <span className="chip bg-line/60 capitalize text-muted">{intentLabel(session.intent, status)}</span>
          <span className="tabular-nums text-muted">{elapsed}</span>
          {session.phone_masked ? <span className="text-muted">· {session.phone_masked}</span> : null}
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
              liveNow && status !== 'taken_over' ? (
                <span className="chip bg-good-soft text-good">
                  <span className="sol-dot h-1.5 w-1.5 rounded-full bg-good" />
                  streaming
                </span>
              ) : (
                <span className="text-xs font-normal text-muted">{transcript.rows.length} turns</span>
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
                  <div key={m.id} className={`sol-rise flex items-start gap-2 ${style.align}`}>
                    {/* Sol's rows carry the agent mark; other rows carry their role's colour. */}
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-semibold uppercase ${style.mark}`}
                    >
                      {m.role === 'assistant' ? <SolMark className="h-3.5 w-3.5" /> : style.label.charAt(0)}
                    </span>
                    <div className={`min-w-0 max-w-[85%] px-3.5 py-2.5 shadow-sm ${style.bubble}`}>
                      <span className={`mr-2 text-[11px] font-medium ${m.role === 'user' ? 'text-hero-text/70' : 'text-muted'}`}>
                        {style.label}
                      </span>
                      <span className="text-[11px] tabular-nums opacity-70">{clockTime(m.created_at)}</span>
                      <p className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed ${style.tone}`}>
                        {m.content}
                      </p>
                      {m.attachment ? <AttachmentChip attachment={m.attachment} /> : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="border-t border-line px-4 py-2">
            <ErrorNote message={transcript.error} />
          </div>
        </Panel>

        {/* tool trace */}
        <Panel className="flex min-h-[28rem] flex-col xl:col-span-4">
          <PanelHeader
            title="Tool trace"
            right={
              ungrounded > 0 ? (
                <span className="chip bg-bad-soft text-bad">{ungrounded} ungrounded</span>
              ) : (
                <span className="text-xs font-normal text-muted">{trace.rows.length} calls</span>
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
          <div className="border-t border-line px-4 py-2 text-[11px] leading-relaxed text-muted">
            Arguments are masked in the tool layer before they are written, never in the UI. A
            <span className="mx-1 font-medium text-bad">not grounded</span>
            result obliges Sol to escalate rather than improvise.
          </div>
        </Panel>

        {/* supervisor */}
        <div className="space-y-4 xl:col-span-3 xl:sticky xl:top-20 xl:self-start">
          {/* Two channels, two different controls. A chat has no audio to monitor or whisper into,
              so the voice ladder's four rungs would be one working button and three dead ones. */}
          {session.channel === 'chat' ? (
            <ChatIntervention
              sessionId={session.id}
              status={status}
              live={liveNow}
              onStatusChange={setStatusOverride}
            />
          ) : (
            <SupervisorLadder sessionId={session.id} channel={session.channel} status={status} />
          )}
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

/** A file a supervisor handed the guest, shown in the transcript so the archive records what was
 *  sent and not merely that something was. */
function AttachmentChip({ attachment }: { attachment: MessageAttachment }) {
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded border border-line bg-card px-2 py-1 text-xs text-muted transition hover:border-faint/60"
    >
      <span className="truncate font-medium text-ink">{attachment.filename}</span>
      <span className="shrink-0 text-muted">
        {attachment.bytes < 1024 * 1024
          ? `${Math.max(1, Math.round(attachment.bytes / 1024))} KB`
          : `${(attachment.bytes / (1024 * 1024)).toFixed(1)} MB`}
      </span>
    </a>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 eyebrow">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-xs text-muted ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  )
}

function TraceEntry({ entry }: { entry: ToolInvocationRow }) {
  const args = Object.entries(entry.args_masked ?? {})
  return (
    <div className="sol-rise rounded-md border border-line bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="text-sm font-medium text-ink">{entry.tool}</code>
        <span className="flex items-center gap-1.5">
          <GroundedChip grounded={entry.grounded} />
          {entry.latency_ms !== null ? (
            <span className="chip bg-line/60 tabular-nums text-muted">{entry.latency_ms} ms</span>
          ) : null}
        </span>
      </div>

      {args.length > 0 ? (
        <dl className="mt-2 space-y-0.5 rounded bg-canvas px-2 py-1.5 font-mono text-[11px] leading-relaxed">
          {args.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 text-muted">{k}</dt>
              <dd className="min-w-0 break-all text-muted">{formatArg(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {entry.result_summary ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">{entry.result_summary}</p>
      ) : null}
      <p className="mt-1 text-[11px] tabular-nums text-muted/70">{clockTime(entry.created_at)}</p>
    </div>
  )
}

function formatArg(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}
