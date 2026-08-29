/**
 * `assemora()` — the call SPEC.md §9 writes (ADR-0022).
 *
 * ```ts
 * export default assemora({
 *   database: postgres(),
 *   modules: [auth(), pages({ blocks }), media(), blog()],
 *   studio: true,
 *   api: true,
 *   mcp: true,
 * })
 * ```
 *
 * Everything in this file either constructs something a package below it exports, or
 * connects two packages that are forbidden to know about each other: the login route
 * over the auth commands, the media URL over the storage driver, the MCP endpoint
 * over the buses. There is no business logic here, and there is nowhere for any to
 * hide — a command, a model or a policy would belong to the feature it describes.
 *
 * Nothing here is asynchronous. `assemora()` returns with the Schema Registry already
 * complete for everything a source file declares, which is what lets `export default
 * assemora({…})` be a top-level statement and what lets `assemora routes` describe an
 * application without starting a server. The one thing that arrives later is a
 * resource the application *grew* — a collection, read out of the database while the
 * modules boot — and `boot()` mounts what it finds (SPEC.md §37).
 */
import { audit, auditModule } from '@assemora/audit'
import { policies, resolveActor } from '@assemora/auth'
import { changeSets } from '@assemora/change-sets'
import {
  type Application,
  ConfigurationError,
  createApplication,
  createLogger,
  type ErrorTrackingPort,
  type Logger,
  logErrors,
  type ModuleBuilder,
} from '@assemora/core'
import { clearSlowQueryLog, dataTransactions, useAdapter, useSlowQueryLog } from '@assemora/data'
import { commandEndpoints, commandRoutes, createHttpServer, type HttpServer } from '@assemora/http'
import { mcp } from '@assemora/mcp'
import { currentStorage, localStorage, type StorageDriver, useStorage } from '@assemora/media'
import { introspectionRoute, openApiRoute } from '@assemora/openapi'
import { revisions, revisionsModule } from '@assemora/revisions'
import { theme } from '@assemora/theme'

import { authRoutes, CSRF_COOKIE } from './auth-routes.js'
import { healthRoutes, type Readiness } from './health-routes.js'
import { type MountedMcp, mcpRoutes } from './mcp-routes.js'
import { mediaRoutes } from './media-routes.js'
import {
  type AssemoraOptions,
  DEFAULT_PORT,
  defaultMediaRoot,
  type JobWorker,
  type MediaOptions,
  type ResolvedApi,
  resolve,
  type Settings,
} from './options.js'
import { mountPreview } from './preview-routes.js'
import { reportedOnce } from './reporting.js'
import { mountStudio } from './studio.js'
import { themeRoutes } from './theme-routes.js'

/**
 * A built application, and the server in front of it.
 *
 * `app` is the application, un-booted, and it is what a config file hands the CLI.
 * `listen()` is the other half — one entry point for the process that actually
 * serves, which a config file has no place to call. Both reach the same boot.
 */
export type AssemoraApplication = {
  /**
   * The application, with this handle's own lifecycle on it.
   *
   * It is what `assemora.config.ts` hands the CLI: the CLI boots the project itself
   * and reads its registry, and must not have to know the application was assembled
   * by this function (ADR-0021). Its `boot()` and `shutdown()` are this handle's, so
   * booting through it mounts Studio and the preview like `listen()` does, and
   * stopping through it closes the server and the database — two paths on to one
   * lifecycle rather than two lifecycles that disagree.
   */
  readonly app: Application
  /** `undefined` when `api: false`. */
  readonly server: HttpServer | undefined
  /**
   * Boots the application and mounts what needs a filesystem.
   *
   * The same boot, however often it is asked for and through whichever half of this
   * handle, so seeding between booting and listening does not have to thread a flag
   * and a CLI that boots what the config gave it does not collide with `listen()`.
   */
  boot(): Promise<Application>
  /** Boots, then serves. Answers with the address it is listening on. */
  listen(port?: number, host?: string): Promise<string>
  /**
   * Boots, then works: this process starts pulling jobs off the queue (SPEC.md §82).
   *
   * The counterpart of `listen()`, and separate from it on purpose. One application
   * definition has to serve two process shapes — the one that answers requests and the
   * one that runs the work those requests schedule — and which of them a process is, is
   * a property of its entry point rather than of the application. A process that is
   * both calls both; a worker-only process calls this and nothing else.
   *
   * It is deliberately not part of `boot()`. The CLI boots this very application to
   * answer `assemora routes` (ADR-0021), and a question about routes must not attach a
   * consumer to the production queue and start running jobs out of it.
   */
  work(): Promise<void>
  /**
   * Stops serving, stops working, stops the modules, closes the database. In that order.
   *
   * Every step is attempted even when an earlier one fails, because the database is
   * the last of them and a connection pool nobody closed outlives the process that
   * forgot it. What went wrong is thrown once everything has been tried.
   */
  shutdown(): Promise<void>
}

