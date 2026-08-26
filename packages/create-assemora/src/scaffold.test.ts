import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FEATURES, type Features } from './features.js'
import { projectNameError, type ScaffoldResult, scaffold, shortestPath } from './scaffold.js'
import { remove, temporaryDirectory, write, writeTemplate } from './template.fixture.js'

const directories: string[] = []

const temporary = async (): Promise<string> => {
  const directory = await temporaryDirectory()
  directories.push(directory)

  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(remove))
})

/**
 * A project, from the fixture template.
 *
 * The template is handed over as an absolute path rather than by name, so the test
 * copies the directory it just wrote instead of whatever `starters/bare` happens to
 * hold in this checkout.
 */
const project = async (
  answers: Partial<Features> & { readonly database?: string; readonly force?: boolean } = {},
): Promise<{
  readonly result: ScaffoldResult
  readonly read: (path: string) => Promise<string>
}> => {
  const root = await temporary()
  const template = await writeTemplate(root)
  const directory = join(root, 'my-project')

  const result = await scaffold({ name: 'my-project', directory, template, ...answers })

  return {
    result,
    read: (path: string) => readFile(join(directory, ...path.split('/')), 'utf8'),
  }
}

const parsed = async (read: (path: string) => Promise<string>, path: string): Promise<unknown> =>
  JSON.parse(await read(path))

const dependencies = (manifest: unknown): readonly string[] =>
  Object.keys((manifest as { dependencies: Record<string, string> }).dependencies).sort()

/** Every relative import `src/app.ts` makes, as the file it expects to find. */
const importedFiles = (source: string): readonly string[] =>
  [...source.matchAll(/from '\.\/(.+)\.js'/g)].map((match) => `src/${match[1] ?? ''}.ts`)

describe('projectNameError', () => {
  it('accepts a name npm would', () => {
    expect(projectNameError('my-project')).toBeUndefined()
    expect(projectNameError('my.project_1')).toBeUndefined()
  })

  it('asks for one when there is none', () => {
    expect(projectNameError('')).toMatch(/needs a name/)
  })

  it('suggests the kebab form rather than guessing it', () => {
    expect(projectNameError('MyProject')).toContain('"my-project"')
    expect(projectNameError('My Project')).toContain('"my-project"')
  })

  it('refuses a leading dot or underscore, a path, and something too long', () => {
    expect(projectNameError('.hidden')).toMatch(/cannot begin/)
    expect(projectNameError('_hidden')).toMatch(/cannot begin/)
    expect(projectNameError('a/b')).toMatch(/is not a package name/)
    expect(projectNameError('..')).toMatch(/cannot begin/)
    expect(projectNameError('a'.repeat(215))).toMatch(/214 characters/)
  })
})

