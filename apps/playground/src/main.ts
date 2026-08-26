/**
 * A running Assemora application (SPEC.md §9).
 *
 * This is what an application file looks like once the framework is doing its job:
 * modules in, ports registered, server up. Everything the API offers — CRUD, OpenAPI,
 * introspection, policies, revisions — follows from the declarations in the modules,
 * not from anything written here.
 */
import { audit, auditModule } from '@assemora/audit'
import { auth, policies, resolveActor } from '@assemora/auth'
import { createApplication, createLogger } from '@assemora/core'
import { dataTransactions, useAdapter } from '@assemora/data'
import { createMemoryAdapter } from '@assemora/database'
import { createHttpServer, route } from '@assemora/http'
import { localStorage, media, useStorage } from '@assemora/media'
import { introspectionRoute, openApiRoute } from '@assemora/openapi'
import { pages } from '@assemora/pages'
import { revisions, revisionsModule } from '@assemora/revisions'
import { string } from '@assemora/schema'

import { authRoutes, CSRF_COOKIE } from './auth-routes.ts'
import { blog, Faq, Hero, Section } from './blog.ts'
import { mediaRoutes } from './media-routes.ts'
import { previewRoutes } from './preview-routes.ts'
import { seed } from './seed.ts'

const PORT = Number(process.env.PORT ?? 4000)
const STUDIO_ORIGIN = process.env.STUDIO_ORIGIN ?? 'http://localhost:5173'
const MEDIA_ROOT = new URL('../storage/', import.meta.url).pathname

useAdapter(createMemoryAdapter())
useStorage(localStorage({ root: MEDIA_ROOT, baseUrl: '/api/media' }))

const app = createApplication({
  modules: [
    auth(),
    blog(),
    pages({ blocks: [Hero, Section, Faq] }),
    media(),
    revisionsModule(),
    auditModule(),
  ],
  authorization: policies(),
  transactions: dataTransactions(),
  revisions: revisions(),
  audit: audit(),
  logger: createLogger(),
})

const health = route.get('/health', {
  description: 'Liveness',
  tags: ['developer'],
  response: { status: string() },
  handler: () => ({ status: 'ok' }),
})

const server = createHttpServer({
  registry: app.registry,
  commands: app.commands,
  queries: app.queries,
  logger: app.logger,
  resolveActor,
  cors: { origins: [STUDIO_ORIGIN], credentials: true },
  rateLimit: { max: 600, windowMs: 60_000 },
  csrf: { cookie: CSRF_COOKIE },
  // The builder canvas frames `/preview`, and nothing else may (SPEC.md §59, §85).
  security: { frameAncestors: [STUDIO_ORIGIN] },
})

server
  .mountRegistered()
  .mountResources()
  .mountCommands()
  .mountQueries()
  .mount(
    ...authRoutes(app.commands),
    ...mediaRoutes(),
    ...previewRoutes(),
    health,
    openApiRoute({
      registry: app.registry,
      info: {
        title: 'Assemora playground',
        version: '0.0.0',
        description: 'A blog, built the way the framework intends',
      },
    }),
    introspectionRoute(app.registry),
  )

await app.boot()
await seed(app)

console.log(`[playground] listening on ${await server.listen(PORT)}`)
console.log(`[playground] studio origin allowed: ${STUDIO_ORIGIN}`)
