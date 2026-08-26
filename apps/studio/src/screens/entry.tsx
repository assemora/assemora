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

import { ApiError, api } from '../api/client.ts'
import { editableFields, useIntrospection } from '../api/introspection.ts'
import { Page } from '../app/shell.tsx'
import { Button, Card, Failure, Spinner } from '../ui/index.tsx'
import { FieldInput } from './fields.tsx'

type Entry = Record<string, unknown>

export const EntryForm = ({ mode }: { mode: 'create' | 'edit' }) => {
  const params = useParams({ strict: false }) as { resource: string; id?: string }
  const navigate = useNavigate()
  const client = useQueryClient()

  const introspection = useIntrospection()
  const resource = introspection.data?.resources?.find((entry) => entry.name === params.resource)

  const existing = useQuery({
    queryKey: ['entry', params.resource, params.id],
    queryFn: ({ signal }) => api.get<Entry>(`/${params.resource}/${params.id}`, signal),
    enabled: mode === 'edit' && params.id !== undefined,
  })

  const [draft, setDraft] = useState<Entry>({})
  const [failure, setFailure] = useState<ApiError>()

  useEffect(() => {
    if (existing.data !== undefined) setDraft(existing.data)
  }, [existing.data])

  const save = useMutation({
    mutationFn: (values: Entry) =>
      mode === 'create'
        ? api.post<Entry>(`/${params.resource}`, values)
        : api.patch<Entry>(`/${params.resource}/${params.id}`, values),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['collection', params.resource] })
      await navigate({ to: '/content/$resource', params: { resource: params.resource } })
    },
    onError: (error) => setFailure(error instanceof ApiError ? error : undefined),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/${params.resource}/${params.id}`),
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

  const fields = editableFields(resource)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(undefined)

    // Only what the resource declares is sent: an id or a timestamp the read
    // returned is not the form's to write back.
    const values: Entry = {}

    for (const field of fields) {
      if (field.name in draft) values[field.name] = draft[field.name]
    }

    save.mutate(values)
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
        {failure !== undefined && Object.keys(failure.fields).length === 0 && (
          <Failure error={failure} />
        )}

        <Card className="space-y-5 p-6">
          {fields.map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              value={draft[field.name]}
              {...(failure?.fields[field.name] === undefined
                ? {}
                : { errors: failure.fields[field.name] })}
              onChange={(value) => setDraft((current) => ({ ...current, [field.name]: value }))}
            />
          ))}
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
