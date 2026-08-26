# 0010. A relation's target is accepted as `unknown`

Status: accepted
Date: 2026-08-26

## Context

SPEC.md §9 and §23 declare relations inside the model literal, and normally in both
directions:

```ts
export const User = model('users', { posts: hasMany(() => Post) })
export const Post = model('posts', { author: belongsTo(() => User) })
```

To type `User`, TypeScript must type the argument `() => Post`, which requires the
type of `Post`, which contains `() => User`. That is a cycle, and it surfaces as
`TS7022: 'User' implicitly has type 'any' because it is referenced directly or
indirectly in its own initializer`.

Measured on TypeScript 7.0.2: a parameter typed `() => RelatedModel` fails, and so
does `() => unknown` — the contextual signature still forces the target to be
resolved. Only a parameter typed `unknown` avoids it.

## Decision

`belongsTo`, `hasOne`, `hasMany` and `belongsToMany` accept their target as
`unknown`. At runtime the value is checked: it must be a function returning
something that looks like a model, and anything else throws
`A relation target must be a function returning the related model`.

Relation names remain fully typed, because they are the keys of the model's own
field record rather than anything derived from the target: `Post.with('author')`
compiles and `Post.with('somethingUnknown')` does not, as SPEC.md §94 requires.

## Consequences

- Mutual relations work with no hand-written type annotations, and the API of §9 and
  §23 is preserved exactly.
- The one call position that loses static checking is the target argument. It is
  caught at runtime on the first query that touches the relation, with a message
  that names the problem.
- `.with()` checks the head of a path (`'posts.author'` requires `posts` to be a
  declared relation). Deeper segments are validated at runtime, because the target's
  relation names are exactly what this decision erases. Phase 3 revisits this when
  relation loading moves into the SQL adapter.

## Alternatives

Declaring relations in a separate step after both models — rejected against SPEC.md
§9. Requiring an explicit type annotation on one side — rejected: the model type is
not something a person should have to write out.
