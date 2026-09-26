// What the inbox's Rules column is allowed to claim about a row nobody has priced yet.
//
// This exists because the previous attempt asked the wrong question. It tested
// `inquiry.status === 'blocked'`, on the belief that a blocked inquiry arrives carrying that
// status — which is true of `statusFor()` in netlify/functions/group/tools.ts, and false of the
// `inquiries` table the inbox actually reads. Live, that column holds only `new`, `needs_info`,
// `needs_review` and `auto_approvable`; `blocked` never appears in any of the 13 rows, and
// MOCK_INQUIRIES uses `ready`. So the branch was unreachable, the screen went on calling
// INQ-2003 and INQ-2010 "ready to price", and a test that asserted the source shape passed the
// whole time.
//
// So ask the rules engine instead of a status string. It is client-side code, the row carries the
// whole inquiry payload, and it is the same engine that refused these two inquiries in the first
// place:
//
//   "Solstice Austin Congress Ave does not take group blocks between March 10, 2027 through
//    March 19, 2027, and these dates fall inside that window."
//
// One known gap, stated rather than hidden: GRP-DATA-QUALITY blocks pricing only when the engine
// is handed the property master record, and the inbox does not load properties. A row this calls
// "ready to price" can therefore still be refused later over a bad rate on the property. The
// completeness and blackout blockers, which are what fire on real inquiries here, do not need it.

import { evaluateGroupRules, isPriceable } from '@/lib/rules/engine'
import type { InquiryRow } from '@/components/admin/mockData'
import type { GroupInquiry } from '../../../shared/types'

export type RulesChip =
  | { kind: 'missing'; count: number }
  | { kind: 'blocked' }
  | { kind: 'ready' }
  | { kind: 'unknown' }

/**
 * The chip for an inquiry with no proposal against it.
 *
 * `unknown` is deliberate: if the engine throws on a payload, the honest answer is neither "ready
 * to price" (which sends a rep at something pricing may refuse) nor "cannot be priced" (which
 * claims a refusal that never happened).
 */
export function rulesChipFor(inquiry: InquiryRow, asOf: Date = new Date()): RulesChip {
  if (inquiry.missing_fields.length > 0) return { kind: 'missing', count: inquiry.missing_fields.length }
  try {
    const evaluation = evaluateGroupRules({
      // The completeness rules read `missing_fields` off the inquiry itself (completeness.ts:58),
      // and throw if it is absent. The row's own column is the authoritative copy, so hand that
      // over rather than trusting the payload to carry it.
      inquiry: { ...inquiry.payload, missing_fields: inquiry.missing_fields } as unknown as GroupInquiry,
      // The portal payload carries date_received; the typed shape does not name it, and the
      // engine falls back to today when it is absent.
      received_date: (inquiry.payload as { date_received?: string }).date_received ?? null,
      // Same clock as the server, so a past arrival reads as blocked here too.
      as_of: asOf,
    })
    return isPriceable(evaluation) ? { kind: 'ready' } : { kind: 'blocked' }
  } catch {
    return { kind: 'unknown' }
  }
}
