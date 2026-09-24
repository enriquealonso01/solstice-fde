// Shared domain contracts. Every runtime (chat, voice, tools, UI) imports from here.
// Changing a type here is a cross-cutting change: update callers in the same commit.

export type LoyaltyTier = 'None' | 'Silver' | 'Gold' | 'Platinum'
export type Channel = 'voice' | 'chat'
export type StaffRole = 'concierge' | 'group_sales' | 'admin'

/** Every tool returns this envelope. `grounded:false` obliges the agent to say it
 *  cannot confirm and to escalate, never to improvise. */
export interface ToolResult<T = unknown> {
  ok: boolean
  data?: T
  grounded: boolean
  citations?: Citation[]
  masked_fields?: string[]
  error?: string
  latency_ms?: number
}

export interface Citation {
  source: 'policy' | 'property' | 'reservation' | 'guest' | 'inquiry'
  ref: string          // e.g. "policy:5" or "property:SOL-PVD"
  label: string        // human-readable, rendered in the UI
}

export interface Guest {
  guest_id: string
  first_name: string
  last_name: string
  email_masked: string
  phone_masked: string
  loyalty_tier: LoyaltyTier
  loyalty_points: number
  member_since: string | null
}

export interface Reservation {
  reservation_id: string
  guest_id: string
  property_code: string
  check_in_date: string
  check_out_date: string
  room_type: string
  rate_plan: 'Best Available Rate' | 'Advance Purchase' | 'Corporate Negotiated' | 'Loyalty Redemption'
  nightly_rate: number
  total_nights: number
  status: 'Confirmed' | 'Cancelled' | 'Checked-in' | 'Checked-out' | 'No-show'
  payment_last4: string        // already masked at the data layer, never spoken aloud
  special_requests: string | null
  internal_notes: string | null
}

export interface Property {
  property_code: string
  property_name: string
  city: string
  state: string
  market_type: 'Urban' | 'Resort'
  total_rooms: number
  inventory: Record<string, number>
  base_rate_standard: number
  base_rate_deluxe: number
  base_rate_suite: number
  meeting_space_sqft: number
  max_meeting_capacity: number
  group_block_auto_approve_max_rooms: number
  max_discount_auto_approve_pct: number
  blackout_dates: DateRange[]
  general_manager: string
  notes: string
  data_quality_flags: string[]   // e.g. ["base_rate_suite_negative"] — SOL-PVD is -395
}

export interface DateRange { start: string; end: string }

/** A rule verdict is the atom of the group workflow. Never a free-text opinion. */
export interface RuleVerdict {
  rule_id: string
  status: 'pass' | 'flag' | 'fail'
  actual: string | number
  threshold: string | number
  human_reason: string
}

export interface GroupInquiry {
  inquiry_id: string
  source: 'portal' | 'voice' | 'manual'
  company_name: string
  contact_name: string
  contact_email: string | null
  contact_phone: string | null
  event_type: string
  preferred_property_code: string
  alternate_property_ok: boolean
  arrival_date: string | null
  departure_date: string | null
  rooms_requested: number | null
  room_type_preference: string | null
  requested_discount_pct: number | null
  meeting_capacity_needed: number | null
  special_requests: string | null
  missing_fields: string[]
}

export interface Proposal {
  proposal_id: string
  inquiry_id: string
  status: 'draft' | 'awaiting_approval' | 'approved' | 'sent' | 'rejected'
  verdicts: RuleVerdict[]
  line_items: ProposalLine[]
  subtotal: number
  discount_pct: number
  total: number
  pdf_path: string | null
  sent_via: 'email' | 'sms' | null
  sent_at: string | null
}

/**
 * Every money field carries `_cents` in its NAME and an integer in its value. The previous shape
 * used bare `nightly_rate` / `line_total`, which held dollars while the sibling totals held cents,
 * and the table rendered $197.10 as $1.97. Names that state their unit are the fix.
 *
 * Gross and net are both stored so nothing downstream recomputes either:
 * rack figures sum to `subtotal_cents`, net figures sum to `total_cents`.
 */
export interface ProposalLine {
  room_type: string
  rooms: number
  nights: number
  /** Rack rate, before the group discount. */
  nightly_rate_cents: number
  /** rooms x nights x nightly_rate_cents. Sums to subtotal_cents across lines. */
  line_total_cents: number
  /** Rate after the group discount. */
  nightly_net_cents: number
  /** rooms x nights x nightly_net_cents. Sums to total_cents across lines. */
  net_total_cents: number
}

export interface EscalationPacket {
  escalation_id: string
  session_id: string
  category: 'refund' | 'dispute' | 'medical' | 'legal' | 'safety' | 'authority_exceeded' | 'other'
  severity: 'low' | 'normal' | 'high' | 'critical'
  summary: string
  policy_citations: Citation[]
  attempted_resolutions: string[]
  transcript_excerpt: string
  recommended_action: string
  authority_required: 'front_desk' | 'agm' | 'gm' | 'regional_security'
}
