/**
 * The collections this application grew rather than declared (SPEC.md §37, §115).
 *
 * A collection is a resource whose schema is a row in the database, so it is the one
 * kind of resource somebody can make without writing TypeScript — and once made it is
 * a resource like any other: it appears in the navigation beside the declared ones, its
 * entries are written through the same `entries.*` commands, and an agent reaches it by
 * name over MCP. Nothing below knows that; it asks the application what it has.
 */
import { Link, useNavigate } from '@tanstack/react-router'

import { type CollectionSummary, useCollections } from '../api/collections.ts'
import { useSession } from '../api/session.tsx'
import { Page } from '../app/shell.tsx'
import { NoCollections } from '../ui/blank.tsx'
import { Badge, Button, Card, Failure, Spinner } from '../ui/index.tsx'

/** Which of the generated CRUD operations a resource answers to (SPEC.md §43). */
const OPERATIONS = [
  ['create', 'created'],
  ['read', 'read'],
  ['update', 'updated'],
  ['delete', 'deleted'],
] as const satisfies readonly (readonly [keyof CollectionSummary['api'], string])[]

export const Collections = () => {
  const { can } = useSession()
  const navigate = useNavigate()
  const collections = useCollections()

  const made = collections.data?.data ?? []
  const declared = (collections.data?.taken ?? []).filter(
    (name) => !made.some((collection) => collection.name === name),
  )
  const create = () => void navigate({ to: '/collections/new' })

  return (
    <Page
      title="Collections"
      description="Resources made here rather than written in TypeScript"
      // The empty state carries this button itself, where the sentence explaining it
      // is. Two identical primary buttons on one screen is one of them being ignored.
      actions={
        made.length > 0 &&
        can('collections.create') && <Button onClick={create}>New collection</Button>
      }
    >
      {collections.isError && <Failure error={collections.error} />}

      <Card className="overflow-hidden">
        {collections.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {made.length === 0 && collections.isSuccess && (
          <NoCollections canCreate={can('collections.create')} onCreate={create} />
        )}

        {made.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Collection</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Fields</th>
                <th className="px-4 py-2.5 font-medium">Entries can be</th>
                <th className="w-0 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {made.map((collection) => (
                <tr
                  key={collection.id}
                  className="border-b border-line-soft last:border-0 hover:bg-surface-sunken"
                >
                  <td className="px-4 py-2.5 font-medium">
                    <Link
                      to="/content/$resource"
                      params={{ resource: collection.name }}
                      className="hover:text-accent"
                    >
                      {collection.label}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <code className="font-mono text-xs text-ink-faint">{collection.name}</code>
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{collection.fields}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {OPERATIONS.filter(([operation]) => collection.api[operation]).map(
                        ([operation, done]) => (
                          <Badge key={operation}>{done}</Badge>
                        ),
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to="/collections/$name"
                      params={{ name: collection.name }}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      Fields
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* The names a new collection may not take. Said here rather than discovered on
          submit — half of them belong to resources this screen has no other reason to
          mention, because they are declared in the application's source. */}
      {declared.length > 0 && (
        <p className="mt-4 text-sm text-ink-soft">
          Declared in this application’s source, and edited where they are written:{' '}
          {declared.map((name) => (
            <code key={name} className="mr-1.5 font-mono text-xs">
              {name}
            </code>
          ))}
        </p>
      )}
    </Page>
  )
}
