// Supervisor session tags: what a conversation needs from a human, derived from data.
//
// The old badges answered "what row is this" (`active` / `ended` / `Classifying…`). A supervisor
// scanning thirty conversations wants one different question answered: *which of these needs me,
// and in what order?* Three tags answer that, and every one of them is derived from the two
// tables the app already has — `sessions` and `escalations` — never stored, so a change to an
// escalation row re-tags the board on the next Realtime frame without a write to sessions.
//
// The rules, in one place (see deriveSessionTags below for the code):
//
//   Supervisor needed          the session needs a human: an OPEN row in `escalations` (that row
//                              IS the request; there is nothing else to interpret) OR a live
//                              conversation a supervisor is on (taken_over) that has not ended.
//   Handled by Sol             live, nobody asked for a human, no supervisor in control.
//   Finished                   over, and nothing open: ended_at stamped and no open escalation.
//
// Urgency is still data, not prose: URGENT_SEVERITIES and ATTENTION_AFTER_MS are exported
// constants so the panel can retune them live the same way as src/lib/rules/thresholds.ts. They
// no longer create a second tag — they decide SORTING (attention-first order via
// mostPressingEscalation) and the chip's dot color (red = urgent, amber = normal).

import { isLive, type EscalationRow, type SessionRow } from './mockData'

/**
 * The escalation fields the tag logic reads. `EscalationRow` in mockData.ts is the full shape;
 * a structural subset keeps this function honest about what it actually looks at.
 */
export type EscalationTagRow = Pick<EscalationRow, 'session_id' | 'severity' | 'status' | 'created_at'>

export type SessionTag = 'supervisor' | 'handled' | 'finished'

export const TAG_LABELS: Record<SessionTag, string> = {
  supervisor: 'Supervisor needed',
  handled: 'Handled by Sol',
  finished: 'Finished',
}

/** Tailwind classes stay with the tag so every surface renders the same colour for the same state. */
export const TAG_CHIP_CLASS: Record<SessionTag, string> = {
  supervisor: 'bg-warn-soft text-warn',
  handled: 'bg-good-soft text-good',
  finished: 'bg-line/60 text-muted',
}

/**
 * The matching dot color, so a chip always shows the dot AND the label. The supervisor dot is
 * filled per session: red when the ask is urgent (see supervisorUrgency), amber otherwise.
 */
export const TAG_DOT_CLASS: Record<SessionTag, string> = {
  supervisor: 'bg-warn',
  handled: 'bg-good',
  finished: 'bg-faint',
}

/**
 * Escalation severities that mean "drop everything", as data. The schema default is 'normal' and
 * the escalation tool writes 'critical' | 'high' | 'normal' | 'low'
 * (netlify/functions/tools/rules.ts), so the urgent set is those top two — spelled out rather
 * than assumed by position.
 */
export const URGENT_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high'])

/**
 * How long an open escalation may sit before it sorts to the FRONT of the supervisor queue.
 * 24h: a request no human has touched for a day is no longer a queue entry, it is a problem.
 */
export const ATTENTION_AFTER_MS = 24 * 60 * 60 * 1000

/** Every open escalation row for the session, however severe or old. */
function openEscalationsFor(sessionId: string, escalations: EscalationTagRow[]): EscalationTagRow[] {
  return escalations.filter((e) => e.session_id === sessionId && e.status === 'open')
}

/** The single escalation a supervisor should read first: urgent beats old beats anything. */
export function mostPressingEscalation(
  escalations: EscalationTagRow[],
  now: number,
): EscalationTagRow | null {
  if (escalations.length === 0) return null
  const rank = (e: EscalationTagRow): number => {
    if (URGENT_SEVERITIES.has(e.severity ?? '')) return 0
    if (now - new Date(e.created_at).getTime() > ATTENTION_AFTER_MS) return 1
    return 2
  }
  return [...escalations].sort((a, b) => rank(a) - rank(b))[0]
}

/**
 * Is this session's supervisor ask URGENT (red dot, front of the queue) rather than normal
 * (amber dot)? Urgent means: an open escalation at an urgent severity, an open escalation older
 * than ATTENTION_AFTER_MS, or a live takeover still awaiting follow-up.
 */
export function supervisorUrgency(
  session: Pick<SessionRow, 'id' | 'status' | 'ended_at'>,
  escalations: EscalationTagRow[],
  now: number = Date.now(),
): 'urgent' | 'normal' | null {
  const open = openEscalationsFor(session.id, escalations)
  if (open.length > 0) {
    if (open.some((e) => URGENT_SEVERITIES.has(e.severity ?? ''))) return 'urgent'
    const pressing = mostPressingEscalation(open, now)
    if (pressing !== null && now - new Date(pressing.created_at).getTime() > ATTENTION_AFTER_MS) return 'urgent'
    const awaitingFollowUp = session.status === 'taken_over' && isLive(session)
    return awaitingFollowUp ? 'urgent' : 'normal'
  }
  if (session.status === 'taken_over' && isLive(session)) return 'urgent'
  return null
}

/**
 * Derive the supervisor tag for one session — at most ONE of supervisor/handled/finished.
 *
 * `now` is injectable so the >24h rule is testable and so one shared clock tick re-tags the whole
 * board at once (SupervisorDashboard passes its useNow() value down).
 *
 * `supervisor` covers ANY session that needs a human: an open escalation (any severity or age) or
 * a live conversation a supervisor has taken over. Whether that ask is urgent is a separate
 * question — see supervisorUrgency, which feeds sorting and the chip's dot, not a second tag.
 */
export function deriveSessionTags(
  session: Pick<SessionRow, 'id' | 'status' | 'ended_at'>,
  escalations: EscalationTagRow[],
  now: number = Date.now(),
): SessionTag[] {
  const open = openEscalationsFor(session.id, escalations)

  if (open.length > 0) {
    return ['supervisor']
  }

  if (session.status === 'taken_over' && isLive(session)) {
    // A supervisor is in control of a live conversation with no escalation row. That still needs
    // a human — it just arrived through the takeover path instead of create_escalation.
    return ['supervisor']
  }

  if (isLive(session)) {
    return ['handled']
  }

  return ['finished']
}

/** Does a session carry any of the tags a filter button selects? Empty selection = show all. */
export function sessionMatchesTags(tags: SessionTag[], selected: ReadonlySet<SessionTag>): boolean {
  return selected.size === 0 || tags.some((t) => selected.has(t))
}
