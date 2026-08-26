/**
 * A block says what it *is*: its fields, their validation, and the form Studio draws
 * for it (SPEC.md §55).
 *
 * It deliberately says nothing about what it looks like. That is a React component,
 * and it lives on the Next.js side in `app/blocks/hero.tsx` — so the site can be
 * redesigned without this file changing, and the builder can offer a block before
 * anybody has styled it.
 */
import { block } from '@assemora/pages'
import { text } from '@assemora/resources'

export const Hero = block(
  'hero',
  {
    title: text().required().label('Headline'),
    subtitle: text().label('Subtitle'),
  },
  { label: 'Hero', description: 'The first thing a visitor sees' },
)
