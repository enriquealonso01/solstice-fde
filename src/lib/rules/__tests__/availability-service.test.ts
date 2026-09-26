/**
 * The simulated same-day inventory service (netlify/functions/tools/availability.ts), run rather
 * than described: deterministic, bounded by the real room counts, driven by its two env knobs, and
 * labelled simulated on every path. The last block checks that its figure never reaches a tool result.
 *
 * Hermetic: records are compiled from data/, with no network and no database. The two env knobs
 * are saved and restored around every case.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Property } from '../../../../shared/types'
import { listProperties } from '../../../../netlify/functions/_lib/data'
import type { ToolResult } from '../../../../shared/types'
import {
  availabilityByClass,
  roomsOfClass,
  sameDayAvailability,
  type AvailabilitySnapshot,
} from '../../../../netlify/functions/tools/availability'
import { ROOM_CLASS_LADDER } from '../../../../netlify/functions/tools/rules'
import { bookAmenity, checkLateCheckout, checkUpgradeEligibility } from '../../../../netlify/functions/tools/stayBenefits'
import type { ToolArgs, ToolContext } from '../../../../netlify/functions/tools/helpers'

const repoRoot = resolve(__dirname, '../../../..')

/** The two runtime knobs. Saved and restored so no case can leak into another. */
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
})

const properties = (): Property[] => listProperties()
const denver = (): Property => {
  const p = properties().find((x) => x.property_code === 'SOL-DEN')
  expect(p, 'SOL-DEN is not in the property records').toBeDefined()
  return p!
}

describe('the simulated inventory service is deterministic', () => {
  it('returns an identical snapshot for the same property, date and class', () => {
    const a = sameDayAvailability(denver(), '2026-07-20', 'Suite')
    const b = sameDayAvailability(denver(), '2026-07-20', 'Suite')
    expect(a).toEqual(b)
  })

  it('is not a constant: the date, the class and the property each move the number', () => {
    const base = sameDayAvailability(denver(), '2026-07-20', 'Standard King')

    const byDate = ['2026-07-21', '2026-07-22', '2026-08-14', '2026-09-02'].map(
      (d) => sameDayAvailability(denver(), d, 'Standard King').rooms_available,
    )
    expect(
      byDate.some((n) => n !== base.rooms_available),
      `every date returned ${base.rooms_available} rooms. A constant would satisfy the determinism case ` +
        `above, so this one exists to say the date is actually an input.`,
    ).toBe(true)

    const otherClass = sameDayAvailability(denver(), '2026-07-20', 'Standard Double')
    expect(otherClass.total_rooms).not.toBe(base.total_rooms)

    const otherProperty = properties().find((p) => p.property_code !== 'SOL-DEN')!
    const elsewhere = sameDayAvailability(otherProperty, '2026-07-20', 'Standard King')
    expect(elsewhere.property_code).not.toBe(base.property_code)
  })

  /** A clock or an RNG would break determinism quietly: the cases above pass for a value that changes daily. */
  it('contains no clock and no random source', () => {
    const src = readFileSync(resolve(repoRoot, 'netlify/functions/tools/availability.ts'), 'utf8')
    for (const forbidden of ['Math.random', 'Date.now', 'new Date(']) {
      expect(
        src.includes(forbidden),
        `availability.ts uses ${forbidden}. Its contract is that the same property, date and class ` +
          `always yield the same figure, so a run is reproducible. A clock or an RNG breaks that without ` +
          `failing anything.`,
      ).toBe(false)
    }
    // Anti-vacuity: prove the file was actually read.
    expect(src).toContain('function sameDayAvailability')
  })
})

