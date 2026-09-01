/**
 * The frame every screen is drawn inside (SPEC.md §58).
 *
 * Three parts, from `design_handoff_studio_redesign`: a 52px chrome bar the whole width
 * of the window, a 240px sidebar on the canvas that collapses to a 56px icon rail, and
 * a white content panel with a 16px top radius holding one screen at a time.
 *
 * The navigation is not a fixed list. Collections come from the Schema Registry, so a
 * `resource()` added to an application shows up here by itself — and in the rail, and in
 * the command palette, without any of the three being told.
 */
import { Link, type LinkProps, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Bell,
  Check,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Image as ImageIcon,
  LogOut,
  Network,
  Palette,
  PanelLeft,
  Plus,
  Search,
  Sparkles,
  Terminal,
  Users as UsersIcon,
  Zap,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { type ResourceDescriptor, useIntrospection } from '../api/introspection.ts'
import { useLocales } from '../api/locale.tsx'
import { useSession } from '../api/session.tsx'
import { LANGUAGE_NAMES } from '../i18n/languages.ts'
import type { MessageKey } from '../i18n/messages.ts'
import { useLanguage, useT } from '../i18n/translate.tsx'
import { join, Spinner } from '../ui/index.tsx'
import { Screen, ScreenBody, ScreenHead, ScreenTitle } from '../ui/layout.tsx'
import { Logo } from '../ui/logo.tsx'
import { Menu, MenuItem, MenuSeparator } from '../ui/overlay.tsx'
import { Palette as CommandPalette } from './palette.tsx'

/** Two letters from a name, for the avatar the chrome bar and the profile row share. */
export const initials = (name: string | undefined): string =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'

export const Avatar = ({ name, size = 28 }: { name: string | undefined; size?: number }) => (
  <span
    aria-hidden
    className="grid shrink-0 place-items-center rounded-full bg-accent-tint text-xs font-[650] text-accent-ink"
    style={{ width: size, height: size }}
  >
    {initials(name)}
  </span>
)

/* --------------------------------------------------------------------------- sidebar */

const NAV_BASE =
  'flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-md tracking-[-0.006em] active:bg-pressed'
const NAV_OFF = 'bg-transparent font-medium text-ink-strong hover:bg-line'
const NAV_ON = 'bg-line font-[650] text-ink'

/** A destination in the sidebar. The router decides what is current. */
const NavLink = ({
  icon,
  children,
  after,
  ...link
}: LinkProps & { icon: ReactNode; children: ReactNode; after?: ReactNode }) => (
  <li>
    <Link {...link} className={join(NAV_BASE, NAV_OFF)} activeProps={{ className: NAV_ON }}>
      <span aria-hidden className="w-[18px] shrink-0 text-center">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
      {after}
    </Link>
  </li>
)

const SUB_BASE =
  'flex h-[26px] w-full items-center rounded-lg pr-2 pl-5 text-left text-md tracking-[-0.006em] hover:bg-line active:bg-pressed'
const SUB_OFF = 'font-normal text-ink-soft hover:text-ink'
const SUB_ON = 'font-[650] text-ink'

/** A row in the collections subtree, with the marker the active one wears on its rule. */
const SubLink = ({ children, ...link }: LinkProps & { children: ReactNode }) => (
  <li className="relative">
    <Link
      {...link}
      className={join(SUB_BASE, SUB_OFF)}
      activeProps={{ className: join(SUB_BASE, SUB_ON) }}
    >
      {children}
    </Link>
  </li>
)

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <h2 className="mb-1 ml-2 text-sm font-[650] tracking-[0.01em] text-ink-soft">{title}</h2>
    <ul className="flex list-none flex-col gap-0.5 p-0">{children}</ul>
  </div>
)

/** A destination in the collapsed rail: 40px square, the same states as a nav row. */
const RailLink = ({
  icon,
  label,
  badge = false,
  ...link
}: LinkProps & { icon: ReactNode; label: string; badge?: boolean }) => (
  <Link
    {...link}
    title={label}
    aria-label={label}
    className="relative grid size-10 shrink-0 place-items-center rounded-[10px] bg-transparent text-ink-strong hover:bg-line active:bg-pressed"
    activeProps={{ className: 'bg-line text-ink' }}
  >
    {icon}
    {badge && (
      <span
        aria-hidden
        className="absolute top-[7px] right-[7px] size-2 rounded-full bg-accent ring-2 ring-canvas"
      />
    )}
  </Link>
)

