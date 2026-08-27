import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { ignoring, NEVER_COPIED, templateExclusions } from './exclusions.js'
import { type ScaffoldResult, scaffold } from './scaffold.js'
import { remove, temporaryDirectory, write } from './template.fixture.js'

describe('ignoring', () => {
  it('matches a bare name at any depth, the way git does', () => {
    const ignores = ignoring(['dist'])

    expect(ignores('dist', false)).toBe(true)
    expect(ignores('app/dist', false)).toBe(true)
    expect(ignores('app/dist/index.html', false)).toBe(true)
    expect(ignores('distinct', false)).toBe(false)
    expect(ignores('app/mydist', false)).toBe(false)
  })

  it('anchors a pattern that has a separator in it', () => {
    const ignores = ignoring(['src/generated/', '/openapi.json'])

    expect(ignores('src/generated', true)).toBe(true)
    expect(ignores('openapi.json', false)).toBe(true)
    expect(ignores('app/src/generated', true)).toBe(false)
    expect(ignores('app/openapi.json', false)).toBe(false)
  })

  it('applies a trailing slash to directories only', () => {
    const ignores = ignoring(['build/'])

    expect(ignores('build', true)).toBe(true)
    expect(ignores('build', false)).toBe(false)
  })

  it('reads * and ? within one segment, and ** across them', () => {
    expect(ignoring(['*.tsbuildinfo'])('src/tsconfig.tsbuildinfo', false)).toBe(true)
    expect(ignoring(['/database/migrations/*.sql'])('database/migrations/0001.sql', false)).toBe(
      true,
    )
    expect(ignoring(['/database/migrations/*.sql'])('database/migrations/.gitkeep', false)).toBe(
      false,
    )
    expect(ignoring(['/a/*.sql'])('a/b/c.sql', false)).toBe(false)
    expect(ignoring(['/a/**/c.sql'])('a/b/c.sql', false)).toBe(true)
    // `**/` also matches no directory at all.
    expect(ignoring(['**/c.sql'])('c.sql', false)).toBe(true)
    expect(ignoring(['log?.txt'])('log1.txt', false)).toBe(true)
    expect(ignoring(['log?.txt'])('log10.txt', false)).toBe(false)
    expect(ignoring(['log[0-9].txt'])('log7.txt', false)).toBe(true)
    expect(ignoring(['log[!0-9].txt'])('log7.txt', false)).toBe(false)
  })

  it('lets the last matching pattern decide, so ! re-includes', () => {
    const ignores = ignoring(['.env', '.env.*', '!.env.example'])

    expect(ignores('.env', false)).toBe(true)
    expect(ignores('.env.local', false)).toBe(true)
    expect(ignores('.env.example', false)).toBe(false)
  })

  it('ignores blank lines and comments, and takes an escaped # literally', () => {
    const ignores = ignoring(['', '   ', '# a comment', '\\#notes.md'])

    expect(ignores('# a comment', false)).toBe(false)
    expect(ignores('#notes.md', false)).toBe(true)
  })

  it('treats a bracket that never closes as a bracket', () => {
    expect(ignoring(['app/[slug]/'])('app/[slug]', true)).toBe(false)
    expect(ignoring(['a[bc'])('a[bc', false)).toBe(true)
  })
})

/*
 * What a project never inherits, asserted one entry at a time.
 *
 * The reviewer's point, and the reason this file exists: deleting `'dist'` from the
 * scaffolder's list used to leave every test in the repository green. So each entry
 * gets a file planted in a template and a claim about where it did not end up, and
 * every claim is written out here rather than derived from the list it is checking.
 */
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(remove))
})

/** A template holding one of everything a checkout or a run of a project leaves behind. */
const planted = async (ignoreFile?: string): Promise<ScaffoldResult> => {
  const root = await temporaryDirectory()
  directories.push(root)

  const template = join(root, 'template')

  await write(template, 'package.json', '{ "name": "@assemora/starter-planted" }\n')
  await write(template, 'template.json', '{ "features": {} }\n')
  await write(template, 'src/app.ts', 'export const app = 1\n')
  await write(template, 'app/index.html', '<!doctype html>\n')
  await write(template, 'database/migrations/.gitkeep', '')

  if (ignoreFile !== undefined) await write(template, '_gitignore', ignoreFile)

  for (const path of [
    'node_modules/left-pad/index.js',
    'dist/index.js',
    'app/dist/index.html',
    '.turbo/turbo-build.log',
    '.git/HEAD',
    'coverage/index.html',
    'tsconfig.tsbuildinfo',
    'src/other.tsbuildinfo',
    '.assemora/schema.json',
    'database/migrations/0001_initial.sql',
    'openapi.json',
    'src/generated/sdk.ts',
    '.next/BUILD_ID',
    'next-env.d.ts',
    '.env',
    'build/bundle.js',
    // Anchored patterns stop at the root: these are ordinary project files.
    'app/openapi.json',
    'app/database/migrations/0001_initial.sql',
  ]) {
    await write(template, path, 'planted\n')
  }

  return scaffold({ name: 'planted', directory: join(root, 'project'), template })
}

