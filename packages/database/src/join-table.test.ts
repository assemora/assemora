import { describe, expect, it } from 'vitest'

import type { ColumnDescriptor, RelationDescriptor, TableDescriptor } from './adapter.js'
import { joinTableDescriptor, pivotAddress, withJoinTables } from './join-table.js'
import { createMemoryAdapter } from './memory.js'
import { comparison, emptyQuery } from './query-ast.js'
import { diffSchema } from './schema-diff.js'

const column = (name: string, overrides: Partial<ColumnDescriptor> = {}): ColumnDescriptor => ({
  name,
  type: 'string',
  isPrimary: false,
  isNullable: false,
  isUnique: false,
  isIndexed: false,
  hasDefault: false,
  ...overrides,
})

const id = column('id', { type: 'uuid', isPrimary: true })

const table = (
  name: string,
  columns: readonly ColumnDescriptor[] = [id],
  relations: readonly RelationDescriptor[] = [],
): TableDescriptor => ({ name, columns, primaryKey: 'id', relations })

const belongsToMany = (
  name: string,
  target: string,
  overrides: Partial<RelationDescriptor> = {},
): RelationDescriptor => ({
  name,
  kind: 'belongsToMany',
  target,
  // What `model()` produces for this kind: a `belongsToMany` stores no column of its
  // own, and the join columns are named by the derivation rather than by these.
  foreignKey: 'userId',
  ownerKey: 'id',
  ...overrides,
})

const users = table('users', [id, column('email')], [belongsToMany('roles', 'roles')])
const roles = table('roles', [id, column('name')], [belongsToMany('users', 'users')])

const names = (descriptor: TableDescriptor): string[] => descriptor.columns.map((each) => each.name)

const relationOf = (table: TableDescriptor, name: string): RelationDescriptor => {
  const found = table.relations.find((relation) => relation.name === name)

  if (found === undefined) throw new Error(`"${table.name}" has no relation "${name}"`)

  return found
}

describe('the join table (SPEC.md §23)', () => {
  it('derives a name and two columns from the two table names', () => {
    const join = joinTableDescriptor(users, relationOf(users, 'roles'), roles)

    expect(join.name).toBe('roles_users')
    expect(names(join)).toEqual(['roleId', 'userId'])
  })

  it('is named by `through` where the relation declares one', () => {
    const relation = belongsToMany('roles', 'roles', { through: 'assemora_user_roles' })

    expect(joinTableDescriptor(users, relation, roles).name).toBe('assemora_user_roles')
  })

  it('describes both sides of a mutual relation identically', () => {
    const fromUsers = joinTableDescriptor(users, relationOf(users, 'roles'), roles)
    const fromRoles = joinTableDescriptor(roles, relationOf(roles, 'users'), users)

    expect(fromUsers).toEqual(fromRoles)
  })

  it('holds two required keys that are unique only as a pair', () => {
    const join = joinTableDescriptor(users, relationOf(users, 'roles'), roles)

    expect(join.columns.map((each) => each.isNullable)).toEqual([false, false])
    expect(join.columns.map((each) => each.isUnique)).toEqual([false, false])
    expect(join.uniqueTogether).toEqual([['roleId', 'userId']])
    // Nothing identifies a row on its own, and half the pair is not the key.
    expect(join.primaryKey).toBe('')
  })

  it('points a foreign key at the key each column copies', () => {
    const join = joinTableDescriptor(users, relationOf(users, 'roles'), roles)

    expect(join.relations).toEqual([
      { name: 'roleId', kind: 'belongsTo', target: 'roles', foreignKey: 'roleId', ownerKey: 'id' },
      { name: 'userId', kind: 'belongsTo', target: 'users', foreignKey: 'userId', ownerKey: 'id' },
    ])
  })

  it('takes the type of the key each column holds', () => {
    const numbered = table('roles', [column('id', { type: 'integer', isPrimary: true })])
    const join = joinTableDescriptor(users, relationOf(users, 'roles'), numbered)

    expect(join.columns.map((each) => each.type)).toEqual(['integer', 'uuid'])
  })

  it('follows the owner key the relation declares', () => {
    const relation = belongsToMany('roles', 'roles', { ownerKey: 'email' })
    const join = joinTableDescriptor(users, relation, roles)

    expect(join.relations.find((each) => each.name === 'userId')).toMatchObject({
      ownerKey: 'email',
      target: 'users',
    })
    expect(join.columns.find((each) => each.name === 'userId')?.type).toBe('string')
  })

  it('lets both columns be named where the derivation does not fit', () => {
    const relation = belongsToMany('friends', 'users', {
      through: 'friendships',
      foreignPivotKey: 'userId',
      relatedPivotKey: 'friendId',
    })
    const join = joinTableDescriptor(users, relation, users)

    expect(join.name).toBe('friendships')
    expect(names(join)).toEqual(['friendId', 'userId'])
  })

  it('refuses a relation linking a table to itself with nothing to tell the sides apart', () => {
    const relation = belongsToMany('friends', 'users')

    expect(() => joinTableDescriptor(users, relation, users)).toThrowError(
      /two columns named "userId"/,
    )
  })

  it('refuses a relation of any other kind', () => {
    const relation: RelationDescriptor = {
      name: 'author',
      kind: 'belongsTo',
      target: 'users',
      foreignKey: 'authorId',
      ownerKey: 'id',
    }

    expect(() => joinTableDescriptor(table('posts'), relation)).toThrowError(
      /only belongsToMany is stored in a join table/,
    )
  })
})

