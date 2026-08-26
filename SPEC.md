# Assemora v1 — technical specification

**Status:** approved architecture specification v1
**Purpose:** the primary document for developing the project in Claude Code
**Implementation language:** TypeScript
**Primary database:** PostgreSQL
**Architecture:** modular monolith
**Guiding principle:** beautiful → readable → type-safe → schema-first → agent-native

## 1. Product definition

Assemora is a TypeScript framework and CMS for building sites and content
applications, equally convenient for:

- developers;
- ordinary users;
- AI agents.

Positioning:

> Build visually. Extend with TypeScript. Control with AI.

Assemora must not be yet another headless CMS or visual page builder.
It is a single application platform in which:

```text
Developer
     │
     ▼
TypeScript API
     │
     │
Human ───► Studio
     │
     │
AI ──────► MCP / Agent API
     │
     ▼
┌──────────────────┐
│  Assemora Core   │
└────────┬─────────┘
         │
     PostgreSQL
```

Studio, the REST API, the SDK, the CLI and AI agents must all work on top of one
application layer.

## 2. The main architectural principle

Every state-changing operation must go through a single Command Layer.

The following architecture is forbidden:

```text
Studio → DB

REST → Service → DB

AI → separate AI Service → DB
```

It must be:

```text
Studio
REST
SDK
CLI
MCP
AI Agent
   │
   ▼
Command Bus
   │
Validation
   │
Authorization
   │
Transaction
   │
Domain Handler
   │
Revision
   │
Events
   │
Database
```

If an action can be performed with a mouse in Studio, it must be performable by an
AI agent.

If an action can be performed through AI, it must pass the same permissions,
validation, revisions and audit log as a user's action.

## 3. Product principles

### 3.1. Beautiful API

The beauty of the user-facing TypeScript API is part of the product.
Internal implementation may be complex if that makes the public API simpler.

Preferred:

```ts
const posts = await Post
  .published()
  .with('author')
  .latest()
  .take(10)
```

Instead of:

```ts
const repository = dataSource.getRepository(PostEntity)

const posts = await repository.find({
  where: {
    published: Equal(true),
  },
  relations: {
    author: true,
  },
  order: {
    createdAt: 'DESC',
  },
  take: 10,
})
```

### 3.2. Minimum framework noise

Do not use decorators as the primary public API.

It must not be necessary to write:

```ts
@Entity()
@Column()
@Controller()
@Inject()
@ApiProperty()
```

The primary DSL:

```text
model()
resource()
block()
module()
route()
command()
policy()
```

### 3.3. Type inference instead of manual typing

A developer must not have to duplicate:

```text
schema
interface
OpenAPI schema
validation schema
MCP schema
form definition
```

Types are inferred automatically.

### 3.4. Schema-first

One declaration must serve several subsystems.

```text
Assemora Schema
       │
       ├── TypeScript
       ├── Runtime validation
       ├── Database
       ├── Studio
       ├── REST
       ├── OpenAPI
       ├── SDK
       ├── MCP
       └── AI
```

### 3.5. Agent-native

AI is not a plugin. AI is a first-class actor of the system.

### 3.6. Revision-first

Any content mutation must be reversible.

### 3.7. Self-documenting

If an endpoint exists, its current documentation must exist automatically.
Manual duplication of Swagger/OpenAPI annotations is forbidden.

## 4. Scope of v1

Assemora v1 must include:

```text
Core framework
Module system
Dependency container
Commands
Queries
Events

Assemora Data
Models
Query Builder
Relations
Scopes
Query AST
Transactions

PostgreSQL adapter
Drizzle integration
Migrations

Resources
Dynamic Resources
CRUD

Auth
RBAC
Policies
API tokens
Agent tokens

Pages
Blocks
Page Builder
Renderer

Media

Studio

REST API
API Schema Registry
OpenAPI
API Explorer

SDK

MCP
Agent API
Dry Run

Revisions
Audit Log
Undo

CLI

Plugin API

Next.js starter
```

## 5. Not part of v1

Do not implement before v1 is complete:

```text
E-commerce
Marketplace
Email marketing
Analytics platform
Workflow builder
Realtime collaborative editor
Multitenancy
Multi-site
Hosting platform
Own CDN
Visual animation editor
Figma importer
Payment processing
No-code arbitrary database designer
Full Webflow-style CSS editor
```

The architecture may leave room for these later, but v1 must not be complicated for
their sake.

## 6. Technology stack

Runtime:

```text
Node.js 24 LTS
TypeScript
ESM
pnpm
Turborepo
```

Server:

```text
Fastify 5.x
```

NestJS must not be used as a dependency. Architectural ideas from NestJS are
acceptable:

```text
modules
providers
container
guards
lifecycle
```

but Assemora must have its own kernel.

Database:

```text
PostgreSQL
Drizzle ORM — internal implementation
```

Drizzle is not part of the Assemora public API.

Cache / queue:

```text
Redis
BullMQ
```

The queue must not be required to run a minimal Core.

Studio:

```text
React
Vite
TanStack Router
TanStack Query
Tailwind CSS
Radix-style primitives
dnd-kit
```

Testing:

```text
Vitest
Playwright
TypeScript compile/type tests
```

## 7. Monorepo

Structure:

```text
assemora/

  apps/
    studio/
    playground/
    docs/

  packages/
    core/
    schema/
    data/
    database/
    database-postgres/
    http/
    resources/
    auth/
    pages/
    media/
    revisions/
    openapi/
    mcp/
    sdk/
    react/
    plugin/
    cli/

  starters/
    nextjs/
    bare/

  examples/
    blog/
    company/

  docs/
    architecture/
    adr/

  .claude/
    rules/
    agents/

  CLAUDE.md
  SPEC.md
  package.json
  pnpm-workspace.yaml
  turbo.json
```

## 8. Dependency boundaries

Dependencies must flow top to bottom.

