import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { streamChat } from '@/lib/chatClient'
import type { ChatRequest, ChatWireEvent } from '@/lib/chatClient'
import { ChatLauncher } from './ChatLauncher'
import { ChatPanel } from './ChatPanel'
import { mockAgentStream } from './mockAgent'
import { usePrefersReducedMotion, useTypewriter } from './hooks'
import { applyDoneToConnection, applyDoneToTurn } from './turnState'
import { useTelnyxVoice } from './useTelnyxVoice'
import type { AgentTurn, Citation, ConnectionState, ToolActivity, TransportMode, Turn } from './types'

const PANEL_ID = 'sol-chat-panel'

const GREETING =
  'Hi, I’m Sol, I’m here to help with anything you need. I can look up a reservation, walk you ' +
  'through a policy, sort out check-in and check-out, or start a group booking. If something needs a ' +
  'person, I’ll say so and get you one.'

const SUGGESTIONS = [
  'What is your cancellation policy?',
  'Can I get a late check-out?',
  'I need rooms for a team offsite',
]

/**
 * The chat bubble.
 *
 * Owns the conversation state machine and nothing else: rendering lives in
 * ChatPanel, the wire lives in chatClient, the voice leg lives in
 * useTelnyxVoice. Everything the agent does is reflected here as state, which
 * is what lets the supervisor view mirror it later.
 */
