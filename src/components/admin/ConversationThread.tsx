// Everything we have said to this customer, and everything they said to us, in one thread.
//
// A rep asking "did we already chase them?" should not have to infer it from a proposal status.
// Reads GET /api/group/communications?inquiry_id=<code>. Until that endpoint ships, the panel
// says so plainly rather than inventing a thread.
import { useEffect, useState } from 'react'
import { CollapsiblePanel, EmptyState } from './ui'
import { accessToken, ACCESS_MESSAGE, type AccessProblem } from './useAdminData'
import type { InquiryRow } from './mockData'
import { shortDate } from './mockData'

export interface CommunicationItem {
  id: string
  direction: 'outbound' | 'inbound'
  channel: 'email' | 'sms' | 'voice'
  subject?: string | null
  preview?: string | null
  body?: string | null
  status?: string | null
  occurred_at: string
  actor?: string | null
  /** Where it really went in demo mode, when that differs from the customer's address. */
  delivered_to?: string | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; items: CommunicationItem[] }
  | { kind: 'absent' }
  | { kind: 'denied'; problem: AccessProblem }

const CHANNEL_LABEL: Record<CommunicationItem['channel'], string> = {
  email: 'Email',
  sms: 'Text',
  voice: 'Call',
}

export default function ConversationThread({ inquiry }: { inquiry: InquiryRow }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const key = inquiry.inquiry_code ?? inquiry.id

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const token = await accessToken()
        const res = await fetch(`/api/group/communications?inquiry_id=${encodeURIComponent(key)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!alive) return
        if (res.status === 404) return setState({ kind: 'absent' })
        if (res.status === 401) return setState({ kind: 'denied', problem: 'expired' })
        if (res.status === 403) return setState({ kind: 'denied', problem: 'forbidden' })
        if (res.status === 503) return setState({ kind: 'denied', problem: 'unavailable' })
        if (!res.ok) return setState({ kind: 'absent' })
        const body = (await res.json()) as { items?: CommunicationItem[] }
        setState({ kind: 'ready', items: body.items ?? [] })
      } catch {
        if (alive) setState({ kind: 'absent' })
      }
    })()
    return () => {
      alive = false
    }
  }, [key])

  const count = state.kind === 'ready' ? state.items.length : null

  return (
    <CollapsiblePanel
      title="Conversation"
      summary={
        state.kind === 'loading'
          ? 'loading…'
          : count === null
            ? 'unavailable'
            : count === 0
              ? 'nothing sent yet'
              : `${count} message${count === 1 ? '' : 's'}`
      }
    >
      {state.kind === 'loading' ? (
        <EmptyState title="Loading the thread…" />
      ) : state.kind === 'denied' ? (
        <EmptyState title="Cannot read the thread" body={ACCESS_MESSAGE[state.problem]} />
      ) : state.kind === 'absent' ? (
        <EmptyState
          title="No communication history"
          body="The communications endpoint is not deployed on this build, so nothing is shown rather than guessed."
        />
      ) : state.items.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          body="Proposals, follow-ups and inbound messages for this customer will appear here."
        />
      ) : (
        <ol className="divide-y divide-solstice-sand/60">
          {state.items.map((item) => (
            <li key={item.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`chip ${
                    item.direction === 'outbound'
                      ? 'bg-solstice-ink text-white'
                      : 'border border-solstice-sand bg-white text-solstice-slate'
                  }`}
                >
                  {item.direction === 'outbound' ? 'We sent' : 'They sent'}
                </span>
                <span className="chip bg-solstice-sand/50 text-solstice-slate">{CHANNEL_LABEL[item.channel]}</span>
                {item.status ? (
                  <span className="text-xs text-solstice-stone">{item.status}</span>
                ) : null}
                <span className="ml-auto text-xs text-solstice-stone">{shortDate(item.occurred_at)}</span>
              </div>

              {item.subject ? (
                <p className="mt-2 font-medium text-solstice-ink">{item.subject}</p>
              ) : null}
              {item.preview || item.body ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-solstice-slate">
                  {item.body ?? item.preview}
                </p>
              ) : null}
              {item.delivered_to ? (
                <p className="mt-1.5 text-[11px] text-solstice-stone">
                  Demo mode redirected delivery to {item.delivered_to}
                </p>
              ) : null}
              {item.actor ? <p className="mt-1 text-[11px] text-solstice-stone">by {item.actor}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </CollapsiblePanel>
  )
}
