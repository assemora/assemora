import { describe, expect, it } from 'vitest'

import { hashPassword, hashToken, issueToken, tokensMatch, verifyPassword } from './credentials.js'

describe('passwords (SPEC.md §49)', () => {
  it('hashes with Argon2id, not with something faster', async () => {
    const stored = await hashPassword('correct horse battery staple')

    expect(stored.startsWith('$argon2id$')).toBe(true)
  })

  it('never stores the password itself', async () => {
    const stored = await hashPassword('correct horse battery staple')

    expect(stored).not.toContain('correct horse')
  })

  it('salts, so the same password hashes differently every time', async () => {
    const first = await hashPassword('same password')
    const second = await hashPassword('same password')

    expect(first).not.toBe(second)
    expect(await verifyPassword(first, 'same password')).toBe(true)
    expect(await verifyPassword(second, 'same password')).toBe(true)
  })

  it('accepts the right password and refuses every other', async () => {
    const stored = await hashPassword('correct horse battery staple')

    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true)
    expect(await verifyPassword(stored, 'correct horse battery stapl')).toBe(false)
    expect(await verifyPassword(stored, '')).toBe(false)
  })

  it('treats a malformed hash as a failure, not as an exception', async () => {
    expect(await verifyPassword('not a hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })
})

describe('tokens (SPEC.md §49, §85)', () => {
  it('says what it opens and carries 256 bits of randomness', () => {
    const issued = issueToken('ast')

    expect(issued.token.startsWith('ast_')).toBe(true)
    expect(issued.token.length).toBeGreaterThan(40)
  })

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueToken('ast').token))

    expect(seen.size).toBe(200)
  })

  it('is stored as a digest, from which it cannot be recovered', () => {
    const issued = issueToken('ast')

    expect(issued.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(issued.hash).not.toContain(issued.token.slice(4))
  })

  it('hashes the same token to the same digest, and a different one differently', () => {
    const issued = issueToken('ast')

    expect(hashToken(issued.token)).toBe(issued.hash)
    expect(hashToken(`${issued.token}x`)).not.toBe(issued.hash)
  })

  it('compares digests without leaking how much matched', () => {
    const a = hashToken('one')
    const b = hashToken('two')

    expect(tokensMatch(a, a)).toBe(true)
    expect(tokensMatch(a, b)).toBe(false)
    expect(tokensMatch(a, 'short')).toBe(false)
  })
})
