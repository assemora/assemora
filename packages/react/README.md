# @assemora/react

The renderer (SPEC.md §57).

```tsx
import { AssemoraPage, createBlockRegistry } from '@assemora/react'

const registry = createBlockRegistry(
  { hero: HeroView, section: SectionView, faq: FaqView },
  { fallback: MissingView },
)

<AssemoraPage page={page} blocks={registry} />
```

A block declaration says what a block *is* — its fields, its validation, the form
Studio draws. A view says what it looks like, and it belongs to the application. This
package is where the two meet.

It depends on `@assemora/schema` and React, and on nothing else, which is what lets a
site put it in a browser bundle without the server layer coming along. That is also
why the block tree types live in `schema` rather than in `pages` (ADR-0016).

## Inside a builder

`editing` marks every block in the DOM with a `display: contents` wrapper — no box, no
layout change, so what the canvas shows is what a visitor will see. `measureBlocks()`
and `blockAt()` turn that into geometry and clicks, and `canvas.ts` declares the
messages the editor and the frame exchange (SPEC.md §59).

The application serves this bundle; Studio's canvas is an iframe pointed at it. The
preview is accurate because it is not a second implementation.

## The universal design controls

`BlockNode.design` carries the seven settings of SPEC.md §61. They are tokens, and
this package turns them into data attributes and custom properties:

```css
.assemora-design { padding-top: var(--assemora-space-top, 0); }
.assemora-design[data-width='narrow'] > * { max-width: 34rem; }
```

What `lg` or `narrow` looks like is the theme's answer, given once (SPEC.md §62).