```text
schema
  ↑
core
  ↑
database
  ↑
data
  ↑
resources
  ↑
pages

core
  ↑
http
  ↑
openapi

resources/pages
       ↑
      mcp

sdk
 ↑
studio
```

Dependency cycles between packages are forbidden.

`core` must not import:

```text
React
Fastify
Drizzle
Studio
MCP
```

`data` must not depend on PostgreSQL directly.
`database-postgres` implements the abstractions of `database`.

## 9. Target user-facing API

This is the reference against which architectural decisions are made.

Model:

```ts
import {
  model,
  uuid,
  string,
  boolean,
  timestamp,
  hasMany,
} from '@assemora/data'

export const User = model('users', {
  id: uuid().primary(),

  name: string(),

  email: string()
    .unique(),

  active: boolean()
    .default(true),

  posts: hasMany(() => Post),

  createdAt: timestamp()
    .created(),

  updatedAt: timestamp()
    .updated(),
})
```

Query:

```ts
const users = await User
  .where('active', true)
  .with('posts')
  .latest()
  .take(20)
```

Resource:

```ts
export const Articles = resource(Article, {
  title: text().required(),

  slug: slug('title'),

  content: richText(),

  image: media(),

  published: toggle(),
})
```

Block:

```ts
export const Hero = block('hero', {
  title: text().required(),
  subtitle: text(),
  image: media(),
  variant: select('centered', 'split'),
})
```

Route:

```ts
route.post('/auth/login', {
  body: {
    email: email(),
    password: string().min(8),
  },

  response: {
    token: string(),
    user: User,
  },

  handler: login,
})
```

Policy:

```ts
export const ArticlePolicy = policy(Article, {
  read: () => true,

  update: ({ actor, article }) =>
    actor.id === article.authorId,

  delete: ({ actor }) =>
    actor.isAdmin,
})
```

Module:

```ts
export default module('blog')
  .models(Article, Category)
  .resources(Articles)
  .routes(routes)
```

Application configuration:

```ts
export default assemora({
  database: postgres(),

  modules: [
    auth(),
    pages(),
    media(),
    blog(),
  ],

  studio: true,
  api: true,
  mcp: true,
})
```

## 10. Public API requirements

Every new public API must satisfy the following rules.

**Code must read without documentation.** A method name must explain the action.

Good:

```ts
User.find(id)

Post.latest()

Post.with('author')

user.delete()
```

Bad:

```ts
User.executeFindOperation()

Post.createQueryBuilder()

resolveRelationByName()
```

**Minimum generics in user code.**

Bad:

```ts
model<UserSchema, UserRelations, UserScopes>(...)
```

Generic machinery must stay inside the framework.

**No `any`.** Unjustified `any` is forbidden in public and internal interfaces. Use
`unknown` followed by validation.

**The public API must not expose Drizzle.**

Forbidden:

```ts
User.query((db: PgDatabase) => ...)
```

Core operations must be expressible through the Assemora API. An escape hatch is
allowed separately:

```ts
db.raw(...)
```

and is considered advanced API.

## 11. @assemora/core

Core implements:

```text
Application
Module Registry
Service Container
Lifecycle
Command Bus
Query Bus
Event Bus
Application Context
Hooks
Configuration
Errors
Plugin registration
```

Core must be independent of HTTP and the database.

## 12. Application context

Every operation must carry a context:

```ts
interface AssemoraContext {
  requestId: string

  actor?: {
    type: 'user' | 'agent' | 'api'
    id: string
  }

  source:
    | 'studio'
    | 'rest'
    | 'sdk'
    | 'mcp'
    | 'cli'
    | 'internal'

  locale?: string
}
```

The context must propagate through AsyncLocalStorage.

This allows actor/requestId to be attached automatically to:

```text
logs
commands
events
revisions
audit log
database operations
```

## 13. Module system

API:

```ts
module('blog')
  .models(Post, Category)
  .resources(Posts)
  .commands(PublishPost)
  .routes(routes)
```

Lifecycle:

```text
register
boot
ready
shutdown
```

A module must have an encapsulated registration context.

## 14. Command Bus

Every mutation is a Command.

Example:

```ts
export const PublishPage = command('pages.publish', {
  input: {
    id: uuid(),
  },

  handle: async ({ id }, ctx) => {
    // ...
  },
})
```

Invocation:

```ts
await commands.execute('pages.publish', {
  id,
})
```

Every Command passes through:

```text
Input validation
        ↓
Authorization
        ↓
Transaction
        ↓
Handler
        ↓
Revision collection
        ↓
Events
        ↓
Audit
```

A Command must have a unique name:

```text
pages.create
pages.update
pages.publish

entries.create
entries.update

media.delete
```

## 15. Queries

Read operations must not use the Command Bus.
A Query Bus is acceptable for application queries.
A query must not create side effects.

## 16. Assemora Data

`@assemora/data` is a standalone data layer in the style of Eloquent, but type-safe
and schema-aware. Drizzle sits below the data layer.

```text
Developer API
     ↓
Assemora Model
     ↓
Query Builder
     ↓
Query AST
     ↓
Database Adapter
     ↓
Drizzle
     ↓
PostgreSQL
```

## 17. Model DSL

Minimum set of columns for v1:

```text
uuid
string
text
integer
bigint
number
decimal
boolean
date
timestamp
json
enumOf
binary
```

Modifiers:

```text
primary
required
nullable
unique
index
default
defaultRandom
created
updated
hidden
```

Example:

```ts
export const Product = model('products', {
  id: uuid()
    .primary()
    .defaultRandom(),

  name: string(),

  price: decimal(),

  status: enumOf(
    'draft',
    'active',
    'archived',
  ).default('draft'),

  metadata: json<ProductMetadata>(),

  createdAt: timestamp().created(),

  updatedAt: timestamp().updated(),
})
```

## 18. Type inference

A model must provide compile-time inferred types.

```ts
type ProductRecord = typeof Product.$infer
```

Result:

