/**
 * The `make:*` generators (SPEC.md §77).
 *
 * The claim worth testing is not that a file appeared — it is that what is in it is
 * a declaration the framework accepts. `the generated files` writes all six into one
 * project and runs the repository's own TypeScript over them, resolving
 * `@assemora/*` to the built type declarations exactly as a project would, so a
 * template that drifts away from an API fails here rather than in somebody's
 * terminal on their first afternoon with Assemora.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { parseArgs } from '../args.js'
import { captureOutput } from '../output.js'
import {
  camelCase,
  kebabCase,
  makeCommands,
  pascalCase,
  pluralOf,
  sentenceCase,
  singularOf,
  snakeCase,
} from './make.js'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))

const projects: string[] = []

afterEach(async () => {
  for (const project of projects.splice(0)) await rm(project, { recursive: true, force: true })
})

/**
 * A project the generators can write into.
 *
 * `app` is never called: nothing in `make:*` boots an application, and a config that
 * threw if it were called is the cheapest proof of that.
 */
const project = async (paths = ''): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'assemora-make-'))
  projects.push(root)

  await writeFile(join(root, 'package.json'), '{ "type": "module" }\n', 'utf8')
  await writeFile(
    join(root, 'assemora.config.ts'),
    `export default {
  app: () => {
    throw new Error('make:* must not boot the application')
  },${paths}
}
`,
    'utf8',
  )

  return root
}

type Ran = { readonly code: number; readonly stdout: string; readonly stderr: string }

const make = async (name: string, argv: readonly string[], cwd: string): Promise<Ran> => {
  const command = makeCommands.find((entry) => entry.name === name)
  if (command === undefined) throw new Error(`${name} is not registered`)

  const captured = captureOutput()

  try {
    const code = await command.handler({ args: parseArgs([name, ...argv]), cwd })

    return { code, stdout: captured.stdout, stderr: captured.stderr }
  } finally {
    captured.restore()
  }
}

const written = (root: string, path: string): Promise<string> =>
  readFile(join(root, 'src', path), 'utf8')

describe('the case conversions', () => {
  it('read a name however a person typed it', () => {
    for (const spelling of ['blog_post', 'BlogPost', 'blog-post', 'blogPost', 'blog post']) {
      expect(pascalCase(spelling)).toBe('BlogPost')
      expect(camelCase(spelling)).toBe('blogPost')
      expect(kebabCase(spelling)).toBe('blog-post')
      expect(snakeCase(spelling)).toBe('blog_post')
      expect(sentenceCase(spelling)).toBe('Blog post')
    }
  })

  it('keeps an acronym as one word rather than one word per letter', () => {
    expect(kebabCase('APIKey')).toBe('api-key')
    expect(pascalCase('api_key')).toBe('ApiKey')
  })

  it('treats a digit as part of the word beside it', () => {
    expect(kebabCase('v2Post')).toBe('v2-post')
  })
})

describe('pluralisation', () => {
  it('handles the common English endings', () => {
    expect(pluralOf('post')).toBe('posts')
    expect(pluralOf('category')).toBe('categories')
    expect(pluralOf('day')).toBe('days')
    expect(pluralOf('box')).toBe('boxes')
    expect(pluralOf('church')).toBe('churches')
    expect(pluralOf('dish')).toBe('dishes')
    expect(pluralOf('class')).toBe('classes')
    expect(pluralOf('status')).toBe('statuses')
  })

  it('leaves a name that is already plural alone', () => {
    expect(pluralOf('posts')).toBe('posts')
    expect(pluralOf('categories')).toBe('categories')
  })

  it('does not pretend to know that a person is people', () => {
    expect(pluralOf('person')).toBe('persons')
  })

  it('undoes itself for the endings it knows', () => {
    for (const word of ['post', 'category', 'box', 'church', 'dish', 'class', 'status']) {
      expect(singularOf(pluralOf(word))).toBe(word)
    }
  })
})

