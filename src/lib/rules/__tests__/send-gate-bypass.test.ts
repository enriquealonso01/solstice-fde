// The approval gate is only as strong as the row it reads.
//
// Every application path into a send funnels through `send_proposal`, which asks `canSend`, and all
// four refused the flagged PRP-2009 against production on 2026-09-25: /api/group/tool,
// /api/group/send, /api/group/proposal-action, and the agent's own send_proposal tool (which never
// even fired — the model read the gate and said so).
//
// But `canSend` decides from `proposal.status`, and RLS granted `group_sales` FOR ALL on the
// proposals table. A signed-in rep could PATCH that column straight from the browser with the
// public anon key:
//
//     PATCH /rest/v1/proposals?id=eq.35632960-…  {"status":"approved"}  -> HTTP 200, row returned
//
// These tests pin the two halves of that chain so neither can quietly come back:
//   1. what `canSend` does with a forged 'approved' status, on the real PRP-2009 verdicts
//   2. that the schema no longer hands the browser a write policy on the gate's own inputs
//
// Migration 004 drops the policies. Whether it has been applied to production is tracked in
// HUMAN_INTERVENTION.md, not here — a test cannot assert the state of a live database it is
// deliberately not allowed to reach.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canSend } from '../../../../netlify/functions/group/store'
import type { RuleVerdict } from '../../../../shared/types'

/** PRP-2009's real verdicts, copied from the production row. One flag, six passes. */
const PRP_2009_VERDICTS = [
  { rule_id: 'GRP-COMPLETENESS', status: 'pass', actual: 'all required details supplied', threshold: 'arrival date, departure date, exact room count and a way to reach the customer', human_reason: 'The customer gave us everything we need to quote: dates, an exact room count, and a way to reach them.' },
  { rule_id: 'GRP-BLACKOUT', status: 'pass', actual: 'July 28, 2026 to July 31, 2026', threshold: 'January 15, 2027 through January 19, 2027', human_reason: 'These dates are clear of every blackout window at Solstice Phoenix Camelback.' },
  { rule_id: 'GRP-ROOMS-CAP', status: 'pass', actual: 15, threshold: 35, human_reason: '15 rooms is within the 35 rooms Solstice Phoenix Camelback lets us sign off on our own.' },
  { rule_id: 'GRP-DISCOUNT-CEILING', status: 'flag', actual: 17, threshold: 15, human_reason: 'The customer asked for 17% off. We can approve up to 15% on our own, so this is 2 points over what we can authorise ourselves, and it needs a named approver to sign it off before it goes out.' },
  { rule_id: 'GRP-MEETING-CAPACITY', status: 'pass', actual: 40, threshold: 350, human_reason: 'Seating 40 people fits comfortably in the 350-person space at Solstice Phoenix Camelback.' },
  { rule_id: 'GRP-INVENTORY', status: 'pass', actual: '15 x Deluxe King', threshold: '45 x Deluxe King in the building', human_reason: 'Solstice Phoenix Camelback has 45 Deluxe King rooms, so a 15-room block fits within the room type they asked for.' },
] as unknown as RuleVerdict[]

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    proposal_id: 'PRP-2009',
    row_id: '35632960-f30f-42dc-8daf-a1786f8ddc66',
    inquiry_id: 'INQ-2009',
    status: 'awaiting_approval',
    verdicts: PRP_2009_VERDICTS,
    approved_by: null,
    approved_at: null,
    rejected_reason: null,
    revision: 1,
    ...overrides,
  } as never
}

describe('the send gate, on the real flagged proposal', () => {
  it('refuses while the flag stands, naming the shortfall', () => {
    const gate = canSend(proposal())
    expect(gate.allowed).toBe(false)
    expect(gate.blocking.map((v) => v.rule_id)).toEqual(['GRP-DISCOUNT-CEILING'])
    expect(gate.human_reason).toContain('17% off')
    expect(gate.human_reason).toContain('15%')
  })

  it('opens the moment the status column says approved, with nobody named', () => {
    // This is the bypass, stated as a fact about the code rather than an accusation. The flag is
    // still there and still blocking; only the status changed. If a client can write that column,
    // it can write this verdict.
    const gate = canSend(proposal({ status: 'approved' }))
    expect(gate.allowed).toBe(true)
    expect(gate.blocking.map((v) => v.rule_id)).toEqual(['GRP-DISCOUNT-CEILING'])
    // And the sentence a rep would read credits an approver who does not exist.
    expect(gate.human_reason).toContain('an authorised approver approved it')
    expect(gate.human_reason).not.toContain('Diego')
  })

  it('refuses a second send and a rejected one, so it is not merely reading the flag', () => {
    expect(canSend(proposal({ status: 'sent' })).allowed).toBe(false)
    expect(canSend(proposal({ status: 'rejected' })).allowed).toBe(false)
  })

  it('allows a clean proposal, so the gate is not a constant refusal', () => {
    const clean = canSend(proposal({ verdicts: PRP_2009_VERDICTS.filter((v) => v.status !== 'flag') }))
    expect(clean.allowed).toBe(true)
    expect(clean.blocking).toEqual([])
  })
})

describe('the schema behind the gate', () => {
  const schema = readFileSync(join(process.cwd(), 'supabase/schema.sql'), 'utf8')
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/004_client_read_only_on_group_tables.sql'),
    'utf8',
  )
  const sql = schema
    .split(String.fromCharCode(10))
    .filter((line) => !line.trim().startsWith('--'))
    .join(String.fromCharCode(10))

  it('hands the browser no write policy on the gate\'s own inputs', () => {
    for (const table of ['proposals', 'inquiries', 'follow_ups']) {
      const forAll = new RegExp(`create policy \\S+\\s+on ${table} for all`, 'i')
      const forWrite = new RegExp(`create policy \\S+\\s+on ${table} for (update|insert|delete)`, 'i')
      expect(sql, `${table} must not grant FOR ALL to a client role`).not.toMatch(forAll)
      expect(sql, `${table} must not grant a client write`).not.toMatch(forWrite)
    }
  })

  it('still lets staff read all three, or the inbox goes blank', () => {
    // Guard the guard: the cheapest way to pass the case above is to delete every policy, which
    // would black out /admin/inquiries entirely.
    for (const table of ['proposals', 'inquiries', 'follow_ups']) {
      expect(sql).toMatch(new RegExp(`create policy \\S+\\s+on ${table} for select`, 'i'))
    }
  })

  it('keeps audit_log insert-only, which is why the blocked sends survived a delete attempt', () => {
    expect(sql).toMatch(/create policy \S+\s+on audit_log for insert/i)
    expect(sql).not.toMatch(/create policy \S+\s+on audit_log for (all|update|delete)/i)
  })

  it('ships a migration that actually drops the three policies', () => {
    for (const policy of ['prop_write', 'inq_write', 'fup_write']) {
      expect(migration).toMatch(new RegExp(`drop policy if exists ${policy}`, 'i'))
    }
  })
})