```ts
{
  id: string
  name: string
  price: Decimal
  status: 'draft' | 'active' | 'archived'
  metadata: ProductMetadata
  createdAt: Date
  updatedAt: Date
}
```

## 19. Query Builder

Must support:

```ts
User.where('active', true)

User.where('age', '>=', 18)

User.where({
  active: true,
  verified: true,
})

User.whereIn('status', ['active', 'pending'])

User.whereNull('deletedAt')

User.whereNotNull('publishedAt')

User.whereBetween('price', [10, 100])

User.whereLike('name', '%artem%')

User.orderBy('name')

User.latest()

User.oldest()

User.limit(20)

User.offset(20)
```

Logical groups:

```ts
Post.where(q =>
  q
    .where('published', true)
    .orWhere('featured', true)
)
```

All field names must be compile-time checked.

The following must produce a TypeScript error:

```ts
User.where('unknownField', true)
```

## 20. Lazy query execution

The query builder must be immutable.

A beautiful API is allowed:

```ts
const posts = await Post
  .where('published', true)
  .latest()
  .take(10)
```

A query object may implement `PromiseLike`.

Explicit terminal methods must remain available as well:

```ts
.get()
.first()
.firstOrFail()
.count()
.exists()
.paginate()
.cursorPaginate()
```

## 21. Model static operations

```ts
User.find(id)

User.findOrFail(id)

User.all()

User.create(data)

User.count()

User.exists(filters)
```

## 22. Model instance API

```ts
const user = await User.findOrFail(id)

user.name = 'John'

await user.save()

await user.update({
  name: 'Alex',
})

await user.delete()

await user.refresh()
```

Dirty tracking:

```ts
user.isDirty()

user.isDirty('email')

user.getOriginal('email')
```

## 23. Relations

v1:

```text
belongsTo
hasOne
hasMany
belongsToMany
```

Example:

```ts
export const Post = model('posts', {
  id: uuid().primary(),

  authorId: uuid(),

  author: belongsTo(() => User, {
    foreignKey: 'authorId',
  }),
})
```

User:

```ts
posts: hasMany(() => Post, {
  foreignKey: 'authorId',
})
```

Loading:

```ts
await User
  .with('posts')
  .find(id)
```

Nested:

```ts
await Post
  .with('comments.author')
  .get()
```

TypeScript must check the relation path.

## 24. Pivot operations

For many-to-many:

```ts
await user.roles.attach(roleId)

await user.roles.detach(roleId)

await user.roles.sync([
  adminId,
  editorId,
])
```

## 25. Scopes

Model:

```ts
export const Post = model('posts', {
  // ...
}, {
  scopes: {
    published: q =>
      q.where('status', 'published'),

    featured: q =>
      q.where('featured', true),
  },
})
```

Usage:

```ts
const posts = await Post
  .published()
  .featured()
  .latest()
```

Scope methods must infer their types automatically.

## 26. Computed fields

```ts
computed: {
  fullName: user =>
    `${user.firstName} ${user.lastName}`,
}
```

Usage:

```ts
user.fullName
```

## 27. Casts / transforms

```ts
email: string()
  .set(value => value.toLowerCase()),

settings: json<UserSettings>(),

publishedAt: timestamp(),
```

## 28. Serialization

Must support:

```text
hidden
visible
computed
```

Sensitive fields must not reach JSON by default.

```ts
password: string().hidden()
```

## 29. Soft deletes

Model configuration:

```ts
model('articles', {
  // ...
}).softDeletes()
```

API:

```ts
Article.withTrashed()

Article.onlyTrashed()

article.restore()
```

## 30. Query AST

The query builder must not build Drizzle queries directly.
It produces a framework-neutral Query AST.

Example:

```json
{
  "model": "articles",
  "operation": "select",
  "where": [
    {
      "field": "published",
      "operator": "=",
      "value": true
    }
  ],
  "order": [
    {
      "field": "createdAt",
      "direction": "desc"
    }
  ],
  "limit": 10
}
```

The Query AST is the internal stable contract between:

```text
Assemora Data
Database Adapter
Policy Layer
AI Query Layer
```

AI must never generate arbitrary SQL for standard operations.

## 31. DatabaseAdapter

`@assemora/database` defines abstract interfaces.

A conceptual interface:

```ts
interface DatabaseAdapter {
  execute<T>(
    query: QueryAst,
    context: DatabaseContext,
  ): Promise<T>

  transaction<T>(
    callback: () => Promise<T>,
  ): Promise<T>

  introspect(): Promise<DatabaseSchema>
}
```

No PostgreSQL-specific types in the interface.

## 32. PostgreSQL adapter

Package:

```text
@assemora/database-postgres
```

Uses Drizzle internally.

Responsibilities:

```text
PostgreSQL connection
Query AST → Drizzle
Transactions
Schema generation
Migration execution
PostgreSQL-specific optimizations
JSONB operations
```

## 33. Transactions

Preferred DX:

```ts
await Assemora.transaction(async () => {
  const user = await User.create({
    email,
  })

  await Profile.create({
    userId: user.id,
  })
})
```

The current transaction must propagate through AsyncLocalStorage.
A developer must not have to pass `tx` by hand.

## 34. Database migrations

A user must never edit the Drizzle schema.

Command:

```bash
assemora db:generate add-products
```

Assemora:

```text
Model Registry
     ↓
Generated internal Drizzle schema
     ↓
Migration generator
     ↓
SQL migration
```

Generated files:

```text
.assemora/generated/
```

are internal and must not be edited by hand.

Migration files:

```text
database/migrations/
```

Commands:

```bash
assemora db:generate
assemora db:migrate
assemora db:rollback
assemora db:status
```

Destructive migrations must produce a warning.
Destructive operations in production require `--force`.

## 35. Resource layer

A resource is responsible for:

```text
CMS representation
Studio UI
CRUD
API exposure
Filters
Search
AI exposure
Permissions
```

