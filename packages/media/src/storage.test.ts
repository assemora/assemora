import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AssemoraError } from '@assemora/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearStorage, currentStorage, localStorage, useStorage } from './storage.js'

let root: string

beforeEach(() => {
  clearStorage()
  root = mkdtempSync(join(tmpdir(), 'assemora-media-'))
})

describe('the local driver (SPEC.md §63)', () => {
  it('writes, reads back and removes', async () => {
    const storage = localStorage({ root })
    const bytes = new Uint8Array([1, 2, 3, 4])

    const stored = await storage.put('2026/08/file.png', bytes, 'image/png')

    expect(stored).toEqual({ path: '2026/08/file.png', size: 4 })
    expect(readFileSync(join(root, '2026/08/file.png'))).toEqual(Buffer.from(bytes))
    expect(await storage.get('2026/08/file.png')).toEqual(bytes)

    await storage.remove('2026/08/file.png')
    await expect(storage.get('2026/08/file.png')).rejects.toThrowError()
  })

  it('creates the directories it needs', async () => {
    const storage = localStorage({ root })

    await expect(
      storage.put('deeply/nested/path/file.txt', new Uint8Array([1]), 'text/plain'),
    ).resolves.toBeDefined()
  })

  it('refuses a path that climbs out of the root (SPEC.md §85)', async () => {
    const storage = localStorage({ root })

    for (const path of ['../escaped.txt', '../../etc/passwd', 'a/../../outside.txt']) {
      await expect(storage.put(path, new Uint8Array([1]), 'text/plain')).rejects.toThrowError(
        AssemoraError,
      )
    }
  })

  it('allows a path that stays inside, however it is written', async () => {
    const storage = localStorage({ root })

    await expect(
      storage.put('a/b/../c/file.txt', new Uint8Array([1]), 'text/plain'),
    ).resolves.toBeDefined()
  })

  it('says where a browser fetches it from', () => {
    expect(localStorage({ root }).url('2026/08/file.png')).toBe('/media/2026/08/file.png')
    expect(localStorage({ root, baseUrl: 'https://cdn.example/files/' }).url('/a.png')).toBe(
      'https://cdn.example/files/a.png',
    )
  })

  it('removing something that is not there is not an error', async () => {
    await expect(localStorage({ root }).remove('never-existed.png')).resolves.toBeUndefined()
  })
})

describe('registration', () => {
  it('refuses to work until a driver is registered', () => {
    expect(() => currentStorage()).toThrowError('No media storage is registered')
  })

  it('uses the driver it was given', () => {
    const storage = localStorage({ root })
    useStorage(storage)

    expect(currentStorage()).toBe(storage)
  })
})
