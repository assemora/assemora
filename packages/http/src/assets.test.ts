/**
 * Serving a single-page application (SPEC.md §85).
 *
 * The cases here are the ones static serving gets wrong: a path that climbs out of
 * the root — lexically or through a symlink — a dotfile that shares the directory, a
 * document cached past a deploy, and a file whose type a browser would otherwise
 * guess.
 */
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { assetCacheControl, assetContentType, findAsset, resolveAsset } from './assets.js'

let root: string
/** What lives beside the bundle. A deploy directory, a checkout, a home directory. */
let outside: string

beforeAll(async () => {
  outside = await mkdtemp(join(tmpdir(), 'assemora-outside-'))
  root = join(outside, 'bundle')

  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Studio</title>')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'assets', 'main-8f3a1c2b.js'), 'console.log(1)')
  await writeFile(join(root, 'assets', 'style.css'), 'body{}')
  await writeFile(join(root, 'notes.rtf'), 'nothing a browser should render')

  // The two shapes a real directory grows: a dotfile that ended up beside the bundle,
  // and symlinks — one to a single file, one to the whole parent, which is what a
  // `public/` folder or a pnpm `node_modules` looks like.
  await writeFile(join(root, '.env'), 'INSIDE_SECRET=1')
  await writeFile(join(outside, 'secret.txt'), 'SUPER SECRET OUTSIDE ROOT')
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
  await symlink(outside, join(root, 'up'))
  // A symlink that stays inside is ordinary, and must keep working.
  await symlink(join(root, 'assets', 'style.css'), join(root, 'aliased.css'))
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

describe('a symlink may not leave the directory either (SPEC.md §85)', () => {
  it('refuses a file linked in from outside the root', async () => {
    // The lexical check passes — `link.txt` is inside the root — and `stat` and
    // `createReadStream` then follow the link out. Only the resolved real path says so.
    expect(await findAsset({ path: '/preview', root, fallback: false }, 'link.txt')).toBeUndefined()
  })

  it('refuses a path that climbs out through a linked directory', async () => {
    expect(
      await findAsset({ path: '/preview', root, fallback: false }, 'up/secret.txt'),
    ).toBeUndefined()
  })

  it('still serves a symlink that stays inside, which is what a bundle is made of', async () => {
    const found = await findAsset({ path: '/preview', root, fallback: false }, 'aliased.css')

    expect(found?.contentType).toBe('text/css; charset=utf-8')
  })
})

describe('a dotfile is never part of a bundle (SPEC.md §85)', () => {
  it('refuses one sitting beside the entry document', () => {
    // `.env`, `.git/config`, `.npmrc`: the files a directory grows around a build, and
    // the ones an application never meant to publish by pointing a mount at it.
    expect(() => resolveAsset(root, '.env')).toThrow(/No such file/)
  })

  it('refuses one in a directory below it', () => {
    expect(() => resolveAsset(root, 'assets/.env')).toThrow(/No such file/)
    expect(() => resolveAsset(root, '.git/config')).toThrow(/No such file/)
  })

  it('answers with nothing rather than the file, through the whole lookup', async () => {
    expect(await findAsset({ path: '/preview', root, fallback: false }, '.env')).toBeUndefined()
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