export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'idle' })
  const [transportMode, setTransportMode] = useState<TransportMode | null>(null)
  const [unread, setUnread] = useState(false)
  const [busy, setBusy] = useState(false)

  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sessionIdRef = useRef<string | undefined>(undefined)
  const activeTurnIdRef = useRef<string | null>(null)
  const lastMessageRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  const reducedMotion = usePrefersReducedMotion()
  const voice = useTelnyxVoice(import.meta.env.VITE_TELNYX_ASSISTANT_ID)

  const forceMock = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('mock') === '1'
  }, [])

  const patchAgentTurn = useCallback((id: string, patch: (turn: AgentTurn) => AgentTurn) => {
    setTurns((previous) =>
      previous.map((turn) => (turn.id === id && turn.role === 'agent' ? patch(turn) : turn)),
    )
  }, [])

  // Character-smooth reveal. Disabled outright under prefers-reduced-motion.
  const typewriter = useTypewriter(
    useCallback(
      (chunk: string) => {
        const id = activeTurnIdRef.current
        if (!id) return
        patchAgentTurn(id, (turn) => ({ ...turn, text: turn.text + chunk }))
      },
      [patchAgentTurn],
    ),
    !reducedMotion,
  )

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Seed the greeting the first time the panel is opened, not on page load:
  // an unopened bubble has said nothing yet.
  useEffect(() => {
    if (!open) return
    setUnread(false)
    setTurns((previous) => {
      if (previous.length > 0) return previous
      const greeting: AgentTurn = {
        id: 'greeting',
        role: 'agent',
        text: GREETING,
        at: Date.now(),
        tools: [],
        citations: [],
        status: 'complete',
        greeting: true,
      }
      return [greeting]
    })
  }, [open])

  const closePanel = useCallback(() => {
    setOpen(false)
    voice.stop()
  }, [voice])

  // Return focus to the launcher after the panel unmounts.
  useEffect(() => {
    if (open) return
    if (turns.length === 0) return
    launcherRef.current?.focus()
  }, [open, turns.length])

  const fallback = useCallback(
    (request: ChatRequest) => mockAgentStream(request, { speed: reducedMotion ? 0.35 : 1 }),
    [reducedMotion],
  )

  const runTurn = useCallback(
    async (message: string, agentTurnId: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      activeTurnIdRef.current = agentTurnId
      lastMessageRef.current = message
      setBusy(true)
      setConnection({ kind: 'thinking' })

      try {
        const stream = streamChat(
          { session_id: sessionIdRef.current, message },
          { signal: controller.signal, fallback, forceMock },
        )

        for await (const event of stream) {
          if (controller.signal.aborted) return

          switch (event.type) {
            case 'transport':
              setTransportMode(event.mode)
              break

            case 'session':
              sessionIdRef.current = event.session_id
              break

            case 'reconnect':
              // Throw away the half-written reply; the retry re-sends the turn.
              typewriter.reset()
              patchAgentTurn(agentTurnId, (turn) => ({ ...turn, text: '', tools: [], citations: [] }))
              setConnection({ kind: 'reconnecting', attempt: event.attempt })
              break

            case 'delta':
              setConnection({ kind: 'idle' })
              typewriter.push(event.text)
              break

            case 'tool':
              setConnection({ kind: 'idle' })
              patchAgentTurn(agentTurnId, (turn) => ({ ...turn, tools: applyToolEvent(turn.tools, event) }))
              break

            case 'done':
              typewriter.flush()
              // `done` means the turn is over, not that it succeeded. The server emits `error`
              // and then ALWAYS emits `done`, so completing the turn unconditionally here is
              // what swallowed the failure message before the guest could read it.
              patchAgentTurn(agentTurnId, (turn) => applyDoneToTurn(turn, collectCitations))
              setConnection(applyDoneToConnection)
              if (!openRef.current) setUnread(true)
              break

            case 'error':
              typewriter.reset()
              // A half-finished answer about a cancellation fee is worse than no
              // answer, so the partial text and its citations are dropped. The
              // resolved tool chips stay: they show what Sol actually did.
              patchAgentTurn(agentTurnId, (turn) => ({
                ...turn,
                text: '',
                status: 'failed',
                error: event.message,
                citations: [],
                tools: turn.tools.filter((tool) => tool.status === 'done'),
              }))
              setConnection({ kind: 'failed', message: event.message })
              if (!openRef.current) setUnread(true)
              break
          }
        }
      } finally {
        if (!controller.signal.aborted) {
          setBusy(false)
          activeTurnIdRef.current = null
          if (abortRef.current === controller) abortRef.current = null
        }
      }
    },
    [fallback, forceMock, patchAgentTurn, typewriter],
  )

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim()
      if (!message || busy) return

      const now = Date.now()
      const agentTurnId = 'agent-' + String(now)

      setDraft('')
      setTurns((previous) => [
        ...previous,
        { id: 'guest-' + String(now), role: 'guest', text: message, at: now },
        {
          id: agentTurnId,
          role: 'agent',
          text: '',
          at: now,
          tools: [],
          citations: [],
          status: 'streaming',
        },
      ])

      void runTurn(message, agentTurnId)
    },
    [busy, runTurn],
  )

  const retry = useCallback(() => {
    const message = lastMessageRef.current
    if (!message || busy) return

    const now = Date.now()
    const agentTurnId = 'agent-' + String(now)

    // Drop the failed reply rather than stacking a second one under it.
    setTurns((previous) => {
      const trimmed = [...previous]
      const last = trimmed[trimmed.length - 1]
      if (last && last.role === 'agent' && last.status === 'failed') trimmed.pop()
      return [
        ...trimmed,
        {
          id: agentTurnId,
          role: 'agent',
          text: '',
          at: now,
          tools: [],
          citations: [],
          status: 'streaming',
        },
      ]
    })

    void runTurn(message, agentTurnId)
  }, [busy, runTurn])

  // The typing indicator is drawn by the streaming turn itself, so there is no
  // separate flag to keep in sync here.
  const suggestions = turns.length <= 1 && !busy ? SUGGESTIONS : []

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      <div className="pointer-events-auto">
        {open ? (
          <ChatPanel
            panelId={PANEL_ID}
            turns={turns}
            connection={connection}
            transportMode={transportMode}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => send(draft)}
            onRetry={retry}
            onClose={closePanel}
            suggestions={suggestions}
            onSuggestion={send}
            voice={voice}
            busy={busy}
            inputRef={inputRef}
          />
        ) : (
          <ChatLauncher ref={launcherRef} onClick={() => setOpen(true)} unread={unread} panelId={PANEL_ID} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tool trace bookkeeping                                               *
 * ------------------------------------------------------------------ */

function applyToolEvent(
  tools: ToolActivity[],
  event: Extract<ChatWireEvent, { type: 'tool' }>,
): ToolActivity[] {
  if (event.status === 'running') {
    const ordinal = tools.filter((tool) => tool.name === event.name).length
    return [
      ...tools,
      {
        key: event.name + '#' + String(ordinal),
        name: event.name,
        summary: event.summary,
        status: 'running',
        citations: event.citations,
        startedAt: Date.now(),
      },
    ]
  }

  // Resolve the most recent running call of that tool, in place.
  const index = findLastIndex(tools, (tool) => tool.name === event.name && tool.status === 'running')
  if (index === -1) {
    // A `done` with no matching `running` still deserves a chip.
    const ordinal = tools.filter((tool) => tool.name === event.name).length
    return [
      ...tools,
      {
        key: event.name + '#' + String(ordinal),
        name: event.name,
        summary: event.summary,
        status: 'done',
        citations: event.citations,
        startedAt: Date.now(),
        endedAt: Date.now(),
      },
    ]
  }

  const next = [...tools]
  const existing = next[index]
  next[index] = {
    ...existing,
    status: 'done',
    summary: event.summary || existing.summary,
    citations: event.citations.length > 0 ? event.citations : existing.citations,
    endedAt: Date.now(),
  }
  return next
}

function collectCitations(tools: ToolActivity[]): Citation[] {
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const tool of tools) {
    for (const citation of tool.citations) {
      if (seen.has(citation.ref)) continue
      seen.add(citation.ref)
      out.push(citation)
    }
  }
  return out
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
}
