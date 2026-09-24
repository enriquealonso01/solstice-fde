import { createClient } from '@supabase/supabase-js'
import type { StaffRole } from '../../shared/types'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
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