A resource does not replace a model.

```text
Model = data/domain
Resource = CMS representation
```

## 36. Static resources

Example:

```ts
export const Articles = resource(Article, {
  title: text()
    .required()
    .searchable(),

  slug: slug('title'),

  content: richText(),

  cover: media(),

  status: select(
    'draft',
    'published',
  ),
})
```

## 37. Dynamic resources

A user must be able to create a collection through Studio or AI without changing
source code.

For example:

```text
Testimonials

name
avatar
text
rating
```

Dynamic resources store their schema in the database.
No TypeScript source file is generated automatically.

## 38. Dynamic resource storage

System tables:

```text
assemora_resource_definitions

id
name
label
schema JSONB
settings JSONB
created_at
updated_at
```

```text
assemora_resource_entries

id UUID
resource_id UUID
data JSONB
status
version
created_by
updated_by
created_at
updated_at
deleted_at
published_at
```

For JSONB, implement:

```ts
whereJson()

whereJsonContains()
```

## 39. Resource fields v1

```text
text
textarea
richText
number
boolean/toggle
date
datetime
select
json
slug
url
email
media
relation
object
array
```

The field API is extensible through the Plugin API.

## 40. HTTP layer

Package:

```text
@assemora/http
```

Uses Fastify internally.
Fastify types must not leak into the standard route handler API.

## 41. Route DSL

```ts
route.get('/articles/:id', {
  params: {
    id: uuid(),
  },

  response: Article,

  auth: true,

  handler: async ({ params }) => {
    return Article.findOrFail(params.id)
  },
})
```

Request context:

```ts
{
  params
  query
  body
  headers
  actor
  request
}
```

`request` is an advanced escape hatch.

## 42. Schema Registry

Create a central runtime `SchemaRegistry`.

It holds descriptions of:

```text
models
resources
fields
relations
blocks
routes
commands
permissions
```

The Schema Registry is the data source for:

```text
OpenAPI
Studio
MCP
AI
SDK generator
Introspection
```

## 43. REST CRUD generation

A resource automatically produces:

```text
GET    /api/articles
GET    /api/articles/:id
POST   /api/articles
PATCH  /api/articles/:id
DELETE /api/articles/:id
```

CRUD can be disabled or restricted:

```ts
resource(Article, fields, {
  api: {
    create: true,
    read: true,
    update: true,
    delete: false,
  },
})
```

## 44. OpenAPI

Support OpenAPI 3.1.

Endpoint:

```text
/api/openapi.json
```

The document is built automatically from the Schema Registry.

It must never be necessary to write:

```text
@ApiProperty
@ApiResponse
@ApiOperation
Swagger annotations
```

## 45. Assemora API Explorer

In Studio:

```text
Developer
  ├── API Explorer
  ├── Models
  ├── Resources
  ├── Routes
  ├── MCP
  └── Logs
```

The API Explorer must show:

```text
method
path
description
parameters
query
request body
response
errors
authentication
permissions
```

There must be a `Try request` action showing:

```text
status
duration
response headers
response body
```

## 46. Error schemas

A route must document the application errors it can produce.

```ts
route.post('/auth/login', {
  // ...

  errors: [
    InvalidCredentials,
    UserBlocked,
  ],
})
```

OpenAPI and the API Explorer display those responses automatically.

## 47. API versioning

Support:

```ts
api.version('v1', api => {
  api.resource(Articles)
})
```

Result:

```text
/api/v1/articles
```

## 48. SDK

Package:

```text
@assemora/sdk
```

The SDK must be fully type-safe.

Example:

```ts
const api = createClient({
  url,
  token,
})

const posts = await api.articles.list()

const post = await api.articles.get(id)

await api.articles.create({
  title: 'Hello',
})
```

Generator:

```bash
assemora sdk:generate
```

Generating the TypeScript SDK is mandatory in v1.

## 49. Authentication

Studio:

```text
email/password
secure server-side session
httpOnly cookie
```

Passwords:

```text
Argon2id
```

API:

```text
Bearer API tokens
```

MCP:

```text
Agent token
```

Tokens are stored hashed only.

## 50. Authorization

Support:

```text
roles
permissions
policies
```

System tables:

```text
assemora_users
assemora_sessions

assemora_roles
assemora_permissions

assemora_user_roles
assemora_role_permissions

assemora_api_tokens
assemora_agents
assemora_agent_tokens
```

## 51. Policies

```ts
policy(Article, {
  read: ({ actor }) => true,

  update: ({ actor, article }) =>
    actor.id === article.authorId,

  delete: ({ actor }) =>
    actor.has('articles.delete'),
})
```

A policy applies identically to:

```text
Studio
REST
SDK
MCP
CLI
```

## 52. Field-level AI permissions

Fields may define agent capabilities.

Conceptual example:

```ts
role: string({
  agent: {
    read: true,
    write: false,
  },
})
```

An agent must not be able to bypass field permissions through raw CRUD.

## 53. Pages

System table:

```text
assemora_pages

id UUID
slug
title
status
draft_tree JSONB
published_tree JSONB
meta JSONB
version
created_by
updated_by
published_at
created_at
updated_at
```

Statuses:

```text
draft
published
archived
```

## 54. Block tree

A page is never stored as an arbitrary HTML blob.

Structure:

```json
{
  "blocks": [
    {
      "id": "01...",
      "type": "hero",
      "version": 1,
      "props": {
        "title": "Build anything",
        "subtitle": "With Assemora"
      },
      "children": []
    }
  ]
}
```

Every block has an immutable stable ID.

## 55. Block DSL

```ts
export const Hero = block('hero', {
  title: text().required(),

  subtitle: text(),

  image: media(),

  variant: select(
    'centered',
    'split',
  ),
})
```

A block schema must generate:

```text
Studio form
runtime validation
JSON Schema
AI schema
MCP input schema
```

## 56. Nested blocks

A block may define:

