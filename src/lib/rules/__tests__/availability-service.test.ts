/**
 * The net-new service, run rather than described.
 *
 * `netlify/functions/tools/availability.ts` is the one capability this project ADDED rather than
 * derived from the provided exports: Policies 1 and 6 both hang on same-day availability, and the
 * exports carry room counts but no inventory-by-date. It is named in five reader-facing places --
 * `README.md` twice, `SUBMISSION.md`, `agent/sol.md`, `docs/architecture.drawio` and the in-app
 * Backend map -- and before this file **nothing ran it**. The two tests that mentioned it,
 * `tool-naming` and `diagram-guide`, are about *strings*; `tool-naming` says so itself.
 *
 * It is also the stage control for the best refusal in the demo, which is why this is worth more
 * than a coverage number. `check_upgrade_eligibility` asks it whether a Suite is free; when the
 * answer is no, a Platinum guarantee turns into `policy_gap_manager_decision` and Sol hands the
 * call to a manager instead of promising a room. **If that branch inverted, it would not fail
 * loudly -- Sol would confirm a suite in front of the panel.** So the beat itself is asserted here,
 * both ways round, not just the primitive underneath it.
 *
 * Everything here is hermetic: the property and reservation records are compiled into the bundle
 * from `data/`, there is no network and no database, and the module's only inputs besides its
 * arguments are two environment variables, saved and restored around every case.
 *
 * Written after reading the module rather than against it: at the time of writing it is correct on
 * every branch. These cases exist so it stays that way.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Property } from '../../../../shared/types'
import { listProperties } from '../../../../netlify/functions/_lib/data'
import {
  availabilityByClass,
  houseOccupancy,
  roomsOfClass,
  sameDayAvailability,
  type AvailabilitySnapshot,
} from '../../../../netlify/functions/tools/availability'
import { ROOM_CLASS_LADDER } from '../../../../netlify/functions/tools/rules'
import { checkUpgradeEligibility } from '../../../../netlify/functions/tools/stayBenefits'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

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

  /**
   * The source-level half of "deterministic". The module's own comment promises a figure that is
   * "stable across runs and platforms" and that a supervisor sees the same number the guest was
   * told; a clock or an RNG anywhere in it would break that quietly, and the cases above would
   * still pass for a value that changes once a day.
   */
  it('contains no clock and no random source', () => {
    const src = readFileSync(resolve(repoRoot, 'netlify/functions/tools/availability.ts'), 'utf8')
    for (const forbidden of ['Math.random', 'Date.now', 'new Date(']) {
      expect(
        src.includes(forbidden),
        `availability.ts uses ${forbidden}. Its contract is that the same property, date and class ` +
          `always yield the same figure -- a demo is reproducible and a supervisor sees what the guest ` +
          `was told. A clock or an RNG breaks that without failing anything.`,
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
      'the override path no longer says the figure was pinned. A number a human chose, presented as a ' +
        'simulation output with no note, is the one dishonest thing this service could do.',
    ).toMatch(/pinned by AVAILABILITY_OVERRIDES/)
  })

  it('across every class at once, through availabilityByClass', () => {
    const byClass = availabilityByClass(denver(), '2026-07-20')
    expect(Object.keys(byClass).sort()).toEqual([...ROOM_CLASS_LADDER].sort())
    for (const roomClass of ROOM_CLASS_LADDER) carriesProvenance(byClass[roomClass], roomClass)
  })
})

describe('houseOccupancy, which gates late checkout and early check-in', () => {
  it('is a fraction, and agrees with the by-class figures it is built from', () => {
    const den = denver()
    const occupancy = houseOccupancy(den, '2026-07-20')
    expect(occupancy).toBeGreaterThan(0)
    expect(occupancy).toBeLessThanOrEqual(1)

    let total = 0
    let available = 0
    for (const snap of Object.values(availabilityByClass(den, '2026-07-20'))) {
      total += snap.total_rooms
      available += snap.rooms_available
    }
    expect(occupancy).toBeCloseTo((total - available) / total, 10)
  })

  it('is a full house under sold_out and a quiet one under wide_open', () => {
    process.env.AVAILABILITY_MODE = 'sold_out'
    expect(houseOccupancy(denver(), '2026-07-20')).toBe(1)
    process.env.AVAILABILITY_MODE = 'wide_open'
    expect(houseOccupancy(denver(), '2026-07-20')).toBeLessThan(0.5)
  })
})