const RailRule = () => <span aria-hidden className="my-1.5 h-px w-6 bg-line" />

/* ------------------------------------------------------------------------- the shell */

export const Shell = () => {
  const { viewer, signOut, can } = useSession()
  const introspection = useIntrospection()
  const navigate = useNavigate()
  const t = useT()
  const resources = introspection.data?.resources ?? []

  const [rail, setRail] = useState(false)
  const [openCollections, setOpenCollections] = useState(true)
  const [profileOpen, setProfileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const profile = useRef<HTMLButtonElement>(null)

  /* ⌘K anywhere, and Escape closes whatever is open. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * The resources, under the headings the application filed them under (SPEC.md §58).
   *
   * A project of any size outgrows one list: a menu, a shop and a blog put fifteen
   * entries under `Content` and finding the one you want becomes reading. `group` is the
   * application's own division of itself, declared on the resource and carried here by
   * the registry like everything else — Studio invents nothing and knows no project.
   *
   * Order is not sorted. Within a group it is the order the resources were registered,
   * and the groups follow the order they first appear in, which is the order the modules
   * are listed in `app.ts` — a decision somebody already made, and a better one than
   * alphabetical, which would file `Articles` above `Menu` for no reason anybody meant.
   *
   * Ungrouped resources keep `Content`, so a project that groups nothing looks exactly as
   * it did, and one that groups only its blog does not have its menu disappear.
   */
  const grouped = new Map<string, ResourceDescriptor[]>()

  for (const resource of resources) {
    const heading = resource.group ?? ''
    const kept = grouped.get(heading) ?? []

    kept.push(resource)
    grouped.set(heading, kept)
  }

  const ungrouped = grouped.get('') ?? []
  const groups = [...grouped.entries()].filter(([heading]) => heading !== '')
  const hasTheme =
    introspection.data?.commands?.some((command) => command.name === 'theme.update') === true
  // An application without `collections()` cannot make one, and somebody who may not
  // read them has nothing to open — the registry and the permission decide, the way
  // they decide the theme below.
  const hasCollections =
    introspection.data?.queries?.some((query) => query.name === 'collections.list') === true &&
    can('collections.read')

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <ChromeBar
        rail={rail}
        onToggleRail={() => setRail((collapsed) => !collapsed)}
        onSearch={() => setPaletteOpen(true)}
        viewer={viewer?.name}
        names={new Map(resources.map((resource) => [resource.name, resource.label]))}
      />

      <div className="flex min-h-0 flex-1 bg-canvas">
        <aside
          className={join(
            'flex shrink-0 flex-col overflow-x-hidden overflow-y-auto rounded-tl-2xl bg-canvas p-2 pt-3 transition-[width] duration-200',
            rail ? 'w-14 items-center' : 'w-60',
          )}
        >
          {rail ? (
            <>
              <nav aria-label="Studio" className="flex flex-col items-center gap-1.5">
                <RailLink to="/" icon={<Zap className="size-5" />} label={t('nav.dashboard')} />
                <RailRule />
                {resources.map((resource) => (
                  <RailLink
                    key={resource.name}
                    to="/content/$resource"
                    params={{ resource: resource.name }}
                    icon={<FileText className="size-5" />}
                    label={resource.label}
                  />
                ))}
                {hasCollections && (
                  <RailLink
                    to="/collections"
                    icon={<Network className="size-5" />}
                    label={t('nav.manageCollections')}
                  />
                )}
                <RailRule />
                <RailLink
                  to="/pages"
                  icon={<FileText className="size-5" />}
                  label={t('nav.pages')}
                />
                <RailLink
                  to="/media"
                  icon={<ImageIcon className="size-5" />}
                  label={t('nav.media')}
                />
                {hasTheme && (
                  <>
                    <RailRule />
                    <RailLink
                      to="/design"
                      icon={<Palette className="size-5" />}
                      label={t('nav.theme')}
                    />
                  </>
                )}
                <RailRule />
                <RailLink
                  to="/proposals"
                  icon={<Sparkles className="size-5" />}
                  label={t('nav.proposals')}
                  badge
                />
                <RailRule />
                <RailLink
                  to="/users"
                  icon={<UsersIcon className="size-5" />}
                  label={t('nav.users')}
                />
                <RailLink
                  to="/developer"
                  icon={<Terminal className="size-5" />}
                  label={t('nav.developer')}
                />
              </nav>

              <div className="mt-auto flex justify-center pt-3">
                <button
                  ref={profile}
                  type="button"
                  aria-label={viewer?.name ?? t('account.menu')}
                  title={viewer?.name ?? t('account.menu')}
                  aria-expanded={profileOpen}
                  onClick={() => setProfileOpen((open) => !open)}
                  className="rounded-full hover:ring-2 hover:ring-accent-tint"
                >
                  <Avatar name={viewer?.name} size={30} />
                </button>
              </div>
            </>
          ) : (
            <>
              <nav aria-label="Studio" className="flex flex-col gap-5">
                <ul className="flex list-none flex-col gap-0.5 p-0">
                  <NavLink to="/" icon={<Zap className="size-[18px]" />}>
                    {t('nav.dashboard')}
                  </NavLink>
                </ul>

                {/* `Content` still exists while anything is in it, or while the
                    collections link needs somewhere to live. A project that groups
                    everything it declares does not get an empty heading over a lone
                    link. */}
                {(introspection.isLoading || ungrouped.length > 0 || hasCollections) && (
                  <Group title={t('nav.content')}>
                    {introspection.isLoading && (
                      <li className="px-2 py-1.5">
                        <Spinner label="" />
                      </li>
                    )}
                    {ungrouped.length > 0 && (
                      <li>
                        <button
                          type="button"
                          aria-expanded={openCollections}
                          onClick={() => setOpenCollections((open) => !open)}
                          className={join(NAV_BASE, NAV_OFF)}
                        >
                          <span aria-hidden className="w-[18px] shrink-0 text-center">
                            <FileText className="size-[18px]" />
                          </span>
                          <span className="min-w-0 truncate">{t('nav.collections')}</span>
                          <ChevronRight
                            aria-hidden
                            className={join(
                              'ml-auto size-4 shrink-0 text-ink-subdued transition-transform duration-[180ms]',
                              openCollections && 'rotate-90',
                            )}
                          />
                        </button>
                        <ul
                          className={join(
                            'ml-[17px] flex list-none flex-col overflow-hidden border-l border-line p-0 transition-[max-height,opacity,margin] duration-200',
                            openCollections
                              ? 'my-0.5 max-h-[60rem] gap-0.5 opacity-100'
                              : 'max-h-0 gap-0 opacity-0',
                          )}
                        >
                          {ungrouped.map((resource) => (
                            <SubLink
                              key={resource.name}
                              to="/content/$resource"
                              params={{ resource: resource.name }}
                            >
                              {resource.label}
                            </SubLink>
                          ))}
                          {/* The collections above are whatever the registry holds,
                              declared and stored alike; this is where a stored one is
                              made (SPEC.md §37). */}
                          {hasCollections && (
                            <SubLink to="/collections/new">
                              <Plus aria-hidden className="mr-1.5 size-4" />
                              {t('collections.new')}
                            </SubLink>
                          )}
                        </ul>
                      </li>
                    )}
                    {hasCollections && (
                      <NavLink to="/collections" icon={<Network className="size-[18px]" />}>
                        {t('nav.manageCollections')}
                      </NavLink>
                    )}
                    <NavLink to="/media" icon={<ImageIcon className="size-[18px]" />}>
                      {t('nav.media')}
                    </NavLink>
                  </Group>
                )}

                {groups.map(([heading, inside]) => (
                  <Group key={heading} title={heading}>
                    {inside.map((resource) => (
                      <NavLink
                        key={resource.name}
                        to="/content/$resource"
                        params={{ resource: resource.name }}
                        icon={<FileText className="size-[18px]" />}
                      >
                        {resource.label}
                      </NavLink>
                    ))}
                  </Group>
                ))}

                <Group title={t('nav.pages')}>
                  <NavLink to="/pages" icon={<FileText className="size-[18px]" />}>
                    {t('nav.allPages')}
                  </NavLink>
                </Group>

                {/* An application without `theme()` has no tokens, so it gets no link to
                    them — the registry decides, the way it decides the collections
                    above. */}
                {hasTheme && (
                  <Group title={t('nav.design')}>
                    <NavLink to="/design" icon={<Palette className="size-[18px]" />}>
                      {t('nav.theme')}
                    </NavLink>
                  </Group>
                )}

                <Group title={t('nav.ai')}>
                  <NavLink to="/proposals" icon={<Sparkles className="size-[18px]" />}>
                    {t('nav.proposals')}
                  </NavLink>
                </Group>

                <Group title={t('nav.settings')}>
                  <NavLink to="/users" icon={<UsersIcon className="size-[18px]" />}>
                    {t('nav.users')}
                  </NavLink>
                  <NavLink to="/developer" icon={<Terminal className="size-[18px]" />}>
                    {t('nav.developer')}
                  </NavLink>
                </Group>
              </nav>

              <div className="mt-auto pt-3">
                <div aria-hidden className="mx-1 mb-2 h-px bg-line" />
                <button
                  ref={profile}
                  type="button"
                  aria-expanded={profileOpen}
                  onClick={() => setProfileOpen((open) => !open)}
                  className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-line active:bg-pressed"
                >
                  <Avatar name={viewer?.name} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base leading-[1.35] font-[650] tracking-[-0.006em]">
                      {viewer?.name}
                    </span>
                    <span className="truncate text-sm leading-[1.35] text-ink-subdued">
                      {viewer?.email}
                    </span>
                  </span>
                  <ChevronsUpDown aria-hidden className="size-[18px] shrink-0 text-ink-subdued" />
                </button>
              </div>
            </>
          )}
        </aside>

        <ProfileMenu
          open={profileOpen}
          trigger={profile}
          onDismiss={() => setProfileOpen(false)}
          onSignOut={() => void signOut()}
        />

        <main className="min-w-0 flex-1 pt-2 pr-2">
          <div className="flex h-full flex-col overflow-hidden rounded-t-2xl border border-b-0 border-line bg-surface">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onDismiss={() => setPaletteOpen(false)}
        onGo={(to) => {
          setPaletteOpen(false)
          void navigate(to)
        }}
      />
    </div>
  )
}

