/**
 * `@assemora/auth` — who is asking, and what they may do.
 *
 * Core has declared the authorization port since phase 1 and denied everything in
 * its absence. This package is the implementation: roles and permissions from
 * SPEC.md §50, policies from §51, sessions and tokens from §49.
 *
 * ```ts
 * export const ArticlePolicy = policy('articles', {
 *   read: () => true,
 *   update: ({ actor, record }) => actor?.id === record.authorId,
 *   delete: ({ can }) => can('articles.delete'),
 * })
 *
 * const app = createApplication({
 *   modules: [auth({ policies: [ArticlePolicy] }), blog()],
 *   authorization: policies(),
 * })
 * ```
 *
 * Nothing sensitive is stored as written: passwords are Argon2id, tokens are
 * digests, and a token's plaintext exists exactly once — when it is issued.
 */

export { resolveActor, SESSION_COOKIE } from './actors.js'
export { type CommandSubject, policies, subjectOf } from './authorization.js'
export {
  authCommands,
  CreateAgent,
  CreateApiToken,
  CreateRole,
  CreateUser,
  DeleteRole,
  GrantRole,
  publicAuthPolicy,
  RevokeApiToken,
  RevokeRole,
  SetPassword,
  SignIn,
  SignOut,
  UpdateAgent,
  UpdateRole,
  UpdateUser,
} from './commands.js'
export {
  hashPassword,
  hashToken,
  type IssuedToken,
  issueToken,
  tokensMatch,
  verifyPassword,
} from './credentials.js'
export {
  Agent,
  AgentToken,
  ApiToken,
  authModels,
  Permission,
  Role,
  RolePermission,
  Session,
  User,
  UserRole,
} from './models.js'
export { type AuthModuleOptions, auth, definePolicyFacet } from './module.js'
export {
  holds,
  type PermissionSet,
  permissionsOf,
  WILDCARD,
} from './permissions.js'
export {
  clearPolicies,
  describedPolicies,
  describePolicy,
  type Policy,
  type PolicyActor,
  type PolicyContext,
  type PolicyDescriptor,
  type PolicyRule,
  type PolicyRules,
  policy,
  policyFor,
  registeredPolicies,
  registerPolicy,
} from './policies.js'
export {
  authQueries,
  GetUser,
  ListAgents,
  ListApiTokens,
  ListPermissions,
  ListRoles,
  ListUsers,
} from './queries.js'
export {
  DEFAULT_SESSION_TTL_MS,
  endSession,
  purgeExpiredSessions,
  SESSION_PREFIX,
  type SessionDetails,
  type StartedSession,
  sessionActor,
  startSession,
} from './sessions.js'
export {
  AGENT_TOKEN_PREFIX,
  type AgentDetails,
  API_TOKEN_PREFIX,
  type ApiTokenDetails,
  type CreatedAgent,
  createAgent,
  createApiToken,
  type IssuedApiToken,
  revokeAgentToken,
  revokeApiToken,
  tokenActor,
} from './tokens.js'
