import { expectTypeOf, it } from 'vitest'

import type { BlockDesign, blockDesign, blockDesignPatch } from './design.js'
import type { Infer } from './types.js'

type Parsed = Infer<ReturnType<typeof blockDesign>>
type Patch = Infer<ReturnType<typeof blockDesignPatch>>

it('the parser cannot produce anything the declared type forbids', () => {
  expectTypeOf<Parsed>().toMatchTypeOf<BlockDesign>()
})

it('every value is a token from a closed set', () => {
  expectTypeOf<BlockDesign['width']>().toEqualTypeOf<
    'narrow' | 'normal' | 'wide' | 'full' | undefined
  >()
  expectTypeOf<BlockDesign['align']>().toEqualTypeOf<'start' | 'center' | 'end' | undefined>()
  expectTypeOf<BlockDesign['container']>().toEqualTypeOf<
    'narrow' | 'normal' | 'wide' | 'full' | undefined
  >()
  expectTypeOf<Parsed['spacingTop']>().toEqualTypeOf<
    'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | undefined
  >()
})

it('a patch can clear a control as well as set one', () => {
  expectTypeOf<Patch['width']>().toEqualTypeOf<
    'narrow' | 'normal' | 'wide' | 'full' | null | undefined
  >()
})

it('the seven controls of SPEC.md §61 are all there', () => {
  expectTypeOf<keyof BlockDesign>().toEqualTypeOf<
    | 'spacingTop'
    | 'spacingBottom'
    | 'width'
    | 'align'
    | 'background'
    | 'backgroundImage'
    | 'container'
    | 'hiddenOn'
  >()
})
