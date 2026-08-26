import { ValidationError } from '@assemora/core'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { boolean, enumOf, number, string, text, timestamp, uuid } from './columns.js'
import { model } from './model.js'
import { belongsTo, hasMany } from './relations.js'
import { transaction, useAdapter } from './runtime.js'

const User = model(
  'users',
  {
    id: uuid().primary().defaultRandom(),
    firstName: string(),
    lastName: string(),
    email: string().set((value) => value.toLowerCase()),
    password: string().hidden(),
    active: boolean().default(true),
    createdAt: timestamp().created(),
    posts: hasMany(() => Post, { foreignKey: 'authorId' }),
  },
  {
    computed: {
      fullName: (user) => `${user.firstName} ${user.lastName}`,
    },
  },
)

const Post = model(
  'posts',
  {
    id: uuid().primary().defaultRandom(),
    authorId: uuid(),
    title: text(),
    status: enumOf('draft', 'published'),
    views: number().default(0),
    deletedAt: timestamp().nullable(),
    author: belongsTo(() => User),
  },
  {
    softDeletes: true,
    scopes: {
      published: (query) => query.where('status', 'published'),
      popular: (query) => query.where('views', '>', 100),
    },
  },
)

let adapter: MemoryAdapter

beforeEach(() => {
  adapter = createMemoryAdapter({
    users: [
      {
        id: 'u1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@x.io',
        password: 'secret',
        active: true,
      },
      {
        id: 'u2',
        firstName: 'Alan',
        lastName: 'Turing',
        email: 'alan@x.io',
        password: 'secret',
        active: false,
      },
    ],
    posts: [
      {
        id: 'p1',
        authorId: 'u1',
        title: 'First',
        status: 'published',
        views: 500,
        deletedAt: null,
      },
      { id: 'p2', authorId: 'u1', title: 'Second', status: 'draft', views: 10, deletedAt: null },
      { id: 'p3', authorId: 'u2', title: 'Third', status: 'published', views: 20, deletedAt: null },
      {
        id: 'p4',
        authorId: 'u2',
        title: 'Gone',
        status: 'published',
        views: 0,
        deletedAt: new Date(),
      },
    ],
  })

  useAdapter(adapter)
})

describe('reading', () => {
  it('runs the milestone query of SPEC.md §130', async () => {
    const found = await User.where('active', true).latest('createdAt').take(10)

    expect(found.map((user) => user.firstName)).toEqual(['Ada'])
  })

  it('is awaited without a terminal method', async () => {
    expect(await User.where('active', true)).toHaveLength(1)
    expect(await User.where('active', true).get()).toHaveLength(1)
  })

  it('finds by primary key', async () => {
    expect((await User.find('u1'))?.firstName).toBe('Ada')
    expect(await User.find('missing')).toBeNull()
    await expect(User.findOrFail('missing')).rejects.toThrowError('users missing was not found')
  })

  it('returns the first row or null', async () => {
    expect((await User.where('active', false).first())?.firstName).toBe('Alan')
    expect(await User.where('firstName', 'Nobody').first()).toBeNull()
    await expect(User.where('firstName', 'Nobody').firstOrFail()).rejects.toThrowError()
  })

  it('counts and checks existence without loading rows', async () => {
    expect(await User.count()).toBe(2)
    expect(await User.where('active', true).count()).toBe(1)
    expect(await User.where('active', true).exists()).toBe(true)
    expect(await User.where('firstName', 'Nobody').exists()).toBe(false)
  })

  it('paginates', async () => {
    const page = await User.orderBy('firstName').paginate(1, 1)

    expect(page).toMatchObject({ total: 2, page: 1, perPage: 1, lastPage: 2 })
    expect(page.data.map((user) => user.firstName)).toEqual(['Ada'])
  })

  it('paginates by cursor', async () => {
    const first = await User.cursorPaginate(1)
    expect(first.data).toHaveLength(1)
    expect(first.nextCursor).toBe('u1')

    const second = await User.cursorPaginate(1, first.nextCursor)
    expect(second.data.map((user) => user.id)).toEqual(['u2'])
    expect(second.nextCursor).toBeNull()
  })
})

describe('scopes', () => {
  it('applies a scope', async () => {
    expect(await Post.published().count()).toBe(2)
  })

  it('chains scopes with the rest of the builder', async () => {
    const found = await Post.published().popular().latest('title')

    expect(found.map((post) => post.title)).toEqual(['First'])
  })
})

describe('soft deletes', () => {
  it('hides trashed rows, and shows them on request', async () => {
    expect(await Post.count()).toBe(3)
    expect(await Post.withTrashed().count()).toBe(4)
    expect(await Post.onlyTrashed().count()).toBe(1)
  })

  it('marks instead of removing, and restores', async () => {
    const post = await Post.findOrFail('p2')
    await post.delete()

    expect(await Post.find('p2')).toBeNull()
    expect(adapter.rows('posts')).toHaveLength(4)

    const trashed = await Post.onlyTrashed().where('id', 'p2').firstOrFail()
    await trashed.restore()

    expect(await Post.find('p2')).not.toBeNull()
  })
})

