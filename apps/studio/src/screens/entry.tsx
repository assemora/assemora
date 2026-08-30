/**
 * Creating and editing one entry (SPEC.md §115).
 *
 * The form is the resource's field list. Saving sends the whole change to the
 * generated CRUD endpoint, which is `entries.create` and `entries.update` on the
 * Command Bus — the same handlers an agent reaches (SPEC.md §14, §43).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'

import { ApiError, api, hasMoreToSay } from '../api/client.ts'
import { declaredValues, editableFields, useIntrospection, valueAt } from '../api/introspection.ts'
import { Page } from '../app/shell.tsx'
import { Button, Card, Failure, Spinner } from '../ui/index.tsx'
import { FieldInput } from './fields.tsx'
import { Translations } from './translations.tsx'

type Entry = Record<string, unknown>

export const EntryForm = ({ mode }: { mode: 'create' | 'edit' }) => {
  const params = useParams({ strict: false }) as { resource: string; id?: string }
  const navigate = useNavigate()
  const client = useQueryClient()

  const introspection = useIntrospection()
  const resource = introspection.data?.resources?.find((entry) => entry.name === params.resource)

  /**
   * The bus by name, not the generated REST path.
   *
   * `GET /api/<resource>/:id` dispatches this very query, so the two are one handler —
   * but the routes are mounted before the server listens, and a collection made in
   * Studio is registered after that. Addressing the resource by name is what makes this
   * form work for a resource the application grew as well as one it declared
   * (ADR-0012, ADR-0014, SPEC.md §37).
   */
  const existing = useQuery({
    queryKey: ['entry', params.resource, params.id],
    queryFn: ({ signal }) =>
      api.query<Entry | null>('entries.get', { resource: params.resource, id: params.id }, signal),
    enabled: mode === 'edit' && params.id !== undefined,
  })

  const [draft, setDraft] = useState<Entry>({})
  const [failure, setFailure] = useState<ApiError>()

  useEffect(() => {
    // `entries.get` answers `null` for an id nothing matches, where the REST route
    // answered 404: an absent entry is not an empty one to put in the form.
    if (existing.data !== undefined && existing.data !== null) setDraft(existing.data)
  }, [existing.data])

  const save = useMutation({
    mutationFn: (values: Entry) =>
      mode === 'create'
        ? api.command('entries.create', { resource: params.resource, data: values })
        : api.command('entries.update', {
            resource: params.resource,
            id: params.id,
            data: values,
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['collection', params.resource] })
      await navigate({ to: '/content/$resource', params: { resource: params.resource } })
    },
    onError: (error) => setFailure(error instanceof ApiError ? error : undefined),
  })

  const remove = useMutation({
    mutationFn: () => api.command('entries.delete', { resource: params.resource, id: params.id }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['collection', params.resource] })
      await navigate({ to: '/content/$resource', params: { resource: params.resource } })
    },
  })

  if (introspection.isLoading || (mode === 'edit' && existing.isPending)) {
    return (
      <Page title="Loading">
        <Spinner />
      </Page>
    )
  }

  if (resource === undefined) {
    return <Page title="Not found">No resource called “{params.resource}”.</Page>
  }

  if (mode === 'edit' && existing.data === null) {
    return <Page title="Not found">Nothing in {resource.label} has that id.</Page>
  }

  const fields = editableFields(resource)
  /**
   * The keys the answer named that this form has an input for.
   *
   * Not the field names: a refusal about a value *inside* one names the whole path —
   * `sections.2.heading` — and the input that draws it is the repeater called
   * `sections`, which hands the rest down to the item that owns it. So a path under a
   * rendered field counts as rendered.
   *
   * Everything else — an issue about the record as a whole, one naming a read-only or
   * hidden field, one naming a key the resource does not declare — has no input to land
   * on and belongs in the box. It used to be hidden the moment `fields` held anything at
   * all, so those were shown nowhere (SPEC.md §84).
   */
  const rendered = Object.keys(failure?.fields ?? {}).filter((key) =>
    fields.some((field) => key === field.name || key.startsWith(`${field.name}.`)),
  )

  /** What the answer said about one field, addressed from that field. */
  const issuesFor = (name: string): Readonly<Record<string, readonly string[]>> | undefined => {
    const under: Record<string, readonly string[]> = {}

    for (const [key, messages] of Object.entries(failure?.fields ?? {})) {
      if (key === name) under[''] = messages
      else if (key.startsWith(`${name}.`)) under[key.slice(name.length + 1)] = messages
    }

    return Object.keys(under).length === 0 ? undefined : under
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(undefined)

    // Only what the resource declares is sent: an id or a timestamp the read
    // returned is not the form's to write back.
    save.mutate(declaredValues(fields, draft))
  }

  const singular = resource.label.replace(/s$/, '')

  return (
    <Page
      title={mode === 'create' ? `New ${singular}` : `Edit ${singular}`}
      actions={
        mode === 'edit' &&
        resource.api.delete && (
          <Button
            variant="ghost"
            className="text-danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete this ${singular.toLowerCase()}?`)) remove.mutate()
            }}
          >
            Delete
          </Button>
        )
      }
    >
      <form className="space-y-6" onSubmit={submit}>
        {/* Above the form and not beside the Save button: which language this row is in
            decides what saving *means*, so it has to be read before the fields are. */}
        {mode === 'edit' && params.id !== undefined && (
          <Translations
            resource={params.resource}
            id={params.id}
            entryLocale={existing.data?.locale}
          />
        )}

        {failure !== undefined && hasMoreToSay(failure, rendered) && (
          <Failure error={failure} except={rendered} />
        )}

        <Card className="space-y-5 p-6">
          {fields.map((field) => {
            const issues = issuesFor(field.name)

            return (
              <FieldInput
                key={field.name}
                field={field}
                value={valueAt(draft, field.name)}
                {...(issues === undefined ? {} : { issues })}
                onChange={(value) => setDraft((current) => ({ ...current, [field.name]: value }))}
              />
            )
          })}
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : mode === 'create' ? `Create ${singular}` : 'Save changes'}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void navigate({ to: '/content/$resource', params: { resource: params.resource } })
            }
          >
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  )
}
