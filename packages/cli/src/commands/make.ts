/**
 * `make:*` — the six generators of SPEC.md §77.
 *
 * A generated file is the first Assemora code most developers will ever read, so the
 * bar is not "it saves typing": it is that the file compiles, runs, and shows the
 * declaration the way the framework's own examples write it. A generator that emits
 * code the framework rejects is worse than no generator, and
 * `make.test.ts` compiles what these templates produce against the real packages
 * rather than trusting them.
 *
 * The CLI writes source files against APIs it deliberately does not depend on —
 * `@assemora/resources`, `@assemora/pages`, `@assemora/auth` (ADR-0021). That is a
 * template problem rather than an architectural one: nothing here imports those
 * packages, it only writes text that names them.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { ConflictError } from '@assemora/core'

import { bool, type ParsedArgs } from '../args.js'
import { loadConfig } from '../config.js'
import { detail, fail, ok, warn } from '../output.js'
import { type CliCommand, defineCommand, register } from '../registry.js'

/**
 * The words in a name, however it was typed.
 *
 * `BlogPost`, `blog_post`, `blog-post` and `blogPost` are the same three syllables,
 * and a person typing at a terminal should not have to remember which spelling the
 * generator wanted. Everything below is derived from these words, so all four
 * spellings produce a byte-identical file.
 */
const wordsOf = (name: string): readonly string[] =>
  name
    // `BlogPost` → `Blog Post`, and `APIKey` → `API Key`: the second rule is what
    // stops an acronym being split into one word per letter.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase())

const capitalised = (word: string): string => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`

/** `blog_post` → `BlogPost`. */
export const pascalCase = (name: string): string => wordsOf(name).map(capitalised).join('')

/** `blog_post` → `blogPost`. */
export const camelCase = (name: string): string =>
  wordsOf(name)
    .map((word, index) => (index === 0 ? word : capitalised(word)))
    .join('')

/** `BlogPost` → `blog-post`. The form every generated file name takes. */
export const kebabCase = (name: string): string => wordsOf(name).join('-')

/** `BlogPost` → `blog_post`. The form every generated table name takes. */
export const snakeCase = (name: string): string => wordsOf(name).join('_')

/** `blog_post` → `Blog post`. What a label and a description read like. */
export const sentenceCase = (name: string): string => capitalised(wordsOf(name).join(' '))

/**
 * The plural of one lower-case word.
 *
 * Four ordinary English rules, plus one that leaves a word already ending in `s`
 * alone so that `make:policy posts` is not a policy about `postses`. A genuine
 * singular ending in `s` is caught by the first rule, which is why `status` becomes
 * `statuses` rather than staying put.
 *
 * Nothing here knows that a person is people. An irregular plural is one word to fix
 * in the generated file, and a dictionary of English exceptions inside a CLI is a
 * promise it cannot keep — `model('people', …)` is the honest answer.
 */
export const pluralOf = (word: string): string => {
  if (/(?:ss|us|is)$/.test(word)) return `${word}es`
  if (word.endsWith('s')) return word
  if (/(?:x|z|ch|sh)$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`

  return `${word}s`
}

/** The inverse, to the same standard: it decides a file name, never a table name. */
export const singularOf = (word: string): string => {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(?:ss|us|is)$/.test(word)) return word
  if (/(?:x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('ses')) return word.slice(0, -2)
  if (word.endsWith('s')) return word.slice(0, -1)

  return word
}

/**
 * Only the last word is inflected: `blog_post` pluralises to `blog posts`, never to
 * `blogs posts`. The result is handed back space-separated, because every case
 * helper re-reads it as words anyway.
 */
const inflectLast = (name: string, inflect: (word: string) => string): string => {
  const words = [...wordsOf(name)]
  const last = words.at(-1)

  if (last !== undefined) words[words.length - 1] = inflect(last)

  return words.join(' ')
}

const pluralName = (name: string): string => inflectLast(name, pluralOf)

const singularName = (name: string): string => inflectLast(name, singularOf)

/**
 * Import lines are assembled rather than written out.
 *
 * `pnpm boundaries` reads source text and cannot tell a template apart from the code
 * around it, so a template spelling out an import of the resource layer reads as this
 * package importing it — the one thing the CLI must never do (ADR-0021). Composing
 * the line keeps that check honest without changing a character of what reaches disk.
 */
const importFrom = (names: readonly string[], from: string): string =>
  `import { ${names.join(', ')} } from '${from}'`

/**
 * A relative import carries the real `.ts` extension.
 *
 * Node 24 runs the TypeScript file directly and does not rewrite specifiers, so
 * `../models/post.js` would name a file that never exists. `apps/playground` is
 * written this way for the same reason; a project's tsconfig needs
 * `allowImportingTsExtensions`.
 */
const fromSource = (directory: string, file: string): string => `../${directory}/${file}.ts`