describe('scaffold', () => {
  it('writes the template, with the dotfiles npm cannot carry restored', async () => {
    const { result, read } = await project()

    expect(result.files).toContain('.gitignore')
    expect(result.files).toContain('.npmrc')
    expect(result.files).not.toContain('_gitignore')
    expect(await read('.gitignore')).toContain('node_modules/')
  })

  it('answers with project-relative paths, sorted', async () => {
    const { result } = await project()

    expect(result.files).toStrictEqual([...result.files].sort())
    expect(result.files.every((file) => !file.startsWith('/'))).toBe(true)
  })

  it('never copies the manifest, which is the template talking about itself', async () => {
    const { result } = await project()

    expect(result.files).not.toContain('template.json')
  })

  it('gives the project its own name and a resolvable range', async () => {
    const { read } = await project()
    const manifest = (await parsed(read, 'package.json')) as {
      name: string
      private: boolean
      dependencies: Record<string, string>
    }

    expect(manifest.name).toBe('my-project')
    expect(manifest.private).toBe(true)
    expect(manifest.dependencies.assemora).not.toContain('workspace:')
    expect(manifest.dependencies.assemora).toMatch(/^\^/)
    // Anything that was already a real range is left exactly as its author wrote it.
    expect(manifest.dependencies.zod).toBe('^3.0.0')
  })

  it('leaves a package.json below the root with its own name', async () => {
    const { read } = await project()
    const manifest = (await parsed(read, 'app/package.json')) as {
      name: string
      dependencies: Record<string, string>
    }

    expect(manifest.name).toBe('frontend')
    expect(manifest.dependencies.assemora).not.toContain('workspace:')
  })

  it('copies a file that is not text without touching it', async () => {
    const { result } = await project()
    const root = result.directory

    expect(result.files).toContain('public/logo.png')
    expect((await stat(join(root, 'public/logo.png'))).size).toBe(6)
  })

  it('copies .env.example, and writes no .env without a database URL', async () => {
    const { result, read } = await project()

    expect(result.files).toContain('.env.example')
    expect(result.files).not.toContain('.env')
    await expect(read('.env')).rejects.toThrow()
  })

  it('writes a .env holding the answer that was given, and nothing else', async () => {
    const { result, read } = await project({ database: 'postgres://localhost:5432/demo' })
    const env = await read('.env')

    expect(result.files).toContain('.env')
    expect(env).toContain('DATABASE_URL=postgres://localhost:5432/demo')
    expect(env).not.toContain('DATABASE_URL=\n')
  })

  it('quotes a URL that would otherwise end at a comment', async () => {
    const { read } = await project({ database: 'postgres://ada:pa#ss@localhost/demo' })

    expect(await read('.env')).toContain('DATABASE_URL="postgres://ada:pa#ss@localhost/demo"')
  })

  it('refuses a directory that is not empty', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)
    const directory = join(root, 'taken')

    await write(directory, 'notes.md', 'mine\n')

    await expect(scaffold({ name: 'taken', directory, template })).rejects.toThrow(/not empty/)
  })

  it('writes into one anyway when told to', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)
    const directory = join(root, 'taken')

    await write(directory, 'notes.md', 'mine\n')

    const result = await scaffold({ name: 'taken', directory, template, force: true })

    expect(result.files).toContain('package.json')
    expect(await readFile(join(directory, 'notes.md'), 'utf8')).toBe('mine\n')
  })

  it('refuses a name npm would refuse, before it writes anything', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    await expect(
      scaffold({ name: 'My Project', directory: join(root, 'out'), template }),
    ).rejects.toThrow(/npm has no uppercase ones/)
  })

  it('trims a name pasted with a space on the end', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)
    const directory = join(root, 'my-project')

    const result = await scaffold({ name: ' my-project ', directory, template })
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      name: string
    }

    expect(manifest.name).toBe('my-project')
    expect(result.directory).toBe(directory)
  })
})

/*
 * The eight combinations.
 *
 * SPEC.md §78 asks three yes/no questions, so a starter is eight projects. Every one
 * of them has to compile, which means: nothing imports a file that was left out,
 * nothing depends on a package that was left out, and no marker survives into the
 * project. That is what these assert, mechanically, rather than by reading.
 */
const combinations = (): readonly Features[] =>
  [...Array(8).keys()].map((mask) => ({
    studio: (mask & 1) === 0,
    pages: (mask & 2) === 0,
    mcp: (mask & 4) === 0,
  }))

const OWNED: Readonly<Record<string, { readonly file: string; readonly dependency: string }>> = {
  studio: { file: 'src/studio.ts', dependency: '@assemora/studio' },
  pages: { file: 'src/blocks/hero.ts', dependency: '@assemora/pages' },
  mcp: { file: 'src/mcp-routes.ts', dependency: '@assemora/mcp' },
}

describe.each(combinations())(
  'a project with studio=$studio pages=$pages mcp=$mcp',
  (features: Features) => {
    it('has every file the answers asked for and none they did not', async () => {
      const { result } = await project(features)

      for (const feature of FEATURES) {
        expect(result.files.includes(OWNED[feature]?.file ?? '')).toBe(features[feature])
      }
    })

    it('depends on exactly what it uses', async () => {
      const { read } = await project(features)
      const declared = dependencies(await parsed(read, 'package.json'))
      const expected = [
        'assemora',
        'zod',
        ...FEATURES.filter((f) => features[f]).map((f) => OWNED[f]?.dependency ?? ''),
      ]

      expect(declared).toStrictEqual([...expected].sort())
    })

    it('imports nothing that was left out', async () => {
      const { result, read } = await project(features)

      for (const imported of importedFiles(await read('src/app.ts'))) {
        expect(result.files).toContain(imported)
      }
    })

    it('carries no marker into the project', async () => {
      const { result, read } = await project(features)

      for (const file of result.files) {
        if (file.endsWith('.png')) continue

        expect(await read(file)).not.toContain('assemora:if')
        expect(await read(file)).not.toContain('assemora:end')
      }
    })
  },
)

describe('shortestPath', () => {
  it('is what cd wants', () => {
    expect(shortestPath('/a', '/a/b')).toBe('b')
    expect(shortestPath('/a', '/c')).toBe('/c')
    expect(shortestPath('/a', '/a')).toBe('/a')
  })
})
