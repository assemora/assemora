/**
 * The developer section (SPEC.md §45, §58, §115).
 *
 * Everything on these screens is read from the Schema Registry, which is the single
 * source OpenAPI, the SDK and MCP are also generated from (SPEC.md §42). So this is
 * not documentation *about* the application — it is the application describing
 * itself, and it cannot fall out of date.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Terminal } from 'lucide-react'
import { useState } from 'react'

import { api } from '../api/client.ts'
import { type FieldDescriptor, useIntrospection } from '../api/introspection.ts'
import type { Paged } from '../api/pages.ts'
import { Page } from '../app/shell.tsx'
import type { MessageKey } from '../i18n/messages.ts'
import { useDates, useT } from '../i18n/translate.tsx'
import { Badge, Button, Card, Empty, Failure, Input, Spinner } from '../ui/index.tsx'
import { Screen, ScreenBody, ScreenHead, ScreenTitle, Tabs, Toolbar } from '../ui/layout.tsx'
import { Explorer } from './explorer.tsx'

/** The seven views, and the one the address may name. Exported for the route's guard. */
export const DEVELOPER_VIEWS = [
  'api',
  'logs',
  'resources',
  'blocks',
  'commands',
  'queries',
  'models',
] as const

export type DeveloperView = (typeof DEVELOPER_VIEWS)[number]

const TABS = DEVELOPER_VIEWS

type Tab = DeveloperView

/** The tab row says what a view is, in words. `api` is not a word anybody reads. */
const LABELS = {
  api: 'developer.tab.api',
  logs: 'developer.tab.logs',
  resources: 'developer.tab.resources',
  blocks: 'developer.tab.blocks',
  commands: 'developer.tab.commands',
  queries: 'developer.tab.queries',
  models: 'developer.tab.models',
} as const satisfies Record<Tab, MessageKey>

/** The four answers the log can be filtered to, and the word each is filed under. */
const OUTCOMES = [
  ['', 'developer.outcome.everything'],
  ['succeeded', 'developer.outcome.succeeded'],
  ['failed', 'developer.outcome.failed'],
  ['previewed', 'developer.outcome.previewed'],
] as const satisfies readonly (readonly [string, MessageKey])[]

