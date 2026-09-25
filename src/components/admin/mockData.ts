// Demo fixtures for every admin surface.
//
// Why this file exists: the admin UI must be demonstrable before the voice webhook,
// the chat runtime, the rules engine and the delivery adapter all land. Every screen
// reads Supabase first and falls back to these rows, flagging itself as `demo` in the
// header so nobody on the panel mistakes a fixture for a live row.
//
// Shapes here mirror `supabase/schema.sql` exactly, so swapping the fallback out is a
// deletion, not a rewrite.

import type { Channel, ProposalLine, RuleVerdict, StaffRole } from '../../../shared/types'

// ---------------------------------------------------------------- row shapes

export type SessionStatus = 'active' | 'ended' | 'taken_over'
export type MessageRole = 'user' | 'assistant' | 'system' | 'supervisor'

export interface SessionRow {
  id: string
  channel: Channel
  guest_id: string | null
  guest_label: string | null
  phone_masked: string | null
  status: SessionStatus
  intent: string | null
  call_control_id: string | null
  telnyx_conversation_id: string | null
  started_at: string
  ended_at: string | null
}

export interface MessageRow {
  id: string
  session_id: string
  role: MessageRole
  content: string
  created_at: string
}

export interface ToolInvocationRow {
  id: string
  session_id: string
  tool: string
  args_masked: Record<string, unknown>
  result_summary: string | null
  grounded: boolean | null
  latency_ms: number | null
  created_at: string
}

/** Parsed requirements as the group agent extracted them. Stored in `inquiries.payload`. */
export interface InquiryPayload {
  company_name: string
  contact_name: string
  contact_email: string | null
  contact_phone: string | null
  event_type: string
  preferred_property_code: string
  property_name: string
  alternate_property_ok: boolean
  arrival_date: string | null
  departure_date: string | null
  nights: number | null
  rooms_requested: number | null
  room_type_preference: string | null
  requested_discount_pct: number | null
  stated_budget_per_night: number | null
  meeting_space_needed: boolean
  meeting_capacity_needed: number | null
  special_requests: string | null
}

export interface InquiryRow {
  id: string
  inquiry_code: string
  source: 'portal' | 'voice' | 'manual'
  payload: InquiryPayload
  missing_fields: string[]
  status: string
  created_at: string
}

export interface Pricing {
  line_items: ProposalLine[]
  subtotal_cents: number
  discount_pct: number
  discount_cents: number
  total_cents: number
  /** Present when the rules engine had to move off the requested discount. */
  requested_discount_pct?: number
}

export interface ProposalRow {
  id: string
  inquiry_id: string
  status: 'draft' | 'awaiting_approval' | 'approved' | 'sent' | 'rejected'
  verdicts: RuleVerdict[]
  pricing: Pricing
  pdf_path: string | null
  sent_via: 'email' | 'sms' | null
  sent_to: string | null
  sent_at: string | null
  created_at: string
  /** Generated proposal copy. Not yet a column; rendered from `pricing` when absent. */
  body?: string
}

export interface MemberRow {
  id: string
  email: string
  full_name: string | null
  role: StaffRole
  created_at: string
}

export interface InviteRow {
  id: string
  email: string
  granted_role: StaffRole
  status: string
  created_at: string
}

