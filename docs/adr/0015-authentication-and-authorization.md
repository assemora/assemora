# 0015. How Assemora decides who may do what

Status: accepted
Date: 2026-08-26

## Context

Phase 6 (SPEC.md §113) fills the authorization port core has declared since phase 1
and denied everything through ever since. SPEC.md §50 gives roles and permissions,
§51 gives policies, §49 gives passwords, sessions and tokens, and §113 requires that
every CRUD command pass policies — identically for Studio, REST, the SDK, the CLI and
an agent.

## Decision

**Authorization happens in two stages, because a rule about a record cannot be
answered before the record is read.** SPEC.md §51 writes
`update: ({ actor, article }) => actor.id === article.authorId`, which needs the row.
So the pipeline asks twice:

1. `authorize` — permissions. Does this actor hold `articles.update` at all? Actions
   that act on an existing row and are not covered by a permission defer to stage two
   rather than being refused blind.
2. `authorizeRecord` — the policy rule, with the row in hand. The command loads the
   record, asks, and only then writes.

Both live inside the command pipeline, so no caller can be the one that forgets.

**A command name is already a permission name.** `pages.publish` is `publish` on
`pages`, so the permission is `pages.publish` — exactly how §51 spells
`actor.has('articles.delete')`. The `entries.*` commands are the single exception:
they name their subject in the input, so `entries.update` on `{ resource: 'articles' }`
is `articles.update`. One vocabulary for commands, permissions and policies.

**Passwords and tokens are hashed differently, on purpose.** A password is chosen by
a person, so it is low in entropy and gets Argon2id with OWASP's parameters. A token
is 256 bits from a CSPRNG: guessing it is already impossible, hashing it slowly would
cost every request and buy nothing, and SHA-256 is the right tool. Both are stored as
digests; a token's plaintext exists exactly once, when it is issued (SPEC.md §49,
§85).

**Signing in is a command.** It creates a session, which is a state change, so it
travels the Command Bus and is audited like everything else. It is open to anyone
through a policy — `policy('auth', { login: () => true })` — rather than through a
special case in core. An unknown email and a wrong password take the same path and
cost the same time, because a decoy hash is verified when no user is found: otherwise
the timing says which addresses are registered.

**The policy context names the row `record`.** SPEC.md §51 spells it after the model,
`{ actor, article }`. That key would have to be derived from a literal table name
which `model()` does not preserve, so naming it after the subject would be a
runtime-only convenience with nothing behind it in the types. `record` is typed, and
the deviation is written down here rather than discovered.

## Consequences

- `permitAll()` is no longer needed by an application. It stays for tests and for the
  phases where authorization is not the subject.
- Registering `auth()` registers its models, its commands and the public `auth`
  policy; passing `authorization: policies()` is what turns the port on.
- An actor arrives from `@assemora/http` through `resolveActor`, which this package
  provides and the HTTP layer accepts as an option — neither depends on the other
  (SPEC.md §8).
- Field-level agent permissions (SPEC.md §52) are declared and published on the
  resource descriptor but not yet enforced on writes. That enforcement belongs with
  the MCP surface in phase 9, where an agent's field access is the whole subject.

## Alternatives

A single authorization call with the record fetched eagerly for every command —
rejected: a create has no record, and reading one before knowing whether the actor may
act at all is work done for a refusal. Marking commands public in core — rejected: it
would put an authentication concept in a package that must not have one.
