/**
 * The block registry (SPEC.md §57).
 *
 * A block declaration says what a block *is* — its fields, its validation, its form,
 * its JSON Schema. It deliberately says nothing about what it looks like: that is the
 * application's, and it is a React component. This is where the two meet.
 *
 * ```ts
 * const registry = createBlockRegistry({
 *   hero: HeroView,
 *   features: FeaturesView,
 *   faq: FaqView,
 * })
 * ```
 */
import type { BlockNode } from '@assemora/schema'
import type { ComponentType, ReactNode } from 'react'

export type BlockViewProps<P = Readonly<Record<string, unknown>>> = {
  /** The block itself: its id, its type, its version. */
  readonly block: BlockNode
  /** What the editor filled in. Typed by the view, validated by the block schema. */
  readonly props: P
  /** Already-rendered children. Empty unless the block accepts them (SPEC.md §56). */
  readonly children: ReactNode
}

export type BlockView<P = Readonly<Record<string, unknown>>> = ComponentType<BlockViewProps<P>>

export type BlockViews = Readonly<Record<string, BlockView<never>>>

export type BlockRegistryOptions = {
  /**
   * Drawn in place of a block whose type this registry does not know.
   *
   * A page outlives the code that renders it: a block removed from an application is
   * still in every tree that used it. Nothing by default, because a visitor should
   * not be shown a gap in a page — a builder passes something visible instead.
   */
  readonly fallback?: BlockView
}

export type BlockRegistry = {
  readonly node: 'block-registry'
  /** The view for a type, or the fallback, or nothing at all. */
  viewFor(type: string): BlockView | undefined
  has(type: string): boolean
  readonly types: readonly string[]
}

export const createBlockRegistry = (
  views: BlockViews,
  options: BlockRegistryOptions = {},
): BlockRegistry => {
  const known = new Map(Object.entries(views) as [string, BlockView][])

  return {
    node: 'block-registry',
    viewFor: (type) => known.get(type) ?? options.fallback,
    has: (type) => known.has(type),
    types: [...known.keys()],
  }
}
