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
  /**
   * What the palette draws this block as.
   *
   * ```ts
   * block('hero', { … }, { icon: 'panel-top', group: 'Layout' })
   * ```
   *
   * A name from the set the client ships, kebab-case, and never a picture — an icon set
   * belongs to whatever is drawing (SPEC.md §58). Unsaid, and for a name Studio has
   * never heard of, a block is drawn as the square every one of them was drawn as.
   */
  readonly icon?: string
  /**
   * The heading the palette files it under — `'Layout'`, `'Content'`.
   *
   * A dozen block types in one flat list is a list somebody reads to the end once. The
   * grouping is the application's own division of its blocks, said where the block is
   * declared, and it reaches Studio the way everything else does — through the registry.
   * Unsaid, a block keeps the general heading, so an application that groups nothing
   * looks exactly as it did.
   */
  readonly group?: string
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
  readonly icon: string | undefined
  readonly group: string | undefined
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
  /** What the palette draws it as: a name from the set that client ships (SPEC.md §58). */
  readonly icon?: string
  /** The heading the palette files it under, where the application named one. */
  readonly group?: string
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
  icon: options.icon,
  group: options.group,
  fields,
  acceptsChildren: options.acceptsChildren ?? false,
  allowedChildren: options.allowedChildren ?? [],
  maxChildren: options.maxChildren,
})

export const describeBlock = (definition: Block, module?: string): BlockDescriptor => ({
  name: definition.type,
  label: definition.label,
  ...(definition.description === undefined ? {} : { description: definition.description }),
  ...(definition.icon === undefined ? {} : { icon: definition.icon }),
  ...(definition.group === undefined ? {} : { group: definition.group }),
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

  // `hasOwn` rather than `in`, on both sides. A field name and a prop name are both
  // keys of a plain object, `constructor`, `toString`, `valueOf` and `hasOwnProperty`
  // are legal names for either, and `Object.prototype` answers all of them: `in` said
  // every block has a field called `toString`, so a prop by that name passed this check
  // and was then silently dropped, and it said every caller had sent a `constructor`,
  // so a field of that name was never reported missing — it was parsed from a function
  // instead. `validation.ts` in `@assemora/resources` reads an entry the same way.
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(definition.fields, key)) {
      issues.push({
        path: [key],
        code: 'unknown_field',
        message: `"${key}" is not a field of the ${definition.type} block`,
      })
    }
  }

  for (const [name, field] of Object.entries(definition.fields)) {
    if (!Object.hasOwn(source, name)) {
      if (field.isRequired && mode === 'complete') {
        issues.push({ path: [name], code: 'required', message: 'This field is required' })
      }
      continue
    }

    const value = source[name]

    // Clearing a field is a normal edit: Studio's empty input, an agent's explicit
    // `null`. `validateAgainstFields` in `@assemora/resources` accepts it wherever the
    // value can be held, and a block's props are the same kind of thing — the tree is
    // JSON, which holds a `null` under any key, so there is no column here that could
    // refuse. Without this, emptying a block's image, number, date or link answered
    // "Expected a string" for an edit the same field in an entry form performs.
    //
    // A required field still refuses, exactly as it does there: `complete` is what
    // publishing checks, and clearing a required prop is what it exists to catch.
    if (value === null && !field.isRequired) {
      checked[name] = null
      continue
    }

    const result = field.schema.parse(value)

    if (result.ok) checked[name] = result.value
    else issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...issue.path] })))
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: checked }
}
