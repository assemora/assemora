/**
 * The developer section (SPEC.md §45, §58, §115).
 *
 * Everything on these screens is read from the Schema Registry, which is the single
 * source OpenAPI, the SDK and MCP are also generated from (SPEC.md §42). So this is
 * not documentation *about* the application — it is the application describing
 * itself, and it cannot fall out of date.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../api/client.ts'
import { type FieldDescriptor, useIntrospection } from '../api/introspection.ts'
import type { Paged } from '../api/pages.ts'
import { Page } from '../app/shell.tsx'
import { Badge, Button, Card, Empty, Failure, Input, Spinner } from '../ui/index.tsx'
import { Explorer } from './explorer.tsx'

const TABS = ['api', 'logs', 'resources', 'blocks', 'commands', 'queries', 'models'] as const

type Tab = (typeof TABS)[number]

const Fields = ({ fields }: { fields: readonly FieldDescriptor[] }) => (
  <ul className="space-y-1">
    {fields.map((field) => (
      <li key={field.name} className="flex flex-wrap items-baseline gap-2 text-sm">
        <code className="font-mono text-xs">{field.name}</code>
        <Badge>{field.kind}</Badge>
        {field.required && <Badge tone="accent">required</Badge>}
        {field.hidden && <Badge tone="danger">hidden</Badge>}
        {field.searchable && <span className="text-xs text-ink-faint">searchable</span>}
        {field.sortable && <span className="text-xs text-ink-faint">sortable</span>}
        {field.filterable && <span className="text-xs text-ink-faint">filterable</span>}
      </li>
    ))}
  </ul>
)

const Schema = ({ value }: { value: unknown }) => (
  <pre className="max-h-56 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs">
    {JSON.stringify(value, null, 2)}
  </pre>
)

type AuditRow = {
  readonly id: string
  readonly actorType: string | null
  readonly actorId: string | null
  readonly source: string
  readonly action: string
  readonly kind: string
  readonly entityType: string | null
  readonly outcome: string
  readonly durationMs: number
  readonly createdAt: string
}

/**
 * Who did what (SPEC.md §67).
 *
 * Separate from a page's history: this records the attempts too, including the ones
 * authorization refused — which are the entries that leave no revision behind.
 */
