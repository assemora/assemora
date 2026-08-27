/**
 * Universal design controls (SPEC.md §61).
 *
 * Every block gets the same seven settings — spacing, width, alignment, background,
 * visibility, responsive visibility and container width — and gets them without its
 * author declaring anything. What a block does with its *own* fields stays the block
 * author's business (SPEC.md §61: "Visual specifics stay in developer-defined
 * blocks").
 *
 * Every value is a token, never CSS. That is the point: a person picks `lg`, an agent
 * writes `lg`, and what `lg` means is decided once by the theme (SPEC.md §62). Nothing
 * here can express a colour, a pixel or a rule, so nothing here can be used to smuggle
 * a stylesheet into a page.
 *
 * The settings live beside `props` on the node rather than inside it, because `props`
 * belongs to the block's own schema and a framework key in there would collide with a
 * field somebody declared.
 */
import { array, enumOf, type ObjectSchema, object, string } from './composites-bridge.js'
import { type OptionalSchema, ok, type ParseResult, type Schema } from './types.js'

export const SPACING_SCALE = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const
export const BLOCK_WIDTHS = ['narrow', 'normal', 'wide', 'full'] as const
export const BLOCK_ALIGNMENTS = ['start', 'center', 'end'] as const
export const CONTAINER_WIDTHS = ['narrow', 'normal', 'wide', 'full'] as const
export const VIEWPORTS = ['mobile', 'tablet', 'desktop'] as const

/**
 * The corner radii a theme has to define (SPEC.md §62).
 *
 * No control of §61 names one yet, so this scale exists here rather than in
 * `@assemora/theme` for the reason the others do: the scale a theme defines and the
 * scale a block would one day choose from must be one list, or they drift the moment
 * somebody adds a control. `none` and `full` are the two ends that carry meaning on
 * their own — a square corner and a pill — and three steps between them are enough
 * for a token system that is not a CSS editor.
 */
export const RADIUS_SCALE = ['none', 'sm', 'md', 'lg', 'full'] as const

export type SpacingScale = (typeof SPACING_SCALE)[number]
export type RadiusScale = (typeof RADIUS_SCALE)[number]
export type BlockWidth = (typeof BLOCK_WIDTHS)[number]
export type BlockAlignment = (typeof BLOCK_ALIGNMENTS)[number]
export type ContainerWidth = (typeof CONTAINER_WIDTHS)[number]
export type Viewport = (typeof VIEWPORTS)[number]

export type BlockDesign = {
  readonly spacingTop?: SpacingScale
  readonly spacingBottom?: SpacingScale
  readonly width?: BlockWidth
  readonly align?: BlockAlignment
  /** A theme colour token, by name. Never a colour (SPEC.md §62). */
  readonly background?: string
  /** A media id, for a background image. */
  readonly backgroundImage?: string
  readonly container?: ContainerWidth
  /** Where this block is *not* drawn. Responsive visibility (SPEC.md §61). */
  readonly hiddenOn?: readonly Viewport[]
}

/**
 * A background token names a theme entry, so it is spelled like one: letters, digits
 * and dashes. `#ff0000` and `red; position: fixed` are both refused.
 */
const TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const designShape = {
  spacingTop: enumOf(...SPACING_SCALE).optional(),
  spacingBottom: enumOf(...SPACING_SCALE).optional(),
  width: enumOf(...BLOCK_WIDTHS).optional(),
  align: enumOf(...BLOCK_ALIGNMENTS).optional(),
  background: string().pattern(TOKEN, 'Expected a theme token').optional(),
  backgroundImage: string().optional(),
  container: enumOf(...CONTAINER_WIDTHS).optional(),
  hiddenOn: array(enumOf(...VIEWPORTS)).optional(),
}

/** The parser behind {@link BlockDesign}. `*.test-d.ts` proves the two agree. */
export const blockDesign = (): ObjectSchema<typeof designShape> => object(designShape)

/**
 * A control may be absent, or explicitly `null`.
 *
 * They are different answers: absent means "leave this control alone", and `null`
 * means "clear it and let the theme decide again". A properties panel needs both, and
 * only one of them can be expressed by omission.
 */
const clearable = <T>(inner: Schema<T>): OptionalSchema<T | null> => ({
  kind: inner.kind,
  isOptional: true,
  isNullable: true,
  description: inner.description,
  parse: (value) =>
    value === undefined || value === null
      ? ok(value as T | null | undefined)
      : (inner.parse(value) as ParseResult<T | null | undefined>),
  toJsonSchema: () => ({ ...inner.toJsonSchema(), nullable: true }),
})

const patchShape = {
  spacingTop: clearable(enumOf(...SPACING_SCALE)),
  spacingBottom: clearable(enumOf(...SPACING_SCALE)),
  width: clearable(enumOf(...BLOCK_WIDTHS)),
  align: clearable(enumOf(...BLOCK_ALIGNMENTS)),
  background: clearable(string().pattern(TOKEN, 'Expected a theme token')),
  backgroundImage: clearable(string()),
  container: clearable(enumOf(...CONTAINER_WIDTHS)),
  hiddenOn: clearable(array(enumOf(...VIEWPORTS))),
}

/**
 * What `blocks.design` accepts: the controls that changed, and nothing else.
 *
 * Every key is optional, and every one of them accepts `null` — see {@link clearable}.
 */
export type BlockDesignPatch = {
  readonly [K in keyof BlockDesign]?: BlockDesign[K] | null
}

export const blockDesignPatch = (): ObjectSchema<typeof patchShape> => object(patchShape)

/** Nothing set. What a block that has never been touched by the controls carries. */
export const isPlainDesign = (design: BlockDesign | undefined): boolean =>
  design === undefined || Object.values(design).every((value) => value === undefined)

/** True when this block should not be drawn on that viewport (SPEC.md §61). */
export const hiddenOnViewport = (design: BlockDesign | undefined, viewport: Viewport): boolean =>
  design?.hiddenOn?.includes(viewport) ?? false