describe('every figure is bounded by the real property record', () => {
  it('never exceeds the inventory the records carry, for every property and class', () => {
    let checked = 0
    let withRooms = 0
    const problems: string[] = []

    for (const property of properties()) {
      for (const roomClass of ROOM_CLASS_LADDER) {
        const snap = sameDayAvailability(property, '2026-07-20', roomClass)
        checked += 1
        if (snap.rooms_available > 0) withRooms += 1

        const record = roomsOfClass(property, roomClass)
        const where = `${property.property_code} ${roomClass}`

        if (record !== null && snap.total_rooms !== record) {
          problems.push(`${where}: snapshot says ${snap.total_rooms} rooms, the record says ${record}`)
        }
        if (snap.rooms_available < 0 || snap.rooms_available > snap.total_rooms) {
          problems.push(`${where}: ${snap.rooms_available} available of ${snap.total_rooms}`)
        }
        const expectedOccupancy =
          snap.total_rooms > 0 ? Math.round(((snap.total_rooms - snap.rooms_available) / snap.total_rooms) * 100) : 100
        if (snap.occupancy_pct !== expectedOccupancy) {
          problems.push(`${where}: occupancy ${snap.occupancy_pct}% does not match ${snap.rooms_available}/${snap.total_rooms}`)
        }
      }
    }

    // Anti-vacuity, both directions: the fixture has to be there, and it must not be uniformly
    // sold out, or "available <= total" would be trivially true everywhere.
    expect(checked, 'no property/class pairs were checked, so the bounds proved nothing').toBeGreaterThanOrEqual(
      ROOM_CLASS_LADDER.length * 8,
    )
    expect(
      withRooms,
      'every class at every property came back with zero rooms, which would satisfy the bounds ' +
        'trivially. Either the inventory fixture is empty or the simulation is stuck.',
    ).toBeGreaterThan(checked / 2)

    expect(problems, problems.join('\n')).toEqual([])
  })

  it('reads the class totals off the property record, not from the simulation', () => {
    const den = denver()
    // These are the figures in the provided export, via data/generated. If the data layer ever
    // renamed a key, roomsOfClass would fall through to its fuzzy pass and this would say so.
    for (const roomClass of ROOM_CLASS_LADDER) {
      const record = roomsOfClass(den, roomClass)
      expect(record, `SOL-DEN has no inventory figure for ${roomClass}`).not.toBeNull()
      expect(sameDayAvailability(den, '2026-07-20', roomClass).total_rooms).toBe(record)
    }
  })

  it('still bounds a class that is not on the ladder at all', () => {
    const den = denver()
    const snap = sameDayAvailability(den, '2026-07-20', 'Presidential Penthouse')
    expect(snap.total_rooms).toBeGreaterThan(0)
    expect(snap.total_rooms).toBeLessThanOrEqual(den.total_rooms)
    expect(snap.rooms_available).toBeLessThanOrEqual(snap.total_rooms)
  })
})

describe('the two stage switches Enrique can flip mid-demo', () => {
  it('AVAILABILITY_MODE=sold_out empties the house', () => {
    process.env.AVAILABILITY_MODE = 'sold_out'
    for (const roomClass of ROOM_CLASS_LADDER) {
      const snap = sameDayAvailability(denver(), '2026-07-20', roomClass)
      expect(snap.rooms_available, `${roomClass} is not sold out`).toBe(0)
      expect(snap.occupancy_pct).toBe(100)
      expect(snap.mode).toBe('sold_out')
    }
  })

  it('AVAILABILITY_MODE=wide_open opens it completely', () => {
    process.env.AVAILABILITY_MODE = 'wide_open'
    for (const roomClass of ROOM_CLASS_LADDER) {
      const snap = sameDayAvailability(denver(), '2026-07-20', roomClass)
      expect(snap.rooms_available, `${roomClass} is not wide open`).toBe(snap.total_rooms)
      expect(snap.occupancy_pct).toBe(0)
      expect(snap.mode).toBe('wide_open')
    }
  })

  it('falls back to the simulation when the variable is nonsense, rather than throwing on stage', () => {
    for (const raw of ['', 'SOLD_out ', 'soldout', 'yes', 'true']) {
      process.env.AVAILABILITY_MODE = raw
      const snap = sameDayAvailability(denver(), '2026-07-20', 'Suite')
      const expected = raw.trim().toLowerCase() === 'sold_out' ? 'sold_out' : 'simulated'
      expect(snap.mode, `AVAILABILITY_MODE=${JSON.stringify(raw)} produced mode ${snap.mode}`).toBe(expected)
    }
  })

  it('reports the mode it used, so a snapshot cannot be read out of context', () => {
    expect(sameDayAvailability(denver(), '2026-07-20', 'Suite').mode).toBe('simulated')
  })
})

