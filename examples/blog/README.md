# Blog

The shape SPEC.md §99 uses as its own acceptance test, built out until the parts that
only appear at scale are visible: articles that belong to authors and categories, a
scope, a policy that lets an author edit their own article and nobody else's, and two
public routes a visitor reads without a session.

It assumes you have already read `starters/bare`. Everything the starter explains —
the layout, the `assemora()` call, the seed, the builder canvas — is here without the
commentary.

## Run it

```bash
pnpm install
pnpm --filter @assemora/example-blog build   # the site bundle the canvas frames
pnpm --filter @assemora/example-blog dev
```

With no `DATABASE_URL` it runs in memory and says so. The first boot seeds two
accounts and prints their shared password:

| | |
| --- | --- |
| `editor@example.com` | holds `*` — every permission there is |
| `ada@example.com` | holds `articles.read`, `articles.create` and little else |

The second account is the point of the example. Sign in as Ada in Studio and try to
edit both articles: hers saves, Grace Hopper's comes back 403, and nothing in Studio
was written to make that true.

## Read in this order

| | |
| --- | --- |
| `src/models.ts` | three models, two kinds of relation, three scopes |
| `src/resources.ts` | the same columns as forms, filters, sorts and search |
| `src/policies.ts` | the rule that decides who may edit an article |
| `src/routes.ts` | what a visitor may read, and why it is not a policy |
| `src/blog.ts` | the module — nine lines that register all of it |

## Relations

`Article.author` is a `belongsTo`: the key lives on this table and is named after the
relation, so `author` is `authorId`. `Author.articles` is the `hasMany` on the other
side, and its key is derived from the owning table — which works for `authors` and
breaks for `categories`, where dropping the trailing `s` would produce `categorieId`.
`Category.articles` therefore states `foreignKey: 'categoryId'` and is the one place
in this example where a name has to be written twice.

`.with('author', 'category')` loads them in one statement each, never one per row
(SPEC.md §89). It does **not** yet add the relation to the record type — ADR-0010
erased a relation target's type so that two models could reference each other at all —
so `src/routes.ts` narrows the loaded shape once, at the top, and reads normally
after that.

## Scopes

```ts
scopes: {
  published: (query) => query.where('status', 'published'),
}
```

`Article.published()` hands back the same builder, so it composes:
`Article.published().with('author').latest('publishedAt').take(20)`. The definition of
"published" lives in one place, and the route, the block and the seed all inherit it.

## Policies, and why the public routes exist

Authorization asks twice (ADR-0015). A role that grants `articles.update` answers the
first question and the policy is never consulted; an account without it reaches the
second question, where the stored row is in hand and `src/policies.ts` can compare the
article's author with the actor's profile.

The rule is asynchronous, because the comparison needs a query: an actor is an
account, an article names an author *profile*, and `Author.userId` is the link.

A policy cannot say "published articles only", because it never sees the filter the
caller asked for — it is handed one row, or none. So `read` here means "signed in",
and the public blog is two routes that write the filter themselves:

```text
GET /api/blog/articles          published, newest first, optionally by category
GET /api/blog/articles/:slug    one published article; a draft is a 404
```

That is the pattern to copy whenever anonymous readers need content. Opening the
policy instead would put every unfinished draft on `GET /api/articles`.

## Pages

`src/blocks.ts` declares three. Two of them are ordinary — their content is in their
props — and `articleList` is not: it stores a category and a length, and reads the
articles at render time from the public route. That is what keeps a page a layout.
Copying the current ten articles into the tree would freeze them there.

`app/site.tsx` holds the views and `app/preview.tsx` is the document Studio's canvas
frames. This example reads its page tree through the authorized `pages.get` query;
`examples/company` shows how to serve a published tree to anonymous visitors, and why
that also has to be a route.

## What is deliberately not here

The theme and the universal design controls (`examples/company`), media, the SDK and
the eight variations of a generated project (`starters/bare`).
