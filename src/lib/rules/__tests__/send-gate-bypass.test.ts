// The approval gate does not trust the row it is handed.
//
// Before migration 004 is applied, RLS still grants `group_sales` FOR ALL on `proposals`, so a
// signed-in rep can PATCH any column straight from the browser with the public anon key:
//
//     PATCH /rest/v1/proposals?id=eq.<row>   {"status":"approved"}   -> HTTP 200, row returned
//
// `canSend` does not open on that column: it re-runs the rules as of today, re-prices the block,
// and wants a signed approval in audit_log for the flags that remain. These cases write the
// columns a browser could write and show that none of them opens the gate. The second half pins
// that the schema no longer hands the browser a write policy on those columns either.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clearAuditMemory } from '../../../../netlify/functions/_delivery/audit'
import {
  canSend,
  getProposal,
  resetProposalStore,
  setClock,
  type AuditReader,
} from '../../../../netlify/functions/group/store'
import { generate_proposal } from '../../../../netlify/functions/group/tools'

// Before INQ-2009's arrival on 2026-07-28, so the date rule does not rot with the calendar.
beforeAll(() => setClock(() => new Date('2026-07-15T12:00:00Z')))
afterAll(() => setClock(null))
beforeEach(() => {
  resetProposalStore()
  clearAuditMemory()
})

/** PRP-2009 as the engine produces it: one flag, the 17% asked against a 15% ceiling. */
async function prp2009() {
  const generated = await generate_proposal({ inquiry_id: 'INQ-2009' })
  return (await getProposal(generated.data!.proposal_id))!
}

describe('the send gate, on the real flagged proposal', () => {
  it('refuses while the flag stands, naming the shortfall', async () => {
    const gate = await canSend(await prp2009())
    expect(gate.allowed).toBe(false)
    expect(gate.needs_approval).toBe(true)
    expect(gate.blocking.map((v) => v.rule_id)).toEqual(['GRP-DISCOUNT-CEILING'])
    expect(gate.human_reason).toContain('17% off')
    expect(gate.human_reason).toContain('15%')
  })

  it('stays shut when the status column says approved and audit_log holds no approval', async () => {
    const p = await prp2009()
    p.status = 'approved'
    p.approved_by = 'someone who never approved it'
    const noApprovals: AuditReader = async () => []
    const gate = await canSend(p, { audit: noApprovals })
    expect(gate.allowed).toBe(false)
    expect(gate.human_reason).toContain('cannot go out yet')
  })

  it('stays shut when a browser inserts its own approval row, because it cannot sign it', async () => {
    const p = await prp2009()
    p.status = 'approved'
    const forged: AuditReader = async () => [
      {
        action: 'proposal.approved',
        detail: { approved_by: 'user-gm', approver_role: 'gm', flags: ['GRP-DISCOUNT-CEILING'], signature: 'made-up' },
      },
    ]
    expect((await canSend(p, { audit: forged })).allowed).toBe(false)
  })

  it('stays shut when the verdicts column is rewritten to all passes', async () => {
    const p = await prp2009()
    p.verdicts = p.verdicts.map((v) => ({ ...v, status: 'pass' as const }))
    expect((await canSend(p)).allowed).toBe(false)
  })

  it('stays shut when the price is typed into the row by hand', async () => {
    // A clean proposal, so no flag is in the way, then its total is edited in the row.
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const p = (await getProposal(generated.data!.proposal_id))!
    expect((await canSend(p)).allowed).toBe(true)
    p.pricing = { ...p.pricing, total_cents: 100 }
    const gate = await canSend(p)
    expect(gate.allowed).toBe(false)
    expect(gate.human_reason).toContain('no longer matches')
  })

  it('refuses a second send and a rejected one', async () => {
    const p = await prp2009()
    expect((await canSend({ ...p, status: 'sent' })).allowed).toBe(false)
    expect((await canSend({ ...p, status: 'rejected' })).allowed).toBe(false)
  })

  it('allows a clean proposal, so the gate is not a constant refusal', async () => {
    const generated = await generate_proposal({ inquiry_id: 'INQ-2001' })
    const clean = await canSend((await getProposal(generated.data!.proposal_id))!)
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