/**
 * The bar across the top: the rail toggle, the logo, the breadcrumb, search, the bell.
 *
 * The breadcrumb reads the router rather than being passed down, because every screen
 * would otherwise have to remember to say where it is — and the one that forgot would
 * leave the bar showing the screen before it.
 */
const ChromeBar = ({
  rail,
  onToggleRail,
  onSearch,
  viewer,
  names,
}: {
  rail: boolean
  onToggleRail(): void
  onSearch(): void
  viewer: string | undefined
  /** What the registry calls each resource, so `articles` reads `Articles`. */
  names: ReadonlyMap<string, string>
}) => {
  const crumbs = useCrumbs(names)
  const t = useT()

  return (
    <header className="flex h-13 shrink-0 items-center gap-2 bg-chrome px-3 text-chrome-ink">
      <button
        type="button"
        aria-label={rail ? t('chrome.expandSidebar') : t('chrome.collapseSidebar')}
        aria-expanded={!rail}
        onClick={onToggleRail}
        className="grid size-8 place-items-center rounded-lg opacity-70 hover:bg-white/10 hover:opacity-100"
      >
        <PanelLeft aria-hidden className="size-5" />
      </button>

      <Link to="/" className="flex items-center gap-2 pl-1 text-chrome-ink hover:text-white">
        <Logo size={22} />
        <span className="text-md font-[650] tracking-[-0.02em]">assemora</span>
      </Link>

      {crumbs.map((crumb) => (
        <span key={crumb} className="flex items-center gap-2">
          <span aria-hidden className="px-1 opacity-30">
            /
          </span>
          <span className="text-base font-[550] opacity-90">{crumb}</span>
        </span>
      ))}

      <button
        type="button"
        onClick={onSearch}
        className="ml-auto flex h-8 items-center gap-2 rounded-full border border-white/15 bg-white/5 pr-2 pl-3 text-base hover:border-white/25 hover:bg-white/10"
      >
        <Search aria-hidden className="size-5 opacity-65" />
        <span className="opacity-70">{t('common.search')}</span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-xs opacity-80">
          ⌘K
        </span>
      </button>

      <button
        type="button"
        aria-label={t('chrome.notifications')}
        className="relative grid size-8 place-items-center rounded-lg opacity-70 hover:bg-white/10 hover:opacity-100"
      >
        <Bell aria-hidden className="size-5" />
      </button>

      <Avatar name={viewer} />
    </header>
  )
}

