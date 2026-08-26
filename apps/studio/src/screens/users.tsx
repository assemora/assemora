/**
 * Users, roles and tokens (SPEC.md §50, §72, §115).
 *
 * Every change here is a command, so an administrator in Studio and an agent through
 * MCP pass the same permission checks — there is no privileged path into identity.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { ApiError, api } from '../api/client.ts'
import type { Paged } from '../api/pages.ts'
import { useSession } from '../api/session.tsx'
import { Page } from '../app/shell.tsx'
import { Badge, Button, Card, Empty, Failure, Field, Input, Select, Spinner } from '../ui/index.tsx'

type UserRow = {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly active: boolean
  readonly roles: readonly string[]
  readonly createdAt: string
}

type Role = {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly permissions: readonly string[]
}

type ApiTokenRow = {
  readonly id: string
  readonly name: string
  readonly permissions: readonly string[]
  readonly expiresAt: string | null
  readonly lastUsedAt: string | null
  readonly createdAt: string
}

type AgentRow = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly permissions: readonly string[]
  readonly enabled: boolean
}

const TABS = ['people', 'roles', 'tokens', 'agents'] as const

/** Lists are always paginated: Studio never loads a whole dataset (SPEC.md §89). */
const Pages = ({
  page,
  of,
  onChange,
}: {
  page: number
  of: number | undefined
  onChange(page: number): void
}) =>
  of === undefined || of <= 1 ? null : (
    <div className="flex items-center justify-between text-sm text-ink-soft">
      <span>
        Page {page} of {of}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= of}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )

type Tab = (typeof TABS)[number]

const useRoles = () =>
  useQuery({
    queryKey: ['roles'],
    queryFn: ({ signal }) => api.query<{ data: Role[] }>('auth.roles.list', {}, signal),
  })

