import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { getMyRole } from '@/lib/supabase'
import type { StaffRole } from '../../shared/types'

/** Route guard. Cosmetic only: the database refuses the data regardless,
 *  so a bypassed guard leaks nothing. */
export default function RequireRole({ allow }: { allow: StaffRole[] }) {
  const [role, setRole] = useState<StaffRole | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    getMyRole().then((r) => {
      if (alive) setRole(r)
    })
    return () => {
      alive = false
    }
  }, [])

  if (role === undefined) {
    return <div className="grid min-h-screen place-items-center text-solstice-stone">Loading…</div>
  }
  if (role === null) return <Navigate to="/login" replace />
  if (!allow.includes(role)) return <Navigate to="/login" replace />
  return <Outlet />
}
