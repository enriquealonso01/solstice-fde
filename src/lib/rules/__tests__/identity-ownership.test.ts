/**
 * The identity verified on the conversation (ctx.guest_id) always wins over what the model passes:
 * a different guest_id is refused, and a booking is returned only to its own verified guest.
 */
import { describe, expect, it } from 'vitest'
import { getReservation } from '../../../../netlify/functions/tools/identity'
import { checkCompAuthority, checkServiceRecoveryEligibility } from '../../../../netlify/functions/tools/recovery'
import { createEscalation } from '../../../../netlify/functions/tools/escalation'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

const base: ToolContext = { channel: 'chat', session_id: 'test-ownership', now: '2026-09-26T12:00:00Z' }
const unverified = base
const asKalinski: ToolContext = { ...base, guest_id: 'G10012' } // holds R55012
const OTHER_GUESTS_BOOKING = 'R55006' // Marcus Webb's

const refusedWithNoData = (result: { ok: boolean; data?: unknown }) => {
  expect(result.ok).toBe(false)
  expect(result.data).toBeUndefined()
}

describe('get_reservation', () => {
  it('refuses an unverified conversation even when handed a reservation id', async () => {
    const result = await getReservation({ reservation_id: 'R55012' }, unverified)
    refusedWithNoData(result)
    expect(JSON.stringify(result)).not.toMatch(/Kalinski|Providence|SOL-PVD|2026-06-20/)
    expect(JSON.stringify(await getReservation({ reservation_id: 'R55099' }, unverified))).toBe(JSON.stringify(result))
  })

  it("refuses another guest's reservation, exactly as it refuses one that does not exist", async () => {
    const other = await getReservation({ reservation_id: OTHER_GUESTS_BOOKING }, asKalinski)
    const missing = await getReservation({ reservation_id: 'R59999' }, asKalinski)
    refusedWithNoData(other)
    expect(other.error).toBe(missing.error?.replace('R59999', OTHER_GUESTS_BOOKING))
    expect(JSON.stringify(other)).not.toMatch(/Webb|Tampa|SOL-TPA/)
  })

  it('refuses a model-supplied guest_id that is not the verified guest', async () => {
    refusedWithNoData(await getReservation({ guest_id: 'G10006' }, asKalinski))
    refusedWithNoData(await getReservation({ reservation_id: 'R55012', guest_id: 'G10006' }, asKalinski))
  })

  it("returns the verified guest's own booking, by id or as their most relevant stay", async () => {
    const byId = await getReservation({ reservation_id: 'R55012' }, asKalinski)
    const relevant = await getReservation({}, asKalinski)
    for (const result of [byId, relevant]) {
      expect(result.ok).toBe(true)
      expect((result.data as { reservation: { reservation_id: string } }).reservation.reservation_id).toBe('R55012')
    }
    expect((await getReservation({ guest_id: 'G10012' }, asKalinski)).ok).toBe(true)
  })
})

describe('check_service_recovery_eligibility', () => {
  it('refuses unverified, another guest’s booking, and a foreign guest_id', async () => {
    refusedWithNoData(await checkServiceRecoveryEligibility({ reservation_id: 'R55012' }, unverified))
    refusedWithNoData(await checkServiceRecoveryEligibility({ reservation_id: OTHER_GUESTS_BOOKING }, asKalinski))
    refusedWithNoData(await checkServiceRecoveryEligibility({ guest_id: 'G10006' }, asKalinski))
  })

  it("answers for the verified guest's own stay", async () => {
    const result = await checkServiceRecoveryEligibility({ reservation_id: 'R55012' }, asKalinski)
    expect(result.ok).toBe(true)
  })
})

describe('tools where a booking is only context', () => {
  const items = [{ description: 'minibar', amount: 45 }]
  const refs = (result: { citations?: Array<{ ref: string }> }) => (result.citations ?? []).map((c) => c.ref)

  it('check_comp_authority still decides the amount, but attaches only the verified guest’s booking', async () => {
    const stranger = await checkCompAuthority({ reservation_id: OTHER_GUESTS_BOOKING, items }, asKalinski)
    expect(stranger.ok).toBe(true)
    expect(refs(stranger)).not.toContain(`reservation:${OTHER_GUESTS_BOOKING}`)
    expect((stranger.data as { staff_directives: string[] }).staff_directives).toEqual([])

    const own = await checkCompAuthority({ reservation_id: OTHER_GUESTS_BOOKING, items }, { ...base, guest_id: 'G10006' })
    expect(refs(own)).toContain(`reservation:${OTHER_GUESTS_BOOKING}`)
  })

  it('check_comp_authority refuses a foreign guest_id', async () => {
    refusedWithNoData(await checkCompAuthority({ guest_id: 'G10006', items }, asKalinski))
  })

  it('create_escalation is never refused for want of verification, and attaches no unproven record', async () => {
    const result = await createEscalation({ summary: 'Guest wants a refund', reservation_id: 'R55012' }, unverified)
    expect(result.ok).toBe(true)
    expect(refs(result)).toEqual(['policy:15'])
  })

  it('create_escalation refuses a foreign guest_id', async () => {
    refusedWithNoData(await createEscalation({ summary: 'Guest wants a refund', guest_id: 'G10006' }, asKalinski))
  })
})