/** `PORT` is universal enough to read; everything else arrives as an option. */
const defaultPort = (): number => {
  const declared = Number(process.env.PORT)

  return Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_PORT
}

/**
 * An adapter's own `close()`, when it has one.
 *
 * Neither `DatabaseAdapter` nor `QueuePort` declares one — an in-memory adapter and a
 * queue that runs jobs here have nothing to close — and the real ones do, because a
 * connection pool outlives the process that forgets it. Asking rather than requiring is
 * what lets both interfaces stay the narrow things they are.
 */
const closable = (adapter: unknown): { close(): Promise<void> } | undefined => {
  const candidate = adapter as { close?: unknown } | null | undefined

  return typeof candidate?.close === 'function'
    ? (candidate as { close(): Promise<void> })
    : undefined
}

/**
 * The driver, built so that its URLs and the mounted media routes agree.
 *
 * `media.list` and `media.upload` answer with `driver.url(path)`, and the bytes are
 * served from `<prefix>/media`. Two strings kept the same by hand is how every image
 * in Studio becomes a 404.
 *
 * With nothing said at all it is still a local driver, pointed at the project's own
 * `storage/media`: SPEC.md §9 lists `media()` among the modules and passes no second
 * option, and the reference configuration of the specification has to be one that runs.
 */
const storageFor = (media: MediaOptions | undefined, prefix: string): StorageDriver =>
  media !== undefined && 'storage' in media
    ? media.storage
    : localStorage({ root: media?.root ?? defaultMediaRoot(), baseUrl: `${prefix}/media` })

/**
 * The origin a stored file is rendered from, when it is not this one (SPEC.md §63).
 *
 * S3-compatible storage is mandatory in v1, and a bucket or a CDN is a different
 * origin — so `img-src 'self'` blocks every image in Studio and in the preview. The
 * policy has to name it, and this is where the name comes from: the driver the
 * application configured, asked what URL it hands a browser. Nobody types this string
 * into an option, which is what keeps it from becoming a general way to widen the
 * policy.
 */
const mediaOriginOf = (driver: StorageDriver, logger: Logger): string | undefined => {
  const url = (() => {
    try {
      // Any key will do: only the origin of the answer is read, and `url()` is a pure
      // string operation for both drivers that ship (the S3 one signs, in memory).
      return driver.url('assemora-probe.png')
    } catch {
      return undefined
    }
  })()

  if (url === undefined) return undefined

  const origin = (() => {
    try {
      return new URL(url).origin
    } catch {
      // A relative URL is this origin, which `'self'` already covers.
      return undefined
    }
  })()

  if (origin === undefined) return undefined

  if (!ORIGIN.test(origin)) {
    // Never assembled from a string this package has not proved is an origin: a CSP
    // source list is space-separated and `;`-terminated, so anything else would append
    // directives to the policy (SPEC.md §85).
    logger.warn('The media driver serves from something that is not a browser origin', {
      origin,
      effect: 'the content security policy is left as it is, and those files may not render',
    })

    return undefined
  }

  return origin
}

/**
 * Who may frame this application's pages (SPEC.md §59, §85).
 *
 * The only frameable document here is the preview, and the only thing that may frame
 * it is Studio: `'self'`, which covers the ordinary deployment where Studio is served
 * beside the API, plus whatever `frontend.framedBy` names for a split-origin setup.
 * With no frontend there is nothing to frame, and the policy stays `'none'`.
 *
 * `origins` is deliberately not consulted. It answers "who may call this API", and an
 * origin allowed to fetch JSON has not been allowed to put the logged-in admin UI in
 * an iframe of its own.
 */
