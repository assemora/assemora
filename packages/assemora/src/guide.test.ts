/**
 * That the published tarball carries the guide, and carries all of it.
 *
 * The guide lives at `docs/guide/`, beside the code it documents, so a chapter and the
 * API it describes are edited in one commit. A tarball cannot reach outside itself, so
 * `prepack` copies it in — and a copy is a thing that silently stops happening. The
 * documentation site is a different repository and reads the guide from this package,
 * so a tarball missing a page is a site missing a page, discovered by a reader.
 */
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// @ts-expect-error — a `.mjs` script with no declarations, imported for its one export.
import { copyGuide } from '../scripts/copy-guide.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const GUIDE = join(here, '..', '..', '..', 'docs', 'guide')

const packed = async (): Promise<{ to: string; pages: readonly string[] }> => {
  const to = join(await mkdtemp(join(tmpdir(), 'assemora-guide-')), 'guide')
  const pages = (await copyGuide(GUIDE, to)) as readonly string[]

  return { to, pages }
}

describe('the guide a tarball carries', () => {
  it('is every page the repository has', async () => {
    const written = (await readdir(GUIDE)).filter((name) => name.endsWith('.md')).sort()
    const { to } = await packed()

    expect(await readdir(to)).toEqual(written)
    // A guide of one page would pass every case below by having nothing to lose.
    expect(written.length).toBeGreaterThan(5)
  })

  it('holds the contents page, which is what the site draws its navigation from', async () => {
    // `README.md` is the table of contents. Numbered pages are chapters; this is the
    // one that is not, and dropping it as "just a readme" is the obvious mistake.
    const { to } = await packed()

    expect(await readdir(to)).toContain('README.md')
  })

  it('copies each page whole rather than a truncation of it', async () => {
    const { to } = await packed()
    const name = '02-getting-started.md'

    expect(await readFile(join(to, name), 'utf8')).toBe(await readFile(join(GUIDE, name), 'utf8'))
  })

  it('leaves behind whatever else a checkout has in there', async () => {
    // A draft, an editor's swap file, a directory of images somebody added. Markdown is
    // what the site renders and Markdown is what ships.
    const from = await mkdtemp(join(tmpdir(), 'assemora-guide-source-'))

    await writeFile(join(from, '01-a.md'), '# A')
    await writeFile(join(from, 'notes.txt'), 'not a page')
    await writeFile(join(from, '.02-b.md.swp'), 'not a page either')

    const to = join(await mkdtemp(join(tmpdir(), 'assemora-guide-')), 'guide')

    await copyGuide(from, to)

    expect(await readdir(to)).toEqual(['01-a.md'])
  })

  it('refuses to pack nothing rather than shipping an empty directory', async () => {
    // The failure this whole file exists for: a rename upstream, a path that stops
    // resolving, and a tarball that packs successfully with no guide in it.
    const empty = await mkdtemp(join(tmpdir(), 'assemora-guide-empty-'))
    const to = join(await mkdtemp(join(tmpdir(), 'assemora-guide-')), 'guide')

    await expect(copyGuide(empty, to)).rejects.toThrow(/No guide to pack/)
  })
})
