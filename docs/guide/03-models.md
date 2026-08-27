# Models

A model is the one declaration everything else is derived from. It says what is
stored, and from it come the PostgreSQL table, the runtime validation, the TypeScript
record type, the query entry point, the migration, and — once a resource presents it —
the Studio form, the REST payloads, the OpenAPI schema, the generated SDK and what an
agent may see over MCP.

```ts
import { boolean, model, string, text, timestamp, uuid } from '@assemora/data'

export const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  /** Unique because it is how a visitor addresses the article. */
  slug: string().unique(),
  body: text(),
  published: boolean().default(false),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})
```

`typeof Article.$infer` is the record type. Adding a column above changes it without
anything else being written — there is no interface to keep in step, because there is
no interface.

## The column DSL

`@assemora/data` exports `uuid`, `string`, `text`, `number`, `integer`, `bigint`,
`decimal`, `boolean`, `date`, `timestamp`, `json`, `binary` and `enumOf`. Every one of
them returns an immutable builder:

```ts
uuid().primary().defaultRandom()
string().unique().index()
string().nullable()                 // the record type becomes `string | null`
boolean().default(false)
enumOf('draft', 'published').default('draft')
timestamp().created()               // filled on insert
timestamp().updated()               // filled on every write
string().hidden()                   // never reaches serialized output
string().set((value) => value.trim())
```

Three of those are worth stopping on.

**`.default()` is a data-layer default, not a database one.** It is applied on insert
by `@assemora/data` and never reaches the generated DDL (ADR-0011). One consequence
matters at migration time: adding a required column to a table that already holds rows
has nothing to put in them, and `assemora db:generate` warns about exactly that.

**`.hidden()` is about serialization, not secrecy at rest.** A hidden column stays out
of REST payloads, out of the OpenAPI document and out of the generated SDK. It is
still a column, and a revision still records it, because history is not a reader.

**`decimal()` carries a string.** A `Decimal` value type is not part of v1
(SPEC.md §18), and a float would be the wrong answer for money. `json<T>()` is the
matching honest gap: it takes a type argument that nothing validates at run time, which
is the shape SPEC.md §17 asks for — a checked variant would take a schema instead.

## Relations

A relation names the other side through a thunk, so declaration order does not matter
and two models may reference each other:

```ts
export const Author = model('authors', {
  id: uuid().primary().defaultRandom(),
  name: string(),
  articles: hasMany(() => Article),
})

export const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  authorId: uuid(),
  categoryId: uuid().nullable(),
  author: belongsTo(() => Author),
  category: belongsTo(() => Category),
})
```

`belongsTo` reads a key on *this* table named after the relation: `author` is
`authorId`. `hasMany` reads a key on the *other* table, derived by dropping a trailing
`s` from this table's name — which is right for `authors` and wrong for `categories`,
because `categorieId` is not a column anybody wrote:

```ts
articles: hasMany(() => Article, { foreignKey: 'categoryId' })
```

Every irregular plural has to say the column itself. `hasOne` is declared the same way.

**The type of a relation's target is deliberately erased** (ADR-0010). Accepting it as
`unknown` is what makes a mutual reference declarable at all — TypeScript's
circular-reference error is the alternative. Relation *names* stay compile-time
checked, so `Article.with('author')` is verified and `Article.with('auther')` is an
error; what `.with()` loaded is not added to the record type. `examples/blog/src/routes.ts`
shows the one narrowing that costs, written once at the top of the file.

## Many-to-many

`belongsToMany` is the one relation that stores nothing on either table it links: the
pairs live in a third table nobody declares.

```ts
export const User = model('users', {
  id: uuid().primary().defaultRandom(),
  email: string(),
  roles: belongsToMany(() => Role),
})

export const Role = model('roles', {
  id: uuid().primary().defaultRandom(),
  name: string(),
  users: belongsToMany(() => User),
})
```

