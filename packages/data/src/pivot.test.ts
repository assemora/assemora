import type { DatabaseAdapter, DatabaseContext, QueryAst } from '@assemora/database'
import { createMemoryAdapter, type MemoryAdapter } from '@assemora/database'
import { beforeEach, describe, expect, it } from 'vitest'

import { string, uuid } from './columns.js'
import { model } from './model.js'
import { belongsToMany, hasMany } from './relations.js'
import { transaction, useAdapter } from './runtime.js'

const Role = model('roles', {
  id: uuid().primary(),
  name: string(),
  users: belongsToMany(() => User),
})

const Post = model('posts', {
  id: uuid().primary(),
  authorId: uuid(),
  title: string(),
})

const User = model('users', {
  id: uuid().primary().defaultRandom(),
  email: string(),
  roles: belongsToMany(() => Role),
  posts: hasMany(() => Post, { foreignKey: 'authorId' }),
})

/** Both declarations derive it, and nothing declares it. */
const JOIN = 'roles_users'

/** The links in a stated order, so an expectation reads as a set rather than a log. */
const links = (): readonly Record<string, unknown>[] =>
  [...adapter.rows(JOIN)].sort((left, right) =>
    `${left.userId}${left.roleId}`.localeCompare(`${right.userId}${right.roleId}`),
  )

let adapter: MemoryAdapter

beforeEach(() => {
  adapter = createMemoryAdapter({
    users: [
      { id: 'u1', email: 'ada@x.io' },
      { id: 'u2', email: 'alan@x.io' },
    ],
    roles: [
      { id: 'admin', name: 'Admin' },
      { id: 'editor', name: 'Editor' },
      { id: 'viewer', name: 'Viewer' },
    ],
    [JOIN]: [{ userId: 'u1', roleId: 'admin' }],
  })

  useAdapter(adapter)
})

describe('attach (SPEC.md §24)', () => {
  it('writes the link through the derived join table', async () => {
    const user = await User.findOrFail('u2')

    await user.roles.attach('editor')

    expect(links()).toEqual([
      { userId: 'u1', roleId: 'admin' },
      { userId: 'u2', roleId: 'editor' },
    ])
  })

  it('accepts several ids at once', async () => {
    const user = await User.findOrFail('u2')

    await user.roles.attach(['editor', 'viewer'])

    expect(links().filter((row) => row.userId === 'u2')).toEqual([
      { userId: 'u2', roleId: 'editor' },
      { userId: 'u2', roleId: 'viewer' },
    ])
  })

  it('does not create two rows for one link', async () => {
    const user = await User.findOrFail('u1')

    await user.roles.attach('admin')
    await user.roles.attach(['admin', 'admin', 'editor'])

    expect(links()).toEqual([
      { userId: 'u1', roleId: 'admin' },
      { userId: 'u1', roleId: 'editor' },
    ])
  })

  it('leaves another row links alone', async () => {
    const user = await User.findOrFail('u2')

    await user.roles.attach('admin')

    expect(links().filter((row) => row.userId === 'u1')).toEqual([
      { userId: 'u1', roleId: 'admin' },
    ])
  })

  it('refuses a row with no key for the link to point at', async () => {
    // What a row looks like before it is stored: a link to it would point at nothing.
    adapter.seed('users', [{ email: 'grace@x.io' }])

    const unsaved = await User.where('email', 'grace@x.io').firstOrFail()

    await expect(unsaved.roles.attach('admin')).rejects.toThrow(/Save it first/)
    expect(links()).toEqual([{ userId: 'u1', roleId: 'admin' }])
  })
})

describe('detach (SPEC.md §24)', () => {
  it('removes the link', async () => {
    const user = await User.findOrFail('u1')

    await user.roles.detach('admin')

    expect(links()).toEqual([])
  })

  it('is not an error for something that was never attached', async () => {
    const user = await User.findOrFail('u1')

    await expect(user.roles.detach('viewer')).resolves.toBeUndefined()
    expect(links()).toEqual([{ userId: 'u1', roleId: 'admin' }])
  })

  it('removes several at once and nobody else', async () => {
    const user = await User.findOrFail('u1')
    const other = await User.findOrFail('u2')

    await user.roles.attach(['editor', 'viewer'])
    await other.roles.attach('admin')

    await user.roles.detach(['admin', 'editor'])

    expect(links()).toEqual([
      { userId: 'u1', roleId: 'viewer' },
      { userId: 'u2', roleId: 'admin' },
    ])
  })
})

