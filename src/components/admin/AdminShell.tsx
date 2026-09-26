// Shared chrome for every staff surface. Nav is filtered by role purely so the UI
// does not offer a door the database will slam; RLS is the actual enforcement.

import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { effectiveRole } from '@/lib/rules/types'
import type { StaffRole } from '../../../shared/types'
import { useIdentity } from './useAdminData'
import { Icons, ThemeToggle } from './ui'

interface NavItem {
  to: string
  label: string
  roles: StaffRole[]
  icon: (p: { className?: string }) => ReactNode
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', roles: ['admin'], icon: Icons.home },
  { to: '/admin/sessions', label: 'Live conversations', roles: ['concierge', 'admin'], icon: Icons.chat },
  { to: '/admin/inquiries', label: 'Group requests', roles: ['group_sales', 'gm', 'admin'], icon: Icons.inbox },
  { to: '/admin/backend', label: 'How it works', roles: ['admin'], icon: Icons.map },
  { to: '/admin/cost', label: 'Running costs', roles: ['admin'], icon: Icons.coins },
  { to: '/admin/settings', label: 'Settings', roles: ['admin'], icon: Icons.sliders },
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

  const SignOut = Icons.signOut

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-page items-center gap-4 px-4 py-3 sm:gap-6 sm:px-6">
          <Link to="/" className="font-display text-2xl tracking-tight text-ink">
            Solstice<span className="text-accent">.</span>
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {visible.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/admin'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-ink text-hero-text' : 'text-muted hover:bg-line/50 hover:text-ink'
                  }`
                }
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm text-ink">{email ?? 'Signed out'}</div>
              <div className="text-xs text-faint">{role ? ROLE_LABEL[role] : 'no role'}</div>
            </div>
            <button type="button" className="btn-ghost" onClick={() => void signOut()}>
              <SignOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-page px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl text-ink">{title}</h1>
            {subtitle ? <div className="mt-1 text-sm text-muted">{subtitle}</div> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </main>
    </div>
  )
}
