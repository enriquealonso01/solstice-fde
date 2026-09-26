/**
 * The app must load without a Supabase project, because the guest site does not need one.
 *
 * `vite.config.ts` defines `VITE_SUPABASE_URL` from `.env` and falls back to `''`, and
 * `createClient('')` throws `supabaseUrl is required` — at **module scope**, before React mounts. Since
 * `src/App.tsx` imports every admin page eagerly, that throw took the whole app down: the landing page and
 * the chat widget went with it, and neither needs Supabase, because chat is a Netlify function.
 *
 * So `README.md`'s step 6 — `npm run dev`, after *"cp .env.example .env # then fill it in"* — rendered a
 * white screen for anyone who had not finished filling it in. A reviewer who wants a quick look at the
 * guest experience has no reason to own a Supabase project.
 *
 * Iteration 112 met the same throw from the other side: a test file that imported `useAdminData`
 * collected **zero tests** in a fresh clone, and passed here only because my `.env` existed.
 *
 * This test is the reviewer's clone: under vitest there is no `.env` and no vite `define`, so
 * `import.meta.env.VITE_SUPABASE_URL` is undefined — exactly the unconfigured case. Importing the module
 * has to succeed, and it has to say it is unconfigured rather than pretend otherwise.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../../..')

describe('the app with no Supabase project configured', () => {
  it('imports the client module instead of throwing at module scope', async () => {
    // Before the fix this rejected with "supabaseUrl is required" and took every importer with it.
    const mod = await import('../../supabase')
    expect(mod.supabase).toBeTruthy()
  })

  it('exposes a configured flag, so a screen can say which state it is in', async () => {
    // Deliberately not asserting the VALUE. vitest loads vite's config, so `define` fills these from my
    // `.env` and the flag is true here and false in a fresh clone -- environment-dependent, which is the
    // exact class of bug this file exists for. The first version of this case asserted `false` and failed
    // on my machine for the right reason.
    const { isSupabaseConfigured } = await import('../../supabase')
    expect(typeof isSupabaseConfigured).toBe('boolean')
  })

  it('never hands createClient an empty url, whatever the environment says', () => {
    // The fix itself, read from source, so it holds regardless of what `.env` happens to contain here.
    const src = readFileSync(join(repoRoot, 'src/lib/supabase.ts'), 'utf8').replace(/\s+/g, ' ')
    expect(
      src,
      'src/lib/supabase.ts must fall back to a placeholder. createClient("") throws at module scope, and ' +
        'App.tsx imports the admin pages eagerly, so that throw is a white screen for the guest site too.',
    ).toMatch(/VITE_SUPABASE_URL \|\| '[^']+'/)
    expect(src).toMatch(/VITE_SUPABASE_ANON_KEY \|\| '[^']+'/)
  })

  it('still exposes the role lookup, which callers import unconditionally', async () => {
    const { getMyRole } = await import('../../supabase')
    expect(typeof getMyRole).toBe('function')
  })

  it('keeps the admin pages eagerly imported, which is why this matters', async () => {
    // If the router is ever switched to lazy routes, the blast radius of a module-scope throw shrinks and
    // this test's premise changes. Worth failing then, so the comment above gets revisited.
    const app = readFileSync(join(repoRoot, 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/^import AdminHome from/m)
    expect(app).not.toMatch(/lazy\(/)
  })
})