describe('sync (SPEC.md §24)', () => {
  it('makes the links exactly the set it was given', async () => {
    const user = await User.findOrFail('u1')

    await user.roles.sync(['editor', 'viewer'])

    expect(links()).toEqual([
      { userId: 'u1', roleId: 'editor' },
      { userId: 'u1', roleId: 'viewer' },
    ])
  })

  it('keeps a link it is asked to keep rather than rewriting it', async () => {
    const user = await User.findOrFail('u1')

    await user.roles.sync(['admin', 'editor'])

    expect(links()).toEqual([
      { userId: 'u1', roleId: 'admin' },
      { userId: 'u1', roleId: 'editor' },
    ])
  })

  it('detaches everything for an empty list', async () => {
    const user = await User.findOrFail('u1')

    await user.roles.sync([])

    expect(links()).toEqual([])
  })

  it('asks for the same id once', async () => {
    const user = await User.findOrFail('u2')

    await user.roles.sync(['editor', 'editor'])

    expect(links().filter((row) => row.userId === 'u2')).toEqual([
      { userId: 'u2', roleId: 'editor' },
    ])
  })

  it('touches no row but its own', async () => {
    const other = await User.findOrFail('u2')
    await other.roles.attach(['admin', 'editor'])

    const user = await User.findOrFail('u1')
    await user.roles.sync(['viewer'])

    expect(links().filter((row) => row.userId === 'u2')).toEqual([
      { userId: 'u2', roleId: 'admin' },
      { userId: 'u2', roleId: 'editor' },
    ])
  })
})

/**
 * Fails once its budget of writes is spent, so a verb that applied half of itself
 * leaves the join table visibly wrong instead of plausibly right.
 */
const failingAfter = (inner: MemoryAdapter, writes: number): DatabaseAdapter => {
  let left = writes

  return {
    execute<T>(query: QueryAst, context: DatabaseContext): Promise<T> {
      if (query.operation === 'select' || query.operation === 'count') {
        return inner.execute<T>(query, context)
      }

      if (left === 0) return Promise.reject(new Error('the write budget is spent'))

      left -= 1

      return inner.execute<T>(query, context)
    },
    transaction: (callback) => inner.transaction(callback),
    introspect: () => inner.introspect(),
  }
}

describe('a pivot write is one act (SPEC.md §24, §33)', () => {
  it('rolls a half-applied sync all the way back', async () => {
    const user = await User.findOrFail('u1')

    useAdapter(failingAfter(adapter, 1))

    // The delete of `admin` succeeds; the insert of `editor` does not.
    await expect(user.roles.sync(['editor'])).rejects.toThrow('the write budget is spent')

    expect(links()).toEqual([{ userId: 'u1', roleId: 'admin' }])
  })

  it('rolls a half-applied attach all the way back', async () => {
    const user = await User.findOrFail('u1')

    useAdapter(failingAfter(adapter, 1))

    await expect(user.roles.attach(['editor', 'viewer'])).rejects.toThrow(
      'the write budget is spent',
    )

    expect(links()).toEqual([{ userId: 'u1', roleId: 'admin' }])
  })

  it('joins the transaction the caller already opened', async () => {
    const user = await User.findOrFail('u1')

    await expect(
      transaction(async () => {
        await user.roles.sync(['editor', 'viewer'])
        throw new Error('the caller changed its mind')
      }),
    ).rejects.toThrow('the caller changed its mind')

    expect(links()).toEqual([{ userId: 'u1', roleId: 'admin' }])
  })
})

