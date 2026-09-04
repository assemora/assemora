/**
 * Authentication commands (SPEC.md §14, §49).
 *
 * Signing in changes state — a session is created — so it travels the Command Bus
 * like every other mutation, and is audited like every other mutation.
 */
import {
  AssemoraError,
  type CommandContext,
  ConflictError,
  command,
  ForbiddenError,
  NotFoundError,
} from '@assemora/core'
import {
  array,
  boolean,
  email as emailSchema,
  number,
  string,
  timestamp,
  uuid,
} from '@assemora/schema'

import { hashPassword, verifyPassword } from './credentials.js'
import { Agent, ApiToken, Permission, Role, RolePermission, User, UserRole } from './models.js'
import { holds, permissionsOf } from './permissions.js'
import { policy } from './policies.js'
import { endSession, startSession } from './sessions.js'
import { createAgent, createApiToken } from './tokens.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'auth.signed-in': { readonly userId: string }
    'auth.signed-out': { readonly userId: string | undefined }
    'auth.user-created': { readonly userId: string }
  }
}

/**
 * A hash to verify against when the email is unknown.
 *
 * Without it, a missing user answers faster than a wrong password, and the timing
 * says which emails are registered (SPEC.md §85).
 */
const DECOY = await hashPassword('a password nobody has')

const INVALID = new AssemoraError('INVALID_CREDENTIALS', 'The email or password is wrong', {
  status: 401,
})

/**
 * Refuses to hand out more than the giver has (SPEC.md §50, §72).
 *
 * A role, an API token and an agent all carry permissions, and any of the three would
 * otherwise be a way to mint a credential stronger than the actor minting it — an
 * escalation that leaves an ordinary-looking audit trail.
 */
const grantable = async (
  permissions: readonly string[],
  context: CommandContext,
): Promise<void> => {
  const held = await permissionsOf(context.actor)
  const beyond = permissions.filter((permission) => !holds(held, permission))

  if (beyond.length > 0) {
    throw new ForbiddenError(
      `You cannot grant what you do not hold: ${[...new Set(beyond)].sort().join(', ')}`,
    )
  }
}

/**
 * Links permission names to a role, recording any that had not been seen before.
 *
 * A permission name is a command name (ADR-0015), so the set of legal ones is
 * whatever the application declares — there is no fixed list to validate against, and
 * inventing one would make a role uneditable the moment a package added a command.
 */
const attach = async (roleId: string, names: readonly string[]): Promise<void> => {
  for (const name of names) {
    const permission =
      (await Permission.where('name', name).first()) ??
      (await Permission.create({ name, description: null }))

    const existing = await RolePermission.where('roleId', roleId)
      .where('permissionId', permission.id)
      .first()

    if (existing === null) await RolePermission.create({ roleId, permissionId: permission.id })
  }
}

/**
 * The two commands a route has to front (SPEC.md §85).
 *
 * `publicAuthPolicy` authorizes them for everybody, because the caller of a login is
 * nobody yet. That removes the floor every other command stands on — the bus
 * authorizes first, and authorization denies by default — so the checks that make
 * them safe live in the routes written for them: the session leaves as an `httpOnly`
 * cookie rather than as readable JSON, a CSRF token is minted beside it, logging out
 * clears both, and the forensic fields come off the request.
 *
 * A generated `POST /commands/auth.login` or an MCP tool would be the same handler
 * with none of that in front of it — and, since agent permissions never gate a
 * publicly authorized command, an agent token would be a password oracle. Saying it
 * here is what keeps both generators away, instead of a list of names each of them
 * would have to maintain.
 */
export const SignIn = command('auth.login', {
  description: 'Exchanges an email and a password for a session',
  reachableFrom: 'its own route',
  input: { email: emailSchema(), password: string() },
  output: { token: string(), expiresAt: timestamp(), userId: uuid() },
  handle: async ({ email, password }, context) => {
    const user = await User.where('email', email.toLowerCase()).first()
    const correct = await verifyPassword(user?.passwordHash ?? DECOY, password)

    // The same answer either way: whether the email exists is not something an
    // unauthenticated caller gets to learn.
    if (user === null || !correct || !user.active) throw INVALID

    // Off the context, never out of the input: a caller that names its own user agent
    // is writing the forensic record of its own sign-in. There is no `ipAddress` for
    // the same reason there is none on the context — nothing here knows the client's
    // address without a trusted-proxy policy the HTTP server does not yet offer, and
    // a column holding a claim is worse than a column holding nothing.
    const session = await startSession(user.id, {
      ...(context.userAgent === undefined ? {} : { userAgent: context.userAgent }),
    })

    context.emit('auth.signed-in', { userId: user.id })

    return { token: session.token, expiresAt: session.expiresAt, userId: user.id }
  },
})

