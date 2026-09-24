// Regression tests for the supervisor-leg outage of 2026-09-24.
//
// Symptom: clicking Listen created the supervisor leg, then our own webhook answered it, ran
// caller-ID identification against the browser SIP user, started Sol on it, and hung it up two
// seconds later. It read as "Telnyx will not supervise an assistant leg". It was us.
//
// These are pure-function tests precisely so this can never again need a paid phone call to
// verify. Every payload below is the shape Telnyx actually sends.

import { describe, expect, it } from 'vitest'
import { classifyLeg, isGuestCall, phoneDigits, type LegConfig } from './legs'

const CFG: LegConfig = {
  sipConnectionId: '3056182478436828555',
  sipUsername: 'gencredNPClth8ogCJLToFnI7bChjFBKym8YkP4yImOWWSkZT',
  sipUri: 'sip:gencredNPClth8ogCJLToFnI7bChjFBKym8YkP4yImOWWSkZT@sip.telnyx.com',
  phoneNumber: '+13057866217',
}

const supervisorClientState = Buffer.from(
  JSON.stringify({ kind: 'supervisor', session_id: 'sess-1' }),
  'utf8',
).toString('base64')

const guestClientState = Buffer.from(
  JSON.stringify({ kind: 'guest', session_id: 'sess-1' }),
  'utf8',
).toString('base64')

describe('classifyLeg', () => {
  it('flags the outbound supervisor leg by its client_state marker', () => {
    expect(
      classifyLeg(
        { call_control_id: 'a', direction: 'outgoing', client_state: supervisorClientState },
        CFG,
      ),
    ).toBe('supervisor')
  })

  it('THE OUTAGE: flags the inbound leg on the credential connection, which carries NO client_state', () => {
    // This is the payload that broke us. No client_state, direction "incoming", and a `to` that
    // is the browser's SIP user rather than our phone number.
    const payload = {
      call_control_id: 'b',
      direction: 'incoming',
      connection_id: CFG.sipConnectionId,
      from: '+13057866217',
      to: CFG.sipUri,
    }
    expect(classifyLeg(payload, CFG)).toBe('supervisor')
    expect(isGuestCall(payload, CFG)).toBe(false)
  })

  it('flags a leg by SIP connection id alone, even with no `to` and no client_state', () => {
    expect(classifyLeg({ connection_id: CFG.sipConnectionId, direction: 'incoming' }, CFG)).toBe('supervisor')
  })

  it('flags a leg addressed to the bare SIP username', () => {
    expect(classifyLeg({ direction: 'incoming', to: `${CFG.sipUsername}@sip.telnyx.com` }, CFG)).toBe('supervisor')
  })

  it('flags any outgoing leg, since we only ever dial to supervise', () => {
    expect(classifyLeg({ direction: 'outgoing', to: '+13055551234' }, CFG)).toBe('supervisor')
  })

  it('leaves a real inbound guest call alone', () => {
    const payload = {
      call_control_id: 'c',
      direction: 'incoming',
      connection_id: '3056182416092693893', // the call control application
      from: '+13125550148',
      to: '+13057866217',
    }
    expect(classifyLeg(payload, CFG)).toBe('unknown')
    expect(isGuestCall(payload, CFG)).toBe(true)
  })
})

describe('isGuestCall', () => {
  it('accepts the guest leg once it carries our own guest client_state', () => {
    expect(
      isGuestCall(
        { direction: 'incoming', to: '+13057866217', from: '+13125550148', client_state: guestClientState },
        CFG,
      ),
    ).toBe(true)
  })

  it('matches our number regardless of formatting', () => {
    expect(isGuestCall({ direction: 'incoming', to: '305-786-6217' }, CFG)).toBe(true)
    expect(isGuestCall({ direction: 'incoming', to: '13057866217' }, CFG)).toBe(true)
  })

  it('rejects an inbound call addressed to some other number on the account', () => {
    expect(isGuestCall({ direction: 'incoming', to: '+13055550000' }, CFG)).toBe(false)
  })

  it('fails closed on an unfamiliar leg shape with no `to` at all', () => {
    expect(isGuestCall({ direction: 'incoming' }, CFG)).toBe(false)
  })

  it('falls back to direction when the number is not configured yet', () => {
    const unconfigured: LegConfig = { ...CFG, phoneNumber: null }
    expect(isGuestCall({ direction: 'incoming', to: '+13057866217' }, unconfigured)).toBe(true)
    expect(isGuestCall({ direction: 'outgoing', to: '+13057866217' }, unconfigured)).toBe(false)
  })

  it('ignores a malformed client_state instead of throwing', () => {
    expect(() => classifyLeg({ client_state: 'not-base64-json', direction: 'incoming' }, CFG)).not.toThrow()
  })
})

describe('phoneDigits', () => {
  it('normalises to the last ten digits', () => {
    expect(phoneDigits('+13125550148')).toBe('3125550148')
    expect(phoneDigits('312-555-0148')).toBe('3125550148')
    expect(phoneDigits('(312) 555-0148')).toBe('3125550148')
  })

  it('returns null for anything too short to be a number', () => {
    expect(phoneDigits('555')).toBeNull()
    expect(phoneDigits(null)).toBeNull()
    expect(phoneDigits('sip:someone@sip.telnyx.com')).toBeNull()
  })
})
