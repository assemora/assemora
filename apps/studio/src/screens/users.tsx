/**
 * Users, roles and tokens (SPEC.md §50, §72, §115).
 *
 * Every change here is a command, so an administrator in Studio and an agent through
 * MCP pass the same permission checks — there is no privileged path into identity.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users as UsersIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { ApiError, api } from '../api/client.ts'
import type { Paged } from '../api/pages.ts'
import { useSession } from '../api/session.tsx'
import type { MessageKey } from '../i18n/messages.ts'
import { useDates, useT, useWoven } from '../i18n/translate.tsx'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Failure,
  Field,
  Input,
  Select,
  Spinner,
} from '../ui/index.tsx'
import { Screen, ScreenBody, ScreenHead, ScreenTitle, Tabs } from '../ui/layout.tsx'

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
}) => {
  const t = useT()

  return of === undefined || of <= 1 ? null : (
    <div className="flex items-center justify-between text-base text-ink-soft">
      <span>{t('paging.page', { page, last: of })}</span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          {t('paging.previous')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= of}
          onClick={() => onChange(page + 1)}
        >
          {t('paging.next')}
        </Button>
      </div>
    </div>
  )
}

type Tab = (typeof TABS)[number]

const LABELS = {
  people: 'people.tab.people',
  roles: 'people.tab.roles',
  tokens: 'people.tab.tokens',
  agents: 'people.tab.agents',
} as const satisfies Record<Tab, MessageKey>

const useRoles = () =>
  useQuery({
    queryKey: ['roles'],
    queryFn: ({ signal }) => api.query<{ data: Role[] }>('auth.roles.list', {}, signal),
  })

const NewUser = ({ roles, onClose }: { roles: readonly Role[]; onClose(): void }) => {
  const client = useQueryClient()
  const t = useT()
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
        <h2 className="mb-4 text-base font-semibold">{t('people.newPerson')}</h2>

        <form className="space-y-4" onSubmit={submit}>
          <Field label={t('people.name')} required>
            <Input
              required
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </Field>

          <Field label={t('login.email')} required>
            <Input
              type="email"
              required
              value={values.email}
              onChange={(event) => setValues({ ...values, email: event.target.value })}
            />
          </Field>

          <Field label={t('login.password')} help={t('people.passwordHelp')} required>
            <Input
              type="password"
              required
              minLength={12}
              value={values.password}
              onChange={(event) => setValues({ ...values, password: event.target.value })}
            />
          </Field>

          <Field label={t('people.role')}>
            <Select
              value={values.role}
              onChange={(event) => setValues({ ...values, role: event.target.value })}
            >
              <option value="">{t('people.noRole')}</option>
              {roles.map((role) => (
                <option key={role.id} value={role.name}>
                  {role.label}
                </option>
              ))}
            </Select>
          </Field>

          {create.isError && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-base text-danger">
              {create.error instanceof ApiError ? create.error.message : t('people.createFailed')}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('people.creating') : t('common.create')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
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
  const t = useT()
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
          placeholder={t('people.searchPlaceholder')}
          className="max-w-xs"
          value={search}
          onChange={(event) => {
            setPage(1)
            setSearch(event.target.value)
          }}
        />
        <Button className="ml-auto" onClick={() => setCreating(true)}>
          {t('people.newPerson')}
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

        {users.data?.data.length === 0 && <Empty title={t('people.noMatch')} />}

        {users.data !== undefined && users.data.data.length > 0 && (
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm font-[650] tracking-[0.01em] text-ink-soft">
                <th className="px-4 py-2.5 font-medium">{t('people.name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('login.email')}</th>
                <th className="px-4 py-2.5 font-medium">{t('people.tab.roles')}</th>
                <th className="px-4 py-2.5 font-medium">{t('pages.statusLabel')}</th>
                <th className="w-0 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.data.data.map((user) => (
                <tr key={user.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2.5 font-medium">{user.name}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{user.email}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {user.roles.map((role) => (
                        <button
                          key={role}
                          type="button"
                          title={t('people.takeRoleAway')}
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

                      {/* Wide enough for its own label: `Add role…` was clipped to
                          `Add ro…`, which is a control asking to be guessed at. */}
                      <div className="w-36">
                        <Select
                          size="small"
                          value=""
                          onChange={(event) =>
                            change.mutate({
                              command: 'auth.roles.grant',
                              input: { userId: user.id, role: event.target.value },
                            })
                          }
                        >
                          <option value="">{t('people.addRole')}</option>
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
                      {user.active ? t('people.active') : t('people.blocked')}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={user.id === viewer?.id}
                      title={user.id === viewer?.id ? t('people.cannotBlockSelf') : undefined}
                      onClick={() =>
                        change.mutate({
                          command: 'auth.users.update',
                          input: { id: user.id, active: !user.active },
                        })
                      }
                    >
                      {user.active ? t('people.block') : t('people.unblock')}
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
  const t = useT()
  const woven = useWoven()

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
              <code className="font-mono text-sm text-ink-faint">{role.name}</code>
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
        <p className="mb-2 text-base font-semibold">{t('people.allPermissions')}</p>
        <p className="mb-3 text-base text-ink-soft">
          {woven('people.permissionsAreCommands', {
            example: <code className="font-mono">articles.*</code>,
          })}
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
  { label: 'people.expiry.30', days: 30 },
  { label: 'people.expiry.90', days: 90 },
  { label: 'people.expiry.year', days: 365 },
  { label: 'common.never', days: 0 },
] as const satisfies readonly { label: MessageKey; days: number }[]

