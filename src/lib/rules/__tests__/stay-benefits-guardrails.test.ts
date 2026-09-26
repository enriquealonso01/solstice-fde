/**
 * Late checkout, upgrades and amenity requests against the tool-context clock.
 *
 * Only Platinum's 2 PM checkout may be promised (Policy 6, no inventory involved). Anything that
 * hangs on same-day inventory is offered as eligible, subject to availability, because the only
 * inventory source is simulated. A cancelled or checked-out stay gets nothing and no inventory lookup.
 *
 * Reservations used (data/generated/reservations.json):
 *   R55015  G10004 Michael Chen, Platinum, SOL-AUS, Deluxe King, 2026-09-05 to 09-07
 *   R55022  G10021 Wei Zhang, Gold, SOL-AUS, Deluxe King, 2027-03-12 to 03-15 (the only future stay)
 *   R55003  G10003, Gold, SOL-AUS, Deluxe King, 2026-07-18 to 07-21
 *   R55005  G10005, SOL-NSH, 2026-06-06 to 06-08, Cancelled
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as inventory from '../../../../netlify/functions/tools/availability'
import { stayPhase, type ToolArgs, type ToolContext } from '../../../../netlify/functions/tools/helpers'
import { bookAmenity, checkLateCheckout, checkUpgradeEligibility } from '../../../../netlify/functions/tools/stayBenefits'

const KNOBS = ['AVAILABILITY_MODE', 'AVAILABILITY_OVERRIDES'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(KNOBS.map((k) => [k, process.env[k]]))
  for (const k of KNOBS) delete process.env[k]
})

afterEach(() => {
  for (const k of KNOBS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.restoreAllMocks()
})

type Tool = (args: ToolArgs, ctx: ToolContext) => ReturnType<typeof checkLateCheckout>

async function run(tool: Tool, args: ToolArgs, now: string, guestId?: string) {
  const result = await tool(args, { channel: 'chat', session_id: 'test-stay-benefits', now, guest_id: guestId })
  expect(result.ok, `tool failed: ${result.error}`).toBe(true)
  return { grounded: result.grounded, data: result.data as Record<string, unknown> }
}

const BEFORE_R55015 = '2026-09-01T12:00:00Z'
const DURING_R55015 = '2026-09-06T09:00:00Z'
const AFTER_R55015 = '2026-09-26T12:00:00Z'
const PROMISE_WORDS = /confirmed|guaranteed/i

describe('R55015 (Platinum) upgrade before check-in', () => {
  it('is eligible subject to availability, never promised', async () => {
    const { data } = await run(checkUpgradeEligibility, { reservation_id: 'R55015' }, BEFORE_R55015)
    expect(data.tier).toBe('Platinum')
    expect(data.target_room_class).toBe('Suite')
    expect(data.may_promise).toBe(false)
    expect(data.decision).toBe('eligible_subject_to_availability')
    expect(String(data.human_reason)).toMatch(/subject to same-day availability/)
    expect(String(data.human_reason)).toMatch(/at check-in on 2026-09-05.*front desk confirms on arrival/)
    expect(String(data.human_reason)).not.toMatch(PROMISE_WORDS)
  })

  it('keeps the simulated provenance in the payload, and no figure', async () => {
    const { data } = await run(checkUpgradeEligibility, { reservation_id: 'R55015' }, BEFORE_R55015)
    expect((data.availability as Record<string, unknown>).provenance).toBe('simulated_inventory_service')
    expect(JSON.stringify(data)).not.toMatch(/rooms_available|total_rooms|occupancy/)
  })

  it("carries G10004's staff note that the suite upgrade is not guaranteed, from R55004, once verified", async () => {
    const { data } = await run(checkUpgradeEligibility, { reservation_id: 'R55015' }, BEFORE_R55015, 'G10004')
    const directives = data.staff_directives as string[]
    expect(directives.some((d) => d.startsWith('R55004:') && /Suite upgrade is NOT guaranteed/.test(d))).toBe(true)
    expect(data.staff_directives_are_internal).toBe(true)
  })

  it("keeps the guest's other stays' notes out until the caller is verified as that guest", async () => {
    const { data } = await run(checkUpgradeEligibility, { reservation_id: 'R55015' }, BEFORE_R55015)
    expect(data.staff_directives).toEqual(['R55015: Second, unrelated trip for the same guest as R55004.'])
  })
})

describe('a stay that has checked out', () => {
  const tools: Array<[string, Tool, ToolArgs]> = [
    ['check_upgrade_eligibility', checkUpgradeEligibility, { reservation_id: 'R55015' }],
    ['check_late_checkout', checkLateCheckout, { reservation_id: 'R55015', requested_time: '2pm' }],
    ['check_late_checkout (unparseable time)', checkLateCheckout, { reservation_id: 'R55015', requested_time: 'noon' }],
    ['book_amenity', bookAmenity, { reservation_id: 'R55015', amenity: 'ground floor room' }],
  ]

  it.each(tools)('%s refuses it, grounded, with no inventory lookup', async (_name, tool, args) => {
    const lookup = vi.spyOn(inventory, 'sameDayAvailability')

    const { grounded, data } = await run(tool, args, AFTER_R55015, 'G10004')

    expect(grounded).toBe(true)
    expect(data.decision).toBe('stay_ended')
    expect(data.status).toBe('stay_ended')
    expect(data.may_promise).toBe(false)
    expect(String(data.human_reason)).toMatch(/that stay has ended \(checked out 2026-09-07\)/i)
    expect(JSON.stringify(data)).not.toContain('simulated_inventory_service')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('is checked against a live stay too, so the spy above can see a lookup', async () => {
    const lookup = vi.spyOn(inventory, 'sameDayAvailability')
    await run(checkUpgradeEligibility, { reservation_id: 'R55015' }, BEFORE_R55015)
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('is what a verified guest id resolves to when the guest has nothing current', async () => {
    const { data } = await run(checkUpgradeEligibility, { guest_id: 'G10004' }, AFTER_R55015)
    expect(data.reservation_id).toBe('R55015')
    expect(data.decision).toBe('stay_ended')
  })

  it('still counts checkout day as in house, and ends the day after', async () => {
    const onCheckoutDay = await run(checkLateCheckout, { reservation_id: 'R55015', requested_time: '2pm' }, '2026-09-07T08:00:00Z')
    expect(onCheckoutDay.data.decision).toBe('guaranteed')
    const dayAfter = await run(checkLateCheckout, { reservation_id: 'R55015', requested_time: '2pm' }, '2026-09-08T08:00:00Z')
    expect(dayAfter.data.decision).toBe('stay_ended')
  })
})

describe('a cancelled reservation', () => {
  const tools: Array<[string, Tool, ToolArgs]> = [
    ['check_upgrade_eligibility', checkUpgradeEligibility, { reservation_id: 'R55005' }],
    ['check_late_checkout', checkLateCheckout, { reservation_id: 'R55005', requested_time: '1pm' }],
    ['book_amenity', bookAmenity, { reservation_id: 'R55005', amenity: 'connecting rooms' }],
  ]

  it.each(tools)('%s refuses it before its dates, with no inventory lookup', async (_name, tool, args) => {
    const lookup = vi.spyOn(inventory, 'sameDayAvailability')
    const { data } = await run(tool, args, '2026-06-01T12:00:00Z')
    expect(data.decision).toBe('reservation_cancelled')
    expect(data.may_promise).toBe(false)
    expect(String(data.human_reason)).toMatch(/that reservation was cancelled/i)
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('Platinum 2 PM late checkout', () => {
  it.each([
    ['in house', DURING_R55015],
    ['upcoming', BEFORE_R55015],
  ])('is promised while the stay is %s, with no inventory lookup', async (_phase, now) => {
    const lookup = vi.spyOn(inventory, 'sameDayAvailability')
    const { data } = await run(checkLateCheckout, { reservation_id: 'R55015', requested_time: '2pm' }, now)
    expect(data.decision).toBe('guaranteed')
    expect(data.may_promise).toBe(true)
    expect(data.availability).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('is not promised past 2 PM', async () => {
    const { data } = await run(checkLateCheckout, { reservation_id: 'R55015', requested_time: '4pm' }, DURING_R55015)
    expect(data.decision).toBe('needs_front_desk')
    expect(data.may_promise).toBe(false)
  })
})

describe('Gold benefits (R55022, the only future stay)', () => {
  const TODAY = '2026-09-26T12:00:00Z'

  it.each(['simulated', 'sold_out', 'wide_open'])(
    'offers the 1 PM late checkout subject to availability under AVAILABILITY_MODE=%s',
    async (mode) => {
      process.env.AVAILABILITY_MODE = mode
      const { data } = await run(checkLateCheckout, { reservation_id: 'R55022', requested_time: '1pm' }, TODAY)
      expect(data.tier).toBe('Gold')
      expect(data.decision).toBe('eligible_subject_to_availability')
      expect(data.may_promise).toBe(false)
      expect((data.availability as Record<string, unknown>).provenance).toBe('simulated_inventory_service')
      expect(String(data.human_reason)).toMatch(/subject to same-day availability; the front desk confirms on arrival/)
      expect(String(data.human_reason)).not.toMatch(PROMISE_WORDS)
    },
  )

  it.each(['simulated', 'sold_out', 'wide_open'])(
    'offers the upgrade to a Suite subject to availability under AVAILABILITY_MODE=%s',
    async (mode) => {
      process.env.AVAILABILITY_MODE = mode
      const { data } = await run(checkUpgradeEligibility, { reservation_id: 'R55022' }, TODAY)
      expect(data.target_room_class).toBe('Suite')
      expect(data.decision).toBe('eligible_subject_to_availability')
      expect(data.may_promise).toBe(false)
      expect(String(data.human_reason)).toMatch(/at check-in on 2027-03-12, subject to same-day availability/)
      expect(String(data.human_reason)).not.toMatch(PROMISE_WORDS)
    },
  )
})

describe('a guest already in house (R55003, Gold)', () => {
  it('is offered the upgrade "today"', async () => {
    const { data } = await run(checkUpgradeEligibility, { reservation_id: 'R55003' }, '2026-07-19T12:00:00Z')
    expect(data.decision).toBe('eligible_subject_to_availability')
    expect(String(data.human_reason)).toMatch(/Suite today, subject to same-day availability; the front desk confirms today/)
  })

  it('has late checkout settled on the checkout day, not before', async () => {
    const midStay = await run(checkLateCheckout, { reservation_id: 'R55003', requested_time: '1pm' }, '2026-07-19T12:00:00Z')
    expect(String(midStay.data.human_reason)).toMatch(/the front desk confirms on 2026-07-21/)
    const checkoutDay = await run(checkLateCheckout, { reservation_id: 'R55003', requested_time: '1pm' }, '2026-07-21T08:00:00Z')
    expect(String(checkoutDay.data.human_reason)).toMatch(/the front desk confirms today/)
  })
})

describe('stayPhase', () => {
  it('reads the UTC calendar date, since the data carries no property timezone', () => {
    expect(stayPhase('2027-03-12', '2027-03-15', new Date('2027-03-11T23:59:00Z'))).toBe('upcoming')
    // 19:30 the evening before in Austin is already the check-in date in UTC.
    expect(stayPhase('2027-03-12', '2027-03-15', new Date('2027-03-12T00:30:00Z'))).toBe('in_house')
    expect(stayPhase('2027-03-12', '2027-03-15', new Date('2027-03-16T00:30:00Z'))).toBe('ended')
  })
})

describe('inventory-dependent amenity requests', () => {
  it('are requested subject to availability, never confirmed', async () => {
    const { data } = await run(bookAmenity, { reservation_id: 'R55022', amenity: 'connecting rooms' }, '2026-09-26T12:00:00Z')
    expect(data.status).toBe('requested')
    expect((data.availability as Record<string, unknown>).provenance).toBe('simulated_inventory_service')
    expect(String(data.human_reason)).toMatch(/subject to same-day availability; the front desk confirms on arrival/)
    expect(String(data.human_reason)).not.toMatch(PROMISE_WORDS)
  })
})
