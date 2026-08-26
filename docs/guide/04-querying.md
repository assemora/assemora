# Querying

The query builder is Eloquent-shaped and compile-time checked. A model *is* a query,
so there is no `createQueryBuilder()` step:

```ts
const users = await User.where('active', true).with('posts').latest().take(10)
```

`User.where('unknownField', true)` is a TypeScript error, and so is
`User.with('somethingUnknown')`. Values are checked against the column's type, enum
members against the enum, and scope names against the model's scopes. There is a
`*.test-d.ts` in `@assemora/data` that fails if any of those ever start compiling.

## Filtering

```ts
User.where('active', true)
User.where('age', '>=', 18)
User.where({ active: true, verified: true })
User.whereIn('status', ['active', 'pending'])
User.whereNotIn('status', ['banned'])
User.whereNull('deletedAt')
User.whereNotNull('publishedAt')
User.whereBetween('price', [10, 100])
User.whereLike('name', '%ada%')
```

Logical groups take a callback, and the callback gets the same builder:

```ts
Post.where((query) => query.where('published', true).orWhere('featured', true))
```

JSON columns have their own operators, because a key inside a document is not a
column: `whereJson('metadata', 'source', 'import')`, `whereJsonContains`,
`whereJsonLike` and `orWhereJsonLike`. The path is a dotted string and the value is
`unknown` — typing a JSON path against the document type is wanted and is a design
task of its own.

## Ordering, limiting, loading

```ts
Article.orderBy('title')
Article.orderBy('publishedAt', 'desc')
Article.latest()              // newest first, by createdAt
Article.latest('publishedAt') // …or by a column you name
Article.oldest()
Article.limit(20).offset(20)
Article.take(10)
Article.with('author', 'category')
Article.withTrashed()
Article.onlyTrashed()
```

`.with()` loads relations **in batches** — one statement per relation, never one per
row. The PostgreSQL adapter counts its own statements so the integration suite can
prove it, because an N+1 is something tests catch and code review does not.

## Getting the rows out

The builder is `PromiseLike`, so awaiting it runs it. The explicit terminals are all
still there, and are what you reach for when you want something other than an array:

```ts
await Article.published().get()
await Article.where('slug', slug).first()        // Article | null
await Article.where('slug', slug).firstOrFail()  // throws NotFoundError
await Article.published().count()
await Article.where('slug', slug).exists()

const page = await Article.published().paginate(2, 20)
// { data, total, page, perPage, lastPage }

const cursor = await Article.published().cursorPaginate(20, after)
// { data, nextCursor } — keyset pagination, stable while rows are inserted
```

Model statics cover the rest: `find`, `findOrFail`, `all`, `create`, `count`,
`exists`.

## The builder is immutable

Every chained call returns a **new** builder. This is the one thing that surprises
people who expect a mutable query object:

```ts
let found = Article.published().with('author', 'category').latest('publishedAt')

if (query.category !== undefined) found = found.where('categoryId', query.category)

return { articles: await found.take(20) }
```

The reassignment is load-bearing. `found.where(...)` on its own throws the narrowed
query away.

## The Query AST

A builder never touches an adapter's query API. It produces a framework-neutral Query
AST, and `toAst()` hands it to you:

```ts
Article.where('published', true).latest().take(10).toAst()
// {
//   model: 'articles',
//   operation: 'select',
//   where: [ … ],
//   order: [ { field: 'createdAt', direction: 'desc' } ],
//   with: [],
//   limit: 10,
// }
```

That AST is the stable internal contract between the data layer, database adapters,
the policy layer and the AI query layer (SPEC.md §30). It is why the same query runs
unchanged against the in-memory adapter and against PostgreSQL, why an agent can
express a read as data rather than as SQL, and why `@assemora/data` contains no
PostgreSQL at all.

Every adapter has to agree on what a `Condition` means, and
`tests/integration/adapter-conformance.test.ts` is what proves it (ADR-0013). A new
operator arrives with its conformance case.

## Transactions

```ts
import { transaction } from '@assemora/data'

await transaction(async () => {
  const author = await Author.create({ name: 'Ada', slug: 'ada' })

  await Article.create({ title: 'Hello', slug: 'hello', authorId: author.id, body: '' })
})
```

There is no `tx` to pass. The current adapter travels through `AsyncLocalStorage`, so
everything the operation awaits sees the transactional connection without being told
about it. A nested `transaction()` is a savepoint on the connection already open, so an
outer rollback undoes the inner writes.

**You rarely call it yourself.** The Command Bus opens a transaction around every
command handler, which is where content mutations live. `transaction()` is for the
seams outside that — a seed, a migration script, a job.

## Reads do not go through the Command Bus

Reads never travel the Command Bus and never cause side effects. When a read needs to
be reachable by name — from Studio, from REST, from an agent — it is a **query** on the
Query Bus instead, which still validates and still authorizes. `pages.get`,
`media.list` and `auth.users.list` are queries in the packages that own that data.

## Where to look next

- [Resources](05-resources.md) — the read API a person and an agent actually use.
- [Commands and queries](06-commands-and-queries.md) — the bus both halves run on.
- `packages/database/README.md` — the adapter contract and schema diffing.
