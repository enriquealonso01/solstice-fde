/**
 * An inquiry Sol takes on the phone must survive a cold start, and must not become a way to email
 * a row of asterisks.
 *
 * `create_inquiry` always persisted the row, but nothing read the `inquiries` table back: every
 * reader returned the generated dataset plus a module-level Map that dies with the lambda. So the
 * split-screen beat — caller phones in, row appears on the sales board — worked only while one
 * warm instance served both halves, and INQ-2011 was missing from production when the Tester
 * looked.
 *
 * Rehydrating fixes that, and creates the risk these tests exist to pin down: the persisted
 * payload stores the contact MASKED, because the screen never needs the real address. The
 * asymmetry is deliberate and load-bearing.
 *
 *   masked pair present  -> the rules can see we have a way to reach this customer
 *   real pair null       -> `routeFor` returns 'human', so delivery hands off instead of sending
 *
 * If a later change ever populates `email` or `phone` here from the payload, a proposal would be
 * "delivered" to `+*******7788`. That is what the third test is for.
 */
import { describe, expect, it } from 'vitest'
import { rehydrateInquiryRow, type PersistedInquiryRow } from '../../../../netlify/functions/group/_deps'
import { routeFor } from '../../../../netlify/functions/_delivery/config'

/** Shaped exactly like what `persistInquiry` writes, masked contact and all. */
const ROW: PersistedInquiryRow = {
  inquiry_code: 'INQ-2011',
  source: 'voice',
  missing_fields: [],
  payload: {
    company_name: 'Cypress Ridge Reunion',
    contact_name: 'Dana Alvarez',
    contact_email: null,
    contact_phone: '+*******7788',
    event_type: 'reunion',
    preferred_property_code: 'SOL-TPA',
    property_name: 'Solstice Tampa Bayshore',
    alternate_property_ok: false,
    arrival_date: '2026-10-09',
    departure_date: '2026-10-11',
    nights: 2,
    rooms_requested: 20,
    room_type_preference: null,
    requested_discount_pct: 10,
    stated_budget_per_night: null,
    meeting_space_needed: false,
    meeting_capacity_needed: null,
    special_requests: null,
    date_received: '2026-09-25',
  },
}

describe('a phoned-in inquiry rehydrated from Postgres', () => {
  it('comes back with the fields the sales board renders', () => {
    const entry = rehydrateInquiryRow(ROW)
    expect(entry).not.toBeNull()

    expect(entry?.inquiry).toMatchObject({
      inquiry_id: 'INQ-2011',
      source: 'voice',
      company_name: 'Cypress Ridge Reunion',
      preferred_property_code: 'SOL-TPA',
      arrival_date: '2026-10-09',
      departure_date: '2026-10-11',
      rooms_requested: 20,
      requested_discount_pct: 10,
    })
    expect(entry?.context.nights).toBe(2)
  })

  it('keeps the masked pair, so the rules still see a reachable customer', () => {
    const contact = rehydrateInquiryRow(ROW)?.contact
    expect(contact?.phone_masked).toBe('+*******7788')

    // This is the expression `contactPresent()` evaluates in tools.ts.
    const present = Boolean(
      contact?.email || contact?.phone || contact?.email_masked || contact?.phone_masked,
    )
    expect(present).toBe(true)
  })

  it('never yields a real address, so delivery routes to a human instead of sending', () => {
    const contact = rehydrateInquiryRow(ROW)?.contact

    expect(contact?.email).toBeNull()
    expect(contact?.phone).toBeNull()
    expect(routeFor({ email: contact?.email, phone: contact?.phone })).toBe('human')
  })

  it('does not resurrect an unmasked address even if one is somehow in the payload', () => {
    const leaky: PersistedInquiryRow = {
      ...ROW,
      payload: { ...ROW.payload, contact_phone: '+13055557788', contact_email: 'dana@example.com' },
    }
    const contact = rehydrateInquiryRow(leaky)?.contact

    expect(contact?.email).toBeNull()
    expect(contact?.phone).toBeNull()
    expect(routeFor({ email: contact?.email, phone: contact?.phone })).toBe('human')
  })

  it('refuses a row with no payload rather than inventing an empty inquiry', () => {
    expect(rehydrateInquiryRow({ ...ROW, payload: null })).toBeNull()
  })

  it('falls back to portal for a source value it does not recognise', () => {
    const odd = rehydrateInquiryRow({ ...ROW, source: 'carrier-pigeon' })
    expect(odd?.inquiry.source).toBe('portal')
  })
})
