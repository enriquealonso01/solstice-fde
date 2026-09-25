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

/**
 * A failure about WHO the caller is, rather than whether the backend exists.
 * These must never fall back to fixtures: showing invented numbers to someone whose
 * session expired is worse than showing them nothing, because they will believe it.
 */
export type AccessProblem = 'expired' | 'forbidden' | 'unavailable'

export const ACCESS_MESSAGE: Record<AccessProblem, string> = {
  expired: 'Your session has expired. Sign in again to see live data.',
  forbidden: 'This account does not have access to these records.',
  unavailable: 'The server cannot verify your session right now. It is missing its database settings.',
}

export interface Loaded<T> {
  rows: T[]
  source: DataSource
  loading: boolean
  /** Populated when the live read failed but fixtures are still safe to show. */
  error: string | null
  /** Set when the read failed on credentials. Fixtures are suppressed; the UI says so. */
  access: AccessProblem | null
}

const EMPTY: Loaded<never> = { rows: [], source: 'demo', loading: true, error: null, access: null }

/** Anything with an `id`, which is every table in the schema. */
interface Identified {
  id: string
}

interface Postgrestish {
  message: string
  code?: string
  status?: number
}

type QueryShape = { data: unknown; error: Postgrestish | null }

/** The caller's Supabase access token, or null when there is no usable session. */
export async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * Separates "you are not allowed" from "the table is empty" on a PostgREST error.
 * PGRST301 is an expired or invalid JWT; 42501 is an RLS refusal on a write.
 */
export function classifyDbError(error: Postgrestish): AccessProblem | null {
  const code = error.code ?? ''
  const msg = (error.message ?? '').toLowerCase()
  if (error.status === 401 || code === 'PGRST301' || msg.includes('jwt expired') || msg.includes('invalid jwt')) {
    return 'expired'
  }
  if (error.status === 403 || code === '42501' || msg.includes('row-level security')) return 'forbidden'
  return null
}

/**
 * Runs a Supabase read. Falls back to fixtures when the backend is simply not seeded,
 * but refuses to do so when the failure was about credentials.
 *
 * The session is checked first: an unauthenticated read of an RLS-protected table
 * returns zero rows rather than an error, which would otherwise be indistinguishable
 * from an empty table and would quietly put demo numbers in front of a signed-out user.
 */
async function readOrMock<T>(run: () => PromiseLike<QueryShape>, fallback: T[]): Promise<Omit<Loaded<T>, 'loading'>> {
  if (!(await accessToken())) {
    return { rows: [], source: 'demo', error: null, access: 'expired' }
  }
  try {
    const { data, error } = await run()
    if (error) {
      const access = classifyDbError(error)
      if (access) return { rows: [], source: 'demo', error: null, access }
      return { rows: fallback, source: 'demo', error: error.message, access: null }
    }
    const rows = (data ?? []) as T[]
    if (rows.length === 0) return { rows: fallback, source: 'demo', error: null, access: null }
    return { rows, source: 'live', error: null, access: null }
  } catch (e) {
    return { rows: fallback, source: 'demo', error: e instanceof Error ? e.message : 'read failed', access: null }
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

export function useSession(sessionId: string | undefined): {
  row: SessionRow | null
  source: DataSource
  loading: boolean
  access: AccessProblem | null
} {
  const [state, setState] = useState<{
    row: SessionRow | null
    source: DataSource
    loading: boolean
    access: AccessProblem | null
  }>({
    row: null,
    source: 'demo',
    loading: true,
    access: null,
  })
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void readOrMock<SessionRow>(
      () => supabase.from('sessions').select('*').eq('id', sessionId).limit(1),
      MOCK_SESSIONS.filter((s) => s.id === sessionId),
    ).then((r) => {
      if (alive) setState({ row: r.rows[0] ?? null, source: r.source, loading: false, access: r.access })
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
  access: AccessProblem | null
  /** Local optimistic patch, so the demo reacts instantly even with no endpoint behind it. */
  patchProposal: (patch: Partial<ProposalRow>) => void
} {
  const [inquiry, setInquiry] = useState<InquiryRow | null>(null)
  const [proposal, setProposal] = useState<ProposalRow | null>(null)
  const [source, setSource] = useState<DataSource>('demo')
  const [loading, setLoading] = useState(true)
  const [access, setAccess] = useState<AccessProblem | null>(null)

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
      setAccess(inq.access ?? pro.access)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [inquiryId])

  const patchProposal = useCallback((patch: Partial<ProposalRow>) => {
    setProposal((p) => (p ? { ...p, ...patch } : p))
  }, [])

  return { inquiry, proposal, source, loading, access, patchProposal }
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

/**
 * Why a call failed. `not_deployed` and `network` mean the backend is not there yet,
 * which is safe to simulate around during the build. The rest mean the backend IS
 * there and said no, which must never be simulated around.
 */
export type ApiFailure = 'unauthorized' | 'forbidden' | 'unavailable' | 'not_deployed' | 'network' | 'error'

export interface ApiOutcome<T> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
  failure: ApiFailure | null
}

/** A refusal from a live backend. Callers must surface these, never fake past them. */
export function isAccessFailure(failure: ApiFailure | null): failure is 'unauthorized' | 'forbidden' | 'unavailable' {
  return failure === 'unauthorized' || failure === 'forbidden' || failure === 'unavailable'
}

/** Only `not_deployed` and `network` justify showing a simulated result. */
export function isMissingBackend(failure: ApiFailure | null): boolean {
  return failure === 'not_deployed' || failure === 'network'
}

const FAILURE_MESSAGE: Record<Exclude<ApiFailure, 'not_deployed' | 'network'>, string> = {
  unauthorized: 'Your session has expired. Sign in again to continue.',
  forbidden: 'This account is not allowed to act on these records.',
  unavailable: 'The server is missing its database settings, so it cannot verify your session.',
  error: 'The request failed.',
}

/**
 * POSTs to a Netlify function with the caller's Supabase access token attached.
 *
 * Every /api/group/* route verifies the token and checks profiles.role against the
 * same rule RLS enforces, so an unauthenticated call is a 401 rather than a data leak.
 * The header goes on every admin call, not only the group ones, so no future endpoint
 * is accidentally left anonymous.
 *
 * Callers get a structured outcome instead of a thrown error, and `failure` tells them
 * whether falling back to a simulated result is honest or a lie.
 */
export async function postJson<T>(path: string, body: unknown): Promise<ApiOutcome<T>> {
  const token = await accessToken()
  if (!token) {
    return { ok: false, status: 401, data: null, error: FAILURE_MESSAGE.unauthorized, failure: 'unauthorized' }
  }
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (res.ok) return { ok: true, status: res.status, data: parsed as T, error: null, failure: null }

    const failure: ApiFailure =
      res.status === 401
        ? 'unauthorized'
        : res.status === 403
          ? 'forbidden'
          : res.status === 503
            ? 'unavailable'
            : res.status === 404
              ? 'not_deployed'
              : 'error'

    const serverMessage =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : typeof parsed === 'string' && parsed.trim()
          ? parsed
          : null

    return {
      ok: false,
      status: res.status,
      data: null,
      error: isAccessFailure(failure) ? FAILURE_MESSAGE[failure] : (serverMessage ?? `HTTP ${res.status}`),
      failure,
    }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : 'network error', failure: 'network' }
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
