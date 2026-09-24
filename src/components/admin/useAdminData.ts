// Admin data access: Supabase first, fixtures second.
//
// Every hook here reports which source it served. The header renders that, so a
// screen is never silently demonstrating a fixture while claiming to be live.
// The instant a real row arrives over Realtime, the fixtures are dropped and the
// surface flips to `live` on its own.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { StaffRole } from '../../../shared/types'
import {
  MOCK_AUDIT,
  MOCK_INQUIRIES,
  MOCK_INVITES,
  MOCK_MEMBERS,
  MOCK_MESSAGES,
  MOCK_PROPOSALS,
  MOCK_SESSIONS,
  MOCK_TOOL_INVOCATIONS,
  type AuditRow,
  type InquiryRow,
  type InviteRow,
  type MemberRow,
  type MessageRow,
  type ProposalRow,
  type SessionRow,
  type ToolInvocationRow,
} from './mockData'

export type DataSource = 'live' | 'demo'

export interface Loaded<T> {
  rows: T[]
  source: DataSource
  loading: boolean
  /** Populated when the live read failed. Shown once, quietly, never as a crash. */
  error: string | null
}

const EMPTY: Loaded<never> = { rows: [], source: 'demo', loading: true, error: null }

/** Anything with an `id`, which is every table in the schema. */
interface Identified {
  id: string
}

type QueryShape = { data: unknown; error: { message: string } | null }

/**
 * Runs a Supabase read and falls back to fixtures on error OR empty result.
 * Empty counts as "not seeded yet", which during this build is the common case.
 */
async function readOrMock<T>(run: () => PromiseLike<QueryShape>, fallback: T[]): Promise<Omit<Loaded<T>, 'loading'>> {
  try {
    const { data, error } = await run()
    if (error) return { rows: fallback, source: 'demo', error: error.message }
    const rows = (data ?? []) as T[]
    if (rows.length === 0) return { rows: fallback, source: 'demo', error: null }
    return { rows, source: 'live', error: null }
  } catch (e) {
    return { rows: fallback, source: 'demo', error: e instanceof Error ? e.message : 'read failed' }
  }
}

/**
 * Subscribes to postgres_changes and merges into local state. If the surface was
 * serving fixtures, the first real event clears them so live and demo never mix.
 */