export interface AuditRow {
  id: string
  /** `audit_log.actor` is a uuid; a display name needs a join that does not exist yet. */
  actor?: string | null
  actor_label?: string | null
  action: string
  subject: string
  detail: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------- helpers

const NOW = Date.now()
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

/** rooms x nights x nightly rate, in integer cents. Arithmetic never touches floats. */
function line(room_type: string, rooms: number, nights: number, nightly_rate_cents: number, discount_pct = 0): ProposalLine {
  const nightly_net_cents = Math.round(nightly_rate_cents * (1 - discount_pct / 100))
  return {
    room_type,
    rooms,
    nights,
    nightly_rate_cents,
    line_total_cents: rooms * nights * nightly_rate_cents,
    nightly_net_cents,
    net_total_cents: rooms * nights * nightly_net_cents,
  }
}

function priced(items: ProposalLine[], discount_pct: number, requested?: number): Pricing {
  const subtotal_cents = items.reduce((sum, i) => sum + i.line_total_cents, 0)
  const discount_cents = Math.round((subtotal_cents * discount_pct) / 100)
  return {
    line_items: items,
    subtotal_cents,
    discount_pct,
    discount_cents,
    total_cents: subtotal_cents - discount_cents,
    ...(requested === undefined ? {} : { requested_discount_pct: requested }),
  }
}

// ---------------------------------------------------------------- sessions

export const MOCK_SESSIONS: SessionRow[] = [
  {
    id: 'ses-2001',
    channel: 'voice',
    guest_id: 'GST-4417',
    guest_label: 'Marcus Doyle',
    phone_masked: '+1 (813) •••-2244',
    status: 'active',
    intent: 'group_inquiry',
    call_control_id: 'v3:demo-call-control-2001',
    telnyx_conversation_id: 'conv-2001',
    started_at: ago(214),
    ended_at: null,
  },
  {
    id: 'ses-2002',
    channel: 'chat',
    guest_id: 'GST-3102',
    guest_label: 'Bethany Cruz',
    phone_masked: null,
    status: 'active',
    intent: 'late_checkout',
    call_control_id: null,
    telnyx_conversation_id: null,
    started_at: ago(97),
    ended_at: null,
  },
  {
    id: 'ses-2003',
    channel: 'voice',
    guest_id: null,
    guest_label: 'Unidentified caller',
    phone_masked: '+1 (312) •••-8890',
    status: 'active',
    intent: 'billing_dispute',
    call_control_id: 'v3:demo-call-control-2003',
    telnyx_conversation_id: 'conv-2003',
    started_at: ago(41),
    ended_at: null,
  },
  {
    id: 'ses-2004',
    channel: 'voice',
    guest_id: 'GST-2288',
    guest_label: 'Nicole Farrow',
    phone_masked: '+1 (614) •••-2288',
    status: 'taken_over',
    intent: 'service_recovery',
    call_control_id: 'v3:demo-call-control-2004',
    telnyx_conversation_id: 'conv-2004',
    started_at: ago(612),
    ended_at: null,
  },
  {
    id: 'ses-2005',
    channel: 'chat',
    guest_id: 'GST-2266',
    guest_label: 'Kevin Marsh',
    phone_masked: null,
    status: 'ended',
    intent: 'cancellation_policy',
    call_control_id: null,
    telnyx_conversation_id: null,
    started_at: ago(3480),
    ended_at: ago(3240),
  },
  {
    id: 'ses-2006',
    channel: 'voice',
    guest_id: 'GST-2233',
    guest_label: 'Sarah Kim',
    phone_masked: '+1 (401) •••-2233',
    status: 'ended',
    intent: 'group_inquiry',
    call_control_id: 'v3:demo-call-control-2006',
    telnyx_conversation_id: 'conv-2006',
    started_at: ago(7800),
    ended_at: ago(7350),
  },
]

export const MOCK_MESSAGES: Record<string, MessageRow[]> = {
  'ses-2001': [
    { id: 'm-1', session_id: 'ses-2001', role: 'assistant', content: "Hi, I'm Sol, I'm here to help with anything you need.", created_at: ago(214) },
    { id: 'm-2', session_id: 'ses-2001', role: 'user', content: "Hi, I'm calling about a block of rooms for a youth sports team in Tampa in October.", created_at: ago(198) },
    { id: 'm-3', session_id: 'ses-2001', role: 'assistant', content: 'Happy to help with that. How many rooms, and which nights are you looking at?', created_at: ago(190) },
    { id: 'm-4', session_id: 'ses-2001', role: 'user', content: 'Forty rooms, October 2nd through the 5th. We were hoping for 22 percent off.', created_at: ago(172) },
    { id: 'm-5', session_id: 'ses-2001', role: 'assistant', content: 'Let me check what I can confirm for you at Solstice Tampa Bayshore.', created_at: ago(164) },
    { id: 'm-6', session_id: 'ses-2001', role: 'assistant', content: 'Forty rooms is above what I can confirm on my own for that property, and 22 percent is past the discount I can approve. I can put this in front of our group sales team today with everything you have told me, and they will come back with a firm number. Would you like me to do that?', created_at: ago(121) },
    { id: 'm-7', session_id: 'ses-2001', role: 'user', content: 'Yes please. My email is on file.', created_at: ago(96) },
    { id: 'm-8', session_id: 'ses-2001', role: 'assistant', content: 'Done. I have created inquiry INQ-2002 and flagged both items for a human decision. Anything else while I have you?', created_at: ago(58) },
  ],
  'ses-2002': [
    { id: 'm-20', session_id: 'ses-2002', role: 'assistant', content: "Hi, I'm Sol, I'm here to help with anything you need.", created_at: ago(97) },
    { id: 'm-21', session_id: 'ses-2002', role: 'user', content: 'Can I get a late checkout Saturday? Confirmation RES-8841.', created_at: ago(84) },
    { id: 'm-22', session_id: 'ses-2002', role: 'assistant', content: 'Let me pull that reservation up.', created_at: ago(80) },
    { id: 'm-23', session_id: 'ses-2002', role: 'assistant', content: 'Found it: Solstice Chicago Riverwalk, checking out Saturday, Standard King. You are Gold, so complimentary late checkout to 2 PM is yours under the loyalty benefits policy. Want me to add it?', created_at: ago(61) },
    { id: 'm-24', session_id: 'ses-2002', role: 'user', content: 'Could I push it to 4 PM instead?', created_at: ago(38) },
    { id: 'm-25', session_id: 'ses-2002', role: 'assistant', content: 'Four is past what the policy lets me confirm on my own, so I would be guessing if I said yes. I can ask the front desk to hold it and have them confirm with you directly.', created_at: ago(19) },
  ],
  'ses-2003': [
    { id: 'm-40', session_id: 'ses-2003', role: 'assistant', content: "Hi, I'm Sol, I'm here to help with anything you need.", created_at: ago(41) },
    { id: 'm-41', session_id: 'ses-2003', role: 'user', content: 'I was charged twice for my stay last week and nobody is picking up at the property.', created_at: ago(28) },
    { id: 'm-42', session_id: 'ses-2003', role: 'assistant', content: 'That should not have happened and I want to get it to somebody who can actually reverse it. Can I take your confirmation number?', created_at: ago(11) },
  ],
  'ses-2004': [
    { id: 'm-60', session_id: 'ses-2004', role: 'assistant', content: "Hi, I'm Sol, I'm here to help with anything you need.", created_at: ago(612) },
    { id: 'm-61', session_id: 'ses-2004', role: 'user', content: 'Our team block in Columbus was split across three floors after I was told it would be together.', created_at: ago(580) },
    { id: 'm-62', session_id: 'ses-2004', role: 'assistant', content: 'I can see the block and the note about keeping the rooms together. I do not have the authority to compensate for that, so I am bringing in a supervisor now.', created_at: ago(520) },
    { id: 'm-63', session_id: 'ses-2004', role: 'system', content: 'Supervisor joined the call in monitor mode.', created_at: ago(480) },
    { id: 'm-64', session_id: 'ses-2004', role: 'system', content: 'Assistant stopped. Supervisor has taken over the call.', created_at: ago(455) },
    { id: 'm-65', session_id: 'ses-2004', role: 'supervisor', content: "Ms. Farrow, this is Dana from the Solstice group desk, I'm taking over from here.", created_at: ago(450) },
  ],
  'ses-2005': [
    { id: 'm-80', session_id: 'ses-2005', role: 'assistant', content: "Hi, I'm Sol, I'm here to help with anything you need.", created_at: ago(3480) },
    { id: 'm-81', session_id: 'ses-2005', role: 'user', content: 'What is the cancellation window on an advance purchase rate?', created_at: ago(3460) },
    { id: 'm-82', session_id: 'ses-2005', role: 'assistant', content: 'Advance Purchase is non-refundable and cannot be cancelled or modified after booking. That is section 2 of the front desk policy reference, so it is not something I can flex.', created_at: ago(3430) },
    { id: 'm-83', session_id: 'ses-2005', role: 'user', content: 'Understood, thanks.', created_at: ago(3300) },
  ],
  'ses-2006': [
    { id: 'm-90', session_id: 'ses-2006', role: 'assistant', content: "Hi, I'm Sol, I'm here to help with anything you need.", created_at: ago(7800) },
    { id: 'm-91', session_id: 'ses-2006', role: 'user', content: 'I need twelve rooms in Providence for a wedding block, August 1st to 3rd.', created_at: ago(7760) },
    { id: 'm-92', session_id: 'ses-2006', role: 'assistant', content: 'Twelve rooms at Solstice Providence Waterplace is within what I can quote. Let me build that for you.', created_at: ago(7700) },
    { id: 'm-93', session_id: 'ses-2006', role: 'assistant', content: 'Proposal INQ-2006 is with the group desk and should reach you by email shortly.', created_at: ago(7400) },
  ],
}

export const MOCK_TOOL_INVOCATIONS: Record<string, ToolInvocationRow[]> = {
  'ses-2001': [
    { id: 't-1', session_id: 'ses-2001', tool: 'classify_intent', args_masked: { utterance: 'block of rooms … Tampa … October' }, result_summary: 'group_inquiry (0.94)', grounded: true, latency_ms: 210, created_at: ago(196) },
    { id: 't-2', session_id: 'ses-2001', tool: 'identify_guest', args_masked: { phone: '+1813•••2244' }, result_summary: 'GST-4417 Marcus Doyle, Silver', grounded: true, latency_ms: 88, created_at: ago(188) },
    { id: 't-3', session_id: 'ses-2001', tool: 'get_property_info', args_masked: { property_code: 'SOL-TPA' }, result_summary: 'Solstice Tampa Bayshore, 210 rooms, auto-approve ≤35, ceiling 15%', grounded: true, latency_ms: 64, created_at: ago(168) },
    { id: 't-4', session_id: 'ses-2001', tool: 'check_availability', args_masked: { property_code: 'SOL-TPA', arrival: '2026-10-02', departure: '2026-10-05', rooms: 40 }, result_summary: 'no inventory-by-date source; returned grounded:false', grounded: false, latency_ms: 42, created_at: ago(160) },
    { id: 't-5', session_id: 'ses-2001', tool: 'evaluate_group_rules', args_masked: { property_code: 'SOL-TPA', rooms: 40, discount_pct: 22 }, result_summary: '2 fail: rooms over auto-approve, discount over ceiling', grounded: true, latency_ms: 31, created_at: ago(151) },
    { id: 't-6', session_id: 'ses-2001', tool: 'create_inquiry', args_masked: { source: 'voice', contact_email: 'm•••@ridgelinesports.org' }, result_summary: 'INQ-2002 created, status flagged', grounded: true, latency_ms: 176, created_at: ago(70) },
  ],
  'ses-2002': [
    { id: 't-20', session_id: 'ses-2002', tool: 'classify_intent', args_masked: { utterance: 'late checkout Saturday' }, result_summary: 'late_checkout (0.97)', grounded: true, latency_ms: 180, created_at: ago(82) },
    { id: 't-21', session_id: 'ses-2002', tool: 'get_reservation', args_masked: { reservation_id: 'RES-8841' }, result_summary: 'SOL-CHI, Standard King, card ••••4417', grounded: true, latency_ms: 74, created_at: ago(78) },
    { id: 't-22', session_id: 'ses-2002', tool: 'get_policy', args_masked: { section: 'loyalty_benefits' }, result_summary: 'Gold: late checkout to 2 PM, complimentary', grounded: true, latency_ms: 52, created_at: ago(70) },
    { id: 't-23', session_id: 'ses-2002', tool: 'check_late_checkout', args_masked: { reservation_id: 'RES-8841', requested_time: '16:00' }, result_summary: 'denied: 4 PM exceeds Gold entitlement, requires front desk', grounded: true, latency_ms: 38, created_at: ago(26) },
  ],
  'ses-2003': [
    { id: 't-40', session_id: 'ses-2003', tool: 'classify_intent', args_masked: { utterance: 'charged twice' }, result_summary: 'billing_dispute (0.91)', grounded: true, latency_ms: 195, created_at: ago(25) },
    { id: 't-41', session_id: 'ses-2003', tool: 'identify_guest', args_masked: { phone: '+1312•••8890' }, result_summary: 'no match on caller ID', grounded: false, latency_ms: 91, created_at: ago(20) },
    { id: 't-42', session_id: 'ses-2003', tool: 'check_comp_authority', args_masked: { category: 'duplicate_charge' }, result_summary: 'agent authority: none, route to front desk manager', grounded: true, latency_ms: 29, created_at: ago(14) },
  ],
  'ses-2004': [
    { id: 't-60', session_id: 'ses-2004', tool: 'get_reservation', args_masked: { reservation_id: 'RES-7712' }, result_summary: 'SOL-CMH block of 28, note: rooms grouped', grounded: true, latency_ms: 80, created_at: ago(575) },
    { id: 't-61', session_id: 'ses-2004', tool: 'check_service_recovery_eligibility', args_masked: { category: 'block_split' }, result_summary: 'eligible, but above agent comp authority', grounded: true, latency_ms: 44, created_at: ago(540) },
    { id: 't-62', session_id: 'ses-2004', tool: 'create_escalation', args_masked: { category: 'authority_exceeded', severity: 'high' }, result_summary: 'ESC-118 opened, authority_required: agm', grounded: true, latency_ms: 132, created_at: ago(525) },
    { id: 't-63', session_id: 'ses-2004', tool: 'transfer_to_human', args_masked: { target: 'supervisor_leg' }, result_summary: 'ai_assistant_stop issued, call still live', grounded: true, latency_ms: 310, created_at: ago(458) },
  ],
  'ses-2005': [
    { id: 't-80', session_id: 'ses-2005', tool: 'get_policy', args_masked: { section: 'cancellation_advance_purchase' }, result_summary: 'non-refundable, no modification after booking', grounded: true, latency_ms: 47, created_at: ago(3450) },
  ],
  'ses-2006': [
    { id: 't-90', session_id: 'ses-2006', tool: 'validate_property_data', args_masked: { property_code: 'SOL-PVD' }, result_summary: 'quarantined base_rate_suite = -395', grounded: true, latency_ms: 22, created_at: ago(7740) },
    { id: 't-91', session_id: 'ses-2006', tool: 'price_block', args_masked: { property_code: 'SOL-PVD', rooms: 12, nights: 2 }, result_summary: '$3,625.20 after 5%', grounded: true, latency_ms: 58, created_at: ago(7690) },
    { id: 't-92', session_id: 'ses-2006', tool: 'generate_proposal', args_masked: { inquiry_code: 'INQ-2006' }, result_summary: 'proposal drafted, PDF stored', grounded: true, latency_ms: 940, created_at: ago(7600) },
  ],
}

// ---------------------------------------------------------------- inquiries

export const MOCK_INQUIRIES: InquiryRow[] = [
  {
    id: 'inq-2001',
    inquiry_code: 'INQ-2001',
    source: 'portal',
    status: 'ready',
    missing_fields: [],
    created_at: ago(9600),
    payload: {
      company_name: 'Harlow & Vance Consulting',
      contact_name: 'Bethany Cruz',
      contact_email: 'bcruz@harlowvance.com',
      contact_phone: '312-555-2211',
      event_type: 'Corporate Retreat',
      preferred_property_code: 'SOL-CHI',
      property_name: 'Solstice Chicago Riverwalk',
      alternate_property_ok: false,
      arrival_date: '2026-09-14',
      departure_date: '2026-09-16',
      nights: 2,
      rooms_requested: 18,
      room_type_preference: 'Standard King',
      requested_discount_pct: 10,
      stated_budget_per_night: 195,
      meeting_space_needed: true,
      meeting_capacity_needed: 20,
      special_requests: 'Need a breakout room for half the group on day 2',
    },
  },
  {
    id: 'inq-2011',
    inquiry_code: 'INQ-2011',
    source: 'voice',
    status: 'ready',
    missing_fields: ['contact_email'],
    created_at: ago(1800),
    payload: {
      company_name: 'Sunbelt Robotics',
      contact_name: 'Dev Raman',
      contact_email: null,
      contact_phone: '+1 (602) •••-4180',
      event_type: 'Engineering Offsite',
      preferred_property_code: 'SOL-PHX',
      property_name: 'Solstice Phoenix Camelback',
      alternate_property_ok: true,
      arrival_date: '2026-11-10',
      departure_date: '2026-11-13',
      nights: 3,
      rooms_requested: 14,
      room_type_preference: 'Standard King',
      requested_discount_pct: 10,
      stated_budget_per_night: 180,
      meeting_space_needed: true,
      meeting_capacity_needed: 30,
      special_requests: 'One room set up as a workshop space for all three days',
    },
  },
  {
    id: 'inq-2009',
    inquiry_code: 'INQ-2009',
    source: 'portal',
    status: 'needs_decision',
    missing_fields: [],
    created_at: ago(5400),
    payload: {
      company_name: 'Camelback Fitness Retreat',
      contact_name: 'Alicia Storm',
      contact_email: 'astorm@camelbackfitness.com',
      contact_phone: '480-555-2211',
      event_type: 'Corporate Retreat',
      preferred_property_code: 'SOL-PHX',
      property_name: 'Solstice Phoenix Camelback',
      alternate_property_ok: false,
      arrival_date: '2026-07-28',
      departure_date: '2026-07-31',
      nights: 3,
      rooms_requested: 15,
      room_type_preference: 'Deluxe King',
      requested_discount_pct: 17,
      stated_budget_per_night: 175,
      meeting_space_needed: true,
      meeting_capacity_needed: 40,
      special_requests: 'Morning yoga sessions need a quiet room, not the main ballroom',
    },
  },
  {
    id: 'inq-2002',
    inquiry_code: 'INQ-2002',
    source: 'voice',
    status: 'flagged',
    missing_fields: [],
    created_at: ago(300),
    payload: {
      company_name: 'Ridgeline Sports Club',
      contact_name: 'Marcus Doyle',
      contact_email: 'mdoyle@ridgelinesports.org',
      contact_phone: '813-555-2244',
      event_type: 'Youth Sports Travel',
      preferred_property_code: 'SOL-TPA',
      property_name: 'Solstice Tampa Bayshore',
      alternate_property_ok: true,
      arrival_date: '2026-10-02',
      departure_date: '2026-10-05',
      nights: 3,
      rooms_requested: 40,
      room_type_preference: 'Standard Double',
      requested_discount_pct: 22,
      stated_budget_per_night: 140,
      meeting_space_needed: false,
      meeting_capacity_needed: null,
      special_requests: 'Traveling with 3 coaches, need rooms grouped on same floor',
    },
  },
  {
    id: 'inq-2007',
    inquiry_code: 'INQ-2007',
    source: 'portal',
    status: 'flagged',
    missing_fields: [],
    created_at: ago(12000),
    payload: {
      company_name: 'Ocean State University Alumni Assoc.',
      contact_name: 'Kevin Marsh',
      contact_email: 'kmarsh@osualumni.edu',
      contact_phone: '401-555-2266',
      event_type: 'Reunion',
      preferred_property_code: 'SOL-PVD',
      property_name: 'Solstice Providence Waterplace',
      alternate_property_ok: true,
      arrival_date: '2026-10-16',
      departure_date: '2026-10-18',
      nights: 2,
      rooms_requested: 20,
      room_type_preference: 'Standard King',
      requested_discount_pct: 10,
      stated_budget_per_night: 150,
      meeting_space_needed: false,
      meeting_capacity_needed: null,
      special_requests: 'Alumni reunion weekend, flexible on exact property if nearby',
    },
  },
  {
    id: 'inq-2010',
    inquiry_code: 'INQ-2010',
    source: 'portal',
    status: 'flagged',
    missing_fields: [],
    created_at: ago(15000),
    payload: {
      company_name: 'Golden State Policy Forum',
      contact_name: 'Evan Rutherford',
      contact_email: 'erutherford@gspforum.org',
      contact_phone: '916-555-2244',
      event_type: 'Conference',
      preferred_property_code: 'SOL-SAC',
      property_name: 'Solstice Sacramento Capitol',
      alternate_property_ok: false,
      arrival_date: '2027-05-04',
      departure_date: '2027-05-06',
      nights: 2,
      rooms_requested: 18,
      room_type_preference: 'Standard King',
      requested_discount_pct: 10,
      stated_budget_per_night: 165,
      meeting_space_needed: true,
      meeting_capacity_needed: 120,
      special_requests: 'Need panel space for 3 concurrent sessions',
    },
  },
  {
    id: 'inq-2008',
    inquiry_code: 'INQ-2008',
    source: 'portal',
    status: 'flagged',
    missing_fields: ['insurance_certificate'],
    created_at: ago(18000),
    payload: {
      company_name: 'Buckeye Valley Marching Band',
      contact_name: 'Nicole Farrow',
      contact_email: 'nfarrow@buckeyevalleyschools.org',
      contact_phone: '614-555-2288',
      event_type: 'Youth Group Travel',
      preferred_property_code: 'SOL-CMH',
      property_name: 'Solstice Columbus Short North',
      alternate_property_ok: false,
      arrival_date: '2026-09-25',
      departure_date: '2026-09-27',
      nights: 2,
      rooms_requested: 28,
      room_type_preference: 'Standard Double',
      requested_discount_pct: 12,
      stated_budget_per_night: 130,
      meeting_space_needed: false,
      meeting_capacity_needed: null,
      special_requests: 'Traveling with students ages 14-18 plus chaperones',
    },
  },
  {
    id: 'inq-2004',
    inquiry_code: 'INQ-2004',
    source: 'portal',
    status: 'awaiting_guest',
    missing_fields: ['contact_phone', 'arrival_date', 'departure_date', 'rooms_requested', 'stated_budget_per_night'],
    created_at: ago(21000),
    payload: {
      company_name: 'Meridian Wealth Partners',
      contact_name: 'J. Ostrander',
      contact_email: 'jostrander@meridianwp.com',
      contact_phone: null,
      event_type: 'Corporate Retreat',
      preferred_property_code: 'SOL-DEN',
      property_name: 'Solstice Denver Union Station',
      alternate_property_ok: false,
      arrival_date: null,
      departure_date: null,
      nights: null,
      rooms_requested: null,
      room_type_preference: null,
      requested_discount_pct: null,
      stated_budget_per_night: null,
      meeting_space_needed: true,
      meeting_capacity_needed: null,
      special_requests: 'Need AV for presentations',
    },
  },
  {
    id: 'inq-2006',
    inquiry_code: 'INQ-2006',
    source: 'voice',
    status: 'sent',
    missing_fields: [],
    created_at: ago(24000),
    payload: {
      company_name: 'Blue Anchor Wedding & Events',
      contact_name: 'Sarah Kim',
      contact_email: 'sarah@blueanchorevents.com',
      contact_phone: '401-555-2233',
      event_type: 'Wedding Block',
      preferred_property_code: 'SOL-PVD',
      property_name: 'Solstice Providence Waterplace',
      alternate_property_ok: false,
      arrival_date: '2026-08-01',
      departure_date: '2026-08-03',
      nights: 2,
      rooms_requested: 12,
      room_type_preference: 'Standard Double',
      requested_discount_pct: 5,
      stated_budget_per_night: 165,
      meeting_space_needed: false,
      meeting_capacity_needed: null,
      special_requests: 'Bride is asking for confirmation this week',
    },
  },
]

export const MOCK_PROPOSALS: Record<string, ProposalRow> = {
  'inq-2001': {
    id: 'pro-2001',
    inquiry_id: 'inq-2001',
    status: 'draft',
    created_at: ago(9400),
    pdf_path: 'proposals/INQ-2001.pdf',
    sent_via: null,
    sent_to: null,
    sent_at: null,
    pricing: priced([line('Standard King', 18, 2, 21900)], 10),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'pass', actual: 18, threshold: 25, human_reason: '18 rooms is inside the 25-room auto-approve limit for Solstice Chicago Riverwalk.' },
      { rule_id: 'group.discount_ceiling', status: 'pass', actual: '10%', threshold: '12%', human_reason: 'The requested 10% discount is inside this property’s 12% auto-approve ceiling.' },
      { rule_id: 'group.lead_time', status: 'pass', actual: '75 days', threshold: '14 days over 25 rooms', human_reason: 'The Chicago two-week lead-time rule only applies over 25 rooms, so it does not bind here.' },
      { rule_id: 'group.blackout_dates', status: 'pass', actual: '2026-09-14 → 2026-09-16', threshold: 'Jul 2–6, Dec 28–Jan 2', human_reason: 'The requested nights fall outside every published blackout window.' },
      { rule_id: 'group.meeting_capacity', status: 'pass', actual: 20, threshold: 300, human_reason: 'A 20-person breakout is well inside the 300-person meeting capacity.' },
      { rule_id: 'group.contact_channel', status: 'pass', actual: 'email on file', threshold: 'email or phone', human_reason: 'A verified email address is present, so the proposal can be delivered by email.' },
    ],
  },
  'inq-2011': {
    id: 'pro-2011',
    inquiry_id: 'inq-2011',
    status: 'draft',
    created_at: ago(1700),
    pdf_path: 'proposals/INQ-2011.pdf',
    sent_via: null,
    sent_to: null,
    sent_at: null,
    pricing: priced([line('Standard King', 14, 3, 16900)], 10),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'pass', actual: 14, threshold: 35, human_reason: '14 rooms is comfortably inside Phoenix’s 35-room auto-approve limit.' },
      { rule_id: 'group.discount_ceiling', status: 'pass', actual: '10%', threshold: '15%', human_reason: 'The 10% discount sits under the 15% ceiling for this property.' },
      { rule_id: 'group.blackout_dates', status: 'pass', actual: '2026-11-10 → 2026-11-13', threshold: 'Jan 15–19, 2027', human_reason: 'November dates are clear of the only blackout window on file.' },
      { rule_id: 'group.meeting_capacity', status: 'pass', actual: 30, threshold: 350, human_reason: 'A 30-person workshop room is far inside the 350-person capacity.' },
      { rule_id: 'group.contact_channel', status: 'flag', actual: 'phone only', threshold: 'email preferred', human_reason: 'This inquiry arrived by phone and no email was captured, so delivery falls back to SMS with a link to the hosted PDF.' },
    ],
  },
  'inq-2009': {
    id: 'pro-2009',
    inquiry_id: 'inq-2009',
    status: 'draft',
    created_at: ago(5200),
    pdf_path: 'proposals/INQ-2009.pdf',
    sent_via: null,
    sent_to: null,
    sent_at: null,
    pricing: priced([line('Deluxe King', 15, 3, 20900)], 15, 17),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'pass', actual: 15, threshold: 35, human_reason: '15 rooms is well inside the 35-room auto-approve limit.' },
      { rule_id: 'group.discount_ceiling', status: 'flag', actual: '17%', threshold: '15%', human_reason: 'The requested 17% is two points over this property’s 15% auto-approve ceiling. Priced at the compliant 15%; going to 17% needs a GM override.' },
      { rule_id: 'group.blackout_dates', status: 'pass', actual: '2026-07-28 → 2026-07-31', threshold: 'Jan 15–19, 2027', human_reason: 'Late July is clear of the published blackout window.' },
      { rule_id: 'group.meeting_capacity', status: 'pass', actual: 40, threshold: 350, human_reason: 'A 40-person quiet room is inside capacity; the request is for a side room, not the ballroom.' },
      { rule_id: 'group.seasonal_rate_window', status: 'pass', actual: 'Jun–Aug off-peak', threshold: 'property note', human_reason: 'Phoenix runs roughly 20% below peak in June–August, which is why the compliant 15% still lands near the stated $175 budget.' },
      { rule_id: 'group.contact_channel', status: 'pass', actual: 'email on file', threshold: 'email or phone', human_reason: 'Email is present, so this can go out by email once a human decides on the discount.' },
    ],
  },
  'inq-2002': {
    id: 'pro-2002',
    inquiry_id: 'inq-2002',
    status: 'awaiting_approval',
    created_at: ago(260),
    pdf_path: null,
    sent_via: null,
    sent_to: null,
    sent_at: null,
    pricing: priced([line('Standard Double', 40, 3, 17900)], 15, 22),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'fail', actual: 40, threshold: 35, human_reason: '40 rooms is above Tampa’s 35-room auto-approve threshold, so a human has to sign this block off.' },
      { rule_id: 'group.discount_ceiling', status: 'fail', actual: '22%', threshold: '15%', human_reason: 'The requested 22% is seven points over the 15% ceiling. Priced at 15%; anything past that is a GM decision.' },
      { rule_id: 'group.blackout_dates', status: 'pass', actual: '2026-10-02 → 2026-10-05', threshold: 'Feb 5–9, 2027', human_reason: 'October is clear of the Tampa blackout window.' },
      { rule_id: 'group.room_grouping_request', status: 'flag', actual: 'same floor requested', threshold: 'not guaranteed', human_reason: 'Same-floor placement cannot be guaranteed at booking. Tampa has a dedicated group check-in lane, which is the honest thing to offer instead.' },
      { rule_id: 'group.contact_channel', status: 'pass', actual: 'email on file', threshold: 'email or phone', human_reason: 'Email captured from the caller during the voice session.' },
    ],
  },
  'inq-2007': {
    id: 'pro-2007',
    inquiry_id: 'inq-2007',
    status: 'draft',
    created_at: ago(11800),
    pdf_path: null,
    sent_via: null,
    sent_to: null,
    sent_at: null,
    pricing: priced([line('Standard King', 20, 2, 15900)], 10),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'fail', actual: 20, threshold: 15, human_reason: '20 rooms is above Providence’s 15-room auto-approve limit, the smallest in the portfolio.' },
      { rule_id: 'group.property_routing', status: 'flag', actual: 'Boston-area sister property', threshold: 'must exist in directory', human_reason: 'The Providence property note routes blocks over 15 rooms to a Boston-area sister property, but no such property exists in our directory. Surface the referral to the guest; do not quote inventory we cannot see.' },
      { rule_id: 'data.quality_quarantine', status: 'flag', actual: 'base_rate_suite = -395', threshold: 'rate > 0', human_reason: 'Providence’s suite rate is negative in the source export. It is quarantined, so suites are excluded from this quote rather than priced off a bad number.' },
      { rule_id: 'group.discount_ceiling', status: 'pass', actual: '10%', threshold: '10%', human_reason: 'The requested 10% is exactly at the ceiling, which is allowed.' },
      { rule_id: 'group.contact_channel', status: 'pass', actual: 'email on file', threshold: 'email or phone', human_reason: 'Email is present for delivery.' },
    ],
  },
  'inq-2010': {
    id: 'pro-2010',
    inquiry_id: 'inq-2010',
    status: 'draft',
    created_at: ago(14800),
    pdf_path: null,
    sent_via: null,
    sent_to: null,
    sent_at: null,
    pricing: priced([line('Standard King', 18, 2, 17900)], 8, 10),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'pass', actual: 18, threshold: 20, human_reason: '18 rooms is inside Sacramento’s 20-room auto-approve limit.' },
      { rule_id: 'group.seasonal_discount_cap', status: 'flag', actual: '10%', threshold: '8% (legislature weeks)', human_reason: 'These dates fall in a state-legislature session week, which caps group discounts at 8% instead of the usual 10%. Priced at 8%; the two-point difference needs a human to accept or escalate.' },
      { rule_id: 'group.blackout_dates', status: 'pass', actual: '2027-05-04 → 2027-05-06', threshold: 'May 3–7, 2027', human_reason: 'Dates overlap the published May window edge and were re-checked against the arrival date; the stay begins after the hold clears.' },
      { rule_id: 'group.meeting_capacity', status: 'pass', actual: 120, threshold: 140, human_reason: '120 attendees across three concurrent sessions fits inside the 140-person capacity.' },
      { rule_id: 'group.contact_channel', status: 'pass', actual: 'email on file', threshold: 'email or phone', human_reason: 'Email is present for delivery.' },
    ],
  },
  'inq-2008': {
    id: 'pro-2008',
    inquiry_id: 'inq-2008',
    status: 'draft',
    created_at: ago(17800),
    pdf_path: null,
    sent_via: null,
    sent_to: null,
    sent_at: null,
    pricing: priced([line('Standard Double', 28, 2, 16900)], 10, 12),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'fail', actual: 28, threshold: 20, human_reason: '28 rooms is above Columbus’s 20-room auto-approve limit.' },
      { rule_id: 'group.discount_ceiling', status: 'flag', actual: '12%', threshold: '10%', human_reason: 'The requested 12% is two points over the 10% ceiling. Priced at 10% pending a decision.' },
      { rule_id: 'group.youth_insurance_certificate', status: 'flag', actual: 'not on file', threshold: 'required before confirming', human_reason: 'Columbus requires a certificate of insurance on file for youth groups before a block can be confirmed. This is a required follow-up, not something to waive.' },
      { rule_id: 'group.blackout_dates', status: 'pass', actual: '2026-09-25 → 2026-09-27', threshold: 'Sep 4–7, 2026', human_reason: 'The requested nights fall after the September blackout window closes.' },
      { rule_id: 'group.contact_channel', status: 'pass', actual: 'email on file', threshold: 'email or phone', human_reason: 'Email is present for delivery.' },
    ],
  },
  'inq-2006': {
    id: 'pro-2006',
    inquiry_id: 'inq-2006',
    status: 'sent',
    created_at: ago(23800),
    pdf_path: 'proposals/INQ-2006.pdf',
    sent_via: 'email',
    sent_to: 'sarah@blueanchorevents.com',
    sent_at: ago(23000),
    pricing: priced([line('Standard Double', 12, 2, 15900)], 5),
    verdicts: [
      { rule_id: 'group.rooms_auto_approve', status: 'pass', actual: 12, threshold: 15, human_reason: '12 rooms is inside Providence’s 15-room auto-approve limit.' },
      { rule_id: 'group.discount_ceiling', status: 'pass', actual: '5%', threshold: '10%', human_reason: 'A 5% discount is half the ceiling for this property.' },
      { rule_id: 'data.quality_quarantine', status: 'flag', actual: 'base_rate_suite = -395', threshold: 'rate > 0', human_reason: 'The suite rate is negative in the source data and stays quarantined. No suites were quoted.' },
      { rule_id: 'group.contact_channel', status: 'pass', actual: 'email on file', threshold: 'email or phone', human_reason: 'Delivered by email on the same day the inquiry arrived.' },
    ],
  },
}

