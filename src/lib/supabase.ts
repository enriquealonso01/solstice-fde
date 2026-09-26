import { createClient } from '@supabase/supabase-js'
import type { StaffRole } from '../../shared/types'

/**
 * Whether this build was given a Supabase project at all.
 *
 * `vite.config.ts` defines these from `.env` and falls back to `''`, and `createClient('')` throws
 * `supabaseUrl is required` -- at module scope, before React mounts. Because `App.tsx` imports the admin
 * pages eagerly, that throw took the **whole** app down, including the landing page and the chat widget,
 * neither of which needs Supabase: chat is a Netlify function.
 *
 * So `README.md` step 6, `npm run dev`, was a white screen for anyone who had not finished filling in
 * `.env` -- and a reviewer wanting a quick look at the guest experience has no reason to own a Supabase
 * project. Iteration 112 met the same throw in the test suite, where it silently collected zero tests
 * from a whole file.
 *
 * Unconfigured now yields a client pointed at a placeholder that cannot resolve. Every admin read goes
 * through `readOrMock`, which already catches failure and falls back to the sample rows, and the header's
 * `SourceChip` already renders **Sample data** rather than Connected -- so the degraded state is the one
 * this app was designed to show, and it says so on screen instead of showing nothing.
 */
export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
)

if (!isSupabaseConfigured && typeof console !== 'undefined') {
  // Loud where an operator looks, silent where a guest does. A production deploy has these set; if it
  // ever does not, the admin screens say "Sample data" and this line says why.
  console.warn(
    'Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are empty). ' +
      'The guest site works; admin screens will show sample data.',
  )
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'http://supabase.invalid',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'unconfigured',
  { auth: { persistSession: true, autoRefreshToken: true } },
)

/** Reads the caller's role from `profiles`. RLS is the real enforcement;
 *  this only decides what the UI bothers to render. */
export async function getMyRole(): Promise<StaffRole | null> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.session.user.id)
    .single()
  if (error) return null
  return (data?.role as StaffRole) ?? null
}
