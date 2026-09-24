// INQ-2004 is the deliberately incomplete inquiry: no dates, an approximate room count, AV
// requested with no capacity figure. The correct behaviour is to ask, not to guess, so the
// gap has to be detected at build time and carried on the record.

import { describe, it, expect } from 'vitest'

import {
  getInquiry,
  getInquiryDeliveryTarget,
  listInquiries,
  listInquiriesWithDatasetNotes,
  MISSING_FIELD_PROMPTS,
} from '../../../netlify/functions/_lib/data'

describe('INQ-2004 missing-field detection', () => {
  const inquiry = getInquiry('INQ-2004')!

  it('exists and is not actionable', () => {
    expect(inquiry).toBeDefined()
    expect(inquiry.is_actionable).toBe(false)
  })

  it('names exactly the blocking gaps', () => {
    expect(inquiry.missing_fields).toEqual([
      'arrival_date',
      'departure_date',
      'rooms_requested',
      'meeting_capacity_needed',
    ])
  })

  it('treats "around 25" as unconfirmed, not as 25', () => {
    expect(inquiry.rooms_requested).toBeNull()
    expect(inquiry.rooms_requested_raw).toBe('around 25')
    expect(inquiry.rooms_requested_approx).toBe(25)
    expect(inquiry.incomplete_fields).toContain('rooms_requested_is_approximate')
  })

  it('asks for meeting capacity because meeting space was requested', () => {
    expect(inquiry.meeting_space_needed).toBe(true)
    expect(inquiry.meeting_capacity_needed).toBeNull()
  })

  it('does not treat the missing phone as blocking, because an email is on file', () => {
    expect(inquiry.missing_fields).not.toContain('contact_channel')
    expect(inquiry.contact_email_masked).toBe('j***@meridianwp.com')
    expect(inquiry.incomplete_fields).toContain('contact_phone')
  })

  it('has a question ready for every blocking gap', () => {
    for (const field of inquiry.missing_fields) {
      expect(MISSING_FIELD_PROMPTS[field], field).toBeTruthy()
    }
  })
})

describe('the other nine inquiries are complete', () => {
  it('INQ-2004 is the only one with missing fields', () => {
    const blocked = listInquiries().filter((i) => i.missing_fields.length > 0)
    expect(blocked.map((i) => i.inquiry_id)).toEqual(['INQ-2004'])
  })

  it('all ten rows are present and typed', () => {
    const inquiries = listInquiries()
    expect(inquiries).toHaveLength(10)
    for (const inquiry of inquiries) {
      expect(inquiry.inquiry_id).toMatch(/^INQ-20\d{2}$/)
      expect(inquiry.source).toBe('portal')
      expect(typeof inquiry.alternate_property_ok).toBe('boolean')
      expect(Array.isArray(inquiry.missing_fields)).toBe(true)
      expect(inquiry.is_actionable).toBe(inquiry.missing_fields.length === 0)
    }
  })
})

describe('what the agent is allowed to see', () => {
  it('listInquiries strips the challenge author’s commentary', () => {
    for (const inquiry of listInquiries()) {
      expect(inquiry).not.toHaveProperty('dataset_notes')
    }
    // It is still there for our own evaluation harness.
    const raw = listInquiriesWithDatasetNotes().find((i) => i.inquiry_id === 'INQ-2004')!
    expect(raw.dataset_notes).toMatch(/clarifying questions/i)
  })

  it('strips raw contact details and leaves the masked pair', () => {
    const inquiry = getInquiry('INQ-2001')!
    expect(inquiry.contact_email).toBeNull()
    expect(inquiry.contact_phone).toBeNull()
    expect(inquiry.contact_email_masked).toBe('b***@harlowvance.com')
    expect(inquiry.contact_phone_masked).toBe('***-***-2211')
  })
})

describe('delivery targets', () => {
  it('resolves the real address for the send path only', () => {
    const target = getInquiryDeliveryTarget('INQ-2001')!
    expect(target.channel).toBe('email')
    expect(target.address).toBe('bcruz@harlowvance.com')
    expect(target.masked).toBe('b***@harlowvance.com')
  })

  it('returns null for an inquiry that does not exist', () => {
    expect(getInquiryDeliveryTarget('INQ-9999')).toBeNull()
  })

  it('every inquiry in the provided data is reachable somehow', () => {
    for (const inquiry of listInquiries()) {
      expect(getInquiryDeliveryTarget(inquiry.inquiry_id), inquiry.inquiry_id).not.toBeNull()
    }
  })
})
