/**
 * What the application contains (SPEC.md §58).
 *
 * Counts, not charts. The point of the first screen is to show that Studio is looking at
 * a real application: these are its resources, its commands and its blocks, read from the
 * Schema Registry.
 *
 * Except on the day the application is installed, when the same counts say
 * `0 resources · 0 blocks · 84 endpoints` and the first screen of the product is a
 * scoreboard boasting about the framework. Then the next three things to do come first
 * and the counts move under them — still true, still worth a developer's glance, just not
 * the answer to "what is this?".
 *
 * `design_handoff_studio_redesign` §2 is a catalogue of thirty-five widgets and says to
 * pick from it rather than ship it. These are the four this application can fill without
 * inventing a number: a stat tile per registry count, and a card per declared resource.
 * A traffic chart is a widget with nothing behind it here — there is no analytics port —
 * and a dashboard of plausible-looking fictions is worse than a short one.
 */
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Blocks,
  Database,
  FileText,
  Network,
  Route as RouteIcon,
  Terminal,
  Zap,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { useIntrospection } from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { useT } from '../i18n/translate.tsx'
import { GettingStarted } from '../ui/blank.tsx'
import { Card, Failure, Spinner } from '../ui/index.tsx'
import { Screen, ScreenBody, ScreenHead, ScreenTitle } from '../ui/layout.tsx'

/** The handoff's stat tile: label in muted ink, the number at 26/650, tabular. */
const Stat = ({ icon, label, value }: { icon: ReactNode; label: string; value: number }) => (
  <Card className="p-4 transition-colors hover:border-line-strong">
    <div className="flex items-center gap-2">
      <span aria-hidden className="text-ink-subdued">
        {icon}
      </span>
      <span className="text-base text-ink-soft">{label}</span>
    </div>
    <p className="mt-2.5 text-display font-[650] tracking-[-0.02em] tabular-nums">{value}</p>
  </Card>
)

const Heading = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-8 mb-3 text-section font-[650]">{children}</h2>
)

export const Dashboard = () => {
  const introspection = useIntrospection()
  const { can } = useSession()
  const navigate = useNavigate()
  const t = useT()

  if (introspection.isPending) {
    return (
      <Screen>
        <ScreenHead>
          <ScreenTitle icon={<Zap className="size-5" />} title={t('nav.dashboard')} />
        </ScreenHead>
        <ScreenBody className="pt-6">
          <Spinner />
        </ScreenBody>
      </Screen>
    )
  }

  if (introspection.isError) {
    return (
      <Screen>
        <ScreenHead>
          <ScreenTitle icon={<Zap className="size-5" />} title={t('nav.dashboard')} />
        </ScreenHead>
        <ScreenBody className="pt-6">
          <Failure error={introspection.error} />
        </ScreenBody>
      </Screen>
    )
  }

  const {
    resources = [],
    commands = [],
    queries = [],
    routes = [],
    blocks = [],
    models = [],
  } = introspection.data

  /**
   * Whether this application has anything of its own in it yet.
   *
   * Resources and blocks, and not the other three: models, commands and endpoints are
   * never zero, because authentication, pages, media and revisions bring their own.
   * Those two are the only counts that are zero exactly when nobody has declared or
   * made anything, which is the question being asked.
   */
  const fresh = resources.length === 0 && blocks.length === 0

  const canCreateCollection =
    queries.some((query) => query.name === 'collections.list') && can('collections.create')

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<Zap className="size-5" />}
          title={t('nav.dashboard')}
          description={fresh ? t('dashboard.fresh') : t('dashboard.declares')}
        />
      </ScreenHead>

      <ScreenBody className="pt-6 pb-10">
        {fresh && (
          <>
            <GettingStarted
              canCreateCollection={canCreateCollection}
              onCreateCollection={() => void navigate({ to: '/collections/new' })}
              onCreatePage={() => void navigate({ to: '/pages' })}
            />
            <Heading>{t('dashboard.wired')}</Heading>
          </>
        )}

        {/* The two counts that are zero are the two the cards above are about, and
            `0 Resources` under a heading saying what is already wired up is the sentence
            arguing with itself. They come back the moment either is no longer zero. */}
        <div
          className={
            fresh
              ? 'grid grid-cols-3 gap-4'
              : 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5'
          }
        >
          {!fresh && (
            <Stat
              icon={<FileText className="size-4" />}
              label={t('dashboard.resources')}
              value={resources.length}
            />
          )}
          <Stat
            icon={<Database className="size-4" />}
            label={t('dashboard.models')}
            value={models.length}
          />
          <Stat
            icon={<Terminal className="size-4" />}
            label={t('dashboard.commands')}
            value={commands.length}
          />
          <Stat
            icon={<RouteIcon className="size-4" />}
            label={t('dashboard.endpoints')}
            value={routes.length}
          />
          {!fresh && (
            <Stat
              icon={<Blocks className="size-4" />}
              label={t('dashboard.blocks')}
              value={blocks.length}
            />
          )}
        </div>

        {resources.length > 0 && (
          <>
            <Heading>{t('nav.collections')}</Heading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resources.map((resource) => (
                <Link
                  key={resource.name}
                  to="/content/$resource"
                  params={{ resource: resource.name }}
                  className="block"
                >
                  <Card className="flex items-center gap-3 p-4 transition-colors hover:border-line-strong">
                    <span
                      aria-hidden
                      className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-canvas text-ink-soft"
                    >
                      <Network className="size-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-[650] text-ink">{resource.label}</span>
                      <span className="block truncate text-sm text-ink-subdued">
                        {t('dashboard.fieldCount', { count: resource.fields.length })} ·{' '}
                        <span className="font-mono">{resource.model}</span>
                      </span>
                    </span>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}
      </ScreenBody>
    </Screen>
  )
}
