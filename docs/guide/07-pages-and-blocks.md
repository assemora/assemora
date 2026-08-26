# Pages and blocks

A page is a **tree of blocks with stable, immutable ids** — never an HTML blob. Move a
block in the builder and the tree changes; nothing is re-parsed, nothing is
re-serialized, and the block that was there is still the same block with the same id.
That is what makes revisions, undo, diffs and agent proposals expressible at all.

A block is declared in two halves, on purpose.

## Half one: what a block *is*

```ts
import { block } from '@assemora/pages'
import { select, text } from '@assemora/resources'

export const Hero = block(
  'hero',
  {
    title: text().required().label('Headline'),
    subtitle: text().label('Subtitle'),
    variant: select('centered', 'split'),
  },
  { label: 'Hero', description: 'The first thing a visitor sees' },
)
```

Fields, validation, and the form Studio draws. It says nothing about what the block
looks like. The type name — `'hero'` — is what a stored tree holds and what an agent
asks for by name, so it is worth choosing once.

A block that holds other blocks declares the rules:

```ts
export const Section = block(
  'section',
  { heading: text().label('Heading'), columns: select('one', 'two', 'three') },
  {
    label: 'Section',
    acceptsChildren: true,
    allowedChildren: ['feature', 'prose', 'cta'],
    maxChildren: 12,
  },
)
```

Those rules are enforced inside the tree operations, so an invalid tree is never
*produced* rather than merely never displayed. `allowedChildren` is what turns a
builder from a free-for-all into a design system, and the refusal comes from this
declaration rather than from anything Studio knows.

A block reaches the builder by being listed on the module, and by nothing else:

```ts
export default pages({ blocks: [Hero, Section] })
```

## Half two: what it looks like

```tsx
export const HeroView = ({ props }: BlockViewProps<{ title?: string; subtitle?: string }>) => (
  <header className="hero">
    <h1>{props.title}</h1>
    {props.subtitle !== undefined && <p>{props.subtitle}</p>}
  </header>
)
```

Views belong to the application, in its own frontend bundle. One registry joins the two
halves:

```tsx
import { AssemoraPage, createBlockRegistry } from '@assemora/react'

export const blocks = createBlockRegistry(
  { hero: HeroView, richText: RichTextView },
  { fallback: Missing },
)

<AssemoraPage page={{ tree }} blocks={blocks} />
```

**Register a fallback.** A stored page outlives the code that renders it: a block type
dropped from the project is still in every tree that used it, and a visitor should never
be shown a silent gap where one used to be.

`@assemora/react` depends on `@assemora/schema` and React and nothing else, which is
what lets a site put it in a browser bundle without the server layer coming along. It
is also why the block tree types live in `schema` rather than in `pages` (ADR-0016).

## Every builder operation is a command

Add, edit, move, nest, duplicate, hide, remove, design, publish:

```ts
await commands.execute('pages.create', { slug: 'home', title: 'Home' })

await commands.execute('blocks.add', {
  id: pageId,
  type: 'hero',
  props: { title: 'Build visually. Extend with TypeScript.' },
  parentId,          // optional — where in the tree
  index,             // optional — where among its siblings
})

await commands.execute('blocks.update', { id: pageId, blockId, props: { title: 'Welcome home' } })
await commands.execute('blocks.move', { id: pageId, blockId, parentId, index })
await commands.execute('blocks.duplicate', { id: pageId, blockId })
await commands.execute('blocks.hide', { id: pageId, blockId, hidden: true })
await commands.execute('blocks.remove', { id: pageId, blockId })
await commands.execute('pages.publish', { id: pageId })
```

What Studio does with a mouse, an agent does with the same call, through the same
validation, the same policies and the same revision. There is no builder API that is
not a command.

**Every tree command answers with the tree it produced**, plus the new version. An
editor has to draw the result of what it just did, and a client that re-read the page to
learn it would spend a round trip per keystroke — and would be tempted to keep its own
copy of these operations instead, which is exactly the duplicated business logic Studio
must not have.

## Draft and published are two trees

They are stored side by side, so a visitor keeps seeing the published tree while an
editor works on the draft. `pages.get` reads the published one **by default**, because a
renderer must never show a draft because a parameter was forgotten:

```ts
await queries.execute('pages.get', { slug: 'home' })                  // published
await queries.execute('pages.get', { slug: 'home', mode: 'draft' })   // the draft
```

`pages.publish` refuses a tree holding an unfinished block — one whose required fields
have not been filled in — and names the field. A draft may hold one; what visitors see
may not.

`pages.unpublish` takes the published tree away and leaves the draft; `pages.archive`
does the same and marks the page archived.

## Concurrency is explicit

Every page command accepts an optional `expectedVersion`:

```ts
await commands.execute('blocks.update', { id, blockId, props, expectedVersion: page.version })
```

Stating it turns a lost update into a 409 instead of a silent overwrite (SPEC.md §66).
It is optional because not every caller has a version in hand; Studio always does, and
sends it.

## The universal design controls

Seven settings every block gets for free, carried on `BlockNode.design` beside `props`
rather than inside it — `props` belongs to the block's author, and a framework key in
there would collide with a field somebody declared:

```ts
await commands.execute('blocks.design', {
  id: pageId,
  blockId,
  design: { spacingTop: 'md', width: 'narrow', background: 'surface-sunken' },
})
```

Spacing (`spacingTop`, `spacingBottom`), width, alignment (`align`), background
(`background`, `backgroundImage`), container width and responsive visibility
(`hiddenOn`). **Every value is a token**, and nothing there can express
CSS: a background is validated against `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, so `#ff0000`
and `red; position: fixed` are both refused. What `md` or `narrow` looks like is the
theme's answer, given once in a stylesheet (SPEC.md §62). That is what keeps the
controls universal and what lets an agent restyle a page without emitting global CSS.

A control may be absent or explicitly `null`, and they are different answers: absent
means "leave this alone", `null` means "clear it and let the theme decide again".

## The builder canvas

Studio's canvas is an **iframe pointed at your application's own frontend**, at
`/preview`. It runs the real renderer with the real block views in a real viewport, so
the preview cannot drift from what a visitor sees — there is no second implementation
for it to drift from.

`@assemora/react` owns both ends of the conversation: `measureBlocks()` and `blockAt()`
turn the rendered DOM into geometry and clicks, and `canvas.ts` declares the messages.
Studio never reaches inside the frame; it draws its selection outline on top of the
geometry the frame reports. `starters/bare/app/preview.tsx` is the reference
implementation of the frame's half, including the origin check both directions run.

## Where to look next

- [Authentication](08-authentication.md) — who is allowed to publish.
- [Agents and MCP](10-agents-and-mcp.md) — the same tree commands, as proposals.
- `examples/company/` — seven blocks with a nesting rule, the design controls and a
  theme that says what every token means.
