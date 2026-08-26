import { describe, expectTypeOf, it } from 'vitest'

import { boolean, enumOf, json, number, string, timestamp, uuid } from './columns.js'
import { model } from './model.js'
import { belongsTo, hasMany } from './relations.js'

type Metadata = { readonly source: string }

const User = model('users', {
  id: uuid().primary().defaultRandom(),
  email: string().unique(),
  active: boolean().default(true),
  posts: hasMany(() => Post, { foreignKey: 'authorId' }),
})

const Post = model(
  'posts',
  {
    id: uuid().primary(),
    authorId: uuid(),
    title: string(),
    status: enumOf('draft', 'published'),
    views: number(),
    metadata: json<Metadata>(),
    publishedAt: timestamp().nullable(),
    author: belongsTo(() => User),
  },
  {
    scopes: {
      published: (query) => query.where('status', 'published'),
      popular: (query) => query.where('views', '>', 100),
    },
    computed: {
      slug: (post) => post.title.toLowerCase(),
    },
  },
)

describe('record inference (SPEC.md §18)', () => {
  it('produces the exact record type, relations excluded', () => {
    expectTypeOf<typeof User.$infer>().toEqualTypeOf<{
      id: string
      email: string
      active: boolean
    }>()
  })

  it('carries enums, JSON generics and nullability', () => {
    expectTypeOf<typeof Post.$infer>().toEqualTypeOf<{
      id: string
      authorId: string
      title: string
      status: 'draft' | 'published'
      views: number
      metadata: Metadata
      publishedAt: Date | null
    }>()
  })
})

describe('the milestone of SPEC.md §130', () => {
  it('types the awaited result as model instances', async () => {
    const users = await User.where('active', true).latest().take(10)
    const user = users[0]

    expectTypeOf(user?.id).toEqualTypeOf<string | undefined>()
    expectTypeOf(user?.email).toEqualTypeOf<string | undefined>()
    expectTypeOf(user?.active).toEqualTypeOf<boolean | undefined>()
    expectTypeOf(user?.save).toEqualTypeOf<(() => Promise<void>) | undefined>()
  })

  it('keeps the builder immutable in the type as well', () => {
    const base = User.where('active', true)

    expectTypeOf(base.where('email', 'a@b.io')).toEqualTypeOf<typeof base>()
  })
})

describe('scopes and computed fields', () => {
  it('exposes a scope as a method that keeps chaining', async () => {
    const posts = await Post.published().popular().latest('publishedAt').take(5)

    expectTypeOf(posts[0]?.status).toEqualTypeOf<'draft' | 'published' | undefined>()
  })

  it('adds computed fields to the instance', async () => {
    const post = await Post.firstOrFail()

    expectTypeOf(post.slug).toEqualTypeOf<string>()
  })
})

describe('invalid usage does not compile (SPEC.md §94)', () => {
  it('rejects a field the model does not declare', () => {
    // @ts-expect-error `foobar` is not a column of users
    User.where('foobar', true)
  })

  it('rejects a value of the wrong type', () => {
    // @ts-expect-error `active` is a boolean
    User.where('active', 'yes')
  })

  it('rejects a value outside an enum', () => {
    Post.where('status', 'published')

    // @ts-expect-error `INVALID` is not one of the declared statuses
    Post.where('status', 'INVALID')
  })

  it('rejects a relation the model does not declare', () => {
    Post.with('author')

    // @ts-expect-error `somethingUnknown` is not a relation of posts
    Post.with('somethingUnknown')
  })

  it('rejects a relation path whose head is not a relation', () => {
    // @ts-expect-error `ghost` is not a relation of users
    User.with('ghost.author')
  })

  it('rejects a scope the model does not declare', () => {
    // @ts-expect-error `archived` is not a declared scope
    Post.archived()
  })

  it('rejects ordering by a field that does not exist', () => {
    // @ts-expect-error `rank` is not a column of posts
    Post.orderBy('rank')
  })

  it('rejects a whereIn over values of the wrong type', () => {
    Post.whereIn('status', ['draft', 'published'])

    // @ts-expect-error the values must match the column type
    Post.whereIn('views', ['many'])
  })

  it('rejects an object filter with an unknown key', () => {
    // @ts-expect-error `nickname` is not a column of users
    User.where({ nickname: 'ada' })
  })

  it('rejects writing to a column that does not exist', async () => {
    const user = await User.firstOrFail()

    // @ts-expect-error `nickname` is not a column of users
    user.nickname = 'ada'
  })

  it('rejects a pattern match on a column that holds no text', () => {
    Post.whereLike('title', '%news%')

    // @ts-expect-error `views` is a number; `like` is meaningless on it
    Post.whereLike('views', '%1%')
  })

  it('rejects a JSON operator on a column that holds no document', () => {
    Post.whereJson('metadata', 'source', 'import')

    // @ts-expect-error `title` is not a JSON document
    Post.whereJson('title', 'source', 'import')

    // @ts-expect-error the same holds for containment
    Post.whereJsonContains('title', {})
  })

  it('rejects a relation used as if it were a column', () => {
    // @ts-expect-error `posts` is a relation, not a column
    User.where('posts', [])
  })
})