// ---------------------------------------------------------------- staff

export const MOCK_MEMBERS: MemberRow[] = [
  { id: 'usr-1', email: 'concierge@solsticehotels.demo', full_name: 'Dana Whitfield', role: 'concierge', created_at: ago(400000) },
  { id: 'usr-2', email: 'groupsales@solsticehotels.demo', full_name: 'Renee Okafor', role: 'group_sales', created_at: ago(380000) },
  { id: 'usr-3', email: 'admin@solsticehotels.demo', full_name: 'Enrique Alonso', role: 'admin', created_at: ago(500000) },
]

export const MOCK_INVITES: InviteRow[] = [
  { id: 'inv-1', email: 'owen.fitzgerald@solsticehotels.demo', granted_role: 'group_sales', status: 'pending', created_at: ago(86400) },
]

export const MOCK_AUDIT: AuditRow[] = [
  { id: 'aud-1', actor_label: 'Renee Okafor', action: 'proposal.sent', subject: 'INQ-2006', detail: { channel: 'email' }, created_at: ago(23000) },
  { id: 'aud-2', actor_label: 'Sol (agent)', action: 'inquiry.created', subject: 'INQ-2002', detail: { source: 'voice' }, created_at: ago(300) },
  { id: 'aud-3', actor_label: 'Dana Whitfield', action: 'session.taken_over', subject: 'ses-2004', detail: { rung: 'takeover' }, created_at: ago(455) },
]

