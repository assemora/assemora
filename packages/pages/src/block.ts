/**
 * The block DSL (SPEC.md §55, §56).
 *
 * One declaration produces the Studio form, the runtime validation, the JSON Schema,
 * the description an agent reads and the input schema MCP accepts — the same
 * declaration, never five (SPEC.md §3.4).
 */
import { AssemoraError } from '@assemora/core'
import {
  type AnyField,
  describeField,
  humanize,
  type ResourceFieldDescriptor,
} from '@assemora/resources'
import type { Issue } from '@assemora/schema'

export type BlockOptions = {
  readonly label?: string
  readonly description?: string
  /** Whether this block may contain others (SPEC.md §56). */
  readonly acceptsChildren?: boolean
  /** Which block types it may contain. Empty means any, once children are accepted. */
  readonly allowedChildren?: readonly string[]
  readonly maxChildren?: number
}

export type Block = {
  readonly node: 'block'
  readonly type: string
  readonly label: string
  readonly description: string | undefined
  readonly fields: Readonly<Record<string, AnyField>>
  readonly acceptsChildren: boolean
  readonly allowedChildren: readonly string[]
  readonly maxChildren: number | undefined
}

/** How a block describes itself in the Schema Registry (SPEC.md §42, §71). */
export type BlockDescriptor = {
  readonly name: string
  readonly label: string
  readonly description?: string
  readonly fields: readonly ResourceFieldDescriptor[]
  readonly acceptsChildren: boolean
  readonly allowedChildren: readonly string[]
  readonly maxChildren?: number
  readonly module?: string
}

declare module '@assemora/core' {
  interface RegistrySections {
    blocks: BlockDescriptor
  }
}

/**
 * ```ts
 * export const Hero = block('hero', {
 *   title: text().required(),
 *   subtitle: text(),
 *   variant: select('centered', 'split'),
 * })
 * ```
 */
export const block = (
  type: string,
  fields: Readonly<Record<string, AnyField>>,
  options: BlockOptions = {},
): Block => ({
  node: 'block',
  type,
  label: options.label ?? humanize(type),
  description: options.description,
  fields,
  acceptsChildren: options.acceptsChildren ?? false,
  allowedChildren: options.allowedChildren ?? [],
  maxChildren: options.maxChildren,
})

export const describeBlock = (definition: Block, module?: string): BlockDescriptor => ({
  name: definition.type,
  label: definition.label,
  ...(definition.description === undefined ? {} : { description: definition.description }),
  fields: Object.entries(definition.fields).map(([name, field]) => describeField(name, field)),
  acceptsChildren: definition.acceptsChildren,
  allowedChildren: definition.allowedChildren,
  ...(definition.maxChildren === undefined ? {} : { maxChildren: definition.maxChildren }),
  ...(module === undefined ? {} : { module }),
})

const registry = new Map<string, Block>()

export const registerBlock = (definition: Block): void => {
  if (registry.has(definition.type)) {
    throw new AssemoraError(
      'CONFIGURATION_ERROR',
      `A block of type "${definition.type}" is already registered`,
      { status: 500 },
    )
  }

  registry.set(definition.type, definition)
}

export const blockFor = (type: string): Block => {
  const found = registry.get(type)

  if (found === undefined) {
    throw new AssemoraError('UNKNOWN_BLOCK', `There is no block of type "${type}"`, { status: 422 })
  }

  return found
}

export const hasBlock = (type: string): boolean => registry.has(type)

export const registeredBlocks = (): readonly Block[] => [...registry.values()]

export const clearBlockRegistry = (): void => {
  registry.clear()
}

/**
 * How strictly a block's props are judged.
 *
 * `editing` is what a builder does: a block dropped on a page has not been filled in
 * yet, and refusing to create it would mean an editor could never add a block that
 * has a required field. `complete` is what publishing does — an unfinished block may
 * sit in a draft, and may not go live (SPEC.md §55, §60).
 */
export type PropsMode = 'editing' | 'complete'

/** Checks props against the block's fields, the way a resource checks an entry. */
export const validateProps = (
  definition: Block,
  props: unknown,
  mode: PropsMode = 'complete',
):
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly issues: Issue[] } => {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return { ok: false, issues: [{ path: [], code: 'type', message: 'Expected an object' }] }
  }

  const source = props as Record<string, unknown>
  const issues: Issue[] = []
  const checked: Record<string, unknown> = {}

  for (const key of Object.keys(source)) {
    if (!(key in definition.fields)) {
      issues.push({
        path: [key],
        code: 'unknown_field',
        message: `"${key}" is not a field of the ${definition.type} block`,
      })
    }
  }

  for (const [name, field] of Object.entries(definition.fields)) {
    if (!(name in source)) {
      if (field.isRequired && mode === 'complete') {
        issues.push({ path: [name], code: 'required', message: 'This field is required' })
      }
      continue
    }

    const result = field.schema.parse(source[name])

    if (result.ok) checked[name] = result.value
    else issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...issue.path] })))
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: checked }
}
