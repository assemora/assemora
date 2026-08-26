# `@assemora/schema`

Schema primitives: field definitions, type inference, neutral JSON representation.

**Implementation phase:** 1 — implemented.

One declaration is at once a runtime parser, a compile-time type and a JSON Schema
description, so validation, the database, Studio forms, OpenAPI, the SDK and MCP all
read a single source (SPEC.md §3.4, §42).

```ts
import { enumOf, number, object, string, uuid, type Infer } from '@assemora/schema'

const Article = object({
  id: uuid(),
  title: string().min(2),
  status: enumOf('draft', 'published'),
  views: number().optional(),
})

type Article = Infer<typeof Article>
// { id: string; title: string; status: 'draft' | 'published'; views?: number }

const result = Article.parse(payload)
if (!result.ok) result.issues // [{ path: ['title'], code: 'min', message: '...' }]
```

Parsing never throws — the caller decides what a failure means. Keys outside the
declared shape are dropped rather than passed through, which is how mass assignment
is prevented (SPEC.md §85).

## Workspace dependencies

_none, and there never will be any._ `pnpm boundaries` enforces it: every layer and
every browser bundle reads this package.
