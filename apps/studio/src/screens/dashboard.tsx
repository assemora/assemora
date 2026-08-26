/**
 * What the application contains (SPEC.md §58).
 *
 * Counts, not charts. The point of the first screen is to show that Studio is
 * looking at a real application: these are its resources, its commands and its
 * blocks, read from the Schema Registry.
 */
import { Link } from '@tanstack/react-router'

import { useIntrospection } from '../api/introspection.ts'
import { Page } from '../app/shell.tsx'
import { Card, Failure, Spinner } from '../ui/index.tsx'

const Stat = ({ label, value }: { label: string; value: number }) => (
  <Card className="px-5 py-4">
    <p className="text-2xl font-semibold tabular-nums">{value}</p>
    <p className="text-sm text-ink-soft">{label}</p>
  </Card>
)

export const Dashboard = () => {
  const introspection = useIntrospection()

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
    routes = [],
    blocks = [],
    models = [],
  } = introspection.data

  return (
    <Page title="Dashboard" description="What this application declares">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Resources" value={resources.length} />
        <Stat label="Models" value={models.length} />
        <Stat label="Commands" value={commands.length} />
        <Stat label="Endpoints" value={routes.length} />
        <Stat label="Blocks" value={blocks.length} />
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold">Collections</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {resources.map((resource) => (
          <Link key={resource.name} to="/content/$resource" params={{ resource: resource.name }}>
            <Card className="p-4 transition hover:border-accent">
              <p className="font-medium">{resource.label}</p>
              <p className="text-sm text-ink-soft">
                {resource.fields.length} fields · {resource.model}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </Page>
  )
}