```text
acceptsChildren
allowedChildren
maxChildren
```

Arbitrary invalid block trees must not be allowed.

## 57. Renderer

Package:

```text
@assemora/react
```

Registry:

```ts
const registry = createBlockRegistry({
  hero: HeroView,
  features: FeaturesView,
  faq: FaqView,
})
```

Renderer:

```tsx
<AssemoraPage
  page={page}
  blocks={registry}
/>
```

Do not import React into Core/Page Schema packages.

## 58. Studio

Studio is a React SPA.

Primary navigation:

```text
Dashboard

Content
  Collections

Pages

Media

Design

AI

Users

Settings

Developer
```

## 59. Page Builder

Layout:

```text
┌──────────────┬─────────────────────────┬───────────────┐
│ Blocks       │                         │ Properties    │
│              │                         │               │
│ Hero         │        Preview          │ Content       │
│ Features     │                         │ Layout        │
│ Gallery      │                         │ Spacing       │
│ Testimonials │                         │ Responsive    │
│ FAQ          │                         │               │
└──────────────┴─────────────────────────┴───────────────┘
```

The canvas is implemented as an iframe.

Advantages:

```text
CSS isolation
accurate rendering
real frontend renderer
responsive preview
```

## 60. Builder operations

Required operations:

```text
add block
remove block
duplicate block
move block
nest block
edit props
hide block
change block variant
undo
redo
preview
publish
```

Every operation must map to a Command.

## 61. Universal design controls v1

Do not build a full CSS editor.

Support universal settings:

```text
spacing
width
alignment
background
visibility
responsive visibility
container width
```

Specific visual logic stays in developer-defined blocks.

## 62. Theme

The theme is stored as structured tokens.

Example:

```json
{
  "colors": {},
  "typography": {},
  "spacing": {},
  "radius": {},
  "container": {}
}
```

AI must change theme tokens rather than generate arbitrary global CSS.

## 63. Media

System table:

```text
assemora_media

id UUID
disk
path
filename
mime_type
size
width
height
alt
metadata JSONB
created_by
created_at
```

Storage interface:

```text
local
S3-compatible
```

Both `local` and `S3-compatible` are mandatory in v1.

## 64. Revisions

Every content mutation must create a revision.

System table:

```text
assemora_revisions

id UUID

entity_type
entity_id

actor_type
actor_id

command

before JSONB
after JSONB
patch JSONB

metadata JSONB

created_at
```

## 65. Undo / restore

API:

```text
revision.list
revision.compare
revision.restore
```

Studio:

```text
Revision #193

Claude Agent

Changed Hero title
Added Testimonials

[Compare]
[Restore]
```

## 66. Optimistic concurrency

Pages and content entities must carry `version integer`.

A mutation may pass `expectedVersion`.

On conflict:

```text
409 CONFLICT
```

AI and Studio must not silently overwrite fresher changes.

## 67. Audit log

Separate from revisions. The audit log answers: who did what?

System table:

```text
assemora_audit_logs

id
actor_type
actor_id
source
action
entity_type
entity_id
request_id
metadata JSONB
created_at
```

## 68. MCP

Package:

```text
@assemora/mcp
```

The MCP server must use the Schema Registry and the Command Bus.
Do not create separate business logic for MCP.

## 69. MCP read tools

Minimum:

```text
assemora.describe

assemora.resources.list
assemora.resources.describe

assemora.entries.list
assemora.entries.get

assemora.pages.list
assemora.pages.get

assemora.blocks.types

assemora.revisions.list
```

## 70. MCP mutation tools

```text
assemora.entries.create
assemora.entries.update
assemora.entries.delete

assemora.pages.create
assemora.pages.update

assemora.blocks.add
assemora.blocks.update
assemora.blocks.move
assemora.blocks.remove

assemora.pages.publish

assemora.revisions.restore
```

## 71. assemora.describe

The key AI endpoint/tool.

Returns:

```json
{
  "project": {},
  "capabilities": [],
  "models": [],
  "resources": [],
  "pages": [],
  "blocks": [],
  "commands": [],
  "permissions": [],
  "locales": []
}
```

Purpose: AI must be able to understand the structure of the project without reading
the entire codebase.

## 72. Agent identity

An AI agent is an actor:

```ts
{
  type: 'agent',
  id: 'content-agent'
}
```

Every agent has:

```text
name
description
permissions
token
enabled
created_at
```

## 73. AI dry run

A critical feature. AI mutations must support preview by default.

Flow:

```text
Agent command
     ↓
Validation
     ↓
Authorization
     ↓
Dry Run
     ↓
Change Set
     ↓
Diff
     ↓
Approval / Apply
     ↓
Command transaction
```

## 74. Change sets

System table:

```text
assemora_change_sets

id
actor_type
actor_id

commands JSONB
diff JSONB

status
base_versions JSONB

expires_at
created_at
applied_at
```

Statuses:

```text
pending
applied
rejected
expired
conflicted
```

## 75. Agent UX in Studio

The user writes:

```text
Make the hero more compact,
remove the image
and add testimonials after features.
```

AI returns a change set:

```text
3 changes

Hero
spacing: xl → md

Hero
image: removed

Testimonials
new block

[Apply]
[Reject]
```

Production state does not change before `Apply`.

## 76. MCP security

MCP tool execution must pass:

```text
token authentication
agent permissions
policy checks
field permissions
validation
rate limits
audit
```

Direct database access from standard MCP tools is forbidden.

## 77. CLI

Executable: `assemora`

Commands in v1:

```bash
assemora new

assemora dev
assemora build
assemora start

assemora make:model
assemora make:resource
assemora make:block
assemora make:module
assemora make:command
assemora make:policy

assemora db:generate
assemora db:migrate
assemora db:rollback
assemora db:status

assemora routes
assemora models
assemora resources
assemora blocks
assemora agents

assemora api:openapi
assemora sdk:generate

assemora console
```

## 78. create-assemora

