// Policy 7: comps up to the front-desk limit per stay are the desk's call; the items are summed first,
// and anything over the limit, or a full comped night, goes to a manager and may not be promised.
import { describe, expect, it } from 'vitest'
import { checkCompAuthority } from '../../../../netlify/functions/tools/recovery'
import { COMP_AUTHORITY } from '../../../../netlify/functions/tools/rules'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

const ctx = { channel: 'chat', session_id: 'test-comp-authority' } as ToolContext
const LIMIT = COMP_AUTHORITY.front_desk_max_cents / 100

async function decide(args: Record<string, unknown>) {
  const result = await checkCompAuthority({ reservation_id: 'R55006', ...args }, ctx)
  expect(result.ok, result.error).toBe(true)
  return result.data as { authority_required: string; escalation_required: boolean; may_promise: boolean; total_cents: number }
}

describe('check_comp_authority', () => {
  it('lets the front desk act up to and including the limit', async () => {
    expect(await decide({ items: [{ label: 'minibar charge', amount: LIMIT }] })).toMatchObject({
      authority_required: 'front_desk',
      escalation_required: false,
      may_promise: true,
    })
  })

  it('sends one dollar over the limit to the AGM, and forbids promising it', async () => {
    expect(await decide({ items: [{ label: 'minibar charge', amount: LIMIT + 1 }] })).toMatchObject({
      authority_required: 'agm',
      escalation_required: true,
      may_promise: false,
    })
  })

  it('sums items that each fit inside the limit before deciding', async () => {
    const each = Math.ceil(LIMIT * 0.6)
    const d = await decide({ items: [{ label: 'minibar charge', amount: each }, { label: 'late housekeeping', amount: each }] })
    expect(d.total_cents).toBe(2 * each * 100)
    expect(d).toMatchObject({ authority_required: 'agm', escalation_required: true, may_promise: false })
  })

  it('always escalates a full comped night, whatever the amount', async () => {
    expect(await decide({ comp_night: true })).toMatchObject({ escalation_required: true, may_promise: false })
  })

  it('refuses an unknown reservation instead of deciding for it', async () => {
    const result = await checkCompAuthority({ reservation_id: 'R99999', amount: 10 }, ctx)
    expect(result.ok).toBe(false)
  })
})