describe('make:model', () => {
  it('writes the whole declaration, not a stub to be filled in', async () => {
    const root = await project()
    const ran = await make('make:model', ['Post'], root)

    expect(ran.code).toBe(0)
    expect(await written(root, 'models/post.ts')).toBe(`/**
 * The Post model.
 *
 * One declaration is the record type, the database column, the runtime validation
 * and every schema built from them — Studio's form, OpenAPI, the SDK and the MCP
 * tool (SPEC.md §9, §17).
 */
import { model, string, timestamp, uuid } from '@assemora/data'

export const Post = model('posts', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})
`)
  })

  it('names the model in the singular and its table in the plural', async () => {
    const root = await project()
    await make('make:model', ['BlogPost'], root)

    const contents = await written(root, 'models/blog-post.ts')

    expect(contents).toContain('export const BlogPost = model(')
    expect(contents).toContain("model('blog_posts', {")
  })

  it('produces the same file from every spelling of the same name', async () => {
    const contents = new Set<string>()

    // One at a time: `captureOutput()` is a module-level seam, and two generators
    // capturing at once would leave the terminal holding whichever one restored last.
    for (const spelling of ['blog_post', 'BlogPost', 'blog-post']) {
      const root = await project()
      await make('make:model', [spelling], root)

      contents.add(await written(root, 'models/blog-post.ts'))
    }

    expect(contents.size).toBe(1)
  })

  it('accepts a name typed in the plural without doubling it', async () => {
    const root = await project()
    await make('make:model', ['posts'], root)

    const contents = await written(root, 'models/post.ts')

    expect(contents).toContain('export const Post = model(')
    expect(contents).toContain("model('posts', {")
  })

  it('prints the path on stdout and the one next step on stderr', async () => {
    const root = await project()
    const ran = await make('make:model', ['Post'], root)

    expect(ran.stdout).toBe('src/models/post.ts\n')
    expect(ran.stderr).toContain('.models(Post)')
  })
})

describe('make:resource', () => {
  it('presents the model of the same name, and imports it by its real file', async () => {
    const root = await project()
    const ran = await make('make:resource', ['Post'], root)

    expect(ran.code).toBe(0)

    const contents = await written(root, 'resources/posts.ts')

    expect(contents).toContain("import { Post } from '../models/post.ts'")
    expect(contents).toContain('export const Posts = resource(')
    expect(contents).toContain('title: text().required().searchable().sortable()')
    expect(contents).toContain("{ label: 'Posts' }")
  })

  it('does not collide the model it imports with the resource it exports', async () => {
    const root = await project()
    await make('make:resource', ['posts'], root)

    const contents = await written(root, 'resources/posts.ts')

    expect(contents).toContain('import { Post }')
    expect(contents).toContain('export const Posts =')
  })
})

describe('make:block', () => {
  it('names the block type the way a URL would spell it', async () => {
    const root = await project()
    const ran = await make('make:block', ['CallToAction'], root)

    expect(ran.code).toBe(0)

    const contents = await written(root, 'blocks/call-to-action.ts')

    expect(contents).toContain('export const CallToAction = block(')
    expect(contents).toContain("'call-to-action',")
    expect(contents).toContain("{ label: 'Call to action' }")
  })
})

describe('make:module', () => {
  it('exports a factory rather than a constructed module', async () => {
    const root = await project()
    const ran = await make('make:module', ['blog-engine'], root)

    expect(ran.code).toBe(0)
    expect(await written(root, 'modules/blog-engine.ts')).toContain(
      "export const blogEngine = () => module('blog-engine')",
    )
  })
})

describe('make:command', () => {
  it('names the file after the act and the thing acted on', async () => {
    const root = await project()
    const ran = await make('make:command', ['posts.publish'], root)

    expect(ran.code).toBe(0)

    const contents = await written(root, 'commands/publish-post.ts')

    expect(contents).toContain("export const PublishPost = command('posts.publish', {")
    expect(contents).toContain("description: 'Publish post'")
  })

  it('keeps the name the bus will know it by, whatever case it was typed in', async () => {
    const root = await project()
    await make('make:command', ['Posts.Publish'], root)

    expect(await written(root, 'commands/publish-post.ts')).toContain("command('posts.publish', {")
  })

  it('accepts a command with no group and takes the whole name as the act', async () => {
    const root = await project()
    const ran = await make('make:command', ['reindex'], root)

    expect(ran.code).toBe(0)
    expect(await written(root, 'commands/reindex.ts')).toContain(
      "export const Reindex = command('reindex', {",
    )
  })
})

describe('make:policy', () => {
  it('asks for a permission for every action, rather than granting reads to anybody', async () => {
    const root = await project()
    const ran = await make('make:policy', ['posts'], root)

    expect(ran.code).toBe(0)

    const contents = await written(root, 'policies/posts.ts')

    expect(contents).toContain("export const PostPolicy = policy('posts', {")

    for (const action of ['read', 'create', 'update', 'delete']) {
      expect(contents).toContain(`${action}: ({ can }) => can('posts.${action}')`)
    }
  })
})

describe('an existing file', () => {
  it('is refused, and the refusal says what would have made it work', async () => {
    const root = await project()
    await make('make:model', ['Post'], root)
    await writeFile(join(root, 'src', 'models', 'post.ts'), 'const mine = 1\n', 'utf8')

    await expect(make('make:model', ['Post'], root)).rejects.toThrow(
      /src\/models\/post\.ts already exists\. Pass --force/,
    )
    expect(await written(root, 'models/post.ts')).toBe('const mine = 1\n')
  })

  it('is overwritten by --force, which says out loud that it was', async () => {
    const root = await project()
    await make('make:model', ['Post'], root)
    await writeFile(join(root, 'src', 'models', 'post.ts'), 'const mine = 1\n', 'utf8')

    const ran = await make('make:model', ['Post', '--force'], root)

    expect(ran.code).toBe(0)
    expect(ran.stderr).toContain('overwritten')
    expect(await written(root, 'models/post.ts')).toContain('export const Post = model(')
  })
})

