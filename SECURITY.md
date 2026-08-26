# Security

Assemora stores passwords, issues API and agent tokens, and decides who may do what.
A bug in any of that is worth reporting carefully.

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/assemora/assemora/security/advisories/new).
It is private between you and the maintainers, and it gives us somewhere to work on
a fix and credit you before anything is public.

Useful things to include: what an attacker can do that they should not be able to,
the smallest reproduction you have, and which package it is in.

You will get a first response within a few days. If a report turns out to be a real
vulnerability we will agree a disclosure timeline with you rather than deciding one
for you.

## Scope

Assemora is pre-release: nothing is published to npm and there is no supported
version yet. Reports are still welcome — a hole found now is one that never ships.

The things most worth attacking:

- `@assemora/auth` — password hashing, session and token handling, the permission
  matcher, and the two-stage policy check
- `@assemora/http` — CSRF, CORS, the security headers, and the generated command and
  query endpoints. Every registered command and query is reachable over HTTP, and it
  is meant to be safe because authorization denies by default. If it is not, that is
  exactly the report we want
- `@assemora/resources` — dynamic resources are untrusted data, and must never become
  executable
- `@assemora/media` — an upload is chosen by whoever uploads it, including its
  filename and its content type

## What the project already commits to

These are enforced, and a change that breaks one is a bug:

- passwords are Argon2id; API and agent tokens are stored as digests only. A token's
  plaintext exists exactly once, when it is issued
- nothing sensitive reaches a response, a log, an OpenAPI document or an MCP schema.
  Driver errors are redacted, because a database error carries the SQL and its
  parameters
- authorization denies by default, and every mutation passes policies identically
  whoever the caller is. There is no trusted caller
- a query whose input names what it reads authorizes twice: once for the query, once
  for the entity it was pointed at
- an actor cannot grant a permission it does not hold itself
- dynamic resource definitions are declarative JSON. No `eval`, no `new Function`

The full list is [SPEC.md §85](SPEC.md) and
[`docs/rules/security.md`](docs/rules/security.md).