const Fields = ({ fields }: { fields: readonly FieldDescriptor[] }) => {
  const t = useT()

  return (
    <ul className="space-y-1">
      {fields.map((field) => (
        <li key={field.name} className="flex flex-wrap items-baseline gap-2 text-base">
          <code className="font-mono text-sm">{field.name}</code>
          <Badge>{field.kind}</Badge>
          {field.required && <Badge tone="accent">{t('row.required')}</Badge>}
          {field.hidden && <Badge tone="danger">{t('properties.hidden')}</Badge>}
          {field.searchable && (
            <span className="text-sm text-ink-faint">{t('row.searchable')}</span>
          )}
          {field.sortable && (
            <span className="text-sm text-ink-faint">{t('developer.sortable')}</span>
          )}
          {field.filterable && (
            <span className="text-sm text-ink-faint">{t('row.filterable')}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

const Schema = ({ value }: { value: unknown }) => (
  <pre className="max-h-56 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono text-sm">
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
  const t = useT()
  const dates = useDates()

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
        {OUTCOMES.map(([option, label]) => (
          <button
            key={option || 'all'}
            type="button"
            className={[
              'rounded-lg px-3 py-1.5 text-base font-medium transition',
              outcome === option
                ? 'bg-accent-wash text-accent-ink'
                : 'text-ink-soft hover:bg-surface-sunken',
            ].join(' ')}
            onClick={() => {
              setPage(1)
              setOutcome(option)
            }}
          >
            {t(label)}
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

        {entries.data?.data.length === 0 && <Empty title={t('developer.nothingRecorded')} />}

        {entries.data !== undefined && entries.data.data.length > 0 && (
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm font-[650] tracking-[0.01em] text-ink-soft">
                <th className="px-4 py-2.5 font-medium">{t('developer.when')}</th>
                <th className="px-4 py-2.5 font-medium">{t('developer.action')}</th>
                <th className="px-4 py-2.5 font-medium">{t('developer.who')}</th>
                <th className="px-4 py-2.5 font-medium">{t('developer.from')}</th>
                <th className="px-4 py-2.5 font-medium">{t('developer.outcome')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.data.data.map((entry) => (
                <tr key={entry.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2 text-sm text-ink-soft">{dates.time(entry.createdAt)}</td>
                  <td className="px-4 py-2">
                    <code className="font-mono text-sm">{entry.action}</code>
                    {entry.kind === 'query' && (
                      <span className="ml-1.5 text-sm text-ink-faint">{t('developer.read')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-ink-soft">
                    {entry.actorType ?? t('developer.system')}
                  </td>
                  <td className="px-4 py-2 text-sm text-ink-soft">{entry.source}</td>
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
                      {entry.outcome === 'succeeded'
                        ? t('developer.outcome.succeeded')
                        : entry.outcome === 'failed'
                          ? t('developer.outcome.failed')
                          : entry.outcome === 'previewed'
                            ? t('developer.outcome.previewed')
                            : entry.outcome}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {entries.data !== undefined && entries.data.lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-base text-ink-soft">
          <span>
            {`${t('paging.page', {
              page: entries.data.page,
              last: entries.data.lastPage,
            })} · ${t('collection.entryCount', { count: entries.data.total })}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              {t('history.newer')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= entries.data.lastPage}
              onClick={() => setPage((current) => current + 1)}
            >
              {t('history.older')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

export const Developer = () => {
  const introspection = useIntrospection()
  const navigate = useNavigate()
  const t = useT()
  // In the address rather than in state, so a link can open one of these directly.
  const { view: tab, name: named } = useSearch({ from: '/shell/developer' })
  const setTab = (view: Tab) => void navigate({ to: '/developer', search: { view } })
  /**
   * The filter starts at whatever the address named, so a link can land on one row.
   *
   * `useState`'s initial value rather than an effect: the link arrives with the name
   * already in it, and a filter that took a render to catch up would show the whole
   * registry first and then blink down to the one row that was asked for.
   */
  const [filter, setFilter] = useState(named ?? '')

  if (introspection.isPending) {
    return (
      <Page icon={<Terminal className="size-5" />} title={t('nav.developer')}>
        <Spinner />
      </Page>
    )
  }

  if (introspection.isError) {
    return (
      <Page icon={<Terminal className="size-5" />} title={t('nav.developer')}>
        <Failure error={introspection.error} />
      </Page>
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

  /* One tab row over one body: these are views of the same registry, not destinations. */
  const views: readonly { value: Tab; label: string }[] = TABS.map((name) => ({
    value: name,
    label: t(LABELS[name]),
  }))

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<Terminal className="size-5" />}
          title={t('nav.developer')}
          description={t('developer.lede')}
        />
        <Tabs<Tab> value={tab} options={views} onChange={setTab} label={t('developer.views')} />
        {tab !== 'api' && tab !== 'logs' && (
          <Toolbar>
            <Input
              type="search"
              placeholder={t('developer.filter')}
              className="h-8 max-w-xs"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Toolbar>
        )}
      </ScreenHead>

      <ScreenBody className="pt-6 pb-10">
        {tab === 'api' && <Explorer />}

        {tab === 'logs' && <Logs />}

        {tab === 'resources' && (
          <div className="space-y-3">
            {resources
              .filter((entry) => matches(entry.name))
              .map((resource) => (
                <Card key={resource.name} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="font-medium">{resource.label}</p>
                    <code className="font-mono text-sm text-ink-faint">{resource.name}</code>
                    <Badge>{resource.kind}</Badge>
                    <span className="text-sm text-ink-faint">
                      {t('developer.model', { name: resource.model })}
                    </span>
                  </div>
                  <Fields fields={resource.fields} />
                </Card>
              ))}
            {resources.length === 0 && <Empty title={t('developer.noResources')} />}
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
                    <code className="font-mono text-sm text-ink-faint">{block.name}</code>
                    {block.acceptsChildren && (
                      <Badge tone="accent">{t('developer.acceptsChildren')}</Badge>
                    )}
                    {block.maxChildren !== undefined && (
                      <span className="text-sm text-ink-faint">
                        {t('developer.atMost', { count: block.maxChildren })}
                      </span>
                    )}
                  </div>
                  {block.description !== undefined && (
                    <p className="text-base text-ink-soft">{block.description}</p>
                  )}
                  <Fields fields={block.fields} />
                </Card>
              ))}
            {blocks.length === 0 && <Empty title={t('developer.noBlocks')} />}
          </div>
        )}

        {(tab === 'commands' || tab === 'queries') && (
          <div className="space-y-2">
            {(tab === 'commands' ? commands : queries)
              .filter((entry) => matches(entry.name))
              .map((entry) => (
                <Card key={entry.name} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <code className="font-mono text-base font-medium">{entry.name}</code>
                    {entry.module !== undefined && <Badge>{entry.module}</Badge>}
                  </div>
                  {entry.description !== undefined && (
                    <p className="text-base text-ink-soft">{entry.description}</p>
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
                  <code className="font-mono text-base">{model.name}</code>
                  {model.module !== undefined && <Badge>{model.module}</Badge>}
                </Card>
              ))}
          </div>
        )}
      </ScreenBody>
    </Screen>
  )
}
