/**
 * What the application contains (SPEC.md §58).
 *
 * Counts, not charts. The point of the first screen is to show that Studio is
 * looking at a real application: these are its resources, its commands and its
 * blocks, read from the Schema Registry.
 *
 * Except on the day the application is installed, when the same counts say
 * `0 resources · 0 blocks · 84 endpoints` and the first screen of the product is a
 * scoreboard boasting about the framework. Then the next three things to do come
 * first and the counts move under them — still true, still worth a developer's
 * glance, just not the answer to "what is this?".
 */
import { Link, useNavigate } from '@tanstack/react-router'

import { useIntrospection } from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { Page } from '../app/shell.tsx'
import { GettingStarted } from '../ui/blank.tsx'
import { Card, Failure, Spinner } from '../ui/index.tsx'

const Stat = ({ label, value }: { label: string; value: number }) => (
  <Card className="px-5 py-4">
    <p className="text-2xl font-semibold tabular-nums">{value}</p>
    <p className="text-sm text-ink-soft">{label}</p>
  </Card>
)

export const Dashboard = () => {
  const introspection = useIntrospection()
  const { can } = useSession()
  const navigate = useNavigate()

  if (introspection.isPending) {
    return (
      <Page title="Dashboard">
        <Spinner />
      </Page>
    )
  }

  if (introspection.isError) {
    return (
      <Page title="Dashboard">
        <Failure error={introspection.error} />
      </Page>
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
    <Page
      title="Dashboard"
      description={fresh ? 'Nothing has been made here yet' : 'What this application declares'}
    >
      {fresh && (
        <>
          <GettingStarted
            canCreateCollection={canCreateCollection}
            onCreateCollection={() => void navigate({ to: '/collections/new' })}
            onCreatePage={() => void navigate({ to: '/pages' })}
          />
          <h2 className="mt-8 mb-3 text-sm font-semibold">Already wired up for you</h2>
        </>
      )}

      {/* The two counts that are zero are the two the cards above are about, and
          `0 Resources` under a heading saying what is already wired up is the sentence
          arguing with itself. They come back the moment either is no longer zero. */}
      <div className={fresh ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-3 sm:grid-cols-5'}>
        {!fresh && <Stat label="Resources" value={resources.length} />}
        <Stat label="Models" value={models.length} />
        <Stat label="Commands" value={commands.length} />
        <Stat label="Endpoints" value={routes.length} />
        {!fresh && <Stat label="Blocks" value={blocks.length} />}
      </div>

      {resources.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold">Collections</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {resources.map((resource) => (
              <Link
                key={resource.name}
                to="/content/$resource"
                params={{ resource: resource.name }}
              >
                <Card className="p-4 transition hover:border-accent">
                  <p className="font-medium">{resource.label}</p>
                  <p className="text-sm text-ink-soft">
                    {resource.fields.length} fields · {resource.model}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </Page>
  )
}
