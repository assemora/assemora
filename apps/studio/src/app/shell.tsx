/**
 * The frame every screen is drawn inside (SPEC.md §58).
 *
 * The navigation is not a fixed list. Collections come from the Schema Registry, so
 * a `resource()` added to an application shows up here by itself.
 */
import { Link, type LinkProps, Outlet } from '@tanstack/react-router'

import { useIntrospection } from '../api/introspection.ts'
import { useLocales } from '../api/locale.tsx'
import { useSession } from '../api/session.tsx'
import { Button, Select, Spinner } from '../ui/index.tsx'

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

/**
 * Which language Studio is editing in (SPEC.md §131).
 *
 * Beside the person's own name rather than on a screen of its own, because it is not a
 * setting: it decides which rows every listing, every form and every count on the screen
 * is about. Absent entirely in an application that serves one language — the switcher is
 * drawn from the registry, so a project that configured no locales sees nothing new.
 */
const LanguageChoice = () => {
  const { locales, locale, defaultLocale, multilingual, choose } = useLocales()

  if (!multilingual || locale === undefined) return null

  return (
    <div className="space-y-1">
      <label
        htmlFor="studio-locale"
        className="block px-0.5 text-xs font-semibold uppercase tracking-wide text-ink-faint"
      >
        Editing in
      </label>
      <Select
        id="studio-locale"
        value={locale}
        onChange={(event) => choose(event.target.value)}
        className="h-8 py-0 text-sm"
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {code}
            {code === defaultLocale ? ' · default' : ''}
          </option>
        ))}
      </Select>
    </div>
  )
}

export const Shell = () => {
  const { viewer, signOut, can } = useSession()
  const introspection = useIntrospection()
  const resources = introspection.data?.resources ?? []
  const hasTheme =
    introspection.data?.commands?.some((command) => command.name === 'theme.update') === true
  // An application without `collections()` cannot make one, and somebody who may not
  // read them has nothing to open — the registry and the permission decide, the way
  // they decide the theme below.
  const hasCollections =
    introspection.data?.queries?.some((query) => query.name === 'collections.list') === true &&
    can('collections.read')

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
            {/* The collections above are whatever the registry holds, declared and
                stored alike; this is where a stored one is made (SPEC.md §37). */}
            {hasCollections && (
              <NavLink to="/collections">
                <span className="text-ink-faint">Manage collections</span>
              </NavLink>
            )}
          </Section>

          <Section title="Pages">
            <NavLink to="/pages">All pages</NavLink>
          </Section>

          <Section title="Library">
            <NavLink to="/media">Media</NavLink>
          </Section>

          {/* An application without `theme()` has no tokens, so it gets no link to
              them — the registry decides, the way it decides the collections above. */}
          {hasTheme && (
            <Section title="Design">
              <NavLink to="/design">Theme</NavLink>
            </Section>
          )}

          <Section title="AI">
            <NavLink to="/proposals">Proposals</NavLink>
          </Section>

          <Section title="Settings">
            <NavLink to="/users">Users</NavLink>
            <NavLink to="/developer">Developer</NavLink>
          </Section>
        </nav>

        <div className="space-y-3 border-t border-line-soft px-3 pt-4">
          <LanguageChoice />

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