export const SignOut = command('auth.logout', {
  description: 'Ends a session',
  reachableFrom: 'its own route',
  input: { token: string() },
  output: { ended: boolean() },
  handle: async ({ token }, context) => {
    await endSession(token)
    context.emit('auth.signed-out', { userId: context.actor?.id })

    return { ended: true }
  },
})

export const CreateUser = command('auth.users.create', {
  description: 'Creates a user',
  input: {
    email: emailSchema(),
    name: string(),
    password: string().min(12),
    roles: array(string()).optional(),
  },
  output: { id: uuid() },
  handle: async ({ email, name, password, roles }, context) => {
    const user = await User.create({
      email: email.toLowerCase(),
      name,
      passwordHash: await hashPassword(password),
      active: true,
    })

    for (const roleName of roles ?? []) {
      const role = await Role.where('name', roleName).first()

      if (role === null) {
        throw new AssemoraError('UNKNOWN_ROLE', `There is no role named "${roleName}"`, {
          status: 422,
        })
      }

      await UserRole.create({ userId: user.id, roleId: role.id })
    }

    context.revise({
      entityType: 'assemora_users',
      entityId: user.id,
      before: null,
      after: user.toJSON(),
    })
    context.emit('auth.user-created', { userId: user.id })

    return { id: user.id }
  },
})

export const GrantRole = command('auth.roles.grant', {
  description: 'Gives a user a role',
  input: { userId: uuid(), role: string() },
  output: { userId: uuid(), role: string() },
  handle: async ({ userId, role }) => {
    const found = await Role.where('name', role).first()

    if (found === null) {
      throw new AssemoraError('UNKNOWN_ROLE', `There is no role named "${role}"`, { status: 422 })
    }

    const existing = await UserRole.where('userId', userId).where('roleId', found.id).first()

    if (existing === null) await UserRole.create({ userId, roleId: found.id })

    return { userId, role }
  },
})

export const CreateApiToken = command('auth.tokens.create', {
  description: 'Issues an API token. The token is returned once and never again',
  input: {
    name: string(),
    permissions: array(string()),
    userId: uuid().optional(),
    expiresAt: timestamp().optional(),
  },
  output: { token: string(), id: uuid() },
  handle: async (input, context) => {
    await grantable(input.permissions, context)

    return createApiToken({
      name: input.name,
      permissions: input.permissions,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })
  },
})

export const CreateAgent = command('auth.agents.create', {
  description: 'Creates an agent identity and its first token (SPEC.md §72)',
  input: { name: string(), description: string().optional(), permissions: array(string()) },
  output: { agentId: uuid(), token: string(), tokenId: uuid() },
  handle: async (input, context) => {
    await grantable(input.permissions, context)

    return createAgent({
      name: input.name,
      permissions: input.permissions,
      ...(input.description === undefined ? {} : { description: input.description }),
    })
  },
})

/** Reads the row and refuses to go on if someone else has written since (SPEC.md §66). */
const versioned = async <T extends { version: number }>(
  load: () => Promise<T | null>,
  what: string,
  id: string,
  expectedVersion: number | undefined,
): Promise<T> => {
  const found = await load()

  if (found === null) throw new NotFoundError(what, id)

  if (expectedVersion !== undefined && found.version !== expectedVersion) {
    throw new ConflictError(`This ${what} has changed since it was read`, {
      expectedVersion,
      currentVersion: found.version,
    })
  }

  return found
}

export const UpdateUser = command('auth.users.update', {
  description: 'Changes a user name, email or whether they may sign in',
  input: {
    id: uuid(),
    expectedVersion: number().integer().optional(),
    name: string().min(1).optional(),
    email: emailSchema().optional(),
    active: boolean().optional(),
  },
  output: { id: uuid(), version: number().integer() },
  handle: async ({ id, expectedVersion, name, email, active }, context) => {
    const user = await versioned(() => User.find(id), 'user', id, expectedVersion)
    const before = user.toJSON()

    await context.authorize('auth.users', 'update', before)

    await user.update({
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email: email.toLowerCase() }),
      ...(active === undefined ? {} : { active }),
      version: user.version + 1,
    })

    context.revise({
      entityType: 'assemora_users',
      entityId: id,
      before,
      after: user.toJSON(),
    })

    return { id, version: user.version }
  },
})

export const SetPassword = command('auth.users.password', {
  description: 'Sets a user password. The old one is never read back to check it',
  input: { id: uuid(), password: string().min(12) },
  output: { id: uuid() },
  handle: async ({ id, password }, context) => {
    const user = await User.find(id)

    if (user === null) throw new NotFoundError('user', id)

    await context.authorize('auth.users', 'update', user.toJSON())

    await user.update({ passwordHash: await hashPassword(password), version: user.version + 1 })

    // Deliberately no revision: a revision stores before and after, and neither
    // belongs in a table anybody can read (SPEC.md §85).
    return { id }
  },
})

