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
import { FileText, Network } from 'lucide-react'
import type { ReactNode } from 'react'

import { type CollectionSummary, useCollections } from '../api/collections.ts'
import { useIntrospection } from '../api/introspection.ts'
import { useSession } from '../api/session.tsx'
import { Page } from '../app/shell.tsx'
import { NoCollections } from '../ui/blank.tsx'
import { Badge, Button, Card, Counter, Failure, Spinner } from '../ui/index.tsx'

/** Which of the generated CRUD operations a resource answers to (SPEC.md §43). */
const OPERATIONS = [
  ['create', 'created'],
  ['read', 'read'],
  ['update', 'updated'],
  ['delete', 'deleted'],
] as const satisfies readonly (readonly [keyof CollectionSummary['api'], string])[]

/** A heading over one half of the screen, with how much is under it. */
const Section = ({
  title,
  count,
  note,
  children,
}: {
  title: string
  count: number
  note?: string
  children: ReactNode
}) => (
  <section className="mt-8 first:mt-0">
    <div className="mb-1 flex items-center gap-3">
      <h2 className="text-section font-[650]">{title}</h2>
      <Counter>{count}</Counter>
    </div>
    {note !== undefined && <p className="mb-3 max-w-prose text-base text-ink-soft">{note}</p>}
    {children}
  </section>
)

export const Collections = () => {
  const { can } = useSession()
  const navigate = useNavigate()
  const collections = useCollections()
  const introspection = useIntrospection()

  const made = collections.data?.data ?? []
  /**
   * The resources this screen cannot edit, with the names the application gave them.
   *
   * `taken` is every resource name in use, so the ones made here are removed first; the
   * label comes from the registry, which is also where the link goes. A name the registry
   * does not describe stays a bare name: it exists — the command refused it — but this
   * viewer may not read it, and a link to a 403 is worse than none.
   */
  const described = introspection.data?.resources ?? []
  const declared = (collections.data?.taken ?? [])
    .filter((name) => !made.some((collection) => collection.name === name))
    .map((name) => ({ name, label: described.find((entry) => entry.name === name)?.label }))

  const create = () => void navigate({ to: '/collections/new' })
  const canCreate = can('collections.create')

  /**
   * A fresh install, as opposed to an application whose content is all in its source.
   *
   * The two used to be one branch, so a project with seventeen resources in its sidebar
   * was told to "make your first collection" over a 340px void, and the seventeen were
   * named in a footnote under it. That reads as broken software. Nothing made *and*
   * nothing declared is the only state where the invitation is the whole truth.
   */
  const fresh = made.length === 0 && declared.length === 0

  return (
    <Page
      icon={<Network className="size-5" />}
      title="Collections"
      description="A collection is a resource made here rather than written in TypeScript. Both kinds are equal once they exist"
      // On a fresh install the empty state carries this button itself, where the
      // sentence explaining it is. Two identical primary buttons on one screen is one of
      // them being ignored.
      actions={!fresh && canCreate && <Button onClick={create}>New collection</Button>}
    >
      {collections.isError && <Failure error={collections.error} />}

      {collections.isPending && (
        <Card>
          <div className="p-6">
            <Spinner />
          </div>
        </Card>
      )}

      {fresh && collections.isSuccess && (
        <Card>
          <NoCollections canCreate={canCreate} onCreate={create} />
        </Card>
      )}

      {!fresh && collections.isSuccess && (
        <>
          <Section title="Made here" count={made.length}>
            {made.length === 0 ? (
              <Card className="px-6 py-10 text-center">
                <p className="text-base font-[650]">Nothing has been made here yet</p>
                <p className="mx-auto mt-1.5 max-w-prose text-base text-ink-soft">
                  A collection made here is stored as a row rather than a source file, so Studio can
                  change its fields. Everything else about it is the same as the ones below.
                </p>
                {canCreate && (
                  <div className="mt-5">
                    <Button onClick={create}>New collection</Button>
                  </div>
                )}
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <table className="w-full text-left text-base">
                  <thead>
                    <tr className="border-b border-line text-sm font-[650] tracking-[0.01em] text-ink-soft">
                      <th className="px-4 py-2.5">Collection</th>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Fields</th>
                      <th className="px-4 py-2.5">Entries can be</th>
                      <th className="w-0 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {made.map((collection) => (
                      <tr
                        key={collection.id}
                        className="border-b border-hairline last:border-0 hover:bg-surface-sunken"
                      >
                        <td className="px-4 py-2.5 font-[550]">
                          <Link
                            to="/content/$resource"
                            params={{ resource: collection.name }}
                            className="hover:text-link"
                          >
                            {collection.label}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <code className="font-mono text-sm text-ink-soft">{collection.name}</code>
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
                            className="text-base font-[550] text-link hover:text-link-hover hover:underline"
                          >
                            Fields
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </Section>

          {/* The names a new collection may not take — and, far more useful to somebody
              standing here, where those resources actually are. This was a run-on line of
              seventeen names in the smallest type on the page, under everything else. */}
          {declared.length > 0 && (
            <Section
              title="Declared in this application’s source"
              count={declared.length}
              note="Their fields are a TypeScript declaration, which is what produces the record type, the API types and the SDK — so Studio can read them but never rewrite them, and they are changed by editing the application and restarting it. Everything else is the same: the same screens, the same policies, revisions and audit, and the same tools over MCP. A new collection may not take one of these names."
            >
              <Card className="overflow-hidden">
                <ul className="list-none p-0">
                  {declared.map((resource) => (
                    <li
                      key={resource.name}
                      className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-0 hover:bg-surface-sunken"
                    >
                      <FileText aria-hidden className="size-[18px] shrink-0 text-ink-subdued" />
                      <span className="min-w-0 flex-1 truncate font-[550]">
                        {resource.label ?? resource.name}
                      </span>
                      <code className="shrink-0 font-mono text-sm text-ink-soft">
                        {resource.name}
                      </code>
                      {resource.label !== undefined && (
                        <>
                          {/* Read-only, and said in the one place that can show them:
                              a row that only asserts "you cannot edit this" is a dead
                              end, and the fields are a fair question to have. */}
                          <Link
                            to="/developer"
                            search={{ view: 'resources' as const }}
                            className="shrink-0 text-base font-[550] text-link hover:text-link-hover hover:underline"
                          >
                            Fields
                          </Link>
                          <Link
                            to="/content/$resource"
                            params={{ resource: resource.name }}
                            className="shrink-0 text-base font-[550] text-link hover:text-link-hover hover:underline"
                          >
                            Entries
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          )}
        </>
      )}
    </Page>
  )
}
