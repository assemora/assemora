# 0018. Reads by name, and the shape of a page

Status: accepted
Date: 2026-08-26

## Context

The second half of phase 8 (SPEC.md §115) is pages, the builder, revision history,
users and the developer section. Building them surfaced one structural gap and four
smaller ones, all in the application layer rather than in Studio.

The structural gap: every command was reachable as `POST /commands/<name>` after
ADR-0017, but nothing exposed a **query**. `revisions.list` and `revisions.compare`
had been registered, described, authorized and tested since phase 7 — and were
unreachable from a browser. Pages, users, roles and the media library had no read
path at all.

## Decision

**Every registered query is a `GET /queries/<name>`.** `server.mountQueries()` is the
read half of `mountCommands()`, and it closes ADR-0017's weakest point rather than
extending it: with reads dispatchable by name, an application no longer declares a
route per screen. What is left in `apps/playground` is only what genuinely needs HTTP
mechanics — the login that sets a cookie, and the routes that hand over bytes.

It is `GET`, because a read has no side effects and must not need a CSRF token to be
allowed. Query-string values are decoded against the query's own declared input
schema, so nothing here guesses what a parameter meant. It is safe for the same
reason `mountCommands()` is: the Query Bus validates and authorizes first, and
authorization denies by default (SPEC.md §12, §51).

**A read is declared by the package that owns the data.** `pages.list`, `pages.get`,
`media.list`, `media.get`, `auth.users.list`, `auth.roles.list` and the rest are
queries in `@assemora/pages`, `@assemora/media` and `@assemora/auth`. No new
dependency edge was needed, because `query()` lives in core.

**`list` and `get` both mean `read`.** `subjectOf` folded them for `entries.*` only;
now it folds them for every subject, so one policy rule covers listing and fetching
and a role says `pages.read` rather than two names for one right.

**A permission is held by any wildcard above it.** `holds()` accepts `articles.*` and
`auth.users.*`, not only `*` and the exact name. Studio already believed this; the
server did not, so an interface could offer what the API would refuse.

**The universal design controls live beside `props`, not inside it.** SPEC.md §61
requires seven settings on every block whatever its schema says, and §54 fixes the
node as `{ id, type, version, props, children }`. They cannot go in `props`: that
belongs to the block author, and a framework key there would collide with a declared
field. `BlockNode.design` follows `hidden`, which phase 7 added for the same reason.

Every value is a token from a closed set — `lg`, `wide`, `surface-sunken` — never
CSS. `@assemora/react` turns them into data attributes and custom properties, and the
theme decides what they mean (SPEC.md §62). There is no path from a block's settings
to a literal declaration, which is what makes it safe for an agent to write them.

**A block may be added before it is written; a page may not be published unfinished.**
`blocks.add` validating required props would make a block that has one impossible to
add from a palette at all. So props are checked as `editing` while a page is a draft,
and `pages.publish` checks the whole tree as `complete` and names the block and field
that is not ready. §56's rule — no invalid trees — is about structure, and structure
is still enforced on every edit.

**Every tree command answers with the tree it produced.** Without it an editor must
re-read the page after every keystroke, or keep its own copy of the six tree
operations — which is the duplicated business logic Studio must not have (SPEC.md
§58). Undo and redo answer the same way.

**Undo and redo are commands, and the stack is the history.** `revisions.undo` and
`revisions.redo` walk the entity's revisions, counting undos and redos already
recorded, and restore through the same path `revisions.restore` uses. Nothing is kept
in a browser tab, so the stack survives a reload, a second tab and an agent doing the
undoing. Ordering is load-bearing, so a revision now carries `sequence` — two
commands can commit inside the same millisecond and `createdAt` cannot separate them.

**`revisions.restore` restores a revision's `after`.** SPEC.md §65 shows `[Restore]`
on a specific timeline row, and what a person means there is "put it back the way it
was then". It used to apply `before`, which is the *undo* of that revision — now
`revisions.undo`'s job. `to: 'before' | 'after'` states which act is meant.

**The canvas is the application's own frontend, in an iframe.** `apps/playground` now
ships a browser bundle: `@assemora/react`, this application's block views, this
application's theme. Studio's canvas loads it at `/preview`, so the preview is not a
second implementation of the page (SPEC.md §59). Studio sends the tree in and gets
geometry and clicks back over `postMessage`, and draws its selection outline over the
frame — nothing Studio does changes what the page looks like.

**A tree change is described as a tree change.** `diffTrees` in `@assemora/schema`
answers "the hero's title changed" rather than handing back two complete block trees.
It lives with the tree so the editor, an agent and a change set read one answer
(SPEC.md §65, §75).

## Consequences

Mounting every query means every registered read is public API surface. That is the
same bargain ADR-0017 struck for commands and it rests on the same guarantee — deny
by default — but it does mean a package adding a query is adding an endpoint, and its
authorization has to be thought about at the point of declaration.

A query still declares no output schema, so its endpoint appears in OpenAPI and the
SDK with an undocumented response. Commands have the same hole. Closing it means
adding `output` to `query()` and `command()` and writing one for every existing
handler; it is worth doing and it is not §115.

`BlockNode.design` widens the tree shape SPEC.md §54 fixes. Every tree already stored
stays valid — the field is optional — but MCP tools and any external reader of a tree
now have a key they did not have before.
