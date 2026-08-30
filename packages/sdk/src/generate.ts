/**
 * The SDK generator (SPEC.md §48, §121).
 *
 * It reads the Schema Registry snapshot — plain data, which is why this package
 * depends on nothing but `@assemora/schema` — and emits TypeScript. A resource or a
 * route that exists is therefore a resource or a route the SDK can call, without
 * anyone writing a client by hand (SPEC.md §3.7).
 *
 * "A resource that exists" means one this application *serves*, and the snapshot says
 * which: the `routes` section is written when a route is mounted, and a server refuses
 * to start when the two disagree (SPEC.md §98). The `resources` section is a different
 * question — what content this application has — and answering the first with the
 * second is how the client came to publish addresses that answer 404: a resource whose
 * four `api` flags are off, one a version publishes and the bare paths do not, and a
 * collection that was registered after the routes were mounted (SPEC.md §37, §43).
 */
import type { JsonSchema } from '@assemora/schema'

export type RegistrySnapshot = Readonly<
  Record<string, readonly Readonly<Record<string, unknown>>[]>
>

export type GenerateOptions = {
  /** Where the runtime client is imported from in the emitted file. */
  readonly clientModule?: string
}

/**
 * What TypeScript accepts as a bare name, whether a property key or a type.
 *
 * Deliberately not a global regex. `test` on a `/g` pattern is stateful: a match
 * leaves `lastIndex` past it and the next call resumes from there, so one shared
 * pattern answered correctly only every other time and the *second* name that needed
 * quoting was emitted bare. It also has to be anchored rather than a search for a
 * character that is not allowed — `2fa` is made only of identifier characters and is
 * still not an identifier.
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const pascal = (value: string): string =>
  value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

const camel = (value: string): string => {
  const cased = pascal(value)

  return cased.charAt(0).toLowerCase() + cased.slice(1)
}

/**
 * A TypeScript string literal, quoted the way the rest of the emitted file is.
 *
 * `JSON.stringify` escapes correctly but quotes with `"`, while the generated import
 * quotes with `'`. A file that changes its mind halfway through is a file every
 * formatter rewrites the moment it lands in somebody's repository.
 */
const stringLiteral = (value: string): string => {
  let escaped = ''

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0

    // A control character has no printable form, and an unescaped newline inside a
    // quoted literal ends the literal rather than appearing in it.
    if (character === '\\' || character === "'") escaped += `\\${character}`
    else if (code < 0x20) escaped += `\\u${code.toString(16).padStart(4, '0')}`
    else escaped += character
  }

  return `'${escaped}'`
}

const quoteKey = (key: string): string => (IDENTIFIER.test(key) ? key : stringLiteral(key))

/**
 * A resource name as the name of its record type.
 *
 * `pascal` cases the words it is handed and nothing more, so a resource named
 * `2fa-tokens` arrives as `2faTokens` and one named `--` arrives as nothing at all.
 * Neither is a name TypeScript will accept, and both emit a file that does not parse
 * from a build that reported success.
 */
const typeName = (value: string): string => {
  const cased = pascal(value)

  return IDENTIFIER.test(cased) ? cased : `_${cased}`
}

/**
 * Whether an element type has to be bracketed before `[]` is put after it.
 *
 * `readonly 'a' | 'b'[]` parses as `'a' | ('b'[])`, and `readonly readonly T[][]` is
 * refused outright — so an array of a union or of an array is invalid TypeScript
 * unless it is grouped. An identifier or an object literal needs nothing, and
 * bracketing it anyway would put noise in every generated line.
 */
const grouped = (type: string): string => {
  if (type.startsWith('readonly ')) return `(${type})`

  let depth = 0

  for (const character of type) {
    if (character === '{' || character === '(' || character === '[') depth += 1
    else if (character === '}' || character === ')' || character === ']') depth -= 1
    else if (depth === 0 && (character === '|' || character === '&')) return `(${type})`
  }

  return type
}

/** JSON Schema as TypeScript. What travels over the wire, not what the server holds. */
export const toTypeScript = (schema: JsonSchema | undefined, indent = ''): string => {
  if (schema === undefined) return 'unknown'

  const enumValues = schema.enum as readonly string[] | undefined

  if (enumValues !== undefined) return enumValues.map(stringLiteral).join(' | ')

  switch (schema.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return `readonly ${grouped(toTypeScript(schema.items as JsonSchema | undefined, indent))}[]`
    case 'object': {
      const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {}
      const required = new Set((schema.required as readonly string[] | undefined) ?? [])
      const inner = `${indent}  `

      const lines = Object.entries(properties).map(
        ([name, property]) =>
          `${inner}readonly ${quoteKey(name)}${required.has(name) ? '' : '?'}: ${toTypeScript(property, inner)}`,
      )

      return lines.length === 0
        ? 'Readonly<Record<string, unknown>>'
        : `{\n${lines.join('\n')}\n${indent}}`
    }
    default:
      return 'unknown'
  }
}

