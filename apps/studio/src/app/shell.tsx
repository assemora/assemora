/**
 * The frame every screen is drawn inside (SPEC.md §58).
 *
 * The navigation is not a fixed list. Collections come from the Schema Registry, so
 * a `resource()` added to an application shows up here by itself.
 */
import { Link, type LinkProps, Outlet } from '@tanstack/react-router'

import { useIntrospection } from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { Button, Spinner } from '../ui/index.tsx'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <p className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
    <div className="space-y-0.5">{children}</div>
  </div>
)

const INACTIVE =
  'block rounded-lg px-3 py-1.5 text-sm text-ink-soft transition hover:bg-surface-sunken'
const ACTIVE = 'block rounded-lg px-3 py-1.5 text-sm font-medium text-accent bg-accent-soft'

/** The router decides what is current; this only says how current looks. */
const NavLink = ({ children, ...link }: LinkProps & { children: React.ReactNode }) => (
  <Link {...link} className={INACTIVE} activeProps={{ className: ACTIVE }}>
    {children}
  </Link>
)

export const Shell = () => {
  const { viewer, signOut } = useSession()
  const introspection = useIntrospection()
  const resources = introspection.data?.resources ?? []

  return (
    <div className="grid min-h-dvh grid-cols-[15rem_1fr] items-start">
      <aside className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto border-r border-line bg-surface px-3 py-5">
        <Link to="/" className="px-3 text-sm font-semibold tracking-tight">
          Assemora
          <span className="ml-1.5 font-normal text-ink-faint">Studio</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-5">
          <Section title="Overview">
            <NavLink to="/">Dashboard</NavLink>
          </Section>

          <Section title="Content">
            {introspection.isLoading && (
              <div className="px-3 py-1.5">
                <Spinner label="" />
              </div>
            )}
            {resources.map((resource) => (
              <NavLink
                key={resource.name}
                to="/content/$resource"
                params={{ resource: resource.name }}
              >
                {resource.label}
              </NavLink>
            ))}
          </Section>

          <Section title="Pages">
            <NavLink to="/pages">All pages</NavLink>
          </Section>

          <Section title="AI">
            <NavLink to="/proposals">Proposals</NavLink>
          </Section>

          <Section title="Library">
            <NavLink to="/media">Media</NavLink>
          </Section>

          <Section title="Settings">
            <NavLink to="/users">Users</NavLink>
            <NavLink to="/developer">Developer</NavLink>
          </Section>
        </nav>

        <div className="space-y-2 border-t border-line-soft px-3 pt-4">
          <p className="truncate text-sm font-medium">{viewer?.name}</p>
          <p className="truncate text-xs text-ink-faint">{viewer?.email}</p>
          <Button variant="ghost" size="sm" className="-mx-2" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  )
}

export const Page = ({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string | undefined
  actions?: React.ReactNode
  children: React.ReactNode
}) => (
  <div className="mx-auto max-w-6xl px-8 py-8">
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && <p className="text-sm text-ink-soft">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </header>
    {children}
  </div>
)