describe('AVAILABILITY_OVERRIDES pins one beat without a redeploy', () => {
  const den = () => denver()

  it('pins the exact property|date|class key', () => {
    process.env.AVAILABILITY_OVERRIDES = JSON.stringify({ 'SOL-DEN|2026-07-20|Suite': 4 })
    expect(sameDayAvailability(den(), '2026-07-20', 'Suite').rooms_available).toBe(4)
    // and only that key
    expect(sameDayAvailability(den(), '2026-07-21', 'Suite').rooms_available).not.toBe(4)
  })

  it('accepts the looser property|date key for a whole day', () => {
    process.env.AVAILABILITY_OVERRIDES = JSON.stringify({ 'SOL-DEN|2026-08-01': 3 })
    expect(sameDayAvailability(den(), '2026-08-01', 'Standard King').rooms_available).toBe(3)
    expect(sameDayAvailability(den(), '2026-08-01', 'Suite').rooms_available).toBe(3)
  })

  it('clamps a forced number to the rooms that actually exist', () => {
    process.env.AVAILABILITY_OVERRIDES = JSON.stringify({ 'SOL-DEN|2026-07-20|Suite': 999 })
    const snap = sameDayAvailability(den(), '2026-07-20', 'Suite')
    expect(snap.rooms_available).toBe(snap.total_rooms)
    expect(snap.rooms_available, 'a forced figure escaped the real inventory').toBeLessThanOrEqual(
      roomsOfClass(den(), 'Suite')!,
    )
  })

  it('clamps a negative to zero instead of reporting minus rooms', () => {
    process.env.AVAILABILITY_OVERRIDES = JSON.stringify({ 'SOL-DEN|2026-07-20|Suite': -5 })
    expect(sameDayAvailability(den(), '2026-07-20', 'Suite').rooms_available).toBe(0)
  })

  it('beats AVAILABILITY_MODE, which is the documented precedence', () => {
    // Both knobs set at once is a realistic mid-demo state: the mode is flipped for the room, the
    // override pins one beat. The override is read first, and a reviewer who set both should get
    // the specific instruction rather than the general one.
    process.env.AVAILABILITY_MODE = 'sold_out'
    process.env.AVAILABILITY_OVERRIDES = JSON.stringify({ 'SOL-DEN|2026-07-20|Suite': 2 })
    const snap = sameDayAvailability(den(), '2026-07-20', 'Suite')
    expect(snap.rooms_available).toBe(2)
    expect(snap.mode, 'the snapshot should still report the mode that is set').toBe('sold_out')
  })

  it('ignores a malformed value instead of throwing, because this is typed by hand mid-demo', () => {
    for (const raw of ['{', 'null', '[]', '"a string"', '{"SOL-DEN|2026-07-20|Suite": "lots"}', '42']) {
      process.env.AVAILABILITY_OVERRIDES = raw
      const snap = sameDayAvailability(den(), '2026-07-20', 'Suite')
      expect(snap.provenance).toBe('simulated_inventory_service')
      expect(snap.rooms_available).toBeLessThanOrEqual(snap.total_rooms)
    }
  })
})

