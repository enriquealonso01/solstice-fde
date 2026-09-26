// The guest half of supervisor intervention: watching for a human to speak.
//
// A supervisor types in the admin console, which writes a `role = 'supervisor'` row through
// POST /api/supervisor/message. This hook polls GET /api/chat/inbox and hands anything new to the
// widget. It is the only read the guest side does.
//
// WHY POLLING, WHICH IS THE QUESTION A REVIEWER WILL ASK. The admin console uses Supabase Realtime
// and is the better experience, and it can, because a supervisor is signed in and RLS decides what
// their subscription may carry. A guest has no account. Giving an anonymous browser a database
// subscription means handing out an anon key and trusting a policy to be the only thing between a
// stranger and the `messages` table. A four-second poll against an endpoint that returns exactly
// one role's rows for exactly one session id has no such surface, and four seconds is invisible in
// a conversation where the other party is typing anyway.
//
// It polls only while the panel is open and a session exists. A closed bubble costs nothing.

import { useEffect, useRef, useState } from 'react'
import type { TurnAttachment } from './types'

export interface InboxMessage {
  id: string
  text: string
  at: number
  attachment?: TurnAttachment
}

export interface StaffInboxState {
  /** True while a human, rather than Sol, is answering this conversation. */
  takenOver: boolean
}

interface InboxResponse {
  status?: string | null
  taken_over?: boolean
  messages?: Array<{
    id?: string
    content?: string
    created_at?: string
    attachment?: Record<string, unknown> | null
  }>
}

const POLL_MS = 4000

/**
 * @param sessionId  undefined until the server's first `session` event lands.
 * @param active     poll only while the panel is open.
 * @param onMessages called with messages never seen before, oldest first. Must be stable.
 */
export function useStaffInbox(
  sessionId: string | undefined,
  active: boolean,
  onMessages: (messages: InboxMessage[]) => void,
): StaffInboxState {
  const [takenOver, setTakenOver] = useState(false)
  // `after` is the newest timestamp already delivered, so a poll asks only for what it has not
  // seen. Held in a ref rather than state: updating it must not re-run the effect and restart the
  // interval, which would turn a 4s poll into a request per message.
  const afterRef = useRef<string | null>(null)
  const seenRef = useRef<Set<string>>(new Set())
  const onMessagesRef = useRef(onMessages)
  onMessagesRef.current = onMessages

  useEffect(() => {
    if (!active || !sessionId) return
    let alive = true

    const poll = async () => {
      try {
        const url = new URL('/api/chat/inbox', window.location.origin)
        url.searchParams.set('session_id', sessionId)
        if (afterRef.current) url.searchParams.set('after', afterRef.current)

        const res = await fetch(url.toString(), { headers: { accept: 'application/json' } })
        if (!res.ok || !alive) return
        const body = (await res.json()) as InboxResponse
        if (!alive) return

        setTakenOver(body.taken_over === true)

        const fresh: InboxMessage[] = []
        for (const row of body.messages ?? []) {
          const id = typeof row.id === 'string' ? row.id : null
          if (!id || seenRef.current.has(id)) continue
          seenRef.current.add(id)
          const createdAt = typeof row.created_at === 'string' ? row.created_at : null
          if (createdAt && (!afterRef.current || createdAt > afterRef.current)) afterRef.current = createdAt
          fresh.push({
            id,
            text: typeof row.content === 'string' ? row.content : '',
            at: createdAt ? new Date(createdAt).getTime() : Date.now(),
            attachment: toAttachment(row.attachment),
          })
        }
        if (fresh.length > 0) onMessagesRef.current(fresh)
      } catch {
        // A failed poll is not worth telling the guest about. The next one is four seconds away.
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [sessionId, active])

  return { takenOver }
}

/** Defensive because this comes off the wire: a message with a malformed attachment should render
 *  as text rather than as a broken download link. */
function toAttachment(raw: Record<string, unknown> | null | undefined): TurnAttachment | undefined {
  if (!raw) return undefined
  const url = typeof raw.url === 'string' ? raw.url : null
  const filename = typeof raw.filename === 'string' ? raw.filename : null
  if (!url || !filename) return undefined
  return {
    url,
    filename,
    content_type: typeof raw.content_type === 'string' ? raw.content_type : 'application/octet-stream',
    bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
  }
}
