import { describe, expect, it } from 'vitest'

import { holds } from './permissions.ts'

/**
 * The same cases as `packages/auth/src/authorization.test.ts`.
 *
 * Studio deciding differently from the server means an interface that offers what the
 * API refuses, which is worse than an interface that offers too little.
 */
describe('what the viewer is offered (SPEC.md §50)', () => {
  it('accepts the exact name, the group and everything', () => {
    expect(holds(['articles.update'], 'articles.update')).toBe(true)
    expect(holds(['articles.*'], 'articles.update')).toBe(true)
    expect(holds(['*'], 'articles.update')).toBe(true)
  })

  it('grants every depth above the permission', () => {
    expect(holds(['auth.*'], 'auth.users.create')).toBe(true)
    expect(holds(['auth.users.*'], 'auth.users.create')).toBe(true)
  })

  it('matches whole segments only', () => {
    expect(holds(['articles.*'], 'articlesecret.read')).toBe(false)
    expect(holds(['articles.*'], 'articles')).toBe(false)
    expect(holds(['articles.update'], 'articles.delete')).toBe(false)
    expect(holds([], 'articles.update')).toBe(false)
  })
})