export const RevokeRole = command('auth.roles.revoke', {
  description: 'Takes a role away from a user',
  input: { userId: uuid(), role: string() },
  output: { userId: uuid(), role: string() },
  handle: async ({ userId, role }, context) => {
    const found = await Role.where('name', role).first()

    if (found === null) {
      throw new AssemoraError('UNKNOWN_ROLE', `There is no role named "${role}"`, { status: 422 })
    }

    await context.authorize('auth.roles', 'revoke', { userId, role })

    const link = await UserRole.where('userId', userId).where('roleId', found.id).first()

    if (link !== null) await link.delete()

    return { userId, role }
  },
})

export const CreateRole = command('auth.roles.create', {
  description: 'Creates a role and the permissions it carries',
  input: { name: string().min(1), label: string().min(1), permissions: array(string()) },
  output: { id: uuid(), name: string() },
  handle: async ({ name, label, permissions }, context) => {
    await grantable(permissions, context)

    if ((await Role.where('name', name).first()) !== null) {
      throw new AssemoraError('ROLE_EXISTS', `There is already a role named "${name}"`, {
        status: 409,
      })
    }

    const role = await Role.create({ name, label, version: 1 })

    await attach(role.id, permissions)

    context.revise({
      entityType: 'assemora_roles',
      entityId: role.id,
      before: null,
      after: role.toJSON(),
    })

    return { id: role.id, name: role.name }
  },
})

export const UpdateRole = command('auth.roles.update', {
  description: 'Renames a role or replaces the permissions it carries',
  input: {
    id: uuid(),
    expectedVersion: number().integer().optional(),
    label: string().min(1).optional(),
    permissions: array(string()).optional(),
  },
  output: { id: uuid(), version: number().integer() },
  handle: async ({ id, expectedVersion, label, permissions }, context) => {
    const role = await versioned(() => Role.find(id), 'role', id, expectedVersion)
    const before = role.toJSON()

    await context.authorize('auth.roles', 'update', before)

    if (permissions !== undefined) await grantable(permissions, context)

    await role.update({ ...(label === undefined ? {} : { label }), version: role.version + 1 })

    if (permissions !== undefined) {
      for (const link of await RolePermission.where('roleId', id)) await link.delete()

      await attach(id, permissions)
    }

    context.revise({ entityType: 'assemora_roles', entityId: id, before, after: role.toJSON() })

    return { id, version: role.version }
  },
})

export const DeleteRole = command('auth.roles.delete', {
  description: 'Deletes a role, and takes it from everyone who held it',
  input: { id: uuid() },
  output: { id: uuid() },
  handle: async ({ id }, context) => {
    const role = await Role.find(id)

    if (role === null) throw new NotFoundError('role', id)

    await context.authorize('auth.roles', 'delete', role.toJSON())

    for (const link of await RolePermission.where('roleId', id)) await link.delete()
    for (const link of await UserRole.where('roleId', id)) await link.delete()

    await role.delete()

    return { id }
  },
})

export const RevokeApiToken = command('auth.tokens.revoke', {
  description: 'Stops an API token working, at once and for good',
  input: { id: uuid() },
  output: { id: uuid() },
  handle: async ({ id }, context) => {
    const token = await ApiToken.find(id)

    if (token === null) throw new NotFoundError('token', id)

    await context.authorize('auth.tokens', 'revoke', { id: token.id, name: token.name })
    await token.delete()

    return { id }
  },
})

export const UpdateAgent = command('auth.agents.update', {
  description: 'Changes what an agent may do, or turns it off (SPEC.md §72)',
  input: {
    id: uuid(),
    description: string().optional(),
    permissions: array(string()).optional(),
    enabled: boolean().optional(),
  },
  output: { id: uuid(), enabled: boolean() },
  handle: async ({ id, description, permissions, enabled }, context) => {
    if (permissions !== undefined) await grantable(permissions, context)

    const agent = await Agent.find(id)

    if (agent === null) throw new NotFoundError('agent', id)

    const before = agent.toJSON()

    await context.authorize('auth.agents', 'update', before)

    await agent.update({
      ...(description === undefined ? {} : { description }),
      ...(permissions === undefined ? {} : { permissions }),
      ...(enabled === undefined ? {} : { enabled }),
    })

    context.revise({ entityType: 'assemora_agents', entityId: id, before, after: agent.toJSON() })

    return { id, enabled: agent.enabled }
  },
})

/**
 * Signing in and signing out are open to anyone; everything else in `auth` needs the
 * matching permission, which is what having no policy for it means.
 */
export const publicAuthPolicy = policy('auth', {
  login: () => true,
  logout: () => true,
})

export const authCommands = [
  SignIn,
  SignOut,
  CreateUser,
  UpdateUser,
  SetPassword,
  GrantRole,
  RevokeRole,
  CreateRole,
  UpdateRole,
  DeleteRole,
  CreateApiToken,
  RevokeApiToken,
  CreateAgent,
  UpdateAgent,
] as const