describe('the loaded rows and the verbs are one value', () => {
  const loaded = (id: string) => User.where('id', id).with('roles').firstOrFail()

  it('reads as the array a load returned', async () => {
    const user = await loaded('u1')

    expect(user.roles.isLoaded).toBe(true)
    expect(user.roles.map((role) => role.name)).toEqual(['Admin'])
  })

  it('carries the verbs on a row nobody loaded roles for', async () => {
    const user = await User.findOrFail('u2')

    expect(user.roles.isLoaded).toBe(false)
    expect(user.roles).toHaveLength(0)

    await user.roles.attach('viewer')

    expect(links()).toEqual([
      { userId: 'u1', roleId: 'admin' },
      { userId: 'u2', roleId: 'viewer' },
    ])
  })

  it('reads back what it wrote', async () => {
    const user = await User.findOrFail('u1')

    await user.roles.sync(['editor', 'viewer'])

    const reread = await loaded('u1')

    expect(reread.roles.map((role) => role.name).sort()).toEqual(['Editor', 'Viewer'])
  })

  it('tells "linked to nothing" from "nobody asked"', async () => {
    const empty = await loaded('u2')
    const unloaded = await User.findOrFail('u2')

    expect(empty.roles).toHaveLength(0)
    expect(empty.roles.isLoaded).toBe(true)

    expect(unloaded.roles).toHaveLength(0)
    expect(unloaded.roles.isLoaded).toBe(false)
  })

  it('stops calling itself loaded once a write has moved the database', async () => {
    const user = await loaded('u1')

    await user.roles.attach('editor')

    expect(user.roles.isLoaded).toBe(false)
    expect(user.roles).toHaveLength(0)
  })

  it('is the same value every time it is read', async () => {
    const user = await User.findOrFail('u1')

    expect(user.roles).toBe(user.roles)
  })

  it('detaches every row the loop it was handed is walking', async () => {
    const before = await User.findOrFail('u1')
    await before.roles.attach(['editor', 'viewer'])

    const user = await loaded('u1')

    // The natural way to unlink what was read. `for…of` binds the array once, so a
    // verb that emptied that array in place stopped the loop after its first row and
    // left the other two links behind without saying a word.
    for (const role of user.roles) await user.roles.detach(String(role.id))

    expect(links()).toEqual([])
  })

  it('publishes a fresh array rather than emptying the one a caller holds', async () => {
    const user = await loaded('u1')
    const held = user.roles

    // A write that changes nothing at all: `admin` is linked already.
    await user.roles.attach('admin')

    expect(held.map((role) => role.name)).toEqual(['Admin'])
    // What a write takes away is the claim that those rows are current, not the rows.
    expect(held.isLoaded).toBe(false)
    expect(user.roles).not.toBe(held)
    expect(user.roles).toHaveLength(0)
  })

  it('keeps the verbs on an array a write has already replaced', async () => {
    const user = await loaded('u1')
    const held = user.roles

    await user.roles.detach('admin')
    await held.attach('editor')

    expect(links()).toEqual([{ userId: 'u1', roleId: 'editor' }])
  })

  it('leaves serialization exactly as it was', async () => {
    const unloaded = await User.findOrFail('u2')

    expect(Object.keys(unloaded)).not.toContain('roles')
    expect(JSON.parse(JSON.stringify(unloaded))).toEqual({ id: 'u2', email: 'alan@x.io' })

    const withRoles = await loaded('u1')

    expect(JSON.parse(JSON.stringify(withRoles))).toEqual({ id: 'u1', email: 'ada@x.io' })
  })

  it('is hidden until a read fills it, and enumerable once one has', async () => {
    const unloaded = await User.findOrFail('u1')
    const withRoles = await loaded('u1')

    expect(Object.getOwnPropertyDescriptor(unloaded, 'roles')?.enumerable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(withRoles, 'roles')?.enumerable).toBe(true)
  })

  it('never writes the relation to the row own table', async () => {
    await User.create({ email: 'grace@x.io' })

    const stored = adapter.rows('users').at(-1) ?? {}

    expect(stored).toMatchObject({ email: 'grace@x.io' })
    expect(Object.keys(stored)).not.toContain('roles')
  })

  it('gives a relation with no join table nothing to carry', async () => {
    const user = await User.findOrFail('u1')

    expect(Object.getOwnPropertyDescriptor(user, 'posts')).toBeUndefined()
  })
})

const Member = model('members', {
  id: uuid().primary(),
  name: string(),
  friends: belongsToMany(() => Member, {
    through: 'friendships',
    foreignPivotKey: 'memberId',
    relatedPivotKey: 'friendId',
  }),
})

describe('a model linked to itself', () => {
  beforeEach(() => {
    adapter.seed('members', [
      { id: 'm1', name: 'Ada' },
      { id: 'm2', name: 'Alan' },
    ])
  })

  it('writes the row own key and the other one in the columns named for them', async () => {
    const member = await Member.findOrFail('m1')

    await member.friends.attach('m2')

    expect(adapter.rows('friendships')).toEqual([{ memberId: 'm1', friendId: 'm2' }])
  })

  it('detaches the direction it wrote and not the other', async () => {
    const ada = await Member.findOrFail('m1')
    const alan = await Member.findOrFail('m2')

    await ada.friends.attach('m2')
    await alan.friends.attach('m1')

    await ada.friends.detach('m2')

    expect(adapter.rows('friendships')).toEqual([{ memberId: 'm2', friendId: 'm1' }])
  })
})