const NewToken = ({ onIssued, onClose }: { onIssued(token: string): void; onClose(): void }) => {
  const client = useQueryClient()
  const t = useT()
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
        <h2 className="mb-1 text-base font-semibold">{t('people.issueToken')}</h2>
        <p className="mb-4 text-base text-ink-soft">{t('people.tokenScope')}</p>

        <form className="space-y-4" onSubmit={submit}>
          <Field label={t('people.tokenPurpose')} required>
            <Input
              required
              placeholder={t('people.tokenExample')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label={t('people.expires')} help={t('people.expiresHelp')}>
            <Select
              value={String(expiry)}
              onChange={(event) => setExpiry(Number(event.target.value))}
            >
              {DAYS.map((option) => (
                <option key={option.label} value={option.days}>
                  {t(option.label)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t('people.permissions')}
            required
            {...(chosen.length === 0 ? { errors: [t('people.chooseOne')] } : {})}
          >
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {permissions.data?.data.map((permission) => (
                <Checkbox
                  key={permission.id}
                  checked={chosen.includes(permission.name)}
                  onChange={(ticked) =>
                    setChosen((current) =>
                      ticked
                        ? [...current, permission.name]
                        : current.filter((entry) => entry !== permission.name),
                    )
                  }
                >
                  <code className="font-mono text-sm">{permission.name}</code>
                </Checkbox>
              ))}
            </div>
          </Field>

          {create.isError && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-base text-danger">
              {create.error instanceof ApiError ? create.error.message : t('people.issueFailed')}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending || chosen.length === 0}>
              {create.isPending ? t('people.issuing') : t('people.issue')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

const Tokens = () => {
  const client = useQueryClient()
  const t = useT()
  const dates = useDates()
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
        <Button onClick={() => setIssuing(true)}>{t('people.issueAToken')}</Button>
      </div>

      {issued !== undefined && (
        <Card className="border-accent/30 bg-accent-wash p-4">
          <p className="mb-1 text-base font-medium text-accent-ink">{t('people.copyNow')}</p>
          <code className="block break-all font-mono text-sm">{issued}</code>
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
          <Empty title={t('people.noTokens')}>{t('people.noTokensBody')}</Empty>
        )}

        {tokens.data !== undefined && tokens.data.data.length > 0 && (
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm font-[650] tracking-[0.01em] text-ink-soft">
                <th className="px-4 py-2.5 font-medium">{t('people.name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('people.permissions')}</th>
                <th className="px-4 py-2.5 font-medium">{t('people.lastUsed')}</th>
                <th className="w-0 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tokens.data.data.map((token) => (
                <tr key={token.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2.5 font-medium">{token.name}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {token.permissions.map((permission) => (
                        <Badge key={permission}>{permission}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    {token.lastUsedAt === null ? t('common.never') : dates.date(token.lastUsedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => {
                        if (window.confirm(t('people.confirmRevoke', { name: token.name }))) {
                          revoke.mutate(token.id)
                        }
                      }}
                    >
                      {t('people.revoke')}
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
  const t = useT()
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
          <Empty title={t('people.noAgents')}>{t('people.noAgentsBody')}</Empty>
        )}

        {agents.data?.data.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{agent.name}</p>
              <p className="truncate text-base text-ink-soft">{agent.description}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {agent.permissions.map((permission) => (
                  <Badge key={permission}>{permission}</Badge>
                ))}
              </div>
            </div>

            <Badge tone={agent.enabled ? 'positive' : 'danger'}>
              {agent.enabled ? t('people.enabled') : t('people.disabled')}
            </Badge>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => update.mutate({ id: agent.id, enabled: !agent.enabled })}
            >
              {agent.enabled ? t('people.disable') : t('people.enable')}
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
  const t = useT()

  /* People, roles, tokens and agents are four views of one question — who may do what —
     so they are tabs on one screen rather than four destinations in the sidebar. */
  const views: readonly { value: Tab; label: string }[] = TABS.map((name) => ({
    value: name,
    label: t(LABELS[name]),
  }))

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<UsersIcon className="size-5" />}
          title={t('nav.users')}
          description={t('people.lede')}
        />
        <Tabs<Tab> value={tab} options={views} onChange={setTab} label={t('people.tabs')} />
      </ScreenHead>

      <ScreenBody className="pt-6 pb-10">
        {tab === 'people' && <People />}
        {tab === 'roles' && <Roles />}
        {tab === 'tokens' && <Tokens />}
        {tab === 'agents' && <Agents />}
      </ScreenBody>
    </Screen>
  )
}
