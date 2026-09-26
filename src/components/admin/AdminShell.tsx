// Shared chrome for every staff surface. Nav is filtered by role purely so the UI
// does not offer a door the database will slam; RLS is the actual enforcement.

import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { effectiveRole } from '@/lib/rules/types'
import type { StaffRole } from '../../../shared/types'
import { useIdentity } from './useAdminData'

interface NavItem {
  to: string
  label: string
  roles: StaffRole[]
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', roles: ['admin'] },
  { to: '/admin/sessions', label: 'Live sessions', roles: ['concierge', 'admin'] },
  { to: '/admin/inquiries', label: 'Group inbox', roles: ['group_sales', 'gm', 'admin'] },
  { to: '/admin/backend', label: 'Backend map', roles: ['admin'] },
  { to: '/admin/cost', label: 'Cost', roles: ['admin'] },
]

const ROLE_LABEL: Record<StaffRole, string> = {
  concierge: 'Concierge supervisor',
  group_sales: 'Group sales',
  gm: 'General manager',
  admin: 'Super admin',
}

/** The signed-in user's role as the server decides it (see effectiveRole). Cosmetic here too;
 *  the functions and RLS enforce it. */
export function useStaffRole(): { email: string | null; role: StaffRole | null } {
  const identity = useIdentity()
  const [appMetadata, setAppMetadata] = useState<Record<string, unknown> | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setAppMetadata(data.session?.user.app_metadata)
    })
    return () => {
      alive = false
    }
  }, [])
  return { email: identity.email, role: effectiveRole(appMetadata, identity.role) }
}

export default function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { email, role } = useStaffRole()
  const visible = NAV.filter((n) => (role ? n.roles.includes(role) : false))

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-solstice-cream">
      <header className="border-b border-solstice-sand bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3">
          <Link to="/" className="font-display text-xl tracking-tight text-solstice-ink">
            Solstice<span className="text-solstice-ember">.</span>
          </Link>
          <nav className="flex items-center gap-1">
            {visible.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/admin'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-solstice-sand/70 text-solstice-ink'
                      : 'text-solstice-stone hover:bg-solstice-sand/40 hover:text-solstice-ink'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm text-solstice-ink">{email ?? 'Signed out'}</div>
              <div className="text-xs text-solstice-stone">{role ? ROLE_LABEL[role] : 'no role'}</div>
            </div>
            <button type="button" className="btn-ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-solstice-ink">{title}</h1>
            {subtitle ? <div className="mt-1 text-sm text-solstice-stone">{subtitle}</div> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </main>
    </div>
  )
}
