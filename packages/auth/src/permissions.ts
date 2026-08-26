/**
 * What an actor is allowed to do (SPEC.md §50).
 *
 * A user's permissions come from the roles they hold; an API token and an agent
 * carry their own list. All three answer the same question the same way, which is
 * why a policy never has to know which kind of actor it is looking at.
 */
import type { Actor } from '@assemora/core'

import { Agent, ApiToken, Permission, RolePermission, UserRole } from './models.js'

/** Grants everything. Given to the first administrator, and to nobody casually. */
export const WILDCARD = '*'

export type PermissionSet = ReadonlySet<string>

const EMPTY: PermissionSet = new Set()

const permissionsOfUser = async (userId: string): Promise<PermissionSet> => {
  const roles = await UserRole.where('userId', userId)

  if (roles.length === 0) return EMPTY

  const links = await RolePermission.whereIn(
    'roleId',
    roles.map((role) => role.roleId),
  )

  if (links.length === 0) return EMPTY

  const permissions = await Permission.whereIn(
    'id',
    links.map((link) => link.permissionId),
  )

  return new Set(permissions.map((permission) => permission.name))
}

const permissionsOfAgent = async (agentId: string): Promise<PermissionSet> => {
  const agent = await Agent.find(agentId)

  if (agent === null || !agent.enabled) return EMPTY

  return new Set(agent.permissions)
}

const permissionsOfApiToken = async (tokenId: string): Promise<PermissionSet> => {
  const token = await ApiToken.find(tokenId)

  return token === null ? EMPTY : new Set(token.permissions)
}

/** Everything this actor may do, whoever they are. */
export const permissionsOf = async (actor: Actor | undefined): Promise<PermissionSet> => {
  if (actor === undefined) return EMPTY

  switch (actor.type) {
    case 'user':
      return permissionsOfUser(actor.id)
    case 'agent':
      return permissionsOfAgent(actor.id)
    case 'api':
      return permissionsOfApiToken(actor.id)
  }
}

/**
 * Whether a permission is held, exactly or by a wildcard above it.
 *
 * `articles.update` is held by `articles.update`, by `articles.*`, and by `*`. The
 * grouped form is what makes a role like "editor" writable at all — `content.*` says
 * something a list of forty names does not — and it matches how the names themselves
 * are built, since a command name *is* a permission name (ADR-0015).
 *
 * Only whole segments match: `articles.*` does not grant `articlesecret.read`.
 */
export const holds = (permissions: PermissionSet, permission: string): boolean => {
  if (permissions.has(WILDCARD) || permissions.has(permission)) return true

  const segments = permission.split('.')

  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    if (permissions.has(`${segments.slice(0, depth).join('.')}.*`)) return true
  }

  return false
}
