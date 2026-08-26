# `@assemora/pages`

Pages, the block tree, drafts and publishing.

**Implementation phase:** 7 — implemented.

```ts
export const Hero = block('hero', {
  title: text().required(),
  subtitle: text(),
  variant: select('centered', 'split'),
})

export default pages({ blocks: [Hero] })
```

A page is a tree of blocks with stable, immutable ids — never an HTML blob
(SPEC.md §54, §125.14). Draft and published trees are stored side by side, so a
visitor keeps seeing the published one while an editor works.

Every builder operation of SPEC.md §60 — add, edit, move, nest, duplicate, hide,
remove, publish — is a command. What Studio does with a mouse, an agent does with the
same call, through the same validation, the same policies and the same revision.

The nesting rules a block declares (`acceptsChildren`, `allowedChildren`,
`maxChildren`) are enforced in the tree operations, so an invalid tree is never
produced rather than merely never displayed.

`expectedVersion` turns a lost update into a 409 instead of a silent overwrite
(SPEC.md §66).

The block tree types themselves live in `@assemora/schema`, so a renderer can draw a
page without the server layer coming with it.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/data`
- `@assemora/resources`
