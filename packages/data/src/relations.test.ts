import type { RelationDescriptor, TableDescriptor } from '@assemora/database'
import { joinTableDescriptor, withJoinTables } from '@assemora/database'
import { describe, expect, it } from 'vitest'

import { string, uuid } from './columns.js'
import { model } from './model.js'
import { belongsToMany } from './relations.js'

const Role = model('roles', {
  id: uuid().primary(),
  name: string(),
  users: belongsToMany(() => User),
})

const User = model('users', {
  id: uuid().primary(),
  email: string(),
  roles: belongsToMany(() => Role),
})

const relationOf = (table: TableDescriptor, name: string): RelationDescriptor => {
  const found = table.relations.find((relation) => relation.name === name)

  if (found === undefined) throw new Error(`"${table.name}" has no relation "${name}"`)

  return found
}

describe('belongsToMany (SPEC.md §23)', () => {
  it('derives one join table from either declaration', () => {
    expect(relationOf(User.descriptor, 'roles')).toMatchObject({
      kind: 'belongsToMany',
      target: 'roles',
    })

    expect(
      joinTableDescriptor(User.descriptor, relationOf(User.descriptor, 'roles'), Role.descriptor),
    ).toEqual(
      joinTableDescriptor(Role.descriptor, relationOf(Role.descriptor, 'users'), User.descriptor),
    )
  })

  it('adds the join table to the schema exactly once', () => {
    const tables = withJoinTables([User.descriptor, Role.descriptor])

    expect(tables.map((table) => table.name)).toEqual(['users', 'roles', 'roles_users'])
    expect(tables[2]?.columns.map((column) => column.name)).toEqual(['roleId', 'userId'])
  })

  it('refuses a project that models the pivot and points `through` at it', () => {
    // The escape hatch this used to promise: declare the join table as a model, keep
    // the extra columns, name it in `through`. Only the DDL ever read that model —
    // `attach`, `detach` and `sync` write the two derived columns whatever it says —
    // so the table arrived with `grantedAt` nothing fills and `id` nothing supplies.
    const Grant = model('grants', {
      id: uuid().primary(),
      userId: uuid(),
      roleId: uuid(),
      grantedAt: string(),
    })
    const Member = model('members', {
      id: uuid().primary(),
      roles: belongsToMany(() => Role, { through: 'grants' }),
    })

    expect(() =>
      withJoinTables([Member.descriptor, Role.descriptor, Grant.descriptor]),
    ).toThrowError(/"members\.roles" derives the join table "grants", and a model declares it too/)
  })

  it('carries the pivot columns a declaration names', () => {
    const Member = model('members', {
      id: uuid().primary(),
      friends: belongsToMany(() => Member, {
        through: 'friendships',
        foreignPivotKey: 'memberId',
        relatedPivotKey: 'friendId',
      }),
    })
    const relation = relationOf(Member.descriptor, 'friends')

    expect(relation).toMatchObject({
      through: 'friendships',
      foreignPivotKey: 'memberId',
      relatedPivotKey: 'friendId',
    })

    const join = joinTableDescriptor(Member.descriptor, relation, Member.descriptor)

    expect(join.name).toBe('friendships')
    expect(join.columns.map((column) => column.name)).toEqual(['friendId', 'memberId'])
  })
})
