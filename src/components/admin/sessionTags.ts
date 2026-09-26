// Supervisor session tags: what a conversation needs from a human, derived from data.
//
// The old badges answered "what row is this" (`active` / `ended` / `Classifying…`). A supervisor
// scanning thirty conversations wants one different question answered: *which of these needs me,
// and in what order?* These four tags answer that, and every one of them is derived from the two
// tables the app already has — `sessions` and `escalations` — never stored, so a change to an
// escalation row re-tags the board on the next Realtime frame without a write to sessions.
//
// The rules, in one place (see deriveSessionTags below for the code):
//
//   Supervisor requested        the session has an OPEN row in `escalations`. That row IS the
//                               request; there is nothing else to interpret.
//   Supervisor attention needed an open escalation a supervisor should see FIRST: urgent severity,
//                               or any open escalation older than ATTENTION_AFTER_MS, or a live
//                               conversation a supervisor is on (taken_over) that has not ended.
//   Handled by Sol              live, nobody asked for a human, no supervisor in control.
//   Finished                    over, and nothing open: ended_at stamped and no open escalation.
//
// Urgency is data, not prose: URGENT_SEVERITIES and ATTENTION_AFTER_MS are exported constants so
// the panel can retune them live the same way as src/lib/rules/thresholds.ts.

import { isLive, type EscalationRow, type SessionRow } from './mockData'

/**
 * The escalation fields the tag logic reads. `EscalationRow` in mockData.ts is the full shape;
 * a structural subset keeps this function honest about what it actually looks at.
 */
export type EscalationTagRow = Pick<EscalationRow, 'session_id' | 'severity' | 'status' | 'created_at'>

export type SessionTag = 'attention' | 'requested' | 'handled' | 'finished'

export const TAG_LABELS: Record<SessionTag, string> = {
  attention: 'Supervisor attention needed',
  requested: 'Supervisor requested',
  handled: 'Handled by Sol',
  finished: 'Finished',
}

/** Tailwind classes stay with the tag so every surface renders the same colour for the same state. */
export const TAG_CHIP_CLASS: Record<SessionTag, string> = {
  attention: 'bg-rose-50 text-rose-800',
  requested: 'bg-amber-50 text-amber-900',
  handled: 'bg-emerald-50 text-emerald-800',
  finished: 'bg-solstice-sand/60 text-solstice-slate',
}

/**
 * Escalation severities that mean "drop everything", as data. The schema default is 'normal' and
 * the escalation tool writes 'critical' | 'high' | 'normal' | 'low'
 * (netlify/functions/tools/rules.ts), so the urgent set is those top two — spelled out rather
 * than assumed by position.
 */
export const URGENT_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high'])

/**
 * How long an open escalation may sit before it escalates ITSELF into the attention bucket.
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
 * Derive the supervisor tags for one session.
 *
 * `now` is injectable so the >24h rule is testable and so one shared clock tick re-tags the whole
 * board at once (SupervisorDashboard passes its useNow() value down).
 *
 * Tags are a LIST on purpose: `requested` + `attention` is the normal combination for an urgent
 * escalation — the session asked for a human AND should be read first. `handled` and `finished`
 * are mutually exclusive with both by construction: each one requires that nothing is open.
 */
export function deriveSessionTags(
  session: Pick<SessionRow, 'id' | 'status' | 'ended_at'>,
  escalations: EscalationTagRow[],
  now: number = Date.now(),
): SessionTag[] {
  const open = openEscalationsFor(session.id, escalations)
  const tags: SessionTag[] = []

  if (open.length > 0) {
    tags.push('requested')
    const pressing = mostPressingEscalation(open, now)
    const urgent = open.some((e) => URGENT_SEVERITIES.has(e.severity ?? ''))
    const stale = pressing !== null && now - new Date(pressing.created_at).getTime() > ATTENTION_AFTER_MS
    // A live conversation a supervisor took over and has not finished is awaiting follow-up by
    // definition: a human is in control and the conversation is still going. Once it has ended
    // (ended_at stamped) the takeover is part of the record, not an open ask — see isLive's doc.
    const awaitingFollowUp = session.status === 'taken_over' && isLive(session)
    if (urgent || stale || awaitingFollowUp) tags.push('attention')
    return tags
  }

  if (session.status === 'taken_over' && isLive(session)) {
    // A supervisor is in control of a live conversation with no escalation row. That still needs
    // attention — it just arrived through the takeover path instead of create_escalation.
    tags.push('attention')
    return tags
  }

  if (isLive(session)) {
    tags.push('handled')
    return tags
  }

  tags.push('finished')
  return tags
}

/** Does a session carry any of the tags a filter button selects? Empty selection = show all. */
export function sessionMatchesTags(tags: SessionTag[], selected: ReadonlySet<SessionTag>): boolean {
  return selected.size === 0 || tags.some((t) => selected.has(t))
}