const frameAncestorsFor = (settings: Settings): readonly string[] =>
  settings.frontend === undefined ? [] : ["'self'", ...settings.frontend.framedBy]

/**
 * An origin, and nothing else.
 *
 * These strings become a CORS allow-list and a `frame-ancestors` source list. A CSP
 * source list is separated by spaces and terminated by `;`, so an entry carrying
 * either would append directives to the policy this package promises to send
 * (SPEC.md §85).
 */
const ORIGIN = /^https?:\/\/([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(:\d{1,5})?$/i

/** A storage driver the application registered before calling this function. */
const hasStorage = (): boolean => {
  try {
    currentStorage()

    return true
  } catch {
    return false
  }
}

/** A configuration that cannot work, refused where it was written. */
const refuseImpossible = (
  options: AssemoraOptions,
  settings: Settings,
  declared: ReadonlySet<string>,
): void => {
  const fail = (message: string): never => {
    throw new ConfigurationError(message)
  }

  const refuseUnlessOrigins = (values: readonly string[], option: string): void => {
    for (const value of values) {
      if (value === '*') {
        fail(
          `"${option}" contains "*", which is not an origin. CORS is configured, not waved through (SPEC.md §85), and a list holding "*" is matched literally: it would allow no cross-origin call at all while opening the frame policy to everybody. List the origins instead.`,
        )
      }

      if (!ORIGIN.test(value)) {
        fail(
          `"${value}" is not a browser origin. Write "${option}" entries as scheme://host[:port] — no path, no wildcard, and nothing that could add directives to the content security policy this application sends.`,
        )
      }
    }
  }

  refuseUnlessOrigins(settings.origins, 'origins')
  refuseUnlessOrigins(settings.frontend?.framedBy ?? [], 'frontend.framedBy')

  if (settings.api === undefined) {
    if (settings.studio !== undefined) {
      fail(
        'Studio is a client of this application\'s API, and "api: false" leaves it nothing to talk to. Set "api: true", or "studio: false".',
      )
    }

    if (settings.mcp !== undefined) {
      fail(
        'The MCP endpoint is an API route, and "api: false" means there are no routes. Set "api: true", or "mcp: false".',
      )
    }

    if (settings.frontend !== undefined) {
      fail(
        'The frontend is served by the API server, and "api: false" means there is none. Set "api: true", or drop "frontend".',
      )
    }

    // Either an explicit local root, or the default one the media module gets when
    // nothing was said: both build URLs into routes that "api: false" never mounts.
    if (
      (options.media !== undefined && 'root' in options.media) ||
      (options.media === undefined && declared.has('media') && !hasStorage())
    ) {
      fail(
        '"media: { root }" builds URLs that point at the media routes this application serves, and "api: false" means it serves none — every stored URL would point at nothing. Pass a driver of your own with "media: { storage }", or set "api: true".',
      )
    }
  }

  if (
    settings.studio !== undefined &&
    settings.frontend !== undefined &&
    settings.studio.path === settings.frontend.path
  ) {
    fail(
      `Studio and the frontend are both asked for at "${settings.studio.path}", and one origin cannot serve two bundles from one path. Give one of them a path of its own.`,
    )
  }

  if (settings.studio !== undefined && !declared.has('auth')) {
    fail(
      'Studio signs in through /auth/login, which the auth module provides. Add auth() to "modules", or set "studio: false".',
    )
  }

  if (settings.mcp !== undefined && !declared.has('auth')) {
    fail(
      'The MCP endpoint identifies an agent by its token, which the auth module resolves. Add auth() to "modules", or set "mcp: false".',
    )
  }

  if (settings.mcp?.mutations === 'change-set' && !settings.changeSets) {
    fail(
      'An MCP mutation is a proposal, and a proposal is a change set (SPEC.md §75). Set "changeSets: true", or "mcp: { mutations: \'direct\' }".',
    )
  }
}

/**
 * The four modules a developer should not have to list, plus the one a switch asks
 * for.
 *
 * Without revisions and audit an application silently throws its history away, and
 * without change sets an agent's first write is an unknown command. The theme is
 * there for a quieter reason: §61's controls have been token *names* since phase 8,
 * and until something owns what a name means, every project writes the same
 * hand-rolled `theme.css` — the arbitrary global CSS SPEC.md §62 exists to replace
 * (ADR-0024). A module the application listed itself wins: `createApplication`
 * refuses a name twice, and `auth({ policies: [...] })` must not be replaced by a
 * bare one.
 */
const infrastructureFor = (settings: Settings, declared: ReadonlySet<string>): ModuleBuilder[] => {
  const modules: ModuleBuilder[] = []

  if (settings.revisions && !declared.has('revisions')) modules.push(revisionsModule())
  if (settings.audit && !declared.has('audit')) modules.push(auditModule())
  if (settings.changeSets && !declared.has('changesets')) modules.push(changeSets())
  if (settings.theme && !declared.has('theme')) modules.push(theme())

  if (settings.mcp !== undefined && !declared.has('mcp')) {
    modules.push(
      mcp({
        project: {
          name: settings.project.name,
          ...(settings.project.description === undefined
            ? {}
            : { description: settings.project.description }),
        },
      }),
    )
  }

  return modules
}

type Served = {
  readonly server: HttpServer
  readonly mcp: MountedMcp | undefined
  /**
   * REST CRUD for the resources that were not there when this server was built.
   *
   * The registry's `resources` section is complete for everything a source file
   * declares by the time `assemora()` returns, and a module's boot hook adds to it
   * *afterwards*: a collection is a row in `assemora_resource_definitions`, read and
   * registered while the resources module boots (SPEC.md §37). The first
   * `mountResources()` therefore knew every resource declared in TypeScript and no
   * collection at all.
   *
   * Called by `boot()`, once the hooks have run — a second pass rather than a boot
   * moved in front of the mount, because everything else about the server is settled
   * before `assemora()` returns: a version that collides with an address already served
   * is a configuration mistake, and it is worth refusing where it was written rather
   * than one boot later. Fastify has taken no route yet, so a collection restored from
   * the database gets endpoints of its own, exactly as a static resource does.
   */
  mountArrivals(): void
}

/**
 * The server, and everything mounted on it.
 *
 * A module that is not registered gets no routes: without auth() there is no login
 * route and no actor resolver, so every request is anonymous and — because
 * authorization denies by default — refused. That is the honest outcome of an
 * application that has not set up authentication.
 */
const serve = (
  app: Application,
  settings: Settings,
  api: ResolvedApi,
  modules: ReadonlySet<string>,
  readiness: () => Readiness,
  errors: ErrorTrackingPort,
): Served => {
  // Read off the driver this application actually configured, so a bucket or a CDN is
  // named in `img-src` and nothing else is (SPEC.md §63, §85).
  const mediaOrigin = hasStorage() ? mediaOriginOf(currentStorage(), app.logger) : undefined

  const server = createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: app.logger,
    // The same instance the buses were given: one failure is one report, whether it
    // was thrown inside a command or by the layer in front of it (SPEC.md §88).
    errors,
    requestLog:
      settings.observability.slowRequestMs === false
        ? false
        : { slowMs: settings.observability.slowRequestMs },
    prefix: api.prefix,
    ...(modules.has('auth') ? { resolveActor } : {}),
    // Registered only when there is something to allow, and always as a list. CORS is
    // configured, not waved through (SPEC.md §85).
    ...(settings.origins.length === 0
      ? {}
      : { cors: { origins: settings.origins, credentials: true } }),
    rateLimit: api.rateLimit,
    bodyLimit: api.bodyLimit,
    // Passed unconditionally: the option is optional in createHttpServer, and leaving
    // it out turns CSRF off entirely (SPEC.md §85).
    csrf: { cookie: CSRF_COOKIE },
    security: {
      frameAncestors: frameAncestorsFor(settings),
      ...(mediaOrigin === undefined ? {} : { mediaSources: [mediaOrigin] }),
    },
  })

  const endpoint =
    settings.mcp === undefined
      ? undefined
      : mcpRoutes({
          registry: app.registry,
          commands: app.commands,
          queries: app.queries,
          path: settings.mcp.path,
          name: settings.project.name,
          version: settings.project.version,
          mutations: settings.mcp.mutations,
          rateLimit: settings.mcp.rateLimit,
        })

  server.mountRegistered()

  if (api.crud) server.mountResources()

  // After the bare addresses, so a version that collides with one is refused naming
  // both. A version adds an address; it cannot take the module's own away, because
  // `.routes()` described that one when the application was created (SPEC.md §47).
  for (const [name, define] of Object.entries(api.versions)) server.version(name, define)

  // Every command that did not say a route written for it is the only way in.
  // Mounting the rest is safe by construction — the bus validates and authorizes
  // first, and authorization denies by default — and the exceptions exclude
  // themselves, because `commandEndpoints()` reads the declaration off the registry.
  // A list of names kept here would have gone stale the moment a package added a
  // publicly authorized command (SPEC.md §85).
  // The upload is the one command whose input carries a file, so it is the one
  // endpoint that is sized for one. Every other command keeps the server's own ceiling
  // (SPEC.md §85).
  server.mount(
    ...commandRoutes(commandEndpoints(app.registry), app.commands, {
      bodyLimit: { 'media.upload': settings.uploadBytes },
    }),
  )

  server.mountQueries()

  server.mount(
    ...healthRoutes(readiness),
    ...(modules.has('auth') ? authRoutes(app.commands, settings.session) : []),
    ...(modules.has('media') ? mediaRoutes(app.queries) : []),
    // Unconditional, and asked about the module rather than about the option: a site
    // with no editable theme still needs the tokens its blocks render against, and an
    // application that registered `theme()` itself has an editable one whatever the
    // switch says (ADR-0024).
    ...themeRoutes(api.prefix, modules.has('theme'), app.logger),
    ...(endpoint?.routes ?? []),
    ...(api.documentation
      ? [
          openApiRoute({
            registry: app.registry,
            info: {
              title: settings.project.name,
              version: settings.project.version,
              ...(settings.project.description === undefined
                ? {}
                : { description: settings.project.description }),
            },
            prefix: api.prefix,
          }),
          // Authenticated unless the application said otherwise: the snapshot is the
          // internal shape of the application, not the API a caller may use, and the
          // API Explorer that reads it is behind Studio's login (SPEC.md §45, §85).
          introspectionRoute(app.registry, { public: api.introspection === 'public' }),
        ]
      : []),
  )

  return {
    server,
    mcp: endpoint,

    mountArrivals() {
      // Not published under a version: `api.resource(name)` names what a version
      // carries, and a collection nobody wrote into that callback is not in it
      // (SPEC.md §47). `mountResources()` mounts what it has not mounted before, so
      // this is the same call as the one above and not a second kind of mounting.
      if (api.crud) server.mountResources()
    },
  }
}