describe('the invocation', () => {
  it('is rejected with exit code 2 when no name was given', async () => {
    const root = await project()
    const ran = await make('make:model', [], root)

    expect(ran.code).toBe(2)
    expect(ran.stderr).toContain('assemora make:model Post')
  })

  it('is rejected when the name holds no word at all', async () => {
    const root = await project()

    expect((await make('make:model', ['---'], root)).code).toBe(2)
  })

  it('cannot be talked into writing outside the source directory', async () => {
    const root = await project()
    const ran = await make('make:model', ['../../etc/passwd'], root)

    expect(ran.code).toBe(0)
    expect(ran.stdout).toBe('src/models/etc-passwd.ts\n')
  })

  it('cannot close a string literal in the file it writes', async () => {
    const root = await project()
    const ran = await make('make:model', ["Post', evil: 1, x: '"], root)

    expect(ran.code).toBe(0)

    const contents = await written(root, 'models/post-evil-1-x.ts')

    expect(contents).toContain("model('post_evil_1_xes', {")
    expect(contents).not.toContain('evil: 1')
  })

  it('writes where the config says the source lives', async () => {
    const root = await project(`\n  paths: { source: 'app' },`)
    const ran = await make('make:model', ['Post'], root)

    expect(ran.code).toBe(0)
    expect(ran.stdout).toBe('app/models/post.ts\n')
  })

  it('says there is no project rather than failing on a missing directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assemora-empty-'))
    projects.push(root)

    await expect(make('make:model', ['Post'], root)).rejects.toThrow(/assemora\.config\.ts/)
  })
})

/**
 * The compiler is the only witness worth having here.
 *
 * `@assemora/*` resolves to each package's built declarations, which is what a real
 * project resolves too — `pnpm verify` builds before it tests, so this is never
 * checking yesterday's types. `allowImportingTsExtensions` is what lets the generated
 * `../models/post.ts` import be both the file Node runs and the file TypeScript reads.
 */
const IMPORTED_PACKAGES = ['schema', 'core', 'data', 'resources', 'pages', 'auth'] as const

const typecheck = async (root: string): Promise<string> => {
  const declarations = Object.fromEntries(
    (await readdir(join(repositoryRoot, 'packages'))).map((directory) => [
      ['@assemora', directory].join('/'),
      [join(repositoryRoot, 'packages', directory, 'dist', 'index.d.ts')],
    ]),
  )

  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      extends: join(repositoryRoot, 'tsconfig.base.json'),
      compilerOptions: {
        noEmit: true,
        types: ['node'],
        typeRoots: [join(repositoryRoot, 'node_modules', '@types')],
        allowImportingTsExtensions: true,
        paths: declarations,
      },
      include: ['src/**/*'],
    }),
    'utf8',
  )

  const compiler = join(repositoryRoot, 'node_modules', '.bin', 'tsc')
  const result = spawnSync(compiler, ['-p', join(root, 'tsconfig.json')], { encoding: 'utf8' })

  // A compiler that never started produces no diagnostics either, and "no
  // diagnostics" is exactly what this helper reports as success.
  if (result.error !== undefined) throw result.error

  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

describe('the generated files', () => {
  it('compile against the real framework', { timeout: 120_000 }, async () => {
    const missing = IMPORTED_PACKAGES.filter(
      (name) => !existsSync(join(repositoryRoot, 'packages', name, 'dist', 'index.d.ts')),
    )

    expect(missing, 'these packages have not been built; run `pnpm build` first').toEqual([])

    const root = await project()

    await make('make:model', ['Post'], root)
    await make('make:resource', ['Post'], root)
    await make('make:block', ['hero'], root)
    await make('make:module', ['blog'], root)
    await make('make:command', ['posts.publish'], root)
    await make('make:policy', ['posts'], root)

    expect(await typecheck(root)).toBe('')
  })

  it('would fail this check if a template stopped compiling', { timeout: 120_000 }, async () => {
    const root = await project()
    await make('make:model', ['Post'], root)
    await writeFile(
      join(root, 'src', 'models', 'post.ts'),
      `${await written(root, 'models/post.ts')}\nexport const broken: number = 'not a number'\n`,
      'utf8',
    )

    expect(await typecheck(root)).toContain('not assignable')
  })
})
