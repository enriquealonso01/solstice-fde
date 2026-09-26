// Failure injection: a dependency switched off in demo_flags must take down exactly the tools that
// need it, through the same ungrounded envelope a real outage produces, and leave the rest working.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOffline, OUTAGE_REASON, type FlagKey } from '../../../../netlify/functions/_lib/flags'
import { runTool } from '../../../../netlify/functions/tools/registry'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

vi.mock('../../../../netlify/functions/_lib/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../netlify/functions/_lib/flags')>()),
  isOffline: vi.fn(),
}))

const ctx = { channel: 'chat', session_id: 'test-failure-injection' } as ToolContext

function switchOff(...keys: FlagKey[]) {
  vi.mocked(isOffline).mockImplementation(async (key: FlagKey) => keys.includes(key))
}

beforeEach(() => switchOff())

describe('runTool with a dependency switched off', () => {
  it('refuses late checkout with the PMS offline, ungrounded, without guessing', async () => {
    switchOff('pms_offline')
    const result = await runTool('check_late_checkout', { reservation_id: 'R55022', requested_time: '13:00' }, ctx)
    expect(result.ok).toBe(false)
    expect(result.grounded).toBe(false)
    expect(result.error).toContain(OUTAGE_REASON.pms_offline)
    expect(result.error).toMatch(/do not guess/i)
  })

  it('takes every inventory tool down with the PMS', async () => {
    switchOff('pms_offline')
    for (const name of ['check_late_checkout', 'check_upgrade_eligibility', 'book_amenity']) {
      const result = await runTool(name, {}, ctx)
      expect(result.error, name).toContain(OUTAGE_REASON.pms_offline)
    }
  })

  it('keeps policy answers working while the PMS is offline', async () => {
    switchOff('pms_offline')
    const result = await runTool('get_policy', { section_id: '6' }, ctx)
    expect(result.ok).toBe(true)
    expect(result.grounded).toBe(true)
  })

  it('stops policy answers when the policy source is offline', async () => {
    switchOff('policy_source_offline')
    const result = await runTool('get_policy', { section_id: '6' }, ctx)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(OUTAGE_REASON.policy_source_offline)
  })

  it('leaves a tool with no dependency answering when everything is offline', async () => {
    switchOff('pms_offline', 'reservations_offline', 'policy_source_offline')
    const result = await runTool('get_property_info', { property_code: 'SOL-CHI' }, ctx)
    expect(result.ok).toBe(true)
  })
})