/**
 * The beat, driven end to end.
 *
 * R55004 is the Platinum reservation the cheat sheet's row-one walkthrough uses: SOL-DEN, a Deluxe
 * King, so the next class up the ladder is a Suite. In default simulated mode SOL-DEN has **no
 * Suite free** on that stay date, so Policy 6's guarantee meets the gap Policy 6 itself admits to,
 * and the tool refuses and escalates. The cheat sheet calls this "the better moment of the two".
 *
 * The inversion is what makes this worth asserting: flip the service to `wide_open` and the same
 * reservation returns `guaranteed` with `may_promise: true`. That is the proof the decision is
 * really driven by the inventory service and not by the tier alone -- and it is what would happen
 * on stage, silently, if the sold-out branch regressed.
 */
describe('the Platinum upgrade refusal is this service talking', () => {
  const ctx = { channel: 'chat', session_id: 'test-availability' } as ToolContext
  const upgrade = (id = 'R55004') => checkUpgradeEligibility({ reservation_id: id }, ctx)

  it('refuses and escalates in the mode the demo actually runs in', async () => {
    const result = await upgrade()
    expect(result.ok, `check_upgrade_eligibility failed: ${result.error}`).toBe(true)
    const data = result.data as Record<string, unknown>

    expect(data.tier, 'R55004 is no longer a Platinum stay, so this beat needs re-pointing').toBe('Platinum')
    expect(data.target_room_class, 'the next class up from a Deluxe King is no longer a Suite').toBe('Suite')
    expect(
      data.decision,
      `the Platinum upgrade beat returned ${JSON.stringify(data.decision)} with no environment override ` +
        `set. The rehearsed moment is the refusal: Policy 6 guarantees the next class "based on same-day ` +
        `inventory", there is no Suite free, and Sol hands it to the manager on duty. If this now says ` +
        `"guaranteed", the panel watches Sol promise a suite.`,
    ).toBe('policy_gap_manager_decision')
    expect(data.may_promise).toBe(false)
    expect(data.escalation_required).toBe(true)
    expect(data.policy_gap).toBe(true)

    // The refusal must carry the inventory snapshot, because that is what lets Sol say suites are
    // showing sold out without inventing it.
    const availability = data.availability as AvailabilitySnapshot & { rooms_available: number }
    expect(availability.rooms_available).toBe(0)
    expect(availability.provenance).toBe('simulated_inventory_service')
    expect(String(availability.assumption)).toMatch(/no inventory-by-date/i)
  })

  it('inverts to a guaranteed upgrade when the service says there is a room', async () => {
    process.env.AVAILABILITY_MODE = 'wide_open'
    const data = (await upgrade()).data as Record<string, unknown>
    expect(
      data.decision,
      'with inventory available, Platinum should get the guarantee Policy 6 actually grants. If this ' +
        'stays a refusal, the decision is not reading the inventory service at all and the case above ' +
        'proves nothing.',
    ).toBe('guaranteed')
    expect(data.may_promise).toBe(true)
  })

  it('refuses under the sold_out switch as well, which is the control for the beat', async () => {
    process.env.AVAILABILITY_MODE = 'sold_out'
    const data = (await upgrade()).data as Record<string, unknown>
    expect(data.decision).toBe('policy_gap_manager_decision')
    expect(data.may_promise).toBe(false)
  })

  it('never promises the upgrade in the words of the refusal', async () => {
    process.env.AVAILABILITY_MODE = 'sold_out'
    const data = (await upgrade()).data as Record<string, unknown>
    const reason = String(data.human_reason)
    expect(reason).toMatch(/manager on duty/i)
    expect(reason.toLowerCase()).toContain('do not promise')
  })
})