function useRealtimeMerge<T extends Identified>(
  table: string,
  setState: React.Dispatch<React.SetStateAction<Loaded<T>>>,
  filter?: { column: string; value: string },
  sort?: (a: T, b: T) => number,
) {
  useEffect(() => {
    const channel = supabase
      .channel(`admin-${table}-${filter ? `${filter.column}-${filter.value}` : 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          ...(filter ? { filter: `${filter.column}=eq.${filter.value}` } : {}),
        },
        (payload) => {
          // Realtime hands back untyped records; the schema guarantees the shape.
          const next = payload.new as unknown as T
          const prev = payload.old as unknown as Partial<T>
          setState((s) => {
            const base = s.source === 'demo' ? [] : s.rows
            let rows: T[]
            if (payload.eventType === 'DELETE') {
              rows = base.filter((r) => r.id !== prev.id)
            } else {
              rows = [...base.filter((r) => r.id !== next.id), next]
            }
            if (sort) rows = [...rows].sort(sort)
            return { ...s, rows, source: 'live', loading: false }
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter?.column, filter?.value])
}

// ---------------------------------------------------------------- clock

/** One shared ticking clock so twelve session cards do not run twelve timers. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

// ---------------------------------------------------------------- identity

export interface Identity {
  email: string | null
  role: StaffRole | null
  loading: boolean
}

export function useIdentity(): Identity {
  const [identity, setIdentity] = useState<Identity>({ email: null, role: null, loading: true })
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        const email = data.user?.email ?? null
        let role: StaffRole | null = null
        if (data.user) {
          const res = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
          role = (res.data?.role as StaffRole | undefined) ?? null
        }
        if (alive) setIdentity({ email, role, loading: false })
      } catch {
        if (alive) setIdentity({ email: null, role: null, loading: false })
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return identity
}

// ---------------------------------------------------------------- sessions

const bySessionStart = (a: SessionRow, b: SessionRow) =>
  new Date(b.started_at).getTime() - new Date(a.started_at).getTime()

export function useSessions(): Loaded<SessionRow> {
  const [state, setState] = useState<Loaded<SessionRow>>(EMPTY)
  useEffect(() => {
    let alive = true
    void readOrMock<SessionRow>(
      () => supabase.from('sessions').select('*').order('started_at', { ascending: false }).limit(100),
      MOCK_SESSIONS,
    ).then((r) => {
      if (alive) setState({ ...r, rows: [...r.rows].sort(bySessionStart), loading: false })
    })
    return () => {
      alive = false
    }
  }, [])
  useRealtimeMerge<SessionRow>('sessions', setState, undefined, bySessionStart)
  return state
}

export function useSession(sessionId: string | undefined): { row: SessionRow | null; source: DataSource; loading: boolean } {
  const [state, setState] = useState<{ row: SessionRow | null; source: DataSource; loading: boolean }>({
    row: null,
    source: 'demo',
    loading: true,
  })
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void readOrMock<SessionRow>(
      () => supabase.from('sessions').select('*').eq('id', sessionId).limit(1),
      MOCK_SESSIONS.filter((s) => s.id === sessionId),
    ).then((r) => {
      if (alive) setState({ row: r.rows[0] ?? null, source: r.source, loading: false })
    })
    return () => {
      alive = false
    }
  }, [sessionId])

  // Status changes (taken_over, ended) must land on this screen without a refresh.
  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`admin-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => setState((s) => ({ ...s, row: payload.new as unknown as SessionRow, source: 'live' })),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  return state
}

const byCreated = <T extends { created_at: string }>(a: T, b: T) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime()

export function useTranscript(sessionId: string | undefined): Loaded<MessageRow> {
  const [state, setState] = useState<Loaded<MessageRow>>(EMPTY)
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void readOrMock<MessageRow>(
      () => supabase.from('messages').select('*').eq('session_id', sessionId).order('created_at', { ascending: true }),
      MOCK_MESSAGES[sessionId] ?? [],
    ).then((r) => {
      if (alive) setState({ ...r, loading: false })
    })
    return () => {
      alive = false
    }
  }, [sessionId])
  useRealtimeMerge<MessageRow>(
    'messages',
    setState,
    sessionId ? { column: 'session_id', value: sessionId } : undefined,
    byCreated,
  )
  return state
}

export function useToolTrace(sessionId: string | undefined): Loaded<ToolInvocationRow> {
  const [state, setState] = useState<Loaded<ToolInvocationRow>>(EMPTY)
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void readOrMock<ToolInvocationRow>(
      () =>
        supabase
          .from('tool_invocations')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true }),
      MOCK_TOOL_INVOCATIONS[sessionId] ?? [],
    ).then((r) => {
      if (alive) setState({ ...r, loading: false })
    })
    return () => {
      alive = false
    }
  }, [sessionId])
  useRealtimeMerge<ToolInvocationRow>(
    'tool_invocations',
    setState,
    sessionId ? { column: 'session_id', value: sessionId } : undefined,
    byCreated,
  )
  return state
}

// ---------------------------------------------------------------- group sales

const byCreatedDesc = <T extends { created_at: string }>(a: T, b: T) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

export function useInquiries(): Loaded<InquiryRow> {
  const [state, setState] = useState<Loaded<InquiryRow>>(EMPTY)
  useEffect(() => {
    let alive = true
    void readOrMock<InquiryRow>(
      () => supabase.from('inquiries').select('*').order('created_at', { ascending: false }).limit(200),
      MOCK_INQUIRIES,
    ).then((r) => {
      if (alive) setState({ ...r, rows: [...r.rows].sort(byCreatedDesc), loading: false })
    })
    return () => {
      alive = false
    }
  }, [])
  useRealtimeMerge<InquiryRow>('inquiries', setState, undefined, byCreatedDesc)
  return state
}

/** Every proposal, so the inbox can badge each inquiry without N round trips. */
export function useProposals(): Loaded<ProposalRow> {
  const [state, setState] = useState<Loaded<ProposalRow>>(EMPTY)
  useEffect(() => {
    let alive = true
    void readOrMock<ProposalRow>(
      () => supabase.from('proposals').select('*').order('created_at', { ascending: false }).limit(200),
      Object.values(MOCK_PROPOSALS),
    ).then((r) => {
      if (alive) setState({ ...r, loading: false })
    })
    return () => {
      alive = false
    }
  }, [])
  useRealtimeMerge<ProposalRow>('proposals', setState, undefined, byCreatedDesc)
  return state
}