// ---------------------------------------------------------------- formatting

export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

/**
 * Formats either a calendar date or a timestamp.
 *
 * A Postgres `date` column arrives as "2026-09-14" with no zone. `new Date()` reads that
 * as UTC midnight, and formatting it in any negative-offset zone (Eastern, here) renders
 * the previous day. An arrival date that is one day early on a hotel proposal is the
 * worst detail in this system to get wrong, so date-only values are built in local time
 * and never cross a timezone. Timestamps, which genuinely have a zone, still localise.
 */
export function shortDate(value: string | null): string {
  if (!value) return '—'

  const parts = DATE_ONLY.exec(value)
  if (parts) {
    const local = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    if (Number.isNaN(local.getTime())) return value
    return local.toLocaleDateString('en-US', DATE_FORMAT)
  }

  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', DATE_FORMAT)
}

export function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

/** mm:ss for anything under an hour, h:mm:ss above it. */
export function duration(fromIso: string, toMs: number): string {
  const start = new Date(fromIso).getTime()
  if (Number.isNaN(start)) return '—'
  const total = Math.max(0, Math.floor((toMs - start) / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * The conversation's routing label.
 *
 * `classifying…` asserts work in progress, and that is only true while the conversation is live.
 * On a finished one it claims something that will never happen — and most sessions that carry no
 * intent never ran `classify_intent` at all, so there is nothing in flight to wait for. Pass the
 * status and an ended, unclassified conversation says what it is instead of pretending to be busy.
 *
 * Callers without a status keep the old behaviour, which is correct for a row that is live.
 */
export function intentLabel(intent: string | null, status?: string | null): string {
  if (intent) return intent.replace(/_/g, ' ')
  return status && status !== 'active' ? 'not classified' : 'classifying…'
}

/** Worst verdict wins. Drives the inbox badge and the send lock. */
export function verdictSeverity(verdicts: RuleVerdict[]): 'clear' | 'flag' | 'fail' {
  if (verdicts.some((v) => v.status === 'fail')) return 'fail'
  if (verdicts.some((v) => v.status === 'flag')) return 'flag'
  return 'clear'
}

/**
 * Renders the proposal artifact from structured data when `proposals.body` is absent.
 * Deliberately derived, not stored: the panel can change a rule and watch the copy move.
 */
export function renderProposalBody(inquiry: InquiryRow, proposal: ProposalRow): string {
  const p = inquiry.payload
  const lines = proposal.pricing.line_items
    .map((l) => `  ${l.rooms} x ${l.room_type}, ${l.nights} night(s) at ${money(l.nightly_rate_cents)} = ${money(l.line_total_cents)}`)
    .join('\n')
  const requested = proposal.pricing.requested_discount_pct
  const discountNote =
    requested !== undefined && requested !== proposal.pricing.discount_pct
      ? `\nYou asked about ${requested}%. The rate below reflects ${proposal.pricing.discount_pct}%, which is what we can confirm without a further approval. A member of our team will follow up on the difference.`
      : ''

  return `Dear ${p.contact_name},

Thank you for considering ${p.property_name} for ${p.company_name}'s ${p.event_type.toLowerCase()}.

Here is what we can hold for you:

${lines}

  Subtotal            ${money(proposal.pricing.subtotal_cents)}
  Group discount      -${money(proposal.pricing.discount_cents)}  (${proposal.pricing.discount_pct}%)
  Total               ${money(proposal.pricing.total_cents)}
${discountNote}
Arrival ${shortDate(p.arrival_date)}, departure ${shortDate(p.departure_date)}.${
    p.meeting_space_needed ? `\nMeeting space for ${p.meeting_capacity_needed ?? 'your stated'} attendees is included in this hold.` : ''
  }${p.special_requests ? `\n\nNoted from your request: ${p.special_requests}` : ''}

This proposal is a hold, not a confirmation, until you reply.

Warm regards,
Solstice Hotel Group, Group Sales`
}
