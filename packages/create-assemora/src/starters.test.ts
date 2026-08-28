/**
 * The real starters, scaffolded from the directories a checkout actually holds.
 *
 * Every other test in this package copies the synthetic template in
 * `template.fixture.ts`, which is the right way to exercise the copier's awkward
 * cases — and it is also why `--template nextjs` shipped unable to scaffold at all.
 * A fixture cannot grow a `.next/` directory the moment somebody runs `pnpm build`;
 * a starter can, and did.
 *
 * So these tests take the starter as it is on disk, in whatever state this checkout
 * has left it — built or not, installed or not — because that is the state a
 * developer's `pnpm create assemora` meets.
 */
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { FEATURES, type Features } from './features.js'
import { type ScaffoldResult, scaffold } from './scaffold.js'
import { remove, temporaryDirectory } from './template.fixture.js'

const here = dirname(fileURLToPath(import.meta.url))

/** `starters/<name>`, by path rather than by name: the workspace copy, never a packed one. */
const starter = (name: string): string => join(here, '..', '..', '..', 'starters', name)

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(remove))
})

const scaffolded = async (name: string, features: Features): Promise<ScaffoldResult> => {
  const root = await temporaryDirectory()
  directories.push(root)

  return scaffold({
    name: 'my-project',
    directory: join(root, 'my-project'),
    template: starter(name),
    ...features,
  })
}

/** SPEC.md §78 asks three yes/no questions, so a starter is eight projects. */
const combinations = (): readonly Features[] =>
  [...Array(8).keys()].map((mask) => ({
    studio: (mask & 1) === 0,
    pages: (mask & 2) === 0,
    mcp: (mask & 4) === 0,
  }))

/**
 * Every file a module imports by relative path, project-relative and without its
 * extension.
 *
 * TypeScript's ESM imports name the built `.js`, so what is on disk beside it is
 * `.ts` or `.tsx` — the caller tries both. An import naming a file the answers
 * removed is the failure this looks for, and it is also what an `_` rewritten
 * somewhere it should not have been would produce.
 */
const relativeImports = (file: string, text: string): readonly string[] =>
  [...text.matchAll(/from '(\.[^']*)'/g)].map((match) => {
    const segments = [
      ...file.split('/').slice(0, -1),
      ...(match[1] ?? '').replace(/\.js$/, '').split('/'),
    ]
    const resolved: string[] = []

    for (const segment of segments) {
      if (segment === '.') continue
      else if (segment === '..') resolved.pop()
      else resolved.push(segment)
    }

    return resolved.join('/')
  })

/**
 * What no project may inherit, whichever starter it came from.
 *
 * Written out here rather than derived from the scaffolder's own list, so that
 * deleting an entry from that list fails a test instead of silently widening what a
 * new project is given.
 */
const FORBIDDEN: Readonly<Record<string, (file: string) => boolean>> = {
  node_modules: (file) => file.split('/').includes('node_modules'),
  dist: (file) => file.split('/').includes('dist'),
  '.turbo': (file) => file.split('/').includes('.turbo'),
  '.git': (file) => file.split('/').includes('.git'),
  coverage: (file) => file.split('/').includes('coverage'),
  '.assemora': (file) => file.split('/').includes('.assemora'),
  '.next': (file) => file.split('/').includes('.next'),
  'next-env.d.ts': (file) => file === 'next-env.d.ts',
  'a .tsbuildinfo': (file) => file.endsWith('.tsbuildinfo'),
  'the manifest': (file) => file.endsWith('template.json'),
  'a generated migration': (file) =>
    file.startsWith('database/migrations/') && file.endsWith('.sql'),
  'a generated OpenAPI document': (file) => file === 'openapi.json',
  'a generated SDK': (file) => file.startsWith('src/generated/'),
  // The repository's proof that the template works, which imports a test runner the
  // project has no dependency on. `starters/bare/app/main.test.tsx` is the one that
  // exists today, and it is why this entry does.
  "one of the repository's own tests": (file) => /\.test(?:-d)?\.tsx?$/.test(file),
}

/**
 * Every starter a checkout carries, so that adding one to `starters/` and forgetting
 * it here is not possible: the list is read from disk rather than written out.
 *
 * `bare` is the default and `blog` is the worked example it used to be; `nextjs` is the
 * frontend-framework one. All three answer SPEC.md §78's three questions, and all three
 * have to survive all eight answers to them.
 */
const STARTERS: readonly string[] = readdirSync(join(here, '..', '..', '..', 'starters'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && existsSync(join(starter(entry.name), 'package.json')))
  .map((entry) => entry.name)
  .sort()

describe('starters/', () => {
  it('holds the three this repository ships', () => {
    expect(STARTERS).toStrictEqual(['bare', 'blog', 'nextjs'])
  })
})

describe.each(STARTERS)('starters/%s', (name: string) => {
  it.each(combinations())(
    'scaffolds with studio=$studio pages=$pages mcp=$mcp',
    async (features: Features) => {
      const result = await scaffolded(name, features)

      expect(result.files).toContain('package.json')
      expect(result.files).toContain('.gitignore')
    },
  )

  it('gives the project nothing a checkout or a run of the starter left behind', async () => {
    const { files } = await scaffolded(name, { studio: true, pages: true, mcp: true })

    for (const [what, matches] of Object.entries(FORBIDDEN)) {
      expect({ [what]: files.filter(matches) }).toStrictEqual({ [what]: [] })
    }
  })

  it('carries no marker into the project, in any combination', async () => {
    for (const features of combinations()) {
      const { directory, files } = await scaffolded(name, features)

      for (const file of files) {
        const text = await readFile(join(directory, ...file.split('/')), 'utf8')

        expect(`${file}: ${text}`).not.toContain('assemora:if')
        expect(`${file}: ${text}`).not.toContain('assemora:end')
      }
    }
  })

  it('imports no file the answers left out, in any combination', async () => {
    for (const features of combinations()) {
      const { directory, files } = await scaffolded(name, features)

      for (const file of files.filter((entry) => /\.(ts|tsx|mjs)$/.test(entry))) {
        const text = await readFile(join(directory, ...file.split('/')), 'utf8')

        for (const imported of relativeImports(file, text)) {
          const found = [`${imported}.ts`, `${imported}.tsx`, imported].some((candidate) =>
            files.includes(candidate),
          )

          expect({ file, missing: found ? undefined : imported, features }).toStrictEqual({
            file,
            missing: undefined,
            features,
          })
        }
      }
    }
  })
})

describe('every feature of every starter', () => {
  it.each(STARTERS)('is one this scaffolder asks about (%s)', async (name: string) => {
    const manifest = JSON.parse(await readFile(join(starter(name), 'template.json'), 'utf8')) as {
      readonly features?: Record<string, unknown>
    }

    for (const feature of Object.keys(manifest.features ?? {})) {
      expect(FEATURES).toContain(feature)
    }
  })
})

/**
 * A template nobody can tell apart from the others is a template nobody chooses.
 *
 * `--help` and the line printed after a scaffold both list what a checkout carries, and
 * both read the description out of `template.json`. A starter that declares none is
 * listed as a bare name, which is exactly the state this asserts nobody leaves it in.
 */
describe('every starter', () => {
  it.each(STARTERS)('says in one line what it is (%s)', async (name: string) => {
    const manifest = JSON.parse(await readFile(join(starter(name), 'template.json'), 'utf8')) as {
      readonly description?: unknown
    }

    expect({ [name]: typeof manifest.description }).toStrictEqual({ [name]: 'string' })
  })
})
