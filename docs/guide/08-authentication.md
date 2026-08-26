# Authentication and authorization

```ts
const app = createApplication({
  modules: [auth({ policies: [ArticlePolicy] }), blog()],
  authorization: policies(),
})
```

`auth()` brings users, sessions, roles, permissions, API tokens and agent identities.
`policies()` is the implementation of the authorization port core has declared since
phase 1 — registering it is what makes `permitAll()` unnecessary, and what makes every
command and query start passing roles, permissions and policies.

With `assemora()` this is not a choice: authorization is always `policies()`, because
core denies by default and the umbrella must not be the thing that opens the door.

## Actors

Three kinds, and they are actors in exactly the same way:

```ts
{ type: 'user', id: '…' }
{ type: 'token', id: '…' }
{ type: 'agent', id: 'content-agent' }
```

The context carries one, and the whole pipeline reads it: policies decide with it,
revisions record it, and the audit log names it. **A command run by nobody is refused
rather than trusted** — including inside a seed, which is why seeds say who they are.

## Sessions and tokens

Signing in is a command like everything else:

```ts
await commands.execute('auth.login', { email, password })
```

`auth.login` and `auth.logout` are the two commands that do *not* also appear under
`/api/commands/<name>`. They are publicly authorized, and a generic endpoint would be a
second door on to a session — one handing the token back as readable JSON, minting no
CSRF token, and letting the caller choose the IP address recorded against it. The
hardened routes `/api/auth/login`, `/api/auth/logout` and `/api/auth/me` are what an
application mounts instead.

For machines:

```ts
const issued = await createApiToken({ name: 'ci', permissions: ['articles.read'] })
// issued.token is shown once. Store it somewhere safe or issue another.

const agent = await createAgent({
  name: 'content-agent',
  permissions: ['assemora.*', 'pages.read', 'pages.update', 'changesets.propose'],
})
```

`resolveActor` is what `@assemora/http` accepts to turn a bearer token or a session
cookie into an actor — neither package depends on the other.

## Nothing sensitive is stored as written

Passwords are Argon2id with OWASP's parameters. Tokens are SHA-256 digests of 256
random bits, and a token's plaintext exists exactly once: when it is issued. An unknown
email costs the same time as a wrong password, so the timing does not say which
addresses are registered.

## Permissions

A permission is a name, and a command's name is its permission (ADR-0015). A permission
is held by any wildcard above it:

```text
*                grants everything
articles.*       grants articles.read, articles.update, articles.delete, …
articles.update  grants exactly itself
```

Users hold roles; roles hold permissions. `list` and `get` both resolve to `read` for
every subject, so `articles.read` covers both.

**A role, an API token and an agent are each a way to mint a credential, so all three
refuse to grant a permission the actor issuing them does not hold themselves.** Without
that, creating a role would be a way to escalate to `*`.

## Policies

Permissions answer "may this actor do this kind of thing". Policies answer "may this
actor do it to *this* record", and they can only be asked once the row is read:

```ts
export const ArticlePolicy = policy<ArticleRow>('articles', {
  read: ({ actor }) => actor !== undefined,
  create: ({ actor }) => actor?.type === 'user',
  update: ({ actor, record }) => writesAs(actor, record.authorId),
  delete: ({ can }) => can('articles.delete'),
})
```

A rule receives `{ actor, record, context, can }` and may be asynchronous. `can()` asks
whether the actor holds a named permission, which is how a rule delegates back to the
permission system for the cases that are not about the record at all.

Both checks happen inside the command pipeline, so no caller is the one that forgets —
and the same rules answer Studio, REST, the SDK, the CLI and MCP, because all five
arrive through the same buses.

### The one thing people get wrong

**A policy cannot see the filter a caller asked for**, so it cannot say "published ones
only". `read: ({ actor }) => actor !== undefined` guards the collection for signed-in
people; opening it to everybody instead would put every unfinished draft on
`GET /api/articles`.

Anonymous public reading is a **route** that writes the filter itself:

```ts
export const listArticles = route.get('/blog/articles', {
  query: { category: string().optional() },
  response: { articles: array(object(summary)) },
  handler: async ({ query }) => {
    let found = Article.published().with('author', 'category').latest('publishedAt')

    if (query.category !== undefined) found = found.where('categoryId', query.category)

    return { articles: loaded(await found.take(20)).map(card) }
  },
})
```

`Article.published()` is not a suggestion the caller may drop. That is the pattern to
copy whenever anonymous readers need content: return exactly what is public, from a
query you control. `examples/blog/` is written around this distinction.

## Field-level agent permissions

```ts
body: richText().required().agentAccess({ write: false })
```

An agent may read that field and not change it. The check runs inside the command path,
so generic CRUD is not a way around it, and it **refuses the whole command and names
every offending field** rather than dropping fields silently — a partial write an agent
believes succeeded is worse than a refusal it can read. A read is projected to what the
actor may see; revisions still record the whole row, because history is not a reader.

## Where to look next

- [HTTP and the SDK](09-http-and-the-sdk.md) — cookies, CSRF and how an actor is
  resolved from a request.
- [Deploying](12-deploying.md) — the security defaults an application ships with.
- `packages/auth/README.md`, and ADR-0015 for why authorization asks twice.