/** One file, and the one thing the developer still has to do with it. */
type Generated = {
  /** Where it goes, relative to `paths.source`. */
  readonly file: string
  readonly contents: string
  /**
   * A declaration nobody registers does nothing, and the generator is the last
   * moment anybody is looking. One sentence, naming the call to make.
   */
  readonly nextStep: string
}

type GeneratorSpec = {
  readonly name: string
  readonly summary: string
  readonly usage: string
  /** A whole invocation that works, printed when the name is missing. */
  readonly example: string
  readonly plan: (name: string) => Generated
}

const isAlreadyExists = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST'

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const write = async (
  file: string,
  shown: string,
  contents: string,
  force: boolean,
): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })

  try {
    // `wx` is what actually refuses, rather than a check followed by a write: two
    // generators racing for the same path cannot then both believe they won.
    await writeFile(file, contents, { encoding: 'utf8', flag: force ? 'w' : 'wx' })
  } catch (error) {
    if (!isAlreadyExists(error)) throw error

    throw new ConflictError(`${shown} already exists. Pass --force to overwrite it.`)
  }
}

const generate = async (spec: GeneratorSpec, args: ParsedArgs, cwd: string): Promise<number> => {
  const name = args.positionals[0]

  // Checked before the config is loaded: a forgotten argument is a mistake in what
  // was typed, and answering it with "no assemora.config.ts here" helps nobody.
  if (name === undefined || wordsOf(name).length === 0) {
    fail(`${spec.name} needs a name, for example: ${spec.example}`)
    return 2
  }

  const loaded = await loadConfig(cwd)
  const generated = spec.plan(name)
  const file = join(loaded.paths.source, generated.file)
  const shown = relative(cwd, file) || file
  const force = bool(args, 'force')

  // Asked before the write and reported after it, so that a write which failed does
  // not leave behind a warning about work nobody did.
  const replacing = force && (await exists(file))

  await write(file, shown, generated.contents, force)

  if (replacing) warn(`${shown} existed already and was overwritten`)

  // The path is the answer and goes to stdout, so `assemora make:model Post` can be
  // piped into an editor; the next step is commentary and goes to stderr.
  ok(shown)
  detail(generated.nextStep)

  return 0
}

const generator = (spec: GeneratorSpec): CliCommand =>
  defineCommand({
    name: spec.name,
    group: 'make',
    summary: spec.summary,
    usage: spec.usage,
    handler: ({ args, cwd }) => generate(spec, args, cwd),
  })

const modelFile = (name: string): Generated => {
  const model = pascalCase(singularName(name))
  const table = snakeCase(pluralName(name))

  return {
    file: join('models', `${kebabCase(singularName(name))}.ts`),
    nextStep: `Register it on a module with .models(${model}), then run \`assemora db:generate\`.`,
    contents: `/**
 * The ${model} model.
 *
 * One declaration is the record type, the database column, the runtime validation
 * and every schema built from them — Studio's form, OpenAPI, the SDK and the MCP
 * tool (SPEC.md §9, §17).
 */
${importFrom(['model', 'string', 'timestamp', 'uuid'], '@assemora/data')}

export const ${model} = model('${table}', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})
`,
  }
}

const resourceFile = (name: string): Generated => {
  const model = pascalCase(singularName(name))
  const collection = pascalCase(pluralName(name))
  const modelFileName = kebabCase(singularName(name))

  return {
    file: join('resources', `${kebabCase(pluralName(name))}.ts`),
    nextStep: `Register it on a module with .resources(${collection}).`,
    contents: `/**
 * The ${collection} resource.
 *
 * A resource presents a model rather than inventing data, so every field here names
 * a column of ${model}, and only what is declared is ever returned — a column the
 * resource never mentioned cannot leak into an API response (SPEC.md §35).
 */
${importFrom(['resource', 'text'], '@assemora/resources')}

${importFrom([model], fromSource('models', modelFileName))}

export const ${collection} = resource(
  ${model},
  {
    title: text().required().searchable().sortable().label('Title'),
  },
  { label: '${sentenceCase(pluralName(name))}' },
)
`,
  }
}

const blockFile = (name: string): Generated => {
  const block = pascalCase(name)
  const type = kebabCase(name)

  return {
    file: join('blocks', `${type}.ts`),
    nextStep: `Register it with pages({ blocks: [${block}] }).`,
    contents: `/**
 * The ${block} block.
 *
 * These fields are the Studio form, the runtime validation, the JSON Schema and what
 * an agent is allowed to set — one declaration, never four (SPEC.md §55, §56).
 */
${importFrom(['block'], '@assemora/pages')}
${importFrom(['text'], '@assemora/resources')}

export const ${block} = block(
  '${type}',
  {
    title: text().required().label('Title'),
  },
  { label: '${sentenceCase(name)}' },
)
`,
  }
}