describe('relations', () => {
  it('loads a hasMany relation', async () => {
    const [user] = await User.where('id', 'u1').with('posts')
    const posts = (user as unknown as { posts: { title: string }[] }).posts

    expect(posts.map((post) => post.title)).toEqual(['First', 'Second'])
  })

  it('loads a belongsTo relation', async () => {
    const [post] = await Post.where('id', 'p1').with('author')

    expect((post as unknown as { author: { firstName: string } }).author.firstName).toBe('Ada')
  })

  it('derives the foreign key from the owner table when it is not given', async () => {
    const Session = model('sessions', { id: uuid().primary(), userId: uuid() })
    const Owner = model('owners', {
      id: uuid().primary(),
      sessions: hasMany(() => Session),
    })

    adapter.seed('owners', [{ id: 'o1' }])
    adapter.seed('sessions', [{ id: 's1', userId: 'o1' }])

    expect(Owner.descriptor.relations[0]).toMatchObject({
      foreignKey: 'ownerId',
      ownerKey: 'id',
    })
    expect(Session.descriptor.primaryKey).toBe('id')
  })

  it('loads a nested path', async () => {
    const [user] = await User.where('id', 'u1').with('posts.author')
    const posts = (user as unknown as { posts: { author: { firstName: string } }[] }).posts

    expect(posts[0]?.author.firstName).toBe('Ada')
  })
})

describe('writing', () => {
  it('creates a row, filling defaults and timestamps', async () => {
    const created = await User.create({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'GRACE@X.IO',
      password: 'secret',
    })

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.active).toBe(true)
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(await User.count()).toBe(3)
  })

  it('inserts even when the caller supplies the primary key', async () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

    const created = await User.create({
      id,
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@x.io',
      password: 'secret',
    })

    expect(created.id).toBe(id)
    expect(await User.count()).toBe(3)
    expect((await User.findOrFail(id)).firstName).toBe('Grace')
  })

  it('applies a column transform on the way in', async () => {
    const created = await User.create({
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'GRACE@X.IO',
      password: 'secret',
    })

    expect(created.email).toBe('grace@x.io')
  })

  it('refuses a row that is missing a required column', async () => {
    await expect(User.create({ firstName: 'Grace' })).rejects.toThrowError(ValidationError)
    await expect(User.create({ firstName: 'Grace' })).rejects.toMatchObject({
      fields: {
        lastName: ['This field is required'],
        email: ['This field is required'],
        password: ['This field is required'],
      },
    })
  })

  it('refuses a value of the wrong type', async () => {
    await expect(
      Post.create({ authorId: 'u1', title: 'X', status: 'INVALID' as 'draft' }),
    ).rejects.toMatchObject({ fields: { status: ['Expected one of: draft, published'] } })
  })

  it('saves only the columns that changed', async () => {
    const written: Record<string, unknown>[] = []
    const plain = adapter.execute.bind(adapter)

    // Asserting stored values alone cannot tell a partial update from a full-row
    // rewrite that happens to restore the same values, so the statement is watched.
    adapter.execute = async (query, context) => {
      if (query.operation === 'update' && query.data !== undefined) written.push(query.data)
      return plain(query, context)
    }

    const user = await User.findOrFail('u1')
    user.firstName = 'Augusta'
    await user.save()

    adapter.execute = plain

    expect(written).toHaveLength(1)
    expect(Object.keys(written[0] ?? {})).toEqual(['firstName'])

    const stored = adapter.rows('users').find((row) => row.id === 'u1')

    expect(stored?.firstName).toBe('Augusta')
    expect(stored?.lastName).toBe('Lovelace')
  })

  it('updates through a patch', async () => {
    const user = await User.findOrFail('u1')
    await user.update({ lastName: 'Byron' })

    expect((await User.findOrFail('u1')).lastName).toBe('Byron')
  })

  it('deletes a row that has no soft deletes', async () => {
    const user = await User.findOrFail('u2')
    await user.delete()

    expect(await User.count()).toBe(1)
  })

  it('refreshes from storage', async () => {
    const user = await User.findOrFail('u1')
    user.firstName = 'Stale'
    await user.refresh()

    expect(user.firstName).toBe('Ada')
    expect(user.isDirty()).toBe(false)
  })
})

describe('instances', () => {
  it('tracks what changed', async () => {
    const user = await User.findOrFail('u1')

    expect(user.isDirty()).toBe(false)

    user.firstName = 'Augusta'

    expect(user.isDirty()).toBe(true)
    expect(user.isDirty('firstName')).toBe(true)
    expect(user.isDirty('lastName')).toBe(false)
    expect(user.getOriginal('firstName')).toBe('Ada')
  })

  it('exposes computed fields', async () => {
    const user = await User.findOrFail('u1')

    expect(user.fullName).toBe('Ada Lovelace')
  })

  it('keeps hidden columns out of serialized output', async () => {
    const user = await User.findOrFail('u1')
    const json = user.toJSON()

    expect(json).not.toHaveProperty('password')
    expect(json).toMatchObject({ firstName: 'Ada', fullName: 'Ada Lovelace' })
  })
})

describe('transactions', () => {
  it('commits everything the operation did', async () => {
    await transaction(async () => {
      await User.create({ firstName: 'A', lastName: 'B', email: 'a@b.io', password: 'x' })
    })

    expect(await User.count()).toBe(3)
  })

  it('rolls everything back when the operation throws', async () => {
    await expect(
      transaction(async () => {
        await User.create({ firstName: 'A', lastName: 'B', email: 'a@b.io', password: 'x' })
        throw new Error('no good')
      }),
    ).rejects.toThrowError('no good')

    expect(await User.count()).toBe(2)
  })
})
