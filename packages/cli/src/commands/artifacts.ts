/**
 * `assemora api:openapi` and `assemora sdk:generate` (SPEC.md §44, §48, §77).
 *
 * Both have the same shape: boot the project's application, hand its Schema Registry
 * to a generator, and put the answer somewhere. Neither writes a line of the artifact
 * itself — everything emitted is generated from what the application declared, which
 * is what keeps a document current by construction rather than by discipline
 * (SPEC.md §3.7). An application declaring nothing is not a special case; it produces
 * a document and a client that describe nothing, which is the truth about it.
 *
 * The two generators are imported inside their handlers. `@assemora/openapi` also
 * ships the routes that publish the document, so importing it reaches `@assemora/http`
 * and the server library under that — a cost `assemora --help` should not pay.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'

import type { OpenApiInfo } from '@assemora/openapi'

import { bool, flag, type ParsedArgs } from '../args.js'
import { type LoadedConfig, loadConfig } from '../config.js'
import { line, ok } from '../output.js'
import { loadApplication } from '../project.js'
import { defineCommand, register } from '../registry.js'

/** The path as the reader would retype it: from where they are, unless that is worse. */
const shortest = (path: string, cwd: string): string => {
  const near = relative(cwd, path)

  return near === '' || near.startsWith('..') || isAbsolute(near) ? path : near
}

/**
 * Where a generated artifact goes.
 *
 * `--out` beats the config, the config beats the default, and `--stdout` beats all
 * three by naming no file at all. Nothing else is written when it is piped: the
 * "wrote it here" line answers "where did this go", and when the answer is "into your
 * pipe" there is nothing left to say.
 */
const emit = async (input: {
  readonly args: ParsedArgs
  readonly cwd: string
  readonly loaded: LoadedConfig
  readonly declared: string | undefined
  readonly fallback: string
  readonly contents: string
}): Promise<number> => {
  // Exactly one newline at the end, whatever the generator left: `generateSdk` ends
  // with its own and `JSON.stringify` ends with none.
  const body = input.contents.replace(/\n+$/, '')

  if (bool(input.args, 'stdout')) {
    line(body)
    return 0
  }

  const path = input.loaded.resolve(flag(input.args, 'out') ?? input.declared ?? input.fallback)

  // A project that declares `src/generated/sdk.ts` should not have to create the
  // directory before the command that fills it will run.
  await mkdir(dirname(path), { recursive: true })

  const bytes = `${body}\n`
  await writeFile(path, bytes, 'utf8')

  ok(`Wrote ${shortest(path, input.cwd)} (${Buffer.byteLength(bytes)} bytes)`)

  return 0
}

const DEFAULT_OPENAPI_OUT = 'openapi.json'

const UNNAMED_PROJECT: OpenApiInfo = { title: 'Assemora application', version: '0.0.0' }

const stringAt = (value: unknown, key: string): string | undefined => {
  const found =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined

  return typeof found === 'string' && found !== '' ? found : undefined
}

/**
 * What the document says it describes.
 *
 * The config decides; where it says nothing the project's own `package.json` does. A
 * document titled after the project is right far more often than one titled after the
 * framework, and nobody should have to write down what the package manifest already
 * knows.
 */
const infoFor = async (loaded: LoadedConfig): Promise<OpenApiInfo> => {
  const declared = loaded.config.openapi?.info

  if (declared !== undefined) return declared

  const manifest: unknown = await readFile(loaded.resolve('package.json'), 'utf8')
    .then((contents): unknown => JSON.parse(contents))
    .catch(() => undefined)

  return {
    title: stringAt(manifest, 'name') ?? UNNAMED_PROJECT.title,
    version: stringAt(manifest, 'version') ?? UNNAMED_PROJECT.version,
  }
}

export const OpenApi = defineCommand({
  name: 'api:openapi',
  group: 'artifacts',
  summary: 'write the OpenAPI 3.1 document this application describes itself with',
  usage: 'assemora api:openapi [--out <file>] [--stdout]',
  handler: async ({ args, cwd }) => {
    const loaded = await loadConfig(cwd)
    const app = await loadApplication(loaded)

    const { buildOpenApiDocument } = await import('@assemora/openapi')

    return emit({
      args,
      cwd,
      loaded,
      declared: loaded.config.openapi?.out,
      fallback: DEFAULT_OPENAPI_OUT,
      contents: JSON.stringify(buildOpenApiDocument(app.registry, await infoFor(loaded)), null, 2),
    })
  },
})

export const Sdk = defineCommand({
  name: 'sdk:generate',
  group: 'artifacts',
  summary: 'write the typed client for this application',
  usage: 'assemora sdk:generate [--out <file>] [--stdout]',
  handler: async ({ args, cwd }) => {
    const loaded = await loadConfig(cwd)
    const app = await loadApplication(loaded)

    const { generateSdk } = await import('@assemora/sdk')

    const declared = loaded.config.sdk

    return emit({
      args,
      cwd,
      loaded,
      declared: declared?.out,
      // Beside the project's own source rather than at its root: the client is
      // imported by the application's code, and `paths.source` is where that lives.
      fallback: join(loaded.paths.source, 'generated', 'sdk.ts'),
      contents: generateSdk(app.registry.describe(), {
        ...(declared?.clientModule === undefined ? {} : { clientModule: declared.clientModule }),
      }),
    })
  },
})

/** In the order SPEC.md §77 lists them, which is the order the help prints them in. */
export const artifactCommands = [OpenApi, Sdk] as const

register(...artifactCommands)
