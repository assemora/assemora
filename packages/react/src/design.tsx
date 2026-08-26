/**
 * Drawing the universal design controls (SPEC.md §61).
 *
 * The seven controls are tokens, never CSS, so this turns them into the only two
 * things a stylesheet can key on: data attributes and custom properties. What `lg`
 * or `wide` actually looks like is the theme's answer, given once (SPEC.md §62).
 *
 * The contract an application's stylesheet implements:
 *
 * ```css
 * .assemora-design { padding-top: var(--assemora-space-top, 0); }
 * .assemora-design[data-width='narrow'] > * { max-width: 34rem; }
 * ```
 */
import type { BlockDesign } from '@assemora/schema'
import type { CSSProperties, ReactNode } from 'react'

export const DESIGN_CLASS = 'assemora-design'

const spacing = (token: string | undefined): string | undefined =>
  token === undefined ? undefined : `var(--space-${token})`

/**
 * Only tokens reach the style attribute, and every one of them as
 * `var(--something-<token>)` — a value the theme defined or nothing at all. There is
 * no path from a block's settings to a literal declaration.
 */
const propertiesOf = (
  design: BlockDesign,
  mediaUrl: ((id: string) => string) | undefined,
): CSSProperties => {
  const style: Record<string, string> = {}
  const top = spacing(design.spacingTop)
  const bottom = spacing(design.spacingBottom)

  if (top !== undefined) style['--assemora-space-top'] = top
  if (bottom !== undefined) style['--assemora-space-bottom'] = bottom
  if (design.background !== undefined) {
    style['--assemora-background'] = `var(--${design.background})`
  }

  // A media id, resolved by the application. `url()` is built here rather than taken
  // from anywhere, so a stored value cannot become a declaration of its own.
  if (design.backgroundImage !== undefined && mediaUrl !== undefined) {
    style['--assemora-background-image'] = `url("${encodeURI(mediaUrl(design.backgroundImage))}")`
  }

  return style as CSSProperties
}

export type DesignWrapperProps = {
  readonly design: BlockDesign
  /**
   * Turns a media id into a URL.
   *
   * The renderer cannot know where an application serves its files from, so an
   * application that uses `backgroundImage` says (SPEC.md §63).
   */
  readonly mediaUrl?: (id: string) => string
  readonly children: ReactNode
}

export const DesignWrapper = ({ design, mediaUrl, children }: DesignWrapperProps) => (
  <div
    className={DESIGN_CLASS}
    style={propertiesOf(design, mediaUrl)}
    {...(design.width === undefined ? {} : { 'data-width': design.width })}
    {...(design.align === undefined ? {} : { 'data-align': design.align })}
    {...(design.container === undefined ? {} : { 'data-container': design.container })}
    {...(design.hiddenOn?.includes('mobile') === true ? { 'data-hidden-mobile': '' } : {})}
    {...(design.hiddenOn?.includes('tablet') === true ? { 'data-hidden-tablet': '' } : {})}
    {...(design.hiddenOn?.includes('desktop') === true ? { 'data-hidden-desktop': '' } : {})}
  >
    {children}
  </div>
)