export const assemora = (options: AssemoraOptions): AssemoraApplication => {
  const settings = resolve(options)
  const declared = new Set((options.modules ?? []).map((builder) => builder.name))
  const logger: Logger = options.logger ?? createLogger()

  refuseImpossible(options, settings, declared)

  if (!settings.session.secure) {
    logger.warn('Session cookies are issued without Secure, so they may travel over plain http', {
      option: 'session: { secure: false }',
    })
  }

  if (settings.studio !== undefined && (settings.frontend?.framedBy.length ?? 0) > 0) {
    // One content security policy is sent for the whole origin, so the origins that
    // may frame the preview may frame the Studio document served beside it.
    logger.warn('The origins allowed to frame the preview may also frame Studio', {
      framedBy: settings.frontend?.framedBy,
      studio: settings.studio.path,
    })
  }

  // One reporter, held here rather than read off the application: the composition root
  // that wires Sentry is the same one that wires the server, and both halves of
  // SPEC.md §88 have to report an incident to the same place (ADR-0022).
  //
  // And one report per failure. Wiring the layers to a single port is what makes a
  // failure reported twice possible at all — one layer catching what the layer inside
  // it already reported — so the wiring is where that is answered.
  const errors: ErrorTrackingPort = reportedOnce(settings.observability.errors ?? logErrors(logger))

  // These are process-wide, and every one of them is set before anything is
  // registered: a module's registration is user code, and user code may query.
  useAdapter(options.database)

  // Registered unless it was switched off, so §88's slow query log is something an
  // application has rather than something it remembers to ask for. It writes the shape
  // of a query and never its values — a `where` carries whatever the caller passed.
  //
  // Switched off it clears rather than skips, for the reason `useAdapter` above
  // overwrites: this application decides what the process does, and inheriting a log
  // from whoever built one first is not a decision anybody made.
  if (settings.observability.slowQueryMs === false) clearSlowQueryLog()
  else useSlowQueryLog(logger, { slowerThanMs: settings.observability.slowQueryMs })

  // The module needs somewhere to put bytes whether or not the application said where
  // (SPEC.md §9). A driver registered with useStorage() before this call is left
  // alone, because an application that built its own has already answered.
  const needsDefaultStorage = options.media === undefined && declared.has('media') && !hasStorage()

  if (options.media !== undefined || needsDefaultStorage) {
    // The prefix is always there when the driver's URLs need it: a local root without
    // an API is refused above, and a driver the application built decides its own URLs.
    useStorage(storageFor(options.media, settings.api?.prefix ?? ''))
  }

  if (needsDefaultStorage) {
    // Not a refusal, and not silence either. A container replaces this directory on
    // the next deploy, so the application that meant S3 has to be able to see that it
    // did not get it (SPEC.md §63).
    logger.warn('Uploaded files are stored on this process’s own disk', {
      root: defaultMediaRoot(),
      option: 'media: { root } for another directory, media: { storage } for a bucket',
    })
  }

  const app = createApplication({
    modules: [...(options.modules ?? []), ...infrastructureFor(settings, declared)],
    // Never permitAll(). Core denies by default, and the umbrella must not be the
    // thing that opens the door (ADR-0022); an application that wants the blunt
    // answer writes it in its own source, with createApplication().
    authorization: policies(),
    transactions: dataTransactions(),
    // Switched off, the port goes with the module: nothing should write history into
    // a table that is no longer part of the schema.
    ...(settings.revisions ? { revisions: revisions() } : {}),
    ...(settings.audit ? { audit: audit() } : {}),
    // Left out, core runs jobs in this process rather than discarding them: a missing
    // revision is an absence, a missing job is a lie (ADR-0023).
    ...(options.jobs === undefined ? {} : { queue: options.jobs.queue }),
    errors,
    logger,
  })

  if (options.jobs === undefined && app.jobs.names().length > 0) {
    // Not a refusal, and not silence either — the same bargain the default media root
    // makes. In-process is a correct answer for a small deployment and the only honest
    // one for development, but it is not the answer a durable queue gives, and an
    // application whose work must survive a restart has to be able to see that it did
    // not get one (SPEC.md §82).
    logger.warn('Jobs run inside the process that schedules them', {
      jobs: app.jobs.names(),
      effect: 'a restart loses what is in flight, and a slow job slows the request',
      option: 'jobs: { queue } for a durable queue',
    })
  }

  let booting: Promise<Application> | undefined
  let working: Promise<void> | undefined
  let worker: JobWorker | undefined
  let stopped = false
  let booted = false

  // `app.modules` rather than what was passed: it is the list after the umbrella added
  // what a developer should not have to list.
  const registered = new Set(app.modules)
  const served =
    settings.api === undefined
      ? undefined
      : serve(
          app,
          settings,
          settings.api,
          registered,
          // Booting is one half of being ready and the modules are the other, and this
          // is the only place that can see both: `booted` covers what this file mounts
          // after the hooks have run, and `notStarted` is what core collected while
          // they did (SPEC.md §88).
          () => ({ booted, notStarted: app.notStarted }),
          errors,
        )

  /**
   * One boot, whichever half of the handle asks for it.
   *
   * The CLI boots the application the config gave it (ADR-0021) and the process that
   * serves calls `listen()`. Core refuses a second boot, so if those were two
   * different calls the second would fail — and the first would leave an application
   * with no Studio, no preview and nothing saying why.
   */
  const boot = (): Promise<Application> => {
    booting ??= (async () => {
      await app.boot()

      // A resource can *arrive* during boot: a collection is a row, read and registered
      // by the resources module's boot hook, and the snapshot this server was built
      // from has none of them (SPEC.md §37, §43). Fastify refuses a route added after
      // the instance is ready, and nothing has readied this one yet.
      served?.mountArrivals()

      // Assets wait for boot because they need a filesystem, and Studio because it is
      // an import this package deliberately does not declare. Fastify refuses a route
      // added after it is ready, so both happen before anything listens or injects.
      if (served !== undefined) {
        if (settings.studio !== undefined) {
          await mountStudio(served.server, settings.studio, logger)
        }

        if (settings.frontend !== undefined) {
          await mountPreview(served.server, settings.frontend, logger)
        }
      }

      booted = true

      return facade
    })()

    return booting
  }

  /**
   * One worker, whichever entry point asks for it, and none until one does.
   *
   * The worker is built here rather than when the application was declared, so that
   * importing the config file — which is all `assemora routes` does — connects to
   * nothing (ADR-0021).
   */
  const work = (): Promise<void> => {
    working ??= (async () => {
      const build = options.jobs?.worker

      if (build === undefined) {
        throw new ConfigurationError(
          'This application declares no job worker, so there is nothing for work() to run. Pass jobs: { queue, worker } — worker is a function, so that importing this file does not start one.',
        )
      }

      await boot()

      worker = await build()

      logger.info('Working the job queue')
    })()

    return working
  }

  const shutdown = async (): Promise<void> => {
    if (stopped) return

    const failures: unknown[] = []

    /** Every step is tried: one that throws must not strand the ones behind it. */
    const attempt = async (step: string, stop: () => Promise<void>): Promise<void> => {
      try {
        await stop()
      } catch (error) {
        failures.push(error)
        logger.error('An application did not stop cleanly', {
          step,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // The server first, so no request arrives at a module that has already stopped.
    await attempt('mcp', async () => {
      await served?.mcp?.close()
    })

    if (served !== undefined) {
      await attempt('server', async () => {
        // Fastify will not close a server it has never made ready, and an application
        // that was built and then abandoned — a CLI command that only read the
        // registry — has never made one. Readying it is what lets it be closed.
        await served.server.ready()
        await served.server.close()
      })
    }

    // Then the other intake. A worker stops by refusing new jobs and waiting for the
    // ones already running, and those jobs execute commands — so it has to stop while
    // the modules and the database are still there to run them. The other order
    // strands a job halfway through the work it was queued to finish.
    await attempt('worker', async () => {
      // Started, or still starting. A shutdown that raced the first job would otherwise
      // leave a worker holding the very connection this function came to close, and the
      // failure of a start nobody awaited belongs to whoever called work().
      await working?.catch(() => undefined)
      await worker?.stop()
    })

    // And then its connections, once nothing is left that could push on them or pull
    // from them. A queue adapter is only required to push, so this asks.
    await attempt('queue', async () => {
      await closable(options.jobs?.queue)?.close()
    })

    await attempt('modules', () => app.shutdown())
    await attempt('database', async () => {
      await closable(options.database)?.close()
    })

    // Set once everything has been attempted, not before: a caller whose first
    // shutdown failed would otherwise be told the second one had nothing left to do.
    stopped = true

    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'This application did not stop cleanly')
    }
  }

  /**
   * The application, carrying this handle's lifecycle.
   *
   * `assemora.config.ts` hands this to the CLI, which boots it and later stops it
   * (ADR-0021). Delegating those two to the handle is what makes the CLI's boot the
   * same boot as `listen()`'s, and what closes the database pool the CLI opened.
   */
  const facade: Application = {
    container: app.container,
    commands: app.commands,
    queries: app.queries,
    jobs: app.jobs,
    events: app.events,
    registry: app.registry,
    logger: app.logger,
    modules: app.modules,
    // A getter, like core's: it is written while the modules boot, and this facade is
    // built before they do.
    get notStarted() {
      return app.notStarted
    },
    boot,
    shutdown,
    run: (init, operation) => app.run(init, operation),
    contextFor: (init) => app.contextFor(init),
  }

  return {
    app: facade,
    server: served?.server,
    boot,
    work,
    shutdown,

    async listen(port = defaultPort(), host) {
      if (served === undefined) {
        throw new ConfigurationError(
          'This application was built with "api: false", so there is no server to listen with.',
        )
      }

      await boot()

      // The one caller that knows what a module which did not start means. Core warns
      // that it happened, because it cannot tell `db:generate` from a deployment; this
      // is the process that was started to serve, and for it the answer is that it
      // never will — `/ready` refuses from here on, so the process listens and stays
      // out of the load balancer until somebody fixes it (SPEC.md §88).
      if (app.notStarted.length > 0) {
        logger.error('This application is serving but will not report ready', {
          notStarted: app.notStarted,
          endpoint: `${settings.api?.prefix ?? ''}/ready`,
        })
      }

      return served.server.listen(port, host)
    },
  }
}
