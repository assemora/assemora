/**
 * The tables authentication and authorization live in (SPEC.md §50).
 *
 * Nothing sensitive is stored as written: a password is an Argon2id hash and a token
 * is a digest. What a caller sees once, at creation, is the only time the plaintext
 * exists (SPEC.md §49, §85).
 */
import { boolean, integer, json, model, string, text, timestamp, uuid } from '@assemora/data'

export const User = model('assemora_users', {
  id: uuid().primary().defaultRandom(),
  email: string().unique(),
  name: string(),
  /** Argon2id. Never leaves the database and never reaches serialized output. */
  passwordHash: string().hidden(),
  active: boolean().default(true),
  /** Studio states the version it read, and a stale edit is a 409 (SPEC.md §66). */
  version: integer().default(1),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const Session = model('assemora_sessions', {
  id: uuid().primary().defaultRandom(),
  /** A digest of the session secret; the secret itself lives only in the cookie. */
  tokenHash: string().unique().hidden(),
  userId: uuid(),
  userAgent: string().nullable(),
  ipAddress: string().nullable(),
  expiresAt: timestamp(),
  createdAt: timestamp().created(),
})

export const Role = model('assemora_roles', {
  id: uuid().primary().defaultRandom(),
  name: string().unique(),
  label: string(),
  version: integer().default(1),
  createdAt: timestamp().created(),
})

export const Permission = model('assemora_permissions', {
  id: uuid().primary().defaultRandom(),
  name: string().unique(),
  description: text().nullable(),
})

export const UserRole = model('assemora_user_roles', {
  id: uuid().primary().defaultRandom(),
  userId: uuid(),
  roleId: uuid(),
})

export const RolePermission = model('assemora_role_permissions', {
  id: uuid().primary().defaultRandom(),
  roleId: uuid(),
  permissionId: uuid(),
})

export const ApiToken = model('assemora_api_tokens', {
  id: uuid().primary().defaultRandom(),
  name: string(),
  tokenHash: string().unique().hidden(),
  userId: uuid().nullable(),
  permissions: json<readonly string[]>(),
  expiresAt: timestamp().nullable(),
  lastUsedAt: timestamp().nullable(),
  createdAt: timestamp().created(),
})

export const Agent = model('assemora_agents', {
  id: uuid().primary().defaultRandom(),
  name: string().unique(),
  description: text().nullable(),
  permissions: json<readonly string[]>(),
  enabled: boolean().default(true),
  createdAt: timestamp().created(),
})

export const AgentToken = model('assemora_agent_tokens', {
  id: uuid().primary().defaultRandom(),
  agentId: uuid(),
  name: string(),
  tokenHash: string().unique().hidden(),
  expiresAt: timestamp().nullable(),
  lastUsedAt: timestamp().nullable(),
  createdAt: timestamp().created(),
})

/** Every table this package owns, for schema generation and for tests. */
export const authModels = [
  User,
  Session,
  Role,
  Permission,
  UserRole,
  RolePermission,
  ApiToken,
  Agent,
  AgentToken,
] as const
