// The guest site must load without a Supabase project: App.tsx imports every admin page eagerly, so a
// module-scope throw in the client module would take the landing page and chat widget down with it.
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('the Supabase client module with no project configured', () => {
  it('imports without throwing, says it is unconfigured, and still exposes what callers use', async () => {
    // Empty values, whatever .env holds: vite's `define` would otherwise fill them in.
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()

    const mod = await import('../../supabase')
    expect(mod.isSupabaseConfigured).toBe(false)
    expect(mod.supabase).toBeTruthy()
    expect(typeof mod.getMyRole).toBe('function')
  })
})
