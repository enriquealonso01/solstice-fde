// The transfer target now has three places it can come from, in order:
// app_settings.supervisor_forward_phone (super-admin editable, Settings page) →
// TELNYX_TRANSFER_TARGET → DEMO_PHONE. These tests pin that order, because the order IS the
// behaviour: a hotel changing the number in Settings must win over anything baked into the
// deploy, and an empty/cleared row must fall back exactly as before migration 008.

import { afterEach, describe, expect, it } from 'vitest'
import { transferToHuman } from '../../../../netlify/functions/tools/escalation'
import type { ToolContext } from '../../../../netlify/functions/tools/helpers'

const fields = (result: { data?: unknown }): Record<string, unknown> => (result.data ?? {}) as Record<string, unknown>

/** A voice context whose database answers with the given app_settings row (or nothing). */
function voiceWithDb(row: { value: string } | null): ToolContext {
  return {
    channel: 'voice',
    session_id: 'sess-1',
    db: {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: row }),
        }),
      }),
    },
  } as unknown as ToolContext
}

const voiceNoDb = (): ToolContext => ({ channel: 'voice', session_id: 'sess-1' }) as ToolContext

const ENV_KEYS = ['TELNYX_TRANSFER_TARGET', 'DEMO_PHONE', 'TELNYX_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) savedEnv[k] = process.env[k]

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('supervisor transfer target precedence (migration 008)', () => {
  it('the app_settings row wins over the deploy environment', async () => {
    process.env.TELNYX_TRANSFER_TARGET = '+19995550001'
    process.env.TELNYX_API_KEY = 'test-key'
    const data = fields(await transferToHuman({ reason: 'Guest asks for a manager', escalation_id: 'ESC-1' }, voiceWithDb({ value: '+13055550100' })))
    expect(data.transfer_available).toBe(true)
    expect(data.target).toBe('+13055550100')
  })

  it('a cleared row falls back to the deploy environment', async () => {
    process.env.TELNYX_TRANSFER_TARGET = '+19995550001'
    process.env.TELNYX_API_KEY = 'test-key'
    const data = fields(await transferToHuman({ reason: 'Guest asks for a manager', escalation_id: 'ESC-1' }, voiceWithDb(null)))
    expect(data.transfer_available).toBe(true)
    expect(data.target).toBe('+19995550001')
  })

  it('no database client at all still behaves as before (env only)', async () => {
    delete process.env.TELNYX_TRANSFER_TARGET
    process.env.DEMO_PHONE = '+19995550002'
    process.env.TELNYX_API_KEY = 'test-key'
    const data = fields(await transferToHuman({ reason: 'Guest asks for a manager', escalation_id: 'ESC-1' }, voiceNoDb()))
    expect(data.transfer_available).toBe(true)
    expect(data.target).toBe('+19995550002')
  })

  it('an empty-string row is treated as cleared, not as a dialable target', async () => {
    delete process.env.TELNYX_TRANSFER_TARGET
    process.env.DEMO_PHONE = '+19995550002'
    process.env.TELNYX_API_KEY = 'test-key'
    const data = fields(await transferToHuman({ reason: 'Guest asks for a manager', escalation_id: 'ESC-1' }, voiceWithDb({ value: '' })))
    expect(data.target).toBe('+19995550002')
  })
})