type ResourceEntry = {
  readonly name: string
  readonly fields?: readonly {
    name: string
    required?: boolean
    hidden?: boolean
    schema?: JsonSchema
  }[]
}

type RouteEntry = {
  readonly name: string
  readonly method: string
  readonly path: string
  readonly description?: string
  readonly params?: JsonSchema
  readonly query?: JsonSchema
  readonly body?: JsonSchema
  readonly response?: JsonSchema
}

const isResource = (entry: Readonly<Record<string, unknown>>): entry is ResourceEntry =>
  Array.isArray(entry.fields) && typeof entry.name === 'string'

const isRoute = (entry: Readonly<Record<string, unknown>>): entry is RouteEntry =>
  typeof entry.method === 'string' && typeof entry.path === 'string'

type CrudOperation = 'list' | 'get' | 'create' | 'update' | 'delete'

/** In the order `ResourceClient` declares them, so a `Pick` reads like the type does. */
const CRUD_OPERATIONS: readonly CrudOperation[] = ['list', 'get', 'create', 'update', 'delete']

const segmentsOf = (path: string): readonly string[] =>
  path.split('/').filter((part) => part !== '')

/**
 * Which of a resource's five endpoints a described route is, if it is one (SPEC.md §43).
 *
 * `ResourceClient` calls `<base>/<name>` and `<base>/<name>/:id`, so those are the two
 * shapes to recognise — under an optional leading segment, because a version is exactly
 * one path segment (SPEC.md §47) and is a *base URL* to a caller: `/v1/articles` is the
 * same accessor reached by pointing the client at `/api/v1`. A resource published only
 * under a version therefore keeps its accessor, and one published nowhere does not.
 */
const operationOf = (entry: RouteEntry, name: string): CrudOperation | undefined => {
  const segments = segmentsOf(entry.path)
  const byId = segments[segments.length - 1] === ':id'
  const head = byId ? segments.slice(0, -1) : segments

  // Nothing deeper than `<version>/<name>`: `/articles/:id/revisions` is a route of
  // somebody's own, not one of the five this client calls.
  if (head.length === 0 || head.length > 2) return undefined
  if (head[head.length - 1] !== name) return undefined

  switch (entry.method.toLowerCase()) {
    case 'get':
      return byId ? 'get' : 'list'
    case 'post':
      return byId ? undefined : 'create'
    case 'patch':
      return byId ? 'update' : undefined
    case 'delete':
      return byId ? 'delete' : undefined
    default:
      return undefined
  }
}

/**
 * How this resource is reached, or nothing at all when it is not.
 *
 * `ResourceClient` when the application serves all five, which is what a resource that
 * said nothing about `api` publishes; a `Pick` of what it does serve otherwise. Naming
 * the five and serving four is the same lie in a smaller size — `api.notes.delete(id)`
 * compiles and answers 404 — and the emitted type is the only place a caller finds out.
 */
const accessorFor = (
  resource: ResourceEntry,
  routes: readonly RouteEntry[],
): string | undefined => {
  const found = new Set<CrudOperation>()

  for (const entry of routes) {
    const operation = operationOf(entry, resource.name)

    if (operation !== undefined) found.add(operation)
  }

  if (found.size === 0) return undefined

  const record = typeName(resource.name)
  const reachable = CRUD_OPERATIONS.filter((operation) => found.has(operation))

  return reachable.length === CRUD_OPERATIONS.length
    ? `ResourceClient<${record}>`
    : `Pick<ResourceClient<${record}>, ${reachable.map(stringLiteral).join(' | ')}>`
}

/**
 * What stands in the emitted file for a resource with no REST address of its own.
 *
 * The record type stays — the entries are real, and a caller reaching them another way
 * still wants their shape — and the accessor does not, because every call it offered
 * would be a 404. Saying so beside the type is the difference between a client that
 * left something out and one that is missing it.
 */
const UNSERVED = [
  '/**',
  ' * This application serves no REST endpoint for this resource, so the client has no',
  ' * accessor for it: every call would have answered 404. Its entries are reachable',
  ' * through the entries.* commands and queries.',
  ' */',
].join('\n')