describe('every snapshot says where it came from', () => {
  const carriesProvenance = (snap: AvailabilitySnapshot, path: string) => {
    expect(snap.provenance, `${path} lost its provenance`).toBe('simulated_inventory_service')
    expect(snap.assumption.length, `${path} carries an empty assumption`).toBeGreaterThan(40)
    expect(snap.assumption, `${path} no longer states the gap it stands in for`).toMatch(/no inventory-by-date/i)
  }

  it('on the simulated path', () => {
    carriesProvenance(sameDayAvailability(denver(), '2026-07-20', 'Suite'), 'simulated')
  })

  it('on both stage modes', () => {
    for (const mode of ['sold_out', 'wide_open']) {
      process.env.AVAILABILITY_MODE = mode
      carriesProvenance(sameDayAvailability(denver(), '2026-07-20', 'Suite'), mode)
    }
  })

  it('and on the override path, which is the one a reviewer reaches on stage', () => {
    process.env.AVAILABILITY_OVERRIDES = JSON.stringify({ 'SOL-DEN|2026-07-20|Suite': 0 })
    const snap = sameDayAvailability(denver(), '2026-07-20', 'Suite')
    carriesProvenance(snap, 'override')
    expect(
      snap.assumption,
      'the override path no longer says the figure was pinned. A number a human chose would then be ' +
        'presented as simulation output with no note.',
    ).toMatch(/pinned by AVAILABILITY_OVERRIDES/)
  })

  it('across every class at once, through availabilityByClass', () => {
    const byClass = availabilityByClass(denver(), '2026-07-20')
    expect(Object.keys(byClass).sort()).toEqual([...ROOM_CLASS_LADDER].sort())
    for (const roomClass of ROOM_CLASS_LADDER) carriesProvenance(byClass[roomClass], roomClass)
  })
})

/**
 * The figure is simulated, so no tool result may carry it or change with it. Every stay below is
 * upcoming on the pinned clock: R55004 Platinum (SOL-DEN, Deluxe King, 2026-07-20), R55015 Platinum
 * (SOL-AUS, Deluxe King, 2026-09-05) and R55022 Gold (SOL-AUS, Deluxe King, 2027-03-12).
 */
describe('the simulated figure never becomes a promise', () => {
  const ctx: ToolContext = { channel: 'chat', session_id: 'test-availability', now: '2026-07-01T12:00:00Z' }
  const MODES = ['simulated', 'sold_out', 'wide_open']

  it.each(MODES)('offers the Platinum upgrade as eligible, never promised, under AVAILABILITY_MODE=%s', async (mode) => {
    process.env.AVAILABILITY_MODE = mode
    const data = (await checkUpgradeEligibility({ reservation_id: 'R55004' }, ctx)).data as Record<string, unknown>
    expect(data.tier).toBe('Platinum')
    expect(data.target_room_class).toBe('Suite')
    expect(data.decision).toBe('eligible_subject_to_availability')
    expect(data.may_promise).toBe(false)
  })

  const cases: Array<[string, (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>, ToolArgs]> = [
    ['check_upgrade_eligibility R55004', checkUpgradeEligibility, { reservation_id: 'R55004' }],
    ['check_upgrade_eligibility R55015', checkUpgradeEligibility, { reservation_id: 'R55015' }],
    ['check_upgrade_eligibility R55022', checkUpgradeEligibility, { reservation_id: 'R55022' }],
    ['check_late_checkout R55022', checkLateCheckout, { reservation_id: 'R55022', requested_time: '1pm' }],
    ['book_amenity R55022', bookAmenity, { reservation_id: 'R55022', amenity: 'connecting rooms' }],
  ]

  it.each(cases)('%s returns the same result under every mode, labelled simulated, with no figure', async (_name, tool, args) => {
    const seen = new Set<string>()
    for (const mode of MODES) {
      process.env.AVAILABILITY_MODE = mode
      const data = { ...((await tool(args, ctx)).data as Record<string, unknown>) }
      delete data.reference // a fresh id on every amenity request
      seen.add(JSON.stringify(data))
    }
    expect(seen.size, 'the result changed with the simulated house').toBe(1)
    const [json] = seen
    expect(json).toContain('simulated_inventory_service')
    expect(json).not.toMatch(/rooms_available|total_rooms|occupancy/)
  })
})