Primary onboarding:

```bash
pnpm create assemora my-project
```

The CLI asks a minimum of questions:

```text
Project name
Database URL
Include Studio?
Include Pages?
Include MCP?
```

Defaults:

```text
PostgreSQL
Studio = yes
Pages = yes
MCP = yes
```

## 79. Starter

Generated application:

```text
my-project/

  src/
    models/
    resources/
    blocks/
    modules/

  app/
    blocks/

  database/
    migrations/

  assemora.config.ts
  package.json
  tsconfig.json
```

## 80. Plugin API

Plugin:

```ts
export default plugin('seo')
  .resources(...)
  .blocks(...)
  .routes(...)
  .commands(...)
```

Plugins in v1 are installed as npm packages. A marketplace is not part of v1.

## 81. Hooks / events

Domain events:

```ts
events.on('page.published', handler)
```

Do not use events for critical sequential business logic when the operation must be
atomic. Critical logic lives in the command handler.

Events are for side effects:

```text
cache invalidation
notifications
search indexing
analytics
```

## 82. Jobs

Minimal job API:

```ts
await dispatch(
  GenerateSitemap({
    pageId,
  })
)
```

The queue adapter must be separate. The first production adapter is BullMQ.

## 83. Error model

All framework and application errors share a standard structure.

```json
{
  "error": {
    "code": "ARTICLE_NOT_FOUND",
    "message": "Article was not found",
    "details": {},
    "requestId": "..."
  }
}
```

Base:

```ts
class AssemoraError extends Error {
  code: string
  status: number
  details?: unknown
}
```

## 84. Validation errors

Format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "fields": {
      "email": [
        "Invalid email"
      ]
    }
  }
}
```

Studio, the SDK and REST must receive the same semantic structure.

## 85. Security requirements

Mandatory requirements:

```text
No plaintext passwords

No plaintext API/agent tokens in DB

Argon2id password hashing

CSRF protection for Studio session mutations

SameSite secure cookies

Rate limiting

CORS explicit configuration

Input validation

Output serialization

No arbitrary SQL for agent tools

No arbitrary filesystem operations via MCP

Permission checks before every mutation

Sensitive data excluded from logs

Secrets never included in OpenAPI/MCP schemas

Content Security Policy for Studio
```

## 86. User-provided schemas

Dynamic schemas are untrusted data.
JavaScript must not be executed from dynamic resource definitions.
A dynamic schema must be declarative JSON.

None of:

```text
eval
new Function
arbitrary code strings
```

## 87. Logging

Use structured logging.

Every log entry must include, where available:

```text
requestId
actorType
actorId
command
entityType
entityId
duration
```

## 88. Observability

Minimum for v1:

```text
structured logs
request timing
slow query logging
command timing
error tracking adapter interface
health endpoint
readiness endpoint
```

Endpoints: `/health`, `/ready`

## 89. Performance baseline

Target for v1 on a development-class PostgreSQL:

```text
Simple REST read p95 < 100ms
Simple CRUD mutation p95 < 150ms

excluding WAN latency.
```

Studio must not load an entire resource dataset.
Pagination is mandatory.
N+1 relation queries must be caught by tests and logs.

## 90. Type safety requirements

TypeScript:

```text
strict = true
noImplicitAny = true
noUncheckedIndexedAccess = true
exactOptionalPropertyTypes = true
```

Type errors must not be resolved through blanket:

```ts
as any
as unknown as ...
// @ts-ignore
```

Exceptions must be local and documented.

## 91. Code style

Primary style:

```text
ESM
single quotes
no semicolons
trailing commas
2 spaces
small functions
explicit domain names
```

Prettier/Biome must handle formatting automatically.

## 92. API quality gate

Every public API change must ship with:

```text
runtime tests
type inference tests
invalid usage type tests
documentation example
```

The example must actually compile.
README examples should preferably run as tests.

## 93. Tests

Every package must have unit tests.

Test especially thoroughly:

```text
Query AST
Query Builder
Type inference
Relations
Transactions
Command Bus
Policy enforcement
Schema Registry
OpenAPI generation
MCP permissions
Revision restore
Dynamic Resources
```

## 94. Type-level tests

Mandatory scenarios.

This must compile:

```ts
User.where('email', email)
```

This must not compile:

```ts
User.where('foobar', true)
```

Enum:

```ts
Post.where('status', 'published')
```

must compile.

```ts
Post.where('status', 'INVALID')
```

must not.

Relations:

```ts
Post.with('author')
```

is valid.

```ts
Post.with('somethingUnknown')
```

is a TypeScript error.

## 95. Integration tests

PostgreSQL integration tests must run against an isolated test database.

Cover:

```text
CRUD
transactions
rollback
relations
JSONB
migrations
soft deletes
concurrency
```

## 96. E2E

Playwright:

```text
Studio login
Create Resource Entry
Edit Resource Entry
Create Page
Add Block
Move Block
Edit Block
Preview
Publish
Restore Revision
API Explorer request
```

## 97. MCP E2E

Mandatory scenario:

```text
Agent authenticates

→ assemora.describe

→ reads page

→ proposes Block mutation

→ receives Change Set

→ applies Change Set

→ revision appears

→ restore revision

→ original page restored
```

## 98. OpenAPI contract test

A custom route:

```ts
route.post('/test', ...)
```

must appear automatically in:

```text
Schema Registry
/api/openapi.json
API Explorer
generated SDK
```

with no extra configuration.

## 99. Developer experience acceptance test

Creating a blog module must not require boilerplate framework code.

Target example:

```ts
export const Post = model('posts', {
  id: uuid().primary(),
  title: string(),
  content: text(),
  published: boolean().default(false),
  createdAt: timestamp().created(),
})

export const Posts = resource(Post, {
  title: text().required(),
  content: richText(),
  published: toggle(),
})

export default module('blog')
  .models(Post)
  .resources(Posts)
