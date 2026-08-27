/**
 * What an actor is allowed to do (SPEC.md §50).
 *
 * A user's permissions come from the roles they hold; an API token and an agent
 * carry their own list. All three answer the same question the same way, which is
 * why a policy never has to know which kind of actor it is looking at.
 *
 * All three are also asked a question before that one: whether this is still an
 * actor at all. It is asked *here* rather than where a credential is accepted,
 * because not every path presents a credential. A session is checked when the cookie
 * is read (`sessionActor`) and a bearer token when the header is (`tokenActor`), but
 * a job carries an actor sealed into an envelope and is replayed by a worker hours
 * later with nothing to present — as does anything else that stores an identity and
 * acts on it afterwards. This function is the one narrow place every one of those
 * paths goes through, so this is where liveness has to be decided (ADR-0023).
 *
 * The cost is a row read: resolving a user's permissions is four queries rather than
 * three, and the command pipeline resolves them twice — once for the permission
 * check and once for the policy rule (ADR-0015). It buys the only revocation the
 * framework has, so it is paid on every command. A deactivated actor short-circuits
 * to one query, which is the case where it matters that it is cheap.
 */
import type { Actor } from '@assemora/core'

import { Agent, ApiToken, Permission, RolePermission, User, UserRole } from './models.js'
import { isLive } from './tokens.js'

/** Grants everything. Given to the first administrator, and to nobody casually. */
export const WILDCARD = '*'

export type PermissionSet = ReadonlySet<string>

const EMPTY: PermissionSet = new Set()

/**
 * Whether the person behind an actor may still act.
 *
 * An absent row is deliberately *not* a revocation. The framework has no user
 * deletion — `active: false` is the whole of how a person is cut off — so an absence
 * is never something this system decided; it is an application whose identities live
 * in an SSO directory and whose roles are assigned here, and denying on absence
 * would make `assemora_user_roles` unusable for it. `active: false` is a statement,
 * and it is the one that binds.
 */
const userIsLive = async (userId: string): Promise<boolean> => {
  const user = await User.find(userId)

  return user === null || user.active
}

const permissionsOfUser = async (userId: string): Promise<PermissionSet> => {
  // Asked first, so a user who may not act costs one read instead of four.
  if (!(await userIsLive(userId))) return EMPTY

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

  // `tokenActor` refuses an expired token at the header, but a token id restored
  // from anywhere else — a queue, a stored context — never passes that check, and a
  // token whose expiry has come and gone is not a credential any more.
  if (token === null || !isLive(token.expiresAt)) return EMPTY

  // A token issued *for* a person is that person's access under another name.
  // Deactivating them has to take it with it, or the one revocation gesture the
  // framework has quietly leaves a door open (SPEC.md §49).
  if (token.userId !== null && !(await userIsLive(token.userId))) return EMPTY

  return new Set(token.permissions)
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
