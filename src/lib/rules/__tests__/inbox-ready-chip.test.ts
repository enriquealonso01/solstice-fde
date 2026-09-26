// The inbox's Rules chip must not tell a rep an inquiry is ready to price when the rules engine has
// refused it. Runs the real decision function over payloads copied from the live rows, whose status
// is never 'blocked'.

import { describe, expect, it } from 'vitest'
import { rulesChipFor } from '@/pages/admin/inboxRulesChip'
import { evaluateGroupRules, isPriceable } from '@/lib/rules/engine'
import type { InquiryRow } from '@/components/admin/mockData'

/** A row shaped like the ones useInquiries() hands the inbox. */
function row(code: string, payload: Record<string, unknown>, missing: string[] = []): InquiryRow {
  return {
    id: `id-${code}`,
    inquiry_code: code,
    source: 'portal',
    status: 'new', // what production actually stores; never 'blocked'
    missing_fields: missing,
    created_at: '2026-07-03T00:00:00Z',
    // Live payloads carry these two alongside the row column; mirror that rather than inventing a
    // cleaner shape than production has.
    payload: (payload ? { ...payload, missing_fields: missing, incomplete_fields: missing } : payload) as unknown as InquiryRow['payload'],
  }
}

/** INQ-2003, live. Complete, and refused by GRP-BLACKOUT on the Austin March window. */
const INQ_2003 = row('INQ-2003', {
  company_name: 'Longhorn Analytics Summit',
  contact_name: 'Priya Vance',
  contact_email: 'pvance@longhornsummit.com',
  contact_phone: '512-555-2277',
  event_type: 'Conference',
  preferred_property_code: 'SOL-AUS',
  alternate_property_ok: false,
  arrival_date: '2027-03-14',
  departure_date: '2027-03-17',
  nights: 3,
  rooms_requested: 30,
  room_type_preference: 'Standard King',
  requested_discount_pct: 12,
  stated_budget_per_night: 210,
  meeting_space_needed: true,
  meeting_capacity_needed: 250,
  special_requests: 'Need full ballroom for keynote sessions',
  date_received: '2026-07-03',
  inquiry_id: 'INQ-2003',
})

/** INQ-2010, live. Complete, no proposal, and also not priceable. */
const INQ_2010 = row('INQ-2010', {
  company_name: 'Golden State Policy Forum',
  contact_name: 'Evan Rutherford',
  contact_email: 'erutherford@gspforum.org',
  contact_phone: '916-555-2244',
  event_type: 'Conference',
  preferred_property_code: 'SOL-SAC',
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
  date_received: '2026-07-12',
  inquiry_id: 'INQ-2010',
})

/** INQ-2004, live. Four missing fields, so the count still wins. */
const INQ_2004 = row(
  'INQ-2004',
  {
    company_name: 'Meridian Wealth Partners',
    contact_name: 'J. Ostrander',
    contact_email: 'jostrander@meridianwp.com',
    contact_phone: null,
    event_type: 'Board Offsite',
    preferred_property_code: 'SOL-DEN',
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
    special_requests: null,
    date_received: '2026-07-04',
    inquiry_id: 'INQ-2004',
  },
  ['arrival_date', 'departure_date', 'rooms_requested', 'meeting_capacity_needed'],
)

/** INQ-2001, live. Complete, and the engine does not block it — the control for the green chip. */
const INQ_2001 = row('INQ-2001', {
  company_name: 'Harlow & Vance Consulting',
  contact_name: 'Bethany Cruz',
  contact_email: 'bcruz@harlowvance.com',
  contact_phone: '312-555-2211',
  event_type: 'Corporate Retreat',
  preferred_property_code: 'SOL-CHI',
  alternate_property_ok: false,
  arrival_date: '2026-09-14',
  departure_date: '2026-09-16',
  nights: 2,
  rooms_requested: 18,
  room_type_preference: 'Standard King',
  requested_discount_pct: 10,
  stated_budget_per_night: 240,
  meeting_space_needed: true,
  meeting_capacity_needed: 20,
  special_requests: 'Need a breakout room for half the group on day 2',
  date_received: '2026-07-01',
  inquiry_id: 'INQ-2001',
})

describe('the inbox Rules chip', () => {
  it('does not call the two live unpriced inquiries ready to price', () => {
    expect(rulesChipFor(INQ_2003)).toEqual({ kind: 'blocked' })
    expect(rulesChipFor(INQ_2010)).toEqual({ kind: 'blocked' })
  })

  it('agrees with the engine that refused them, on the blocker it names', () => {
    // Guard the guard: if this ever stops blocking, the case above starts passing for the wrong
    // reason, so state the premise out loud.
    const evaluation = evaluateGroupRules({
      inquiry: { ...INQ_2003.payload, missing_fields: [] } as never,
      received_date: '2026-07-03',
    })
    expect(isPriceable(evaluation)).toBe(false)
    expect(evaluation.pricing_blocked_by).toContain('GRP-BLACKOUT')
  })

  it('still leads with the missing-field count when fields are missing', () => {
    expect(rulesChipFor(INQ_2004)).toEqual({ kind: 'missing', count: 4 })
  })

  it('does say ready to price for a complete, priceable inquiry', () => {
    // Without this the whole chip could be a constant "cannot be priced" and every other case
    // above would still pass.
    expect(rulesChipFor(INQ_2001)).toEqual({ kind: 'ready' })
  })

  it('does not claim a refusal that never happened when the engine throws', () => {
    const broken = row('INQ-BAD', null as unknown as Record<string, unknown>)
    expect(rulesChipFor(broken)).toEqual({ kind: 'unknown' })
  })
})