```

After the module is registered, the developer must get:

```text
DB schema
CRUD
Studio
REST
OpenAPI
SDK types
AI introspection
```

## 100. Claude Code: development control structure

The repository root must contain:

```text
CLAUDE.md
SPEC.md
```

`SPEC.md` is this document.
`CLAUDE.md` holds the short, non-negotiable rules.

## 101. CLAUDE.md — mandatory rules

Claude Code must receive approximately the following instructions:

```text
You are developing Assemora.

SPEC.md is the product and architecture source of truth.

Before changing architecture, read SPEC.md.

Never expose Drizzle, Fastify or internal adapter types
through the normal public API.

Public API priority:
beautiful > readable > type-safe > internally simple.

Do not introduce decorators into primary Assemora APIs.

Do not duplicate schemas between runtime validation,
OpenAPI, Studio and MCP.

All mutations must go through Command Bus.

Studio, REST and MCP must share application logic.

Do not bypass Policies.

Do not bypass Revisions for content mutations.

Do not add dependencies between packages that create cycles.

Do not use `any` to silence TypeScript.

Do not modify public APIs merely to make implementation easier.

Run tests, typecheck and lint before completing a task.

When architecture is ambiguous, prefer the solution
that preserves schema-first design and clean user-facing code.
```

## 102. Claude Code rules

Create `.claude/rules/`.

At minimum:

```text
architecture.md
public-api.md
data-layer.md
security.md
testing.md
studio.md
```

Rules must be short and concrete.
Do not copy the whole SPEC into every rule.

## 103. Claude Code subagents

Create project agents in `.claude/agents/`.

**architect** — checks:

```text
package boundaries
dependency direction
schema ownership
command architecture
```

**api-reviewer** — checks the public DX.
The main question: can this API be more beautiful without losing type safety?

**types-reviewer** — checks:

```text
generic inference
public types
invalid type paths
any leakage
```

**security-reviewer** — checks:

```text
auth
permissions
MCP
tokens
injection
dynamic schemas
```

**test-reviewer** — checks test coverage and acceptance criteria.

## 104. Claude Code hooks

Configure deterministic hooks.

After TypeScript files change: `formatter`

Before a significant task completes:

```text
lint
typecheck
targeted tests
```

Before a milestone completes:

```text
full test
build
```

Hooks must not fix architectural mistakes automatically.

## 105. ADR

Record every significant architectural decision in `docs/adr/`.

Example:

```text
0001-query-ast.md
0002-schema-registry.md
0003-drizzle-as-internal-adapter.md
0004-command-bus-for-mutations.md
```

Claude Code must not reverse a recorded ADR decision without an explicit new ADR.

## 106. Git discipline

Every task must produce a logically complete change.

Do not mix in one operation:

```text
refactoring
new feature
formatting the whole codebase
```

## 107. Implementation — phase 0

Repository foundation.

Create:

```text
pnpm workspace
Turborepo
TypeScript configs
lint
format
Vitest
package build pipeline
CLAUDE.md
SPEC.md
ADR
```

Acceptance:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

all pass.

## 108. Phase 1

Schema primitives + Core.

Implement:

```text
@assemora/schema
@assemora/core

Application
Module
Container
Context
Command Bus
Event Bus
Errors
```

Without PostgreSQL for now.

## 109. Phase 2

Assemora Data.

Implement:

```text
model()
columns
type inference
Query Builder
Query AST
model instances
scopes
relations metadata
```

Query execution may initially run through a memory test adapter.
The main goal of this phase is a beautiful API and type safety.
Do not connect Studio before the API stabilises.

## 110. Phase 3

PostgreSQL.

Implement:

```text
DatabaseAdapter
database-postgres
Drizzle translation
transactions
JSONB
relations
migrations
```

Add integration tests.

## 111. Phase 4

Resources.

Implement:

```text
Static Resource
Dynamic Resource
Field Registry
CRUD Commands
Filtering
Pagination
```

After this phase a resource must work without Studio, through tests and the API.

## 112. Phase 5

HTTP + Schema Registry + OpenAPI.

Implement:

```text
route()
HTTP adapter
validation
serialization
Schema Registry
REST CRUD
OpenAPI 3.1
API Explorer backend
SDK generator
```

Criterion: one route declaration generates runtime and docs.

## 113. Phase 6

Auth + security.

```text
users
sessions
roles
permissions
policies
API tokens
Agent identities
Agent tokens
```

All CRUD commands pass through policies.

## 114. Phase 7

Pages + blocks + revisions.

Implement:

```text
Pages
Block Registry
Block Tree
Draft
Publish
Revision
Restore
Optimistic concurrency
```

## 115. Phase 8

Studio.

First:

```text
Login
Navigation
Resource CRUD
Media
API Explorer
```

Then:

```text
Pages
Builder
Revision History
Users
Developer section
```

## 116. Phase 9

MCP / AI.

Implement after commands and the Schema Registry stabilise.

```text
describe
read tools
mutation tools
Agent permissions
Dry Run
Change Sets
Apply
Audit
```

MCP must not contain duplicate business logic.

## 117. Phase 10

CLI + starters + DX.

```text
create-assemora
assemora CLI
Next.js starter
React renderer
examples
documentation
```

## 118. The implementation order must not be changed without cause

In particular, do not start with the visual Studio.

First:

```text
Schema
Core
Data
Commands
Database
Resources
API
```

Only then the UI.

Reason: Studio and AI must be clients of a stable application layer, not the thing
that defines the backend architecture.

## 119. Definition of Done for Assemora Data

The data layer is done when this works:

```ts
const posts = await Post
  .published()
  .with('author')
  .latest()
  .take(10)
