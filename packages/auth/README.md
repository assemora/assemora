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

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/data`