describe('what a project never inherits', () => {
  it.each([
    ['node_modules', 'node_modules/left-pad/index.js'],
    ['dist at the root', 'dist/index.js'],
    ['dist further down', 'app/dist/index.html'],
    ['.turbo', '.turbo/turbo-build.log'],
    ['.git', '.git/HEAD'],
    ['coverage', 'coverage/index.html'],
    ['a .tsbuildinfo at the root', 'tsconfig.tsbuildinfo'],
    ['a .tsbuildinfo further down', 'src/other.tsbuildinfo'],
    ['the schema snapshot', '.assemora/schema.json'],
    ['a generated migration', 'database/migrations/0001_initial.sql'],
    ['a generated OpenAPI document', 'openapi.json'],
    ['a generated SDK', 'src/generated/sdk.ts'],
    ['the template manifest', 'template.json'],
  ])('never carries %s', async (_what: string, path: string) => {
    const { files } = await planted()

    expect(files).not.toContain(path)
  })

  it('still carries everything that is the template', async () => {
    const { files } = await planted()

    expect(files).toContain('src/app.ts')
    expect(files).toContain('app/index.html')
    // The directory a project generates migrations into is part of the template; the
    // migrations somebody else generated into it are not.
    expect(files).toContain('database/migrations/.gitkeep')
    // Anchored patterns mean what they say: these are ordinary files of the project.
    expect(files).toContain('app/openapi.json')
    expect(files).toContain('app/database/migrations/0001_initial.sql')
  })

  it('excludes what the template says its own tooling writes', async () => {
    const { files } = await planted('.next/\nnext-env.d.ts\nbuild/\n.env\n')

    expect(files).not.toContain('.next/BUILD_ID')
    expect(files).not.toContain('next-env.d.ts')
    expect(files).not.toContain('build/bundle.js')
    expect(files).not.toContain('.env')
    expect(files).toContain('.gitignore')
  })

  it('copies what no ignore file names, because that half belongs to the template', async () => {
    const { files } = await planted()

    expect(files).toContain('.next/BUILD_ID')
    expect(files).toContain('build/bundle.js')
  })

  it('does not let a template re-include what it may never carry', async () => {
    const { files } = await planted('!node_modules/\n!.assemora/\n')

    expect(files).not.toContain('node_modules/left-pad/index.js')
    expect(files).not.toContain('.assemora/schema.json')
  })
})

describe('templateExclusions', () => {
  it('prunes an excluded directory rather than asking about what is inside it', async () => {
    const root = await temporaryDirectory()
    directories.push(root)

    await write(root, '_gitignore', 'build/\n')

    const excluded = await templateExclusions(root)

    expect(excluded('node_modules', true)).toBe(true)
    expect(excluded('build', true)).toBe(true)
    expect(excluded('src', true)).toBe(false)
  })

  it('declares nothing for a template with no ignore file', async () => {
    const root = await temporaryDirectory()
    directories.push(root)

    const excluded = await templateExclusions(root)

    expect(excluded('.next', true)).toBe(false)
    expect(excluded('node_modules', true)).toBe(true)
  })

  it('reads a real .gitignore too, for a template that was never packed', async () => {
    const root = await temporaryDirectory()
    directories.push(root)

    await write(root, '.gitignore', 'out/\n')

    const excluded = await templateExclusions(root)

    expect(excluded('out', true)).toBe(true)
  })
})

/*
 * One list, and a test that says so.
 *
 * `scripts/copy-templates.mjs` decided this for itself until now, and the two lists
 * drifted: neither had `.next` in it. A test cannot import the script — it is `.mjs`
 * outside this package's `rootDir` — but it can read it, and what it is reading for
 * is the absence of a second list rather than the presence of a particular line.
 */
describe('scripts/copy-templates.mjs', () => {
  it('asks this module what a template may not carry, and keeps no list of its own', async () => {
    const script = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'copy-templates.mjs'),
      'utf8',
    )

    expect(script).toContain("from '../src/exclusions.ts'")
    expect(script).toContain('templateExclusions(source)')
    expect(script).not.toContain('new Set(')

    for (const entry of NEVER_COPIED) {
      expect(script).not.toContain(`'${entry}'`)
      expect(script).not.toContain(`'${entry.replace(/\/$/, '')}'`)
    }
  })

  it('packs a starter without what a checkout of it accumulated, manifest included', async () => {
    const root = await temporaryDirectory()
    directories.push(root)

    const starters = join(root, 'starters')
    const templates = join(root, 'templates')

    await write(starters, 'demo/package.json', '{ "name": "@assemora/starter-demo" }\n')
    await write(starters, 'demo/template.json', '{ "features": {} }\n')
    await write(starters, 'demo/src/app.ts', 'export const app = 1\n')
    await write(starters, 'demo/_gitignore', '.next/\n')
    await write(starters, 'demo/node_modules/left-pad/index.js', 'module.exports = 1\n')
    await write(starters, 'demo/.next/BUILD_ID', 'abc\n')
    await write(starters, 'demo/dist/index.js', 'built\n')
    await write(starters, 'demo/tsconfig.tsbuildinfo', '{}\n')
    await write(starters, 'demo/database/migrations/0001_initial.sql', 'create table x ();\n')

    const script = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'scripts',
      'copy-templates.mjs',
    )

    await promisify(execFile)(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      script,
      starters,
      templates,
    ])

    const packed = await readdir(join(templates, 'demo'), { recursive: true })
    const found = packed.map((entry) => (sep === '/' ? entry : entry.split(sep).join('/'))).sort()

    // A packed template still has to be able to say what its optional parts are, so
    // the manifest is the one thing the scaffolder drops that the packer keeps.
    expect(found).toContain('template.json')
    expect(found).toContain('src/app.ts')
    expect(found).toContain('_gitignore')
    expect(found.filter((entry) => entry.startsWith('node_modules'))).toStrictEqual([])
    expect(found.filter((entry) => entry.startsWith('.next'))).toStrictEqual([])
    expect(found.filter((entry) => entry.startsWith('dist'))).toStrictEqual([])
    expect(found).not.toContain('tsconfig.tsbuildinfo')
    expect(found).not.toContain('database/migrations/0001_initial.sql')
  })
})
