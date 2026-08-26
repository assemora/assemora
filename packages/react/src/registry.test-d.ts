/**
 * A view goes into a registry without a cast (SPEC.md §57).
 *
 * The registry stores views of different prop shapes under one type, and getting that
 * type wrong is invisible at runtime and unbearable in an application: every entry
 * needs `as never`, which is exactly what the type system was supposed to save.
 */
import { expectTypeOf, test } from 'vitest'

import { type BlockViewProps, createBlockRegistry } from './registry.js'

type HeroProps = { readonly title: string; readonly subtitle?: string }
type FaqProps = { readonly question: string; readonly answer: string }

const Hero = ({ props }: BlockViewProps<HeroProps>) => props.title
const Faq = ({ props }: BlockViewProps<FaqProps>) => `${props.question} ${props.answer}`

test('views of different prop shapes register side by side, uncast', () => {
  const registry = createBlockRegistry({ hero: Hero, faq: Faq })

  expectTypeOf(registry.types).toEqualTypeOf<readonly string[]>()
})

test('something that is not a view at all is refused', () => {
  // @ts-expect-error a string is not a component
  createBlockRegistry({ hero: 'HeroView' })

  // @ts-expect-error a view is handed the whole props object, not the props alone
  createBlockRegistry({ hero: (props: HeroProps) => props.title })
})
