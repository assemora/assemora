/**
 * What a `hero` looks like (SPEC.md §57).
 *
 * `src/blocks/hero.ts` says what a hero *is*. This says what it looks like, and it
 * belongs to the site: change it and every page that uses the block changes with it,
 * without a single stored page being touched.
 *
 * It carries no `'use client'`. A component without one is *shared*: React renders it
 * on the server for `app/[slug]/page.tsx`, and bundles it for the browser when the
 * builder canvas imports it. Keeping block views free of hooks and browser APIs is
 * what lets a page cost a visitor no JavaScript at all.
 *
 * The props are typed here rather than inferred from the declaration, because a block
 * that has just been dragged in has none of them yet — an editor sees a half-filled
 * hero, and so must this component.
 */
import type { BlockViewProps } from '@assemora/react'

export type HeroProps = {
  readonly title?: string
  readonly subtitle?: string
}

export const HeroView = ({ props }: BlockViewProps<HeroProps>) => (
  <header className="hero">
    <h1>{props.title}</h1>
    {props.subtitle !== undefined && <p>{props.subtitle}</p>}
  </header>
)
