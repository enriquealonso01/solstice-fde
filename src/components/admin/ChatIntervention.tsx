// A supervisor answering a guest chat themselves.
//
// This is the chat equivalent of the voice ladder, and deliberately not the same control. The voice
// ladder has four rungs because Telnyx gives us four real primitives on live audio: monitor, whisper,
// barge and stopping the assistant leg. A text conversation has no audio to route, so it has one
// meaningful move -- become the author of the next message -- and pretending otherwise would put
// three dead buttons on the screen.
//
// WHAT MAKES THE BUTTON REAL. Join writes `sessions.status = 'taken_over'`, and
// netlify/functions/chat.ts refuses to call the model while that is set. Sol stops because of the
// row, not because of this component. That is worth saying out loud to a panel: the UI is the
// affordance, the database is the mechanism, and if this file were deleted the guarantee would still
// hold for anything else that set the status.
//
// The browser cannot write `messages` directly, by design -- supabase/schema.sql grants concierge and
// admin a select policy and no insert policy at all -- so every action here goes through
// /api/supervisor/*, which verifies the token as the user and checks the role against the same rule
// RLS enforces underneath.

import { useRef, useState } from 'react'
import type { SessionStatus } from './mockData'
import { isMissingBackend, postJson } from './useAdminData'

/** Matches MAX_ATTACHMENT_BYTES in netlify/functions/supervisor/attachments.ts, which explains where
 *  the number comes from. Checked here too so a supervisor learns a 40 MB video is too big before
 *  waiting for it to encode and upload. */
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

const ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.docx,.xlsx,.ics,' +
  'application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain,text/csv,text/calendar'

interface Props {
  sessionId: string
  status: SessionStatus
  /** False once the conversation has ended: there is nobody left to talk to. */
  live: boolean
  /** Lets the page reflect the new status without waiting for the Realtime round trip. */
  onStatusChange?: (status: SessionStatus) => void
}

export default function ChatIntervention({ sessionId, status, live, onStatusChange }: Props) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState<'join' | 'release' | 'send' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [simulated, setSimulated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const joined = status === 'taken_over'

  async function join(mode: 'join' | 'release') {
    setPending(mode)
    setError(null)
    const res = await postJson<{ ok?: boolean; status?: SessionStatus }>(`/api/supervisor/${mode}`, {
      session_id: sessionId,
    })
    setPending(null)
    if (res.ok) {
      setSimulated(false)
      onStatusChange?.(res.data?.status ?? (mode === 'join' ? 'taken_over' : 'active'))
      return
    }
    if (isMissingBackend(res.failure)) {
      // The endpoint is not deployed. Move the local state so the surface is demonstrable, and say
      // plainly that nothing was written: claiming a guest has a human on the line when they do not
      // is the worst lie this screen can tell.
      setSimulated(true)
      onStatusChange?.(mode === 'join' ? 'taken_over' : 'active')
      return
    }
    setError(res.error)
  }

  async function send() {
    const body = text.trim()
    if (!body && !file) return
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      setError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 4 MB.`)
      return
    }

    setPending('send')
    setError(null)

    let attachment: { filename: string; content_type: string; data_base64: string } | undefined
    if (file) {
      try {
        attachment = {
          filename: file.name,
          // Some browsers report an empty type for an unfamiliar extension. The server's allowlist
          // rejects an empty string with a readable message, which is better than guessing here.
          content_type: file.type || 'application/octet-stream',
          data_base64: await toBase64(file),
        }
      } catch {
        setPending(null)
        setError('That file could not be read from disk.')
        return
      }
    }

    const res = await postJson<{ ok?: boolean }>('/api/supervisor/message', {
      session_id: sessionId,
      text: body,
      attachment,
    })
    setPending(null)

    if (res.ok) {
      setSimulated(false)
      setText('')
      clearFile()
      // Sending implies taking over, server side. Reflect that immediately rather than leaving the
      // panel showing a Join button after a message has already gone out.
      if (!joined) onStatusChange?.('taken_over')
      return
    }
    if (isMissingBackend(res.failure)) {
      setSimulated(true)
      setError('Nothing was sent. This environment cannot reach the supervisor service, so the guest was not contacted.')
      return
    }
    setError(res.error)
  }

  function clearFile() {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (!live) {
    return (
      <div className="panel p-4">
        <h3 className="font-display text-lg text-ink">Intervene</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          This conversation has ended, so there is nobody on the other side to answer. The transcript
          beside it is the full record.
        </p>
      </div>
    )
  }

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg text-ink">Intervene</h3>
          <p className="mt-0.5 text-xs text-muted">
            {joined ? 'You are answering this guest. Sol has stood down.' : 'Sol is answering. Step in when you need to.'}
          </p>
        </div>
        {joined ? (
          <span className="chip shrink-0 bg-accent/15 text-ink">you have it</span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {joined ? (
          <button
            type="button"
            onClick={() => void join('release')}
            disabled={pending !== null}
            className="btn-ghost disabled:opacity-50"
          >
            {pending === 'release' ? 'Handing back…' : 'Hand back to Sol'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void join('join')}
            disabled={pending !== null}
            className="btn-primary disabled:opacity-50"
          >
            {pending === 'join' ? 'Joining…' : 'Join this chat'}
          </button>
        )}
      </div>

      <label htmlFor="supervisor-note" className="mt-4 block eyebrow">
        Message to the guest
      </label>
      <textarea
        id="supervisor-note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line: the same contract as the guest's composer, so
          // a supervisor typing quickly does not have to think about which box they are in.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void send()
          }
        }}
        rows={4}
        maxLength={4000}
        placeholder="They can see this immediately, alongside everything Sol has said."
        className="mt-1.5 w-full resize-y rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-faint/60 focus:outline-none focus:ring-2 focus:ring-accent/25"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          id="supervisor-attachment"
          type="file"
          accept={ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <label
          htmlFor="supervisor-attachment"
          className="btn-ghost cursor-pointer text-xs"
        >
          Attach a file
        </label>
        {file ? (
          <span className="chip max-w-[12rem] bg-line/60 text-muted">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={clearFile}
              aria-label={`Remove ${file.name}`}
              className="ml-1 text-muted hover:text-ink"
            >
              ×
            </button>
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void send()}
          disabled={pending !== null || (!text.trim() && !file)}
          className="btn-primary ml-auto disabled:opacity-50"
        >
          {pending === 'send' ? 'Sending…' : 'Send to guest'}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs leading-relaxed text-bad">{error}</p> : null}
      {simulated ? (
        <p className="mt-2 text-xs leading-relaxed text-warn">
          This environment has no supervisor service running, so the panel moved but the guest was
          not contacted and nothing was recorded.
        </p>
      ) : null}

      <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
        Joining marks the conversation as yours, and Sol will not answer another word on it until you
        hand it back. The guest is told a person has joined. Every message and file you send is
        recorded against your account.
      </p>
    </div>
  )
}

/**
 * File -> base64, without the `data:` prefix.
 *
 * FileReader rather than `file.arrayBuffer()` plus a manual encode: btoa on a large binary string
 * blows the argument limit on some browsers, and this path is already the one the platform
 * optimises.
 */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}