const NewUser = ({ roles, onClose }: { roles: readonly Role[]; onClose(): void }) => {
  const client = useQueryClient()
  const [values, setValues] = useState({ name: '', email: '', password: '', role: '' })

  const create = useMutation({
    mutationFn: () =>
      api.command('auth.users.create', {
        name: values.name,
        email: values.email,
        password: values.password,
        ...(values.role === '' ? {} : { roles: [values.role] }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6">
      <Card className="w-full max-w-md p-6">
        <h2 className="mb-4 text-sm font-semibold">New person</h2>

        <form className="space-y-4" onSubmit={submit}>
          <Field label="Name" required>
            <Input
              required
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </Field>

          <Field label="Email" required>
            <Input
              type="email"
              required
              value={values.email}
              onChange={(event) => setValues({ ...values, email: event.target.value })}
            />
          </Field>

          <Field label="Password" help="At least twelve characters" required>
            <Input
              type="password"
              required
              minLength={12}
              value={values.password}
              onChange={(event) => setValues({ ...values, password: event.target.value })}
            />
          </Field>

          <Field label="Role">
            <Select
              value={values.role}
              onChange={(event) => setValues({ ...values, role: event.target.value })}
            >
              <option value="">No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.name}>
                  {role.label}
                </option>
              ))}
            </Select>
          </Field>

          {create.isError && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {create.error instanceof ApiError ? create.error.message : 'Could not create them'}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

const People = () => {
  const client = useQueryClient()
  const { viewer } = useSession()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const roles = useRoles()

  const users = useQuery({
    queryKey: ['users', search, page],
    queryFn: ({ signal }) => api.query<Paged<UserRow>>('auth.users.list', { search, page }, signal),
  })

  const change = useMutation({
    mutationFn: ({ command, input }: { command: string; input: Record<string, unknown> }) =>
      api.command(command, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Input
          type="search"
          placeholder="Search by name or email…"
          className="max-w-xs"
          value={search}
          onChange={(event) => {
            setPage(1)
            setSearch(event.target.value)
          }}
        />
        <Button className="ml-auto" onClick={() => setCreating(true)}>
          New person
        </Button>
      </div>

      {users.isError && <Failure error={users.error} />}
      {change.isError && <Failure error={change.error} />}

      <Card className="overflow-hidden">
        {users.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {users.data?.data.length === 0 && <Empty title="Nobody matches that" />}

        {users.data !== undefined && users.data.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Roles</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="w-0 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.data.data.map((user) => (
                <tr key={user.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-medium">{user.name}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{user.email}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {user.roles.map((role) => (
                        <button
                          key={role}
                          type="button"
                          title="Take this role away"
                          onClick={() =>
                            change.mutate({
                              command: 'auth.roles.revoke',
                              input: { userId: user.id, role },
                            })
                          }
                        >
                          <Badge tone="accent">{role} ×</Badge>
                        </button>
                      ))}

                      <div className="w-28">
                        <Select
                          className="h-7 py-0 text-xs"
                          value=""
                          onChange={(event) =>
                            change.mutate({
                              command: 'auth.roles.grant',
                              input: { userId: user.id, role: event.target.value },
                            })
                          }
                        >
                          <option value="">Add role…</option>
                          {(roles.data?.data ?? [])
                            .filter((role) => !user.roles.includes(role.name))
                            .map((role) => (
                              <option key={role.id} value={role.name}>
                                {role.label}
                              </option>
                            ))}
                        </Select>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={user.active ? 'positive' : 'danger'}>
                      {user.active ? 'active' : 'blocked'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={user.id === viewer?.id}
                      title={user.id === viewer?.id ? 'You cannot block yourself' : undefined}
                      onClick={() =>
                        change.mutate({
                          command: 'auth.users.update',
                          input: { id: user.id, active: !user.active },
                        })
                      }
                    >
                      {user.active ? 'Block' : 'Unblock'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-4">
        <Pages page={page} of={users.data?.lastPage} onChange={setPage} />
      </div>

      {creating && <NewUser roles={roles.data?.data ?? []} onClose={() => setCreating(false)} />}
    </>
  )
}

const Roles = () => {
  const roles = useRoles()

  const permissions = useQuery({
    queryKey: ['permissions'],
    queryFn: ({ signal }) =>
      api.query<{ data: { id: string; name: string }[] }>('auth.permissions.list', {}, signal),
  })

  return (
    <div className="space-y-4">
      {roles.isError && <Failure error={roles.error} />}
      {roles.isPending && <Spinner />}

      <div className="grid gap-3 sm:grid-cols-2">
        {roles.data?.data.map((role) => (
          <Card key={role.id} className="space-y-2 p-4">
            <div className="flex items-baseline justify-between">
              <p className="font-medium">{role.label}</p>
              <code className="font-mono text-xs text-ink-faint">{role.name}</code>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {role.permissions.map((permission) => (
                <Badge key={permission}>{permission}</Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <p className="mb-2 text-sm font-semibold">Every permission this application has recorded</p>
        <p className="mb-3 text-sm text-ink-soft">
          A permission name is a command name. <code className="font-mono">articles.*</code> grants
          everything under it.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {permissions.data?.data.map((permission) => (
            <Badge key={permission.id}>{permission.name}</Badge>
          ))}
        </div>
      </Card>
    </div>
  )
}

const DAYS = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'A year', days: 365 },
  { label: 'Never', days: 0 },
] as const

const NewToken = ({ onIssued, onClose }: { onIssued(token: string): void; onClose(): void }) => {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [expiry, setExpiry] = useState(90)

  const permissions = useQuery({
    queryKey: ['permissions'],
    queryFn: ({ signal }) =>
      api.query<{ data: { id: string; name: string }[] }>('auth.permissions.list', {}, signal),
  })

  const create = useMutation({
    mutationFn: () =>
      api.command<{ token: string }>('auth.tokens.create', {
        name,
        permissions: chosen,
        ...(expiry === 0
          ? {}
          : { expiresAt: new Date(Date.now() + expiry * 86_400_000).toISOString() }),
      }),
    onSuccess: async (result) => {
      onIssued(result.token)
      await client.invalidateQueries({ queryKey: ['tokens'] })
      onClose()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6">
      <Card className="w-full max-w-md p-6">
        <h2 className="mb-1 text-sm font-semibold">Issue an API token</h2>
        <p className="mb-4 text-sm text-ink-soft">
          A token can do exactly what you give it, and no more than you hold yourself.
        </p>

        <form className="space-y-4" onSubmit={submit}>
          <Field label="What is it for?" required>
            <Input
              required
              placeholder="Analytics export"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field
            label="Expires"
            help="A token that never expires is one nobody remembers to revoke"
          >
            <Select
              value={String(expiry)}
              onChange={(event) => setExpiry(Number(event.target.value))}
            >
              {DAYS.map((option) => (
                <option key={option.label} value={option.days}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Permissions"
            required
            {...(chosen.length === 0 ? { errors: ['Choose at least one'] } : {})}
          >
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {permissions.data?.data.map((permission) => (
                <label
                  key={permission.id}
                  className="flex items-center gap-2 text-sm text-ink-soft"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={chosen.includes(permission.name)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, permission.name]
                          : current.filter((entry) => entry !== permission.name),
                      )
                    }
                  />
                  <code className="font-mono text-xs">{permission.name}</code>
                </label>
              ))}
            </div>
          </Field>

          {create.isError && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {create.error instanceof ApiError ? create.error.message : 'Could not issue it'}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending || chosen.length === 0}>
              {create.isPending ? 'Issuing…' : 'Issue'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

const Tokens = () => {
  const client = useQueryClient()
  const [issued, setIssued] = useState<string>()
  const [issuing, setIssuing] = useState(false)
  const [page, setPage] = useState(1)

  const tokens = useQuery({
    queryKey: ['tokens', page],
    queryFn: ({ signal }) => api.query<Paged<ApiTokenRow>>('auth.tokens.list', { page }, signal),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => api.command('auth.tokens.revoke', { id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tokens'] }),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setIssuing(true)}>Issue a token</Button>
      </div>

      {issued !== undefined && (
        <Card className="border-positive/30 bg-positive-soft p-4">
          <p className="mb-1 text-sm font-medium text-positive">
            Copy this now. It is never shown again.
          </p>
          <code className="block break-all font-mono text-xs">{issued}</code>
        </Card>
      )}

      {tokens.isError && <Failure error={tokens.error} />}

      <Card className="overflow-hidden">
        {tokens.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {tokens.data?.data.length === 0 && (
          <Empty title="No API tokens">A token authenticates an integration, not a person.</Empty>
        )}

        {tokens.data !== undefined && tokens.data.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Permissions</th>
                <th className="px-4 py-2.5 font-medium">Last used</th>
                <th className="w-0 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tokens.data.data.map((token) => (
                <tr key={token.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-medium">{token.name}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {token.permissions.map((permission) => (
                        <Badge key={permission}>{permission}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    {token.lastUsedAt === null
                      ? 'Never'
                      : new Date(token.lastUsedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => {
                        if (window.confirm(`Revoke “${token.name}”? It stops working at once.`)) {
                          revoke.mutate(token.id)
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Pages page={page} of={tokens.data?.lastPage} onChange={setPage} />

      {issuing && <NewToken onIssued={setIssued} onClose={() => setIssuing(false)} />}
    </div>
  )
}

const Agents = () => {
  const client = useQueryClient()
  const [page, setPage] = useState(1)

  const agents = useQuery({
    queryKey: ['agents', page],
    queryFn: ({ signal }) => api.query<Paged<AgentRow>>('auth.agents.list', { page }, signal),
  })

  const update = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      api.command('auth.agents.update', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['agents'] }),
  })

  return (
    <>
      {agents.isError && <Failure error={agents.error} />}

      <Card className="overflow-hidden">
        {agents.isPending && (
          <div className="p-6">
            <Spinner />
          </div>
        )}

        {agents.data?.data.length === 0 && (
          <Empty title="No agents yet">
            An agent is an identity with its own permissions, audited like anyone else.
          </Empty>
        )}

        {agents.data?.data.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{agent.name}</p>
              <p className="truncate text-sm text-ink-soft">{agent.description}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {agent.permissions.map((permission) => (
                  <Badge key={permission}>{permission}</Badge>
                ))}
              </div>
            </div>

            <Badge tone={agent.enabled ? 'positive' : 'danger'}>
              {agent.enabled ? 'enabled' : 'disabled'}
            </Badge>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => update.mutate({ id: agent.id, enabled: !agent.enabled })}
            >
              {agent.enabled ? 'Disable' : 'Enable'}
            </Button>
          </div>
        ))}
      </Card>

      <div className="mt-4">
        <Pages page={page} of={agents.data?.lastPage} onChange={setPage} />
      </div>
    </>
  )
}

export const Users = () => {
  const [tab, setTab] = useState<Tab>('people')

  return (
    <Page title="Users" description="Who may sign in, and what they may do">
      <div className="mb-4 flex gap-1">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition',
              tab === name ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface-sunken',
            ].join(' ')}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'people' && <People />}
      {tab === 'roles' && <Roles />}
      {tab === 'tokens' && <Tokens />}
      {tab === 'agents' && <Agents />}
    </Page>
  )
}
