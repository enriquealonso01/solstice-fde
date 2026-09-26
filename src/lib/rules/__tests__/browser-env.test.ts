// vite.config.ts injects env values into the browser bundle through `define`, bypassing Vite's VITE_
// prefix, so its list is the only boundary between server secrets and every visitor. This builds the
// config with a marker in every credential and checks what would ship.
import { afterEach, describe, expect, it } from 'vitest'
import type { UserConfig } from 'vite'
import viteConfig from '../../../../vite.config'

const SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'ANTHROPIC_API_KEY',
  'TELNYX_API_KEY',
  'TELNYX_PUBLIC_KEY',
  'TELNYX_SIP_PASSWORD',
  'TOOL_WEBHOOK_SECRET',
  'PROPOSAL_LINK_SECRET',
  'DEMO_PASSWORD',
  'NETLIFY_AUTH_TOKEN',
]
const PUBLIC = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']

const saved = new Map<string, string | undefined>()
function setEnv(name: string, value: string) {
  if (!saved.has(name)) saved.set(name, process.env[name])
  process.env[name] = value
}
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  saved.clear()
})

async function shippedDefines(): Promise<string> {
  const config: UserConfig = await viteConfig({ mode: 'production', command: 'build' })
  return JSON.stringify(config.define ?? {})
}

describe('what the build lets into the browser', () => {
  it('ships no server credential', async () => {
    for (const name of SECRETS) setEnv(name, `MARKER_${name}`)
    const defines = await shippedDefines()
    const leaked = SECRETS.filter((name) => defines.includes(`MARKER_${name}`))
    expect(leaked, `these would ship to every visitor: ${leaked.join(', ')}`).toEqual([])
  })

  it('does ship the public Supabase values, so the check above reads the real define block', async () => {
    for (const name of PUBLIC) setEnv(name, `MARKER_${name}`)
    const defines = await shippedDefines()
    for (const name of PUBLIC) expect(defines).toContain(`MARKER_${name}`)
  })
})