```

with:

```text
field type safety
scope type safety
relation type safety
Query AST
PostgreSQL adapter
transactions
relations
tests
```

and the developer never imports Drizzle.

## 120. Definition of Done for Resources

This code:

```ts
export const Articles = resource(Article, {
  title: text().required(),
  content: richText(),
})
```

must automatically produce:

```text
CRUD metadata
validation
Studio form schema
REST routes
OpenAPI schema
SDK type
MCP description
```

## 121. Definition of Done for the API

This endpoint:

```ts
route.post('/auth/login', {
  body: {
    email: email(),
    password: string().min(8),
  },

  response: {
    token: string(),
  },

  handler: login,
})
```

must:

```text
validate request
infer handler types
serialize response
appear in OpenAPI
appear in API Explorer
appear in generated SDK
```

with no additional schemas.

## 122. Definition of Done for AI

AI must be able, without reading source code, to:

```text
connect
describe project
discover available Blocks
read homepage
propose changes
preview diff
apply changes
publish
inspect revision
restore revision
```

## 123. Definition of Done for Studio

A user with no TypeScript knowledge must be able to:

```text
login
create content
edit content
create page
add block
edit block
reorder blocks
preview
publish
undo
upload media
```

## 124. Definition of Done for v1

Assemora v1 is complete when a new project can be created with:

```bash
pnpm create assemora demo
```

The developer adds:

```ts
export const Article = model('articles', {
  id: uuid().primary(),
  title: string(),
  published: boolean().default(false),
})
```

and a resource:

```ts
export const Articles = resource(Article, {
  title: text().required(),
  published: toggle(),
})
```

After migration the system automatically provides:

```text
PostgreSQL table

Assemora Data querying

Studio CRUD

REST CRUD

OpenAPI documentation

API Explorer

TypeScript SDK

MCP introspection
```

The developer then defines:

```ts
export const Hero = block('hero', {
  title: text(),
  subtitle: text(),
})
```

Studio lets a page be assembled from blocks.

An AI agent connects over MCP and performs:

```text
describe
get page
add block dry-run
show diff
apply
publish
```

Every change is recorded in:

```text
revision history
audit log
```

and can be undone.

This is the minimal complete demonstration of the Assemora philosophy.

## 125. Non-negotiable architectural constraints

Claude Code MUST NOT:

1. replace the Assemora model API with the Drizzle API directly;
2. make the Drizzle schema the public source of truth;
3. add TypeORM;
4. add NestJS;
5. build the primary API on decorators;
6. create separate AI business logic;
7. let MCP modify the database directly;
8. create separate schemas for Swagger;
9. create separate schemas for Studio and the API;
10. bypass the Command Bus for mutations;
11. bypass policies;
12. disable type safety to move faster;
13. use `any` as a systemic solution;
14. store pages as an HTML blob;
15. let AI generate raw SQL for standard CMS operations;
16. start a marketplace or e-commerce before v1 is complete;
17. change the public API merely because it makes the implementation easier.

## 126. Decision priority

When an architectural conflict arises, use this order:

```text
1. Correctness
2. Security
3. Beautiful public API
4. Readability
5. Type safety
6. Schema consistency
7. Agent usability
8. Developer experience
9. Performance
10. Internal implementation simplicity
```

Internal simplicity must not degrade the public API.

## 127. Final architecture

```text
                         ┌──────────────────┐
                         │ Assemora Studio  │
                         └────────┬─────────┘
                                  │
                                  │
       SDK ───────────────────────┤
       REST ──────────────────────┤
       CLI ───────────────────────┤
       MCP ───────────────────────┤
       AI ────────────────────────┤
                                  │
                                  ▼
                        ┌──────────────────┐
                        │ Application Core │
                        ├──────────────────┤
                        │ Commands         │
                        │ Queries          │
                        │ Policies         │
                        │ Events           │
                        └────────┬─────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
          Resources            Pages              Media
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 │
                              Models
                                 │
                          Assemora Data
                                 │
                            Query AST
                                 │
                       DatabaseAdapter
                                 │
                        PostgreSQL Adapter
                                 │
                              Drizzle
                                 │
                            PostgreSQL
```

In parallel:

```text
             Models / Resources / Blocks / Routes
                           │
                           ▼
                    Schema Registry
                           │
       ┌──────────┬────────┼────────┬─────────┐
       ▼          ▼        ▼        ▼         ▼
   Validation   Studio   OpenAPI    SDK       MCP
```

## 128. The core product formula

Assemora =

```text
Laravel-like developer experience
+
TypeScript type safety
+
Schema-first CMS
+
Visual Studio
+
Self-documenting API
+
Eloquent-like Data Layer
+
AI-native Command architecture
+
MCP
+
Revisions
```

The central idea must stay visible at every level of the system:

One beautiful TypeScript DSL must be understandable to a developer, executable by
the framework, renderable by Studio, documentable as an API and readable by AI
agents.

## 129. Claude Code starting instruction

At the start of development Claude Code must be given this task:

Read `SPEC.md` and `CLAUDE.md` completely before implementing anything.
Treat `SPEC.md` as the architecture source of truth.

Start with Phase 0 only.
Create the monorepo foundation, package boundaries, TypeScript configuration, test
infrastructure, architecture rules and ADR structure.
Do not implement Studio, MCP or PostgreSQL yet.

Before coding Phase 1, produce a short architecture review of the package dependency
graph.

During implementation, optimize public APIs for beauty, readability and type
inference. Do not expose implementation libraries through Assemora's normal public
API.

Every completed phase must pass build, lint, typecheck and tests before moving to the
next phase.

Do not skip phases to produce a visual demo sooner.

## 130. The first technical milestone

The first genuinely important milestone after bootstrap:

```ts
export const User = model('users', {
  id: uuid().primary(),
  email: string().unique(),
  active: boolean().default(true),
})

const users = await User
  .where('active', true)
  .latest()
  .take(10)
```

with:

```text
User field types inferred
where fields type-safe
values type-safe
Query Builder immutable
Query AST generated
no Drizzle dependency in public API
invalid fields rejected by TypeScript
```

Until this API looks and feels right, do not move on to the CMS or Studio.

The Assemora Data API is the foundation of the product.
