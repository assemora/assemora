/**
 * Reading who exists and what they may do (SPEC.md §15, §50).
 *
 * Administration screens need to see users, roles, permissions, tokens and agents,
 * and every one of those reads travels the Query Bus — so it is validated, it is
 * authorized, and no layer above this one has to depend on it (ADR-0014).
 *
 * Nothing sensitive is projected. A password hash and a token digest exist in this
 * package and stop here (SPEC.md §85).
 */
import { NotFoundError, query } from '@assemora/core'
import { boolean, number, string, uuid } from '@assemora/schema'

import { Agent, ApiToken, Permission, Role, RolePermission, User, UserRole } from './models.js'
import { permissionsOf } from './permissions.js'

const paging = {
  page: number().integer().optional(),
  perPage: number().integer().optional(),
}

const limit = (perPage: number | undefined): number => Math.min(perPage ?? 20, 100)

/** The role names a set of users hold, in one query rather than one per user. */
const rolesByUser = async (userIds: readonly string[]): Promise<Map<string, string[]>> => {
  const byUser = new Map<string, string[]>()

  if (userIds.length === 0) return byUser

  const links = await UserRole.whereIn('userId', [...userIds])

  if (links.length === 0) return byUser

  const roles = await Role.whereIn('id', [...new Set(links.map((link) => link.roleId))])
  const nameById = new Map(roles.map((role) => [role.id, role.name]))

  for (const link of links) {
    const name = nameById.get(link.roleId)

    if (name === undefined) continue

    byUser.set(link.userId, [...(byUser.get(link.userId) ?? []), name])
  }

  return byUser
}

export const ListUsers = query('auth.users.list', {
  description: 'A page of users, with the roles they hold',
  input: { search: string().optional(), active: boolean().optional(), ...paging },
  handle: async ({ search, active, page, perPage }) => {
    let found = User.orderBy('createdAt', 'desc')

    if (active !== undefined) found = found.where('active', active)
    if (search !== undefined && search !== '') {
      found = found.where((builder) =>
        builder.whereLike('name', `%${search}%`).orWhere('email', 'like', `%${search}%`),
      )
    }

    const listed = await found.paginate(page ?? 1, limit(perPage))
    const roles = await rolesByUser(listed.data.map((user) => user.id))

    return {
      ...listed,
      data: listed.data.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        active: user.active,
        roles: roles.get(user.id) ?? [],
        /** Echoed back as `expectedVersion` by any edit (SPEC.md §66). */
        version: user.version,
        createdAt: user.createdAt,
      })),
    }
  },
})

export const GetUser = query('auth.users.get', {
  description: 'One user, with their roles and everything those roles allow',
  input: { id: uuid() },
  handle: async ({ id }) => {
    const user = await User.find(id)

    if (user === null) throw new NotFoundError('user', id)

    const roles = await rolesByUser([user.id])

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      active: user.active,
      roles: roles.get(user.id) ?? [],
      permissions: [...(await permissionsOf({ type: 'user', id: user.id }))],
      version: user.version,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  },
})

export const ListRoles = query('auth.roles.list', {
  description: 'Every role, with the permissions it carries',
  input: {},
  handle: async () => {
    const roles = await Role.orderBy('name', 'asc').get()
    const links = await RolePermission.whereIn(
      'roleId',
      roles.map((role) => role.id),
    )
    const permissions = await Permission.whereIn('id', [
      ...new Set(links.map((link) => link.permissionId)),
    ])
    const nameById = new Map(permissions.map((permission) => [permission.id, permission.name]))

    return {
      data: roles.map((role) => ({
        id: role.id,
        name: role.name,
        label: role.label,
        version: role.version,
        permissions: links
          .filter((link) => link.roleId === role.id)
          .map((link) => nameById.get(link.permissionId))
          .filter((name): name is string => name !== undefined)
          .sort(),
      })),
    }
  },
})

export const ListPermissions = query('auth.permissions.list', {
  description: 'Every permission that has been recorded',
  input: {},
  handle: async () => ({
    data: (await Permission.orderBy('name', 'asc').get()).map((permission) => ({
      id: permission.id,
      name: permission.name,
      description: permission.description,
    })),
  }),
})

export const ListApiTokens = query('auth.tokens.list', {
  description: 'Which API tokens exist. Never what they are',
  input: { userId: uuid().optional(), ...paging },
  handle: async ({ userId, page, perPage }) => {
    let found = ApiToken.orderBy('createdAt', 'desc')

    if (userId !== undefined) found = found.where('userId', userId)

    const listed = await found.paginate(page ?? 1, limit(perPage))

    return {
      ...listed,
      data: listed.data.map((token) => ({
        id: token.id,
        name: token.name,
        userId: token.userId,
        permissions: token.permissions,
        expiresAt: token.expiresAt,
        lastUsedAt: token.lastUsedAt,
        createdAt: token.createdAt,
      })),
    }
  },
})

export const ListAgents = query('auth.agents.list', {
  description: 'The agent identities this application knows (SPEC.md §72)',
  input: paging,
  handle: async ({ page, perPage }) => {
    const listed = await Agent.orderBy('name', 'asc').paginate(page ?? 1, limit(perPage))

    return {
      ...listed,
      data: listed.data.map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        permissions: agent.permissions,
        enabled: agent.enabled,
        createdAt: agent.createdAt,
      })),
    }
  },
})

export const authQueries = [
  ListUsers,
  GetUser,
  ListRoles,
  ListPermissions,
  ListApiTokens,
  ListAgents,
] as const