/**
 * Where the current screen is, as words.
 *
 * Derived from the path rather than stored: a breadcrumb that a screen sets is a second
 * source for something the router already knows, and the two drift the first time
 * somebody adds a route.
 */
const CRUMBS = {
  content: 'nav.content',
  collections: 'nav.collections',
  pages: 'nav.pages',
  media: 'nav.media',
  design: 'nav.design',
  proposals: 'nav.proposals',
  users: 'nav.users',
  developer: 'nav.developer',
  new: 'crumb.new',
  history: 'crumb.history',
} as const satisfies Record<string, MessageKey>

const useCrumbs = (names: ReadonlyMap<string, string>): string[] => {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const t = useT()

  return path
    .split('/')
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => {
      const crumb = CRUMBS[segment as keyof typeof CRUMBS]

      // A segment Studio does not name is a resource, and a resource is called what the
      // application calls it — in the language the application wrote it in.
      return crumb === undefined ? (names.get(segment) ?? segment) : t(crumb)
    })
}

/** The small caps over a group of menu rows. */
const MenuHeading = ({ children }: { children: ReactNode }) => (
  <p className="mx-2.5 mt-1 mb-1 text-xs font-[650] tracking-[0.08em] text-ink-subdued uppercase">
    {children}
  </p>
)

