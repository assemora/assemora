/**
 * Serving a single-page application (SPEC.md §85).
 *
 * The cases here are the ones static serving gets wrong: a path that climbs out of
 * the root, a document cached past a deploy, and a file whose type a browser would
 * otherwise guess.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { assetCacheControl, assetContentType, findAsset, resolveAsset } from './assets.js'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'assemora-assets-'))

  await writeFile(join(root, 'index.html'), '<!doctype html><title>Studio</title>')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'assets', 'main-8f3a1c2b.js'), 'console.log(1)')
  await writeFile(join(root, 'assets', 'style.css'), 'body{}')
  await writeFile(join(root, 'notes.rtf'), 'nothing a browser should render')
})

describe('finding the file a request means', () => {
  it('serves a file that is there', async () => {
    const found = await findAsset({ path: '/studio', root }, 'assets/main-8f3a1c2b.js')

    expect(found?.contentType).toBe('text/javascript; charset=utf-8')
  })

  it('serves the entry document for the root of the mount', async () => {
    const found = await findAsset({ path: '/studio', root }, '')

    expect(found?.contentType).toBe('text/html; charset=utf-8')
  })

  it('falls back to the entry document, because the router in the browser decides', async () => {
    const found = await findAsset({ path: '/studio', root }, 'pages/42/history')

    expect(found?.path).toBe(join(root, 'index.html'))
  })

  it('answers with nothing when the fallback is off', async () => {
    expect(await findAsset({ path: '/files', root, fallback: false }, 'missing.js')).toBeUndefined()
  })

  it('resolves a directory to the document inside it', async () => {
    const found = await findAsset({ path: '/studio', root }, 'assets')

    // There is no assets/index.html, so this lands on the fallback rather than on a
    // directory listing — a listing is never something to serve.
    expect(found?.path).toBe(join(root, 'index.html'))
  })
})

describe('a path may not leave the directory', () => {
  it('refuses to climb out', () => {
    expect(() => resolveAsset(root, '../../etc/passwd')).toThrow(/No such file/)
  })

  it('refuses to climb out through an escape', () => {
    expect(() => resolveAsset(root, '..%2f..%2fetc%2fpasswd')).toThrow(/No such file/)
  })

  it('refuses a null byte, which truncates a path further down', () => {
    expect(() => resolveAsset(root, 'index.html\0.png')).toThrow(/No such file/)
  })

  it('refuses an escape that does not decode', () => {
    expect(() => resolveAsset(root, '%')).toThrow(/No such file/)
  })

  it('allows an ordinary nested path', () => {
    expect(resolveAsset(root, 'assets/style.css')).toBe(join(root, 'assets', 'style.css'))
  })
})

describe('what a browser is told', () => {
  it('never renders a type it was not given', () => {
    expect(assetContentType('/x/notes.rtf')).toBe('application/octet-stream')
  })

  it('keeps a fingerprinted asset forever', () => {
    expect(assetCacheControl('/x/main-8f3a1c2b.js')).toBe('public, max-age=31536000, immutable')
  })

  it('never keeps the entry document, or a deploy leaves browsers on the old one', () => {
    expect(assetCacheControl('/x/index.html')).toBe('no-cache')
    expect(assetCacheControl('/x/style.css')).toBe('no-cache')
  })
})