const recordType = (resource: ResourceEntry): string => {
  const visible = (resource.fields ?? []).filter((field) => field.hidden !== true)

  const lines = [
    '  readonly id: string',
    ...visible.map(
      (field) =>
        `  readonly ${quoteKey(field.name)}${field.required === true ? '' : '?'}: ${toTypeScript(field.schema, '  ')}`,
    ),
  ]

  return `export type ${typeName(resource.name)} = {\n${lines.join('\n')}\n}`
}

const endpointMethod = (entry: RouteEntry): string => {
  const name = camel(`${entry.method} ${entry.path.replace(/:/g, 'by ')}`)
  const input: string[] = []

  if (entry.params !== undefined)
    input.push(`readonly params: ${toTypeScript(entry.params, '    ')}`)
  if (entry.query !== undefined) input.push(`readonly query?: ${toTypeScript(entry.query, '    ')}`)
  if (entry.body !== undefined) input.push(`readonly body: ${toTypeScript(entry.body, '    ')}`)

  const argument = input.length === 0 ? '' : `input: {\n    ${input.join('\n    ')}\n  }`

  return [
    entry.description === undefined ? undefined : `  /** ${entry.description} */`,
    `  ${name}(${argument}): Promise<${toTypeScript(entry.response, '  ')}>`,
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

/** Emits the whole client: record types, resource accessors and route methods. */
export const generateSdk = (snapshot: RegistrySnapshot, options: GenerateOptions = {}): string => {
  const clientModule = options.clientModule ?? '@assemora/sdk'
  const resources = (snapshot.resources ?? []).filter(isResource)
  const routes = (snapshot.routes ?? []).filter(isRoute)
  /**
   * The languages this deployment serves, typed (SPEC.md §131).
   *
   * A union rather than `string`, because the set is known at generation time and a
   * caller asking for a language nobody serves should be told by the compiler rather
   * than by a 404 — which is the whole reason the SDK is generated at all.
   */
  const locales = (snapshot.locales ?? [])
    .map((entry) => (entry as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string')

  const accessors = new Map(
    resources.map((resource) => [resource.name, accessorFor(resource, routes)] as const),
  )

  // `ResourceClient` only when something names it. A project compiling the generated
  // file with `noUnusedLocals` would otherwise be handed an error by its own SDK, and
  // an application whose every resource is served somewhere else is a real application.
  const imported = [
    'type Client',
    'type ClientOptions',
    'createClient',
    ...([...accessors.values()].some((accessor) => accessor !== undefined)
      ? ['type ResourceClient']
      : []),
  ]

  const header = [
    '// Generated by Assemora. Do not edit: run `assemora sdk:generate` instead.',
    '',
    `import { ${imported.join(', ')} } from '${clientModule}'`,
    '',
  ]

  const records = resources.map((resource) =>
    accessors.get(resource.name) === undefined
      ? `${UNSERVED}\n${recordType(resource)}`
      : recordType(resource),
  )

  const resourceMembers = resources.flatMap((resource) => {
    const accessor = accessors.get(resource.name)

    return accessor === undefined ? [] : [`  readonly ${quoteKey(resource.name)}: ${accessor}`]
  })

  const endpoints =
    routes.length === 0 ? [] : ['export type Endpoints = {', ...routes.map(endpointMethod), '}', '']

  const multilingual = locales.length > 1

  const localeType = multilingual
    ? [
        '/** Every language this deployment serves. */',
        `export type Locale = ${locales.map((code) => `'${code}'`).join(' | ')}`,
        '',
      ]
    : []

  const api = [
    'export type AssemoraApi = Client & {',
    ...resourceMembers,
    ...(routes.length === 0 ? [] : ['  readonly endpoints: Endpoints']),
    // Narrower than `Client.inLocale`, which takes any string: here the languages are
    // known, so asking for one nobody serves is a compile error.
    ...(multilingual ? ['  inLocale(locale: Locale): AssemoraApi'] : []),
    '}',
    '',
    multilingual
      ? 'export const createTypedClient = (options: ClientOptions & { locale?: Locale }): AssemoraApi =>'
      : 'export const createTypedClient = (options: ClientOptions): AssemoraApi =>',
    '  createClient(options) as AssemoraApi',
    '',
  ]

  return [
    ...header,
    ...localeType,
    ...records,
    records.length === 0 ? '' : '',
    ...endpoints,
    ...api,
  ].join('\n')
}