const ProfileMenu = ({
  open,
  trigger,
  onDismiss,
  onSignOut,
}: {
  open: boolean
  trigger: React.RefObject<HTMLButtonElement | null>
  onDismiss(): void
  onSignOut(): void
}) => {
  const { locales, locale, defaultLocale, multilingual, choose } = useLocales()
  const { languages, language, choose: speak } = useLanguage()
  const t = useT()

  return (
    <Menu open={open} trigger={trigger} onDismiss={onDismiss} width={232} label={t('account.menu')}>
      {/*
       * Which language Studio is editing in (SPEC.md §131).
       *
       * Beside the person's own name rather than on a screen of its own, because it is
       * not a setting: it decides which rows every listing, every form and every count
       * on the screen is about. Absent entirely in an application that serves one
       * language — the switcher is drawn from the registry, so a project that configured
       * no locales sees nothing new.
       */}
      {multilingual && locale !== undefined && (
        <>
          <MenuHeading>{t('account.editingIn')}</MenuHeading>
          {locales.map((code) => (
            <MenuItem
              key={code}
              onClick={() => {
                choose(code)
                onDismiss()
              }}
            >
              <span className={code === locale ? 'font-[650]' : undefined}>{code}</span>
              {code === defaultLocale && (
                <span className="ml-auto text-sm text-ink-subdued">{t('common.default')}</span>
              )}
            </MenuItem>
          ))}
          <MenuSeparator />
        </>
      )}

      {/*
       * The other language on this menu, and the reason both are on it.
       *
       * Above is which language the *content* is in — a fact about the deployment, and
       * the thing every listing on the screen is about. This is which language *Studio*
       * is in, which is a fact about the person reading it. They are next to each other
       * so that the difference is visible, and they are two controls because a shop in
       * Ukrainian is routinely filled in by somebody who reads English, and the reverse
       * is just as ordinary.
       */}
      <MenuHeading>{t('account.interface')}</MenuHeading>
      {languages.map((code) => (
        <MenuItem
          key={code}
          onClick={() => {
            speak(code)
            onDismiss()
          }}
        >
          <span className={code === language ? 'font-[650]' : undefined}>
            {LANGUAGE_NAMES[code]}
          </span>
          {code === language && (
            <Check aria-hidden className="ml-auto size-4 shrink-0 text-ink-soft" />
          )}
        </MenuItem>
      ))}
      <MenuSeparator />

      <MenuItem icon={<LogOut className="size-[18px]" />} onClick={onSignOut}>
        {t('account.signOut')}
      </MenuItem>
    </Menu>
  )
}

/**
 * A screen's header, for the screens that are a form rather than a list.
 *
 * The same three parts `Screen` is made of, with the body already scrolling — most
 * screens are a heading over one column of content and would otherwise repeat the
 * arrangement. A screen that needs a toolbar, a table or a footer pinned to the panel
 * reaches for `Screen` directly.
 */
export const Page = ({
  icon,
  title,
  count,
  description,
  actions,
  children,
}: {
  icon?: ReactNode
  title: string
  count?: ReactNode
  description?: string | undefined
  actions?: ReactNode
  children: ReactNode
}) => (
  <Screen>
    <ScreenHead>
      <ScreenTitle
        {...(icon === undefined ? {} : { icon })}
        title={title}
        {...(count === undefined ? {} : { count })}
        description={description}
        {...(actions === undefined ? {} : { actions })}
      />
    </ScreenHead>
    <ScreenBody className="pt-6 pb-10">{children}</ScreenBody>
  </Screen>
)
