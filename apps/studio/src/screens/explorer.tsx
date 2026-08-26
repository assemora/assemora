/**
 * The API Explorer (SPEC.md §45, §115).
 *
 * Every endpoint here comes from the Schema Registry. A route added to an
 * application appears in this list, in `/api/openapi.json` and in the generated SDK
 * without anyone adding it anywhere — that is the point of one declaration
 * (SPEC.md §3.7, §121).
 */
import { useMemo, useState } from 'react'

import { type RouteDescriptor, useIntrospection } from '../api/introspection.ts'
import { Page } from '../app/shell.tsx'
import { Badge, Button, Card, Failure, Field, Input, Spinner, Textarea } from '../ui/index.tsx'

const METHOD_TONE = {
  get: 'accent',
  post: 'positive',
  put: 'positive',
  patch: 'positive',
  delete: 'danger',
} as const

type Attempt = {
  readonly status: number
  readonly duration: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

const pathWithParams = (path: string, values: Readonly<Record<string, string>>): string =>
  path.replace(/:(\w+)|\{(\w+)\}/g, (match, a: string, b: string) => values[a ?? b] ?? match)

const parameterNames = (path: string): string[] =>
  [...path.matchAll(/:(\w+)|\{(\w+)\}/g)].map((match) => match[1] ?? match[2] ?? '')

const Try = ({ route }: { route: RouteDescriptor }) => {
  const [params, setParams] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [body, setBody] = useState('{}')
  const [attempt, setAttempt] = useState<Attempt>()
  const [busy, setBusy] = useState(false)
  const names = parameterNames(route.path)

  const send = async () => {
    setBusy(true)
    const started = performance.now()

    try {
      const suffix = query === '' ? '' : `?${query.replace(/^\?/, '')}`

      const response = await fetch(`/api${pathWithParams(route.path, params)}${suffix}`, {
        method: route.method.toUpperCase(),
        credentials: 'include',
        headers: {
          ...(route.method === 'get' ? {} : { 'content-type': 'application/json' }),
          ...(document.cookie.includes('assemora_csrf')
            ? {
                'x-csrf-token': decodeURIComponent(
                  document.cookie.split('assemora_csrf=')[1]?.split(';')[0] ?? '',
                ),
              }
            : {}),
        },
        ...(route.method === 'get' ? {} : { body }),
      })

      const text = await response.text()

      setAttempt({
        status: response.status,
        duration: Math.round(performance.now() - started),
        headers: Object.fromEntries(response.headers.entries()),
        body: (() => {
          try {
            return JSON.stringify(JSON.parse(text), null, 2)
          } catch {
            return text.slice(0, 4000)
          }
        })(),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {names.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {names.map((name) => (
            <Field key={name} label={name}>
              <Input
                value={params[name] ?? ''}
                onChange={(event) =>
                  setParams((current) => ({ ...current, [name]: event.target.value }))
                }
              />
            </Field>
          ))}
        </div>
      )}

      <Field label="Query string">
        <Input
          placeholder="page=1&search=engine"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>

      {route.method !== 'get' && (
        <Field label="Body">
          <Textarea
            className="font-mono text-xs"
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
      )}

      <Button size="sm" onClick={() => void send()} disabled={busy}>
        {busy ? 'Sending…' : 'Send'}
      </Button>

      {attempt !== undefined && (
        <div className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={attempt.status < 400 ? 'positive' : 'danger'}>{attempt.status}</Badge>
            <span className="text-ink-soft">{attempt.duration} ms</span>
            <span className="text-ink-faint">{attempt.headers['content-type']}</span>
          </div>
          <pre className="max-h-72 overflow-auto font-mono text-xs">{attempt.body}</pre>
        </div>
      )}
    </div>
  )
}

const Schema = ({
  title,
  schema,
}: {
  title: string
  schema: Readonly<Record<string, unknown>>
}) => (
  <div className="space-y-1">
    <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
    <pre className="max-h-56 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs">
      {JSON.stringify(schema, null, 2)}
    </pre>
  </div>
)

export const Explorer = () => {
  const introspection = useIntrospection()
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string>()

  const routes = useMemo(() => {
    const all = introspection.data?.routes ?? []
    const needle = filter.trim().toLowerCase()

    return [...all]
      .filter(
        (route) =>
          needle === '' ||
          route.path.toLowerCase().includes(needle) ||
          route.tags.some((tag) => tag.toLowerCase().includes(needle)),
      )
      .sort((left, right) => left.path.localeCompare(right.path))
  }, [introspection.data, filter])

  if (introspection.isLoading) {
    return (
      <Page title="API Explorer">
        <Spinner />
      </Page>
    )
  }

  if (introspection.isError) {
    return (
      <Page title="API Explorer">
        <Failure error={introspection.error} />
      </Page>
    )
  }

  return (
    <Page
      title="API Explorer"
      description={`${routes.length} endpoints, all of them described by the application itself`}
      actions={
        <a
          href="/api/openapi.json"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-accent hover:underline"
        >
          openapi.json
        </a>
      }
    >
      <Input
        type="search"
        placeholder="Filter by path or tag…"
        className="mb-4 max-w-sm"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="space-y-2">
        {routes.map((route) => {
          const key = `${route.method} ${route.path}`
          const expanded = open === key

          return (
            <Card key={key} className="overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken"
                onClick={() => setOpen(expanded ? undefined : key)}
              >
                <Badge tone={METHOD_TONE[route.method]}>{route.method.toUpperCase()}</Badge>
                <code className="font-mono text-sm">/api{route.path}</code>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
                  {route.description}
                </span>
                {route.auth && <Badge>auth</Badge>}
              </button>

              {expanded && (
                <div className="space-y-4 border-t border-line px-4 py-4">
                  {route.params !== undefined && <Schema title="Params" schema={route.params} />}
                  {route.query !== undefined && <Schema title="Query" schema={route.query} />}
                  {route.body !== undefined && <Schema title="Body" schema={route.body} />}
                  {route.response !== undefined && (
                    <Schema title="Response" schema={route.response} />
                  )}

                  {route.errors.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {route.errors.map((error) => (
                        <Badge key={error.code} tone="danger">
                          {error.status} {error.code}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <Try route={route} />
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </Page>
  )
}