const Logs = () => {
  const [page, setPage] = useState(1)
  const [outcome, setOutcome] = useState('')

  const entries = useQuery({
    queryKey: ['audit', page, outcome],
    queryFn: ({ signal }) =>
      api.query<Paged<AuditRow>>(
        'audit.list',
        { page, ...(outcome === '' ? {} : { outcome }) },
        signal,
      ),
  })

  return (
    <>
      <div className="mb-4 flex gap-1">
        {['', 'succeeded', 'failed', 'previewed'].map((option) => (
          <button
            key={option || 'all'}
            type="button"
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition',
              outcome === option
                ? 'bg-accent-soft text-accent'
                : 'text-ink-soft hover:bg-surface-sunken',
            ].join(' ')}
            onClick={() => {
              setPage(1)
              setOutcome(option)
            }}
          >
            {option || 'everything'}
          </button>
        ))}
      </div>

      {entries.isError && <Failure error={entries.error} />}

      <Card className="overflow-hidden">
        {entries.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {entries.data?.data.length === 0 && <Empty title="Nothing recorded yet" />}

        {entries.data !== undefined && entries.data.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Who</th>
                <th className="px-4 py-2.5 font-medium">From</th>
                <th className="px-4 py-2.5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {entries.data.data.map((entry) => (
                <tr key={entry.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2 text-xs text-ink-soft">
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2">
                    <code className="font-mono text-xs">{entry.action}</code>
                    {entry.kind === 'query' && (
                      <span className="ml-1.5 text-xs text-ink-faint">read</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{entry.actorType ?? 'system'}</td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{entry.source}</td>
                  <td className="px-4 py-2">
                    <Badge
                      tone={
                        entry.outcome === 'failed'
                          ? 'danger'
                          : entry.outcome === 'previewed'
                            ? 'accent'
                            : 'positive'
                      }
                    >
                      {entry.outcome}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {entries.data !== undefined && entries.data.lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
          <span>
            Page {entries.data.page} of {entries.data.lastPage} · {entries.data.total} entries
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Newer
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= entries.data.lastPage}
              onClick={() => setPage((current) => current + 1)}
            >
              Older
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

export const Developer = () => {
  const introspection = useIntrospection()
  const [tab, setTab] = useState<Tab>('api')
  const [filter, setFilter] = useState('')

  if (introspection.isPending) {
    return (
      <Page title="Developer">
        <Spinner />
      </Page>
    )
  }

  if (introspection.isError) {
    return (
      <Page title="Developer">
        <Failure error={introspection.error} />
      </Page>
    )
  }

  if (tab === 'api') {
    return (
      <div>
        <div className="mx-auto flex max-w-6xl gap-1 px-8 pt-8">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition',
                name === tab
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-soft hover:bg-surface-sunken',
              ].join(' ')}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <Explorer />
      </div>
    )
  }

  const {
    resources = [],
    blocks = [],
    commands = [],
    queries = [],
    models = [],
  } = introspection.data
  const needle = filter.trim().toLowerCase()
  const matches = (name: string) => needle === '' || name.toLowerCase().includes(needle)

  return (
    <Page
      title="Developer"
      description="What this application declares, straight from the registry"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition',
                name === tab
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-soft hover:bg-surface-sunken',
              ].join(' ')}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <Input
          type="search"
          placeholder="Filter by name…"
          className="ml-auto max-w-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      {tab === 'logs' && <Logs />}

      {tab === 'resources' && (
        <div className="space-y-3">
          {resources
            .filter((entry) => matches(entry.name))
            .map((resource) => (
              <Card key={resource.name} className="space-y-2 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-medium">{resource.label}</p>
                  <code className="font-mono text-xs text-ink-faint">{resource.name}</code>
                  <Badge>{resource.kind}</Badge>
                  <span className="text-xs text-ink-faint">model: {resource.model}</span>
                </div>
                <Fields fields={resource.fields} />
              </Card>
            ))}
          {resources.length === 0 && <Empty title="No resources declared" />}
        </div>
      )}

      {tab === 'blocks' && (
        <div className="space-y-3">
          {blocks
            .filter((entry) => matches(entry.name))
            .map((block) => (
              <Card key={block.name} className="space-y-2 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-medium">{block.label}</p>
                  <code className="font-mono text-xs text-ink-faint">{block.name}</code>
                  {block.acceptsChildren && <Badge tone="accent">accepts children</Badge>}
                  {block.maxChildren !== undefined && (
                    <span className="text-xs text-ink-faint">at most {block.maxChildren}</span>
                  )}
                </div>
                {block.description !== undefined && (
                  <p className="text-sm text-ink-soft">{block.description}</p>
                )}
                <Fields fields={block.fields} />
              </Card>
            ))}
          {blocks.length === 0 && <Empty title="No blocks declared" />}
        </div>
      )}

      {(tab === 'commands' || tab === 'queries') && (
        <div className="space-y-2">
          {(tab === 'commands' ? commands : queries)
            .filter((entry) => matches(entry.name))
            .map((entry) => (
              <Card key={entry.name} className="space-y-2 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="font-mono text-sm font-medium">{entry.name}</code>
                  {entry.module !== undefined && <Badge>{entry.module}</Badge>}
                </div>
                {entry.description !== undefined && (
                  <p className="text-sm text-ink-soft">{entry.description}</p>
                )}
                <Schema value={entry.input} />
              </Card>
            ))}
        </div>
      )}

      {tab === 'models' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {models
            .filter((entry) => matches(entry.name))
            .map((model) => (
              <Card key={model.name} className="flex items-baseline justify-between gap-2 p-4">
                <code className="font-mono text-sm">{model.name}</code>
                {model.module !== undefined && <Badge>{model.module}</Badge>}
              </Card>
            ))}
        </div>
      )}
    </Page>
  )
}