export function useInquiry(inquiryId: string | undefined): {
  inquiry: InquiryRow | null
  proposal: ProposalRow | null
  source: DataSource
  loading: boolean
  /** Local optimistic patch, so the demo reacts instantly even with no endpoint behind it. */
  patchProposal: (patch: Partial<ProposalRow>) => void
} {
  const [inquiry, setInquiry] = useState<InquiryRow | null>(null)
  const [proposal, setProposal] = useState<ProposalRow | null>(null)
  const [source, setSource] = useState<DataSource>('demo')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!inquiryId) return
    let alive = true
    ;(async () => {
      const inq = await readOrMock<InquiryRow>(
        () => supabase.from('inquiries').select('*').eq('id', inquiryId).limit(1),
        MOCK_INQUIRIES.filter((i) => i.id === inquiryId),
      )
      const pro = await readOrMock<ProposalRow>(
        () => supabase.from('proposals').select('*').eq('inquiry_id', inquiryId).order('created_at', { ascending: false }).limit(1),
        MOCK_PROPOSALS[inquiryId] ? [MOCK_PROPOSALS[inquiryId]] : [],
      )
      if (!alive) return
      setInquiry(inq.rows[0] ?? null)
      setProposal(pro.rows[0] ?? null)
      setSource(inq.source === 'live' ? 'live' : 'demo')
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [inquiryId])

  const patchProposal = useCallback((patch: Partial<ProposalRow>) => {
    setProposal((p) => (p ? { ...p, ...patch } : p))
  }, [])

  return { inquiry, proposal, source, loading, patchProposal }
}

// ---------------------------------------------------------------- staff admin

export function useMembers(): Loaded<MemberRow> & { refresh: () => void } {
  const [state, setState] = useState<Loaded<MemberRow>>(EMPTY)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    void readOrMock<MemberRow>(
      () => supabase.from('profiles').select('*').order('created_at', { ascending: true }),
      MOCK_MEMBERS,
    ).then((r) => {
      if (alive) setState({ ...r, loading: false })
    })
    return () => {
      alive = false
    }
  }, [nonce])
  return { ...state, refresh: () => setNonce((n) => n + 1) }
}

export function useInvites(): Loaded<InviteRow> & { refresh: () => void; addLocal: (row: InviteRow) => void } {
  const [state, setState] = useState<Loaded<InviteRow>>(EMPTY)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    void readOrMock<InviteRow>(
      () => supabase.from('invites').select('*').order('created_at', { ascending: false }),
      MOCK_INVITES,
    ).then((r) => {
      if (alive) setState({ ...r, loading: false })
    })
    return () => {
      alive = false
    }
  }, [nonce])
  return {
    ...state,
    refresh: () => setNonce((n) => n + 1),
    addLocal: (row) => setState((s) => ({ ...s, rows: [row, ...s.rows] })),
  }
}

export function useAuditLog(): Loaded<AuditRow> {
  const [state, setState] = useState<Loaded<AuditRow>>(EMPTY)
  useEffect(() => {
    let alive = true
    void readOrMock<AuditRow>(
      () => supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(25),
      MOCK_AUDIT,
    ).then((r) => {
      if (alive) setState({ ...r, loading: false })
    })
    return () => {
      alive = false
    }
  }, [])
  return state
}

// ---------------------------------------------------------------- endpoints

export interface ApiOutcome<T> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

/**
 * POSTs to a Netlify function. Endpoints owned by other agents may not exist yet,
 * so the caller gets a structured outcome rather than a thrown error, and can
 * decide whether to fall back to a simulated result.
 */
export async function postJson<T>(path: string, body: unknown): Promise<ApiOutcome<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: typeof parsed === 'string' ? parsed : `HTTP ${res.status}` }
    }
    return { ok: true, status: res.status, data: parsed as T, error: null }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : 'network error' }
  }
}

/** Keeps a list scrolled to the newest entry unless the operator has scrolled up. */
export function useStickToBottom<T extends HTMLElement>(dep: unknown): React.RefObject<T> {
  const ref = useRef<T>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}