describe('addressing the join table (SPEC.md §24)', () => {
  const relation = relationOf(users, 'roles')

  it('names the two columns and reads the owner key from the row', () => {
    const pivot = pivotAddress(users, relation, { id: 'u1', email: 'ada@assemora.dev' }, roles)

    expect(pivot.table.name).toBe('roles_users')
    expect(pivot.ownerColumn).toBe('userId')
    expect(pivot.relatedColumn).toBe('roleId')
    expect(pivot.ownerValue).toBe('u1')
  })

  it('refuses a row that was never stored', () => {
    expect(() => pivotAddress(users, relation, { email: 'ada@assemora.dev' }, roles)).toThrowError(
      /has no id/,
    )
  })

  it('is enough to attach and to detach through the plain Query AST', async () => {
    const adapter = createMemoryAdapter()
    const pivot = pivotAddress(users, relation, { id: 'u1' }, roles)

    await adapter.execute(
      {
        ...emptyQuery(pivot.table.name, 'insert'),
        data: { [pivot.ownerColumn]: pivot.ownerValue, [pivot.relatedColumn]: 'r1' },
      },
      { table: pivot.table },
    )

    expect(adapter.rows('roles_users')).toEqual([{ userId: 'u1', roleId: 'r1' }])

    await adapter.execute(
      {
        ...emptyQuery(pivot.table.name, 'delete'),
        where: [
          comparison(pivot.ownerColumn, '=', pivot.ownerValue),
          comparison(pivot.relatedColumn, '=', 'r1'),
        ],
      },
      { table: pivot.table },
    )

    expect(adapter.rows('roles_users')).toEqual([])
  })
})

describe('expanding a schema (SPEC.md §23)', () => {
  it('adds one join table for a relation declared on both sides', () => {
    expect(withJoinTables([users, roles]).map((each) => each.name)).toEqual([
      'users',
      'roles',
      'roles_users',
    ])
  })

  it('changes nothing when it is run twice', () => {
    const once = withJoinTables([users, roles])

    expect(withJoinTables(once)).toEqual(once)
  })

  it('leaves a schema without a many-to-many exactly as it was', () => {
    const tables = [table('posts'), table('comments')]

    expect(withJoinTables(tables)).toBe(tables)
  })

  it('refuses a model declared for the table a relation derives', () => {
    // The DDL would build this table and the pivot verbs would write the derived two
    // columns into it, leaving `id` and `grantedAt` with nothing to hold. Keeping the
    // declaration and deriving the writes is the disagreement, so the declaration is
    // refused where it is made rather than at the first `attach`.
    const declared = table(
      'assemora_user_roles',
      [id, column('userId'), column('roleId'), column('grantedAt')],
      [],
    )
    const linked = table(
      'users',
      [id],
      [belongsToMany('roles', 'roles', { through: 'assemora_user_roles' })],
    )

    expect(() => withJoinTables([linked, roles, declared])).toThrowError(
      /"users\.roles" derives the join table "assemora_user_roles", and a model declares it/,
    )
  })

  it('refuses a declared pivot that holds the two derived keys and nothing else', () => {
    // Column for column what the derivation produces, in the order a model would
    // declare them rather than the sorted order both sides of a mutual relation agree
    // on. It reached PostgreSQL as two descriptors for one table and failed there with
    // `DUPLICATE_TABLE`, which names neither the model nor the relation.
    const declared = table('grants', [column('userId'), column('roleId')], [])
    const linked = table('users', [id], [belongsToMany('roles', 'roles', { through: 'grants' })])

    expect(() => withJoinTables([linked, roles, declared])).toThrowError(
      /"users\.roles" derives the join table "grants", and a model declares it/,
    )
  })

  it('refuses two relations that describe one join table differently', () => {
    const mismatched = table(
      'roles',
      [id],
      [belongsToMany('users', 'users', { relatedPivotKey: 'memberId' })],
    )

    expect(() => withJoinTables([users, mismatched])).toThrowError(
      /describe the join table "roles_users" differently/,
    )
  })
})

describe('the schema diff (SPEC.md §34)', () => {
  it('creates the join table a new many-to-many needs', () => {
    const before = [table('users', [id, column('email')]), table('roles', [id, column('name')])]
    const { changes } = diffSchema(before, [users, roles])

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'tableAdded', table: 'roles_users' })
  })

  it('drops it again when the relation goes', () => {
    const after = [table('users', [id, column('email')]), table('roles', [id, column('name')])]
    const { changes } = diffSchema([users, roles], after)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'tableRemoved', table: 'roles_users' })
  })

  it('reports nothing when only one side of a mutual relation is declared', () => {
    // The join table is derived from either declaration, so removing the mirror of a
    // relation is not a schema change — it changes what can be loaded, not what exists.
    expect(
      diffSchema([users, roles], [users, table('roles', [id, column('name')])]).changes,
    ).toEqual([])
  })

  it('sees a renamed join table as one arriving and one going', () => {
    const renamed = [
      table(
        'users',
        [id, column('email')],
        [belongsToMany('roles', 'roles', { through: 'grants' })],
      ),
      table(
        'roles',
        [id, column('name')],
        [belongsToMany('users', 'users', { through: 'grants' })],
      ),
    ]
    const kinds = diffSchema([users, roles], renamed).changes.map(
      (change) => `${change.kind} ${change.table}`,
    )

    expect(kinds).toEqual(['tableAdded grants', 'tableRemoved roles_users'])
  })

  it('compares clean against a snapshot that already holds the join table', () => {
    expect(diffSchema(withJoinTables([users, roles]), [users, roles]).changes).toEqual([])
  })
})
