// The inbox must list a phoned-in inquiry exactly once.
//
// The regression this guards, found in production: `GET /api/group/inquiries` returned 13 rows
// with INQ-2012 listed twice. `handleInquiries` did `[...loadInquiries(), ...createdInquiries()]`,
// but `loadInquiries()` already spreads `registeredInquiries()` — and `createdInquiries()` IS
// `registeredInquiries()`. Every runtime-created inquiry was counted twice.
//
// It stayed latent because it only appears once an inquiry is created and the inbox is read in
// the SAME warm lambda: an inquiry from a dead instance rehydrates from Postgres and appears once.
// That is precisely the split-screen demo — take the call, then look at the board.
//
// NOTE ON WHAT IS NOT TESTED HERE. Driving the real handler would be the better test, but
// `vitest.setup.ts` strips every credential before any test loads (deliberately — see M5), so
// `GET /api/group/inquiries` answers 503 in this environment and an assertion on its rows would
// silently pass while checking nothing. An earlier draft of this file did exactly that. So the
// two guards below test the cause and the call site instead, and say so rather than pretending.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadInquiries,
  registerInquiry,
  registeredInquiries,
  resetRegisteredInquiries,
  resetRehydratedInquiries,
} from '../../../../netlify/functions/group/_deps'
import { createdInquiries } from '../../../../netlify/functions/group/tools'
import type { GroupInquiry } from '../../../../shared/types'

const inquiry = (code: string): GroupInquiry =>
  ({
    inquiry_id: code,
    source: 'voice',
    company_name: 'Vantage Labs',
    contact_name: 'A Caller',
    contact_email: 'caller@example.com',
    contact_phone: null,
    event_type: 'Group booking',
    preferred_property_code: 'SOL-TPA',
    alternate_property_ok: false,
    arrival_date: '2026-10-14',
    departure_date: '2026-10-16',
    rooms_requested: 40,
    room_type_preference: 'Standard King',
    requested_discount_pct: 22,
    meeting_capacity_needed: null,
    special_requests: null,
    missing_fields: [],
  }) as GroupInquiry

beforeEach(() => {
  resetRegisteredInquiries()
  resetRehydratedInquiries()
})
afterEach(() => {
  resetRegisteredInquiries()
  resetRehydratedInquiries()
})

describe('loadInquiries already contains runtime-created inquiries', () => {
  it('returns a phoned-in inquiry exactly once, and concatenating createdInquiries() duplicates it', async () => {
    registerInquiry(inquiry('INQ-9003'))

    // The two lists the handler used to concatenate are the same rows.
    expect(createdInquiries().map((i) => i.inquiry_id)).toEqual(['INQ-9003'])
    expect(registeredInquiries().map((i) => i.inquiry_id)).toEqual(['INQ-9003'])

    const loaded = await loadInquiries()
    expect(loaded.filter((i) => i.inquiry_id === 'INQ-9003')).toHaveLength(1)

    // This is the production bug, reproduced in one line.
    expect([...loaded, ...createdInquiries()].filter((i) => i.inquiry_id === 'INQ-9003')).toHaveLength(2)
  })

  it('no inquiry code is repeated in what loadInquiries returns', async () => {
    registerInquiry(inquiry('INQ-9004'))
    const codes = (await loadInquiries()).map((i) => i.inquiry_id)
    expect(codes.length).toBeGreaterThan(0)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('the call site that caused it', () => {
  // A source-level guard, because the behavioural one cannot run without credentials. It pins the
  // exact mistake: handleInquiries must build its rows from loadInquiries() alone.
  const source = readFileSync(join(process.cwd(), 'netlify/functions/group/index.ts'), 'utf8')
  const handleInquiries = source.slice(
    source.indexOf('async function handleInquiries'),
    source.indexOf('async function handleInquiries') + 700,
  )

  it('handleInquiries does not append createdInquiries() to loadInquiries()', () => {
    expect(handleInquiries).toContain('loadInquiries()')
    expect(handleInquiries).not.toMatch(/\.\.\.\s*createdInquiries\(\)/)
  })

  it('and index.ts no longer imports it, so it cannot drift back in unnoticed', () => {
    expect(source).not.toMatch(/^\s*createdInquiries,\s*$/m)
  })
})