That is the whole declaration. The join table is derived from it — `roles_users`, the
two table names sorted, holding `roleId` and `userId`, both required, unique only as a
pair, each a real foreign key. It is created by `assemora db:generate` like any other
table, and both sides of the relation above derive the *same* one rather than two that
disagree. `through`, `foreignPivotKey` and `relatedPivotKey` name the table and its two
columns where the derivation does not fit — a model linked to itself has to name both
columns, because `userId` twice is not a link:

```ts
friends: belongsToMany(() => User, {
  through: 'friendships',
  foreignPivotKey: 'userId',
  relatedPivotKey: 'friendId',
}),
```

A pivot that carries columns of its own — who granted the role, and when — is not this.
It is an ordinary model with two `belongsTo` relations, and declaring one *and* pointing
`through` at it is refused: the verbs below write the two key columns and nothing else,
so a column they cannot fill would arrive empty or refuse the insert.

Links are loaded like any other relation, in one pass over the join table and one over
the target however many rows are being loaded for:

```ts
const user = await User.where('id', id).with('roles').firstOrFail()

user.roles // the roles themselves, ordered by their key
```

And they are written through three verbs on the same value:

```ts
await user.roles.attach(roleId)              // one id or an array of them
await user.roles.detach(roleId)              // unlinking something unlinked is not an error
await user.roles.sync([adminId, editorId])   // the links become exactly these, in one transaction
```

`user.roles` is an array *and* carries the verbs: the rows are what a read returned,
and the verbs work whether or not anybody read. `user.roles.isLoaded` tells "linked to
nothing" from "nobody asked". A write invalidates the view — `user.roles` answers with
a fresh, empty, unloaded array afterwards, because what was read is no longer what is
stored — but it never empties an array you are already holding, so the obvious loop
does what it looks like:

```ts
for (const role of user.roles) await user.roles.detach(String(role.id))
```

The verbs sit where `save()` sits: below the Command Bus, for framework code and seeds.
A many-to-many a person or an agent edits belongs behind a command of its own, so that
it passes policies, revisions and the audit log like every other content mutation.

## Scopes

A scope is a named piece of a query, and it composes with everything after it:

```ts
export const Article = model(
  'articles',
  {
    /* … columns … */
  },
  {
    scopes: {
      published: (query) => query.where('status', 'published'),
      drafts: (query) => query.where('status', 'draft'),
      featured: (query) => query.where('featured', true),
    },
  },
)

const latest = await Article.published().featured().latest('publishedAt').take(5)
```

What "published" means is decided once, here, instead of being spelled out again in a
route, a block and a seed. Scope names are checked at compile time like field names.

The same options object carries two more things: `computed`, which derives a value
from a record without storing it, and `softDeletes`, which marks the model
soft-deleting and optionally names the column.

## Instances

A row read back is an instance, not a plain object:

```ts
const article = await Article.findOrFail(id)

article.title = 'A better title'
await article.save()

await article.update({ published: true })
await article.delete()

article.isDirty('title')
article.getOriginal('title')
```

`save()`, `update()`, `delete()`, `refresh()`, `restore()` and `toJSON()` are the whole
surface. They are for framework code and seeds — **content mutations belong on the
Command Bus**, because that is where validation, policies, revisions and the audit log
live. `starters/bare/src/server.ts` seeds through `entries.create` and `blocks.add` for
exactly that reason: nothing in a project should reach the database by a path a person
or an agent could not take.

## Registering it

A model reaches the application through a module:

```ts
export const content = () => module('content').models(Article).resources(Articles)
```

Listing a model gives it a table and a migration. Nothing else is needed, and nothing
about PostgreSQL appears anywhere above the adapter — `@assemora/data` does not know
that PostgreSQL exists.

## Where to look next

- [Querying](04-querying.md) — the builder, the Query AST and transactions.
- [Resources](05-resources.md) — how a model becomes content a person edits.
- `examples/blog/src/models.ts` — three models that reference each other, with scopes.
