# `@assemora/auth`

Users, sessions, roles, permissions, policies, tokens.

**Implementation phase:** 6 — implemented.

```ts
export const ArticlePolicy = policy('articles', {
  read: () => true,
  update: ({ actor, record }) => actor?.id === record.authorId,
  delete: ({ can }) => can('articles.delete'),
})

const app = createApplication({
  modules: [auth({ policies: [ArticlePolicy] }), blog()],
  authorization: policies(),
})
```

Registering this module is what makes `permitAll()` unnecessary: the authorization
port core has declared since phase 1 finally has an implementation, and every command
and query starts passing roles, permissions and policies.

The check happens twice, because a rule about a record cannot be answered before the
record is read: permissions before the write, the policy rule once the row is loaded
(ADR-0015). Both are inside the command pipeline, so no caller can be the one that
forgets.

Nothing sensitive is stored as written. Passwords are Argon2id with OWASP's
parameters; tokens are SHA-256 digests of 256 random bits, and a token's plaintext
exists exactly once — when it is issued. An unknown email costs the same time as a
wrong password, so the timing does not say which addresses are registered.

`resolveActor` is what `@assemora/http` accepts to turn a bearer token or a session
cookie into an actor; neither package depends on the other.

## What makes an actor still an actor

`permissionsOf` answers what an actor may do **now**, so it asks first whether this is
still an actor at all:

| Actor | Holds nothing once |
| --- | --- |
| `user` | the `User` row says `active: false` |
| `api` | the token is gone, its expiry has passed, or the person it was issued for is deactivated |
| `agent` | the agent is gone or `enabled: false` |

That question belongs here rather than at the credential boundary, because not every
path presents a credential. A session is checked when the cookie is read and a bearer
token when the header is — but a **job** carries an actor sealed into an envelope and
is replayed by a worker hours later with nothing to present (ADR-0023), and so does
anything else that stores an identity and acts on it afterwards. `permissionsOf` is
the one place all of them go through.

It costs a row read: resolving a user's permissions is four queries rather than three,
and the command pipeline resolves them twice — once for the permission check and once
for the policy rule. It buys the only revocation the framework has, so it is paid on
every command. A deactivated actor short-circuits to a single query.

An **absent** `User` row is deliberately not a revocation. There is no user deletion in
Assemora — `active: false` is the whole of how a person is cut off — so an absence is
never something this system decided; it is an application whose identities live in an
SSO directory and whose roles are assigned here.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/data`
