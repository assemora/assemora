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
import type { ReactNode } from 'react'

export type BlockViewProps<P = Readonly<Record<string, unknown>>> = {
  /** The block itself: its id, its type, its version. */
  readonly block: BlockNode
  /** What the editor filled in. Typed by the view, validated by the block schema. */
  readonly props: P
  /** Already-rendered children. Empty unless the block accepts them (SPEC.md §56). */
  readonly children: ReactNode
}

/**
 * A block's view: a function of its props.
 *
 * Deliberately not `ComponentType`, which also covers a class component — and a class
 * carries `defaultProps?: Partial<P>`, putting `P` in a covariant position. Under
 * `exactOptionalPropertyTypes` that alone stops a `BlockView<HeroProps>` from being
 * assignable to `BlockView<never>`, so every registry entry in every application
 * would need a cast. Nobody writes a block as a class, and this is what that costs.
 */
export type BlockView<P = Readonly<Record<string, unknown>>> = (
  props: BlockViewProps<P>,
) => ReactNode

/** Views of any prop shape, side by side, which is what a registry holds. */
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
  /**
   * What an unknown type is drawn as, if anything. The option, kept.
   *
   * Exposed because "can this registry draw anything at all?" is a real question with
   * a wrong obvious answer: an empty `types` still draws every block when a fallback
   * was given. The renderer has to ask it to tell a page with nothing on it apart from
   * a build with no views in it, and those two need different words (SPEC.md §59).
   */
  readonly fallback: BlockView | undefined
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
    fallback: options.fallback,
  }
}
