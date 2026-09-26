/**
 * identify_guest verifies only on a pair of factors, and a failed check discloses nothing, not even
 * whether the confirmation number exists.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { identifyGuest, NOT_VERIFIED } from '../../../../netlify/functions/tools/identity'
import { summarize } from '../../../../netlify/functions/tools/registry'
import { getGuest, getProperty, getReservation } from '../../../../netlify/functions/_lib/data'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

const ctx: ToolContext = { channel: 'chat', session_id: 'test-identity', now: '2026-09-26T12:00:00Z' }

const reservation = getReservation('R55012')!
const guest = getGuest(reservation.guest_id)!
const property = getProperty(reservation.property_code)!

/** The raw phone and email on file, read from the provided export so no PII is typed here. */
function onFile(guestId: string): { email: string; phone: string } {
  const csv = readFileSync(resolve(__dirname, '../../../../data/solstice-guest-profiles.csv'), 'utf8')
  const cells = csv.split(/\r?\n/).find((line) => line.startsWith(`${guestId},`))!.split(',')
  return { email: cells[3], phone: cells[4] }
}

const identify = (args: Record<string, unknown>) => identifyGuest(args, ctx)
const verifiedId = (result: Awaited<ReturnType<typeof identifyGuest>>) =>
  (result.data as { verified?: boolean; guest?: { guest_id?: string } }).verified === true
    ? (result.data as { guest: { guest_id: string } }).guest.guest_id
    : null

describe('a confirmation number on its own', () => {
  it('does not verify, and the result names nothing about the booking or the guest', async () => {
    const result = await identify({ confirmation_number: 'R55012' })
    expect(result.data).toEqual(NOT_VERIFIED)
    expect(summarize('identify_guest', result)).toBe('Not verified')

    const serialized = JSON.stringify(result)
    for (const secret of [
      guest.guest_id,
      guest.first_name,
      guest.last_name,
      property.property_name,
      property.city,
      reservation.property_code,
      reservation.check_in_date,
      reservation.check_out_date,
      reservation.status,
    ]) {
      expect(serialized, secret).not.toContain(secret)
    }
  })

  it('answers byte for byte the same for a number that does not exist', async () => {
    const real = JSON.stringify(await identify({ confirmation_number: 'R55012' }))
    expect(JSON.stringify(await identify({ confirmation_number: 'R59999' }))).toBe(real)
    expect(JSON.stringify(await identify({ confirmation_number: 'R59999', last_name: guest.last_name }))).toBe(real)
  })
})

describe('the accepted factor pairs', () => {
  const { email, phone } = onFile(guest.guest_id)

  it('confirmation number + the wrong last name is not verified, and looks like any other failure', async () => {
    const wrong = await identify({ confirmation_number: 'R55012', last_name: 'Bennett' })
    expect(wrong.data).toEqual(NOT_VERIFIED)
  })

  it('confirmation number + the right last name verifies that guest', async () => {
    expect(verifiedId(await identify({ confirmation_number: 'R55012', last_name: guest.last_name }))).toBe(guest.guest_id)
    expect(verifiedId(await identify({ confirmation_number: 'r55012', last_name: guest.last_name.toUpperCase() }))).toBe(guest.guest_id)
  })

  it('accepts the full name the voice tool sends as `name`, in either order', async () => {
    for (const name of [`${guest.first_name} ${guest.last_name}`, `${guest.last_name}, ${guest.first_name}`]) {
      expect(verifiedId(await identify({ confirmation_number: 'R55012', name })), name).toBe(guest.guest_id)
    }
  })

  it('reads a hyphenated surname spoken with a space, or typed with an accent, but never a part of it', async () => {
    expect(verifiedId(await identify({ confirmation_number: 'R55025', last_name: 'Okafor Bailey' }))).toBe('G10024')
    expect(verifiedId(await identify({ confirmation_number: 'R55007', last_name: 'Ramírez' }))).toBe('G10007')
    expect((await identify({ confirmation_number: 'R55025', last_name: 'Okafor' })).data).toEqual(NOT_VERIFIED)
  })

  it('tests one surname per attempt: a list of names does not verify', async () => {
    const result = await identify({ confirmation_number: 'R55012', last_name: `${guest.last_name} Bennett Okoye` })
    expect(result.data).toEqual(NOT_VERIFIED)
  })

  it('confirmation number + the phone on file verifies, in any format', async () => {
    expect(verifiedId(await identify({ confirmation_number: 'R55012', phone }))).toBe(guest.guest_id)
    expect(verifiedId(await identify({ confirmation_number: 'R55012', phone: `+1${phone.replace(/\D/g, '')}` }))).toBe(guest.guest_id)
  })

  it('confirmation number + the email on file verifies', async () => {
    expect(verifiedId(await identify({ confirmation_number: 'R55012', email: email.toUpperCase() }))).toBe(guest.guest_id)
  })

  it('confirmation number + someone else’s phone does not verify', async () => {
    const other = onFile('G10001')
    expect((await identify({ confirmation_number: 'R55012', phone: other.phone })).data).toEqual(NOT_VERIFIED)
  })

  it('confirmation number + only the last four digits of the phone does not verify', async () => {
    expect((await identify({ confirmation_number: 'R55012', phone: phone.slice(-4) })).data).toEqual(NOT_VERIFIED)
  })
})

describe('one factor without a confirmation number', () => {
  const { email, phone } = onFile(guest.guest_id)

  it.each([
    ['a phone number', { phone }],
    ['an email', { email }],
    ['a phone and an email together', { phone, email }],
    ['a full name', { first_name: guest.first_name, last_name: guest.last_name }],
  ])('%s alone discloses nothing', async (_label, args) => {
    const result = await identify(args)
    expect(result.data).toEqual(NOT_VERIFIED)
    expect(JSON.stringify(result)).not.toContain(guest.guest_id)
  })
})

describe('a model-supplied guest_id', () => {
  it('is not a factor: naming a guest id verifies nobody', async () => {
    const result = await identify({ guest_id: guest.guest_id })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(guest.last_name)
  })

  it('cannot replace the guest this conversation verified', async () => {
    const result = await identifyGuest({ guest_id: 'G10001', confirmation_number: 'R55001', last_name: 'Bennett' }, { ...ctx, guest_id: guest.guest_id })
    expect(result.ok).toBe(false)
    expect(result.data).toBeUndefined()
  })

  it('does not re-issue the bound identity without proof', async () => {
    const result = await identifyGuest({ guest_id: guest.guest_id }, { ...ctx, guest_id: guest.guest_id })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(guest.last_name)
  })
})
