/**
 * The SDK generator (SPEC.md §48, §121).
 *
 * It reads the Schema Registry snapshot — plain data, which is why this package
 * depends on nothing but `@assemora/schema` — and emits TypeScript. A resource or a
 * route that exists is therefore a resource or a route the SDK can call, without
 * anyone writing a client by hand (SPEC.md §3.7).
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

  const header = [
    '// Generated by Assemora. Do not edit: run `assemora sdk:generate` instead.',
    '',
    `import { type Client, type ClientOptions, createClient, type ResourceClient } from '${clientModule}'`,
    '',
  ]

  const records = resources.map(recordType)

  const resourceMembers = resources.map(
    (resource) =>
      `  readonly ${quoteKey(resource.name)}: ResourceClient<${typeName(resource.name)}>`,
  )

  const endpoints =
    routes.length === 0 ? [] : ['export type Endpoints = {', ...routes.map(endpointMethod), '}', '']

  const api = [
    'export type AssemoraApi = Client & {',
    ...resourceMembers,
    ...(routes.length === 0 ? [] : ['  readonly endpoints: Endpoints']),
    '}',
    '',
    'export const createTypedClient = (options: ClientOptions): AssemoraApi =>',
    '  createClient(options) as AssemoraApi',
    '',
  ]

  return [...header, ...records, records.length === 0 ? '' : '', ...endpoints, ...api].join('\n')
}