const moduleFile = (name: string): Generated => {
  const factory = camelCase(name)
  const moduleName = kebabCase(name)

  return {
    file: join('modules', `${moduleName}.ts`),
    // `assemora()`, not `createApplication()`: the project this same CLI scaffolds
    // calls the umbrella in `src/app.ts` and contains the word `createApplication`
    // nowhere at all, so the other name sends a reader looking for something that is
    // not there (ADR-0022).
    nextStep: `Register it with assemora({ modules: [${factory}()] }) in src/app.ts.`,
    contents: `/**
 * The ${moduleName} module.
 *
 * A module is the registration unit: models, resources, blocks, routes, commands and
 * queries (SPEC.md §13). \`.models()\` and \`.resources()\` appear on the builder as
 * soon as the packages that own them are imported — each contributes its own method
 * rather than core learning what a model is (ADR-0009).
 */
${importFrom(['module'], '@assemora/core')}

export const ${factory} = () => module('${moduleName}')
`,
  }
}

/**
 * `posts.publish` names a command; the file is named after it.
 *
 * The last segment is the verb and the one before it is what the verb acts on, so
 * `posts.publish` becomes `publish-post.ts` holding `PublishPost` — the file sorts
 * beside the other things done to a post, and the export reads as the act. A name
 * with no dot is taken as the verb alone.
 */
const commandFile = (name: string): Generated => {
  const segments = name
    .split('.')
    .map(camelCase)
    .filter((segment) => segment !== '')

  const verb = segments.at(-1) ?? camelCase(name)
  const subject = segments.length > 1 ? (segments.at(-2) ?? '') : ''
  const subjectWords = subject === '' ? '' : wordsOf(singularName(subject)).join(' ')
  const definition = `${pascalCase(verb)}${subject === '' ? '' : pascalCase(singularName(subject))}`
  const fileName =
    subject === '' ? kebabCase(verb) : `${kebabCase(verb)}-${kebabCase(singularName(subject))}`
  const commandName = segments.join('.')

  return {
    file: join('commands', `${fileName}.ts`),
    nextStep: `Register it on a module with .commands(${definition}).`,
    contents: `/**
 * The ${commandName} command.
 *
 * Every state change takes one path — validation, authorization, transaction,
 * handler, revision, events, audit — and Studio, REST, the SDK, this CLI and an
 * agent all arrive through it. The name is also the permission it requires
 * (SPEC.md §14, ADR-0015).
 */
${importFrom(['command'], '@assemora/core')}
${importFrom(['uuid'], '@assemora/schema')}

export const ${definition} = command('${commandName}', {
  description: '${sentenceCase(verb)}${subjectWords === '' ? '' : ` ${subjectWords}`}',
  input: { id: uuid() },
  output: { id: uuid() },
  handle: async ({ id }, context) => {
    context.logger.info('${commandName}', { id })

    return { id }
  },
})
`,
  }
}

const policyFile = (name: string): Generated => {
  const subject = snakeCase(pluralName(name))
  const definition = `${pascalCase(singularName(name))}Policy`

  return {
    file: join('policies', `${kebabCase(pluralName(name))}.ts`),
    nextStep: `Register it with auth({ policies: [${definition}] }).`,
    contents: `/**
 * Who may do what to ${wordsOf(subject).join(' ')}.
 *
 * The same answer is given to Studio, REST, the SDK, this CLI and an agent, because
 * all of them arrive through the same buses: there is no trusted caller. A rule
 * about a record is asked once the record has been read (SPEC.md §51, ADR-0015).
 */
${importFrom(['policy'], '@assemora/auth')}

export const ${definition} = policy('${subject}', {
  read: ({ can }) => can('${subject}.read'),
  create: ({ can }) => can('${subject}.create'),
  update: ({ can }) => can('${subject}.update'),
  delete: ({ can }) => can('${subject}.delete'),
})
`,
  }
}

/** Registered in the order SPEC.md §77 lists them, which is the order they print in. */
export const makeCommands: readonly CliCommand[] = [
  generator({
    name: 'make:model',
    summary: 'a model and the table it maps to',
    usage: 'assemora make:model <name> [--force]',
    example: 'assemora make:model Post',
    plan: modelFile,
  }),
  generator({
    name: 'make:resource',
    summary: 'a resource: how a model appears as content',
    usage: 'assemora make:resource <name> [--force]',
    example: 'assemora make:resource Post',
    plan: resourceFile,
  }),
  generator({
    name: 'make:block',
    summary: 'a block for the page builder',
    usage: 'assemora make:block <name> [--force]',
    example: 'assemora make:block hero',
    plan: blockFile,
  }),
  generator({
    name: 'make:module',
    summary: 'a module to register declarations in',
    usage: 'assemora make:module <name> [--force]',
    example: 'assemora make:module blog',
    plan: moduleFile,
  }),
  generator({
    name: 'make:command',
    summary: 'a command for the Command Bus',
    usage: 'assemora make:command <group.action> [--force]',
    example: 'assemora make:command posts.publish',
    plan: commandFile,
  }),
  generator({
    name: 'make:policy',
    summary: 'a policy for one subject',
    usage: 'assemora make:policy <subject> [--force]',
    example: 'assemora make:policy posts',
    plan: policyFile,
  }),
]

register(...makeCommands)
