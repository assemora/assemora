import { describe, expectTypeOf, it } from 'vitest'

import { string, uuid } from './columns.js'
import { model } from './model.js'
import type { PivotRelation, RelatedKey } from './pivot.js'
import { belongsTo, belongsToMany, hasMany } from './relations.js'

const Role = model('roles', {
  id: uuid().primary(),
  name: string(),
  users: belongsToMany(() => User),
})

const Post = model('posts', {
  id: uuid().primary(),
  authorId: uuid(),
  title: string(),
  author: belongsTo(() => User),
})

const User = model('users', {
  id: uuid().primary().defaultRandom(),
  email: string(),
  roles: belongsToMany(() => Role),
  posts: hasMany(() => Post, { foreignKey: 'authorId' }),
})

describe('pivot verbs (SPEC.md §24)', () => {
  it('writes exactly as the spec writes it', async () => {
    const user = await User.findOrFail('u1')
    const roleId = 'editor'
    const adminId = 'admin'
    const editorId = 'editor'

    expectTypeOf(user.roles.attach(roleId)).toEqualTypeOf<Promise<void>>()
    expectTypeOf(user.roles.detach(roleId)).toEqualTypeOf<Promise<void>>()
    expectTypeOf(user.roles.sync([adminId, editorId])).toEqualTypeOf<Promise<void>>()
  })

  it('takes one id or several', async () => {
    const user = await User.findOrFail('u1')

    user.roles.attach('r1')
    user.roles.attach(1)
    user.roles.attach(1n)
    user.roles.attach(['r1', 'r2'])
    user.roles.detach(['r1', 'r2'])
  })

  it('is an array of the rows a read returned', async () => {
    const user = await User.findOrFail('u1')

    expectTypeOf(user.roles).toExtend<PivotRelation>()
    expectTypeOf(user.roles[0]).toEqualTypeOf<Record<string, unknown> | undefined>()
    expectTypeOf(user.roles.map((role) => role)).toEqualTypeOf<Record<string, unknown>[]>()
    expectTypeOf(user.roles.isLoaded).toEqualTypeOf<boolean>()
  })

  it('leaves the record type alone', () => {
    // A relation is not a column, so `$infer` never grew one (SPEC.md §18).
    expectTypeOf<typeof User.$infer>().toEqualTypeOf<{ id: string; email: string }>()
  })
})

describe('invalid usage does not compile (SPEC.md §94)', () => {
  it('rejects a relation nobody declared', async () => {
    const user = await User.findOrFail('u1')

    // @ts-expect-error `groups` is not a relation of users
    user.groups.attach('g1')
  })

  it('rejects a relation that is not stored in a join table', async () => {
    const user = await User.findOrFail('u1')

    // @ts-expect-error `posts` is a hasMany: there is no join table to attach to
    user.posts.attach('p1')
  })

  it('rejects the pivot verbs on the far side of a belongsTo', async () => {
    const post = await Post.findOrFail('p1')

    // @ts-expect-error `author` is a belongsTo, and a post holds the key itself
    post.author.attach('u1')
  })

  it('rejects an id that is not one', async () => {
    const user = await User.findOrFail('u1')

    // @ts-expect-error an object is not a key
    user.roles.attach({ id: 'r1' })

    // @ts-expect-error and neither is nothing at all
    user.roles.detach(undefined)
  })

  it('rejects a bare id where sync wants the whole set', async () => {
    const user = await User.findOrFail('u1')

    // @ts-expect-error sync states every link, so it takes the list of them
    user.roles.sync('admin')
  })

  it('rejects replacing the relation instead of writing through it', async () => {
    const user = await User.findOrFail('u1')

    // @ts-expect-error links are attached, not assigned
    user.roles = []

    // @ts-expect-error and pushing into the array would write nothing
    user.roles.push({})
  })

  it('rejects a relation used as if it were a column', () => {
    // @ts-expect-error `roles` is a relation, not a column
    User.where('roles', [])
  })

  it('keeps the key type as narrow as the erasure of ADR-0010 allows', () => {
    expectTypeOf<RelatedKey>().toEqualTypeOf<string | number | bigint>()
  })
})
