/**
 * What an application says, and what the umbrella decides for it (SPEC.md §9).
 *
 * Every option here is either something only the application can know — where its
 * database is, where its files live, which origins may reach it — or a switch whose
 * blunt setting deserves to be visible in the project's own source. Everything else
 * is a default, and the defaults are the secure ones (ADR-0022).
 *
 * There is deliberately no option for `authorization`, `transactions`, `revisions` or
 * `audit`. Offering the first would mean offering `permitAll()` as a keyword
 * argument; the other three have one implementation each, and the command pipeline
 * is broken without them. An application that wants a different answer builds its
 * own with `createApplication()`, which stays fully supported.
 */
import { resolve as resolvePath } from 'node:path'

import type { ErrorTrackingPort, Logger, ModuleBuilder, QueuePort } from '@assemora/core'
import { DEFAULT_SLOW_QUERY_MS } from '@assemora/data'
import type { DatabaseAdapter } from '@assemora/database'
import {
  type ApiVersion,
  DEFAULT_BODY_LIMIT,
  SLOW_REQUEST_MS,
  type VersionDeclaration,
} from '@assemora/http'
import type { MutationMode } from '@assemora/mcp'
import type { StorageDriver } from '@assemora/media'

/** Requests allowed per client, per window. */
export type RateWindow = {
  readonly max: number
  readonly windowMs: number
}

/**
 * How the project describes itself.
 *
 * Written once, because three subsystems ask the same question: OpenAPI needs a title
 * and a version (SPEC.md §44), the MCP server announces a name and a version over the
 * protocol, and `assemora.describe` tells an agent which project it is looking at
 * (SPEC.md §71). Three copies is how they drift.
 */
export type ProjectOptions = {
  readonly name?: string
  readonly version?: string
  readonly description?: string
}

export type ApiOptions = {
  /** Everything is mounted below this. `/api` by default (SPEC.md §43). */
  readonly prefix?: string
  /** 600 a minute by default (SPEC.md §85). Counted in this process only. */
  readonly rateLimit?: RateWindow
  /**
   * The largest body any endpoint accepts, in bytes. 1 MiB by default (SPEC.md §85).
   *
   * This is the floor every address shares. The one endpoint that needs more is the
   * media upload, and it has `media: { maxUploadBytes }` of its own precisely so that
   * a site whose content is photographs does not have to hand the same room to every
   * form it serves.
   */
  readonly bodyLimit?: number
  /** Generated REST CRUD for every resource (SPEC.md §43). On by default. */
  readonly crud?: boolean
  /** `/openapi.json` and `/_introspection` (SPEC.md §44, §45). On by default. */
  readonly documentation?: boolean
  /**
   * Who may read `/_introspection`. `authenticated`.
   *
   * The snapshot is not the API a caller may use — that is `/openapi.json`, with the
   * hidden fields already gone — but the registry itself: every model, every column of
   * the auth schema, every command and query, including the ones this caller could
   * never reach. The API Explorer that reads it sits behind Studio's login, and every
   * other read on this surface denies by default (SPEC.md §85).
   *
   * `public` is the deliberate opt-out, for the application whose description is meant
   * to be open — a sandbox, a documentation site.
   */
  readonly introspection?: 'authenticated' | 'public'
  /**
   * The API versions this application publishes (SPEC.md §47).
   *
   * ```ts
   * api: {
   *   crud: false,
   *   versions: {
   *     v1: (api) => api.resource(Articles),
   *     v2: (api) => api.resource(Articles, { except: ['list'] }).mount(listArticlesV2),
   *   },
   * }
   * ```
   *
   * Declared here rather than reached for through the returned server, because it is
   * part of the shape of the API and everything else about that is here. Pair it with
   * `crud: false` for resources that should answer only under a version — otherwise
   * every resource keeps its bare address as well, which is the honest outcome: that
   * address is described whether or not a version exists.
   */
  readonly versions?: Readonly<Record<string, (api: ApiVersion) => VersionDeclaration>>
}

export type StudioOptions = {
  /**
   * The built bundle. `@assemora/studio` by default, loaded at run time.
   *
   * Set it to serve a Studio the project vendors or pins itself. The package is never
   * a dependency of this one: a hard edge would install a React application into
   * every project that does not want Studio (ADR-0022).
   */
  readonly root?: string
  /**
   * Where it is served. `/studio`.
   *
   * Changing it is almost always wrong: the published bundle's asset URLs are built
   * with `/studio/` as their base, so a different path serves a document whose
   * scripts are 404s. It exists for a Studio built with a matching base of its own.
   */
  readonly path?: string
}

export type McpOptions = {
  /** Under the API prefix. `/mcp` by default. */
  readonly path?: string
  /**
   * `change-set` by default: an agent proposes and a person applies (SPEC.md §75).
   *
   * `direct` is the deliberate opt-out, and it belongs in the project's own source
   * rather than in a framework default.
   */
  readonly mutations?: MutationMode
  /** Tool calls per window. 120 a minute by default (SPEC.md §76). */
  readonly rateLimit?: RateWindow
}

/**
 * Where uploaded bytes live (SPEC.md §63).
 *
 * `root` is the shorthand: the umbrella builds the local driver and points its URLs
 * at the media routes it mounts, so the driver and the mount agree by construction
 * rather than by two strings being kept the same by hand. `storage` hands over a
 * driver the application built, and then the URLs are that driver's business.
 *
 * Omitting it leaves the storage driver alone, for an application that calls
 * `useStorage()` itself.
 */
/** What a media library accepts, whichever driver stores it. */
type MediaLimits = {
  /**
   * The largest file `media.upload` accepts, in bytes. 16 MiB by default.
   *
   * Sized against what arrives rather than against the file: a file reaches the command
   * as base64 inside its input, which is four bytes on the wire for every three stored,
   * so this ceiling admits a file of about 12 MB. The default is generous on purpose —
   * a photograph from a phone is 2–5 MB, and a media library that refuses one is a
   * media library nobody can put content in.
   *
   * It applies to `POST /api/commands/media.upload` alone. Every other address keeps
   * `api: { bodyLimit }`, because a ceiling wide enough for a photograph is a memory
   * amplifier anywhere it is not needed (SPEC.md §85).
   */
  readonly maxUploadBytes?: number
}

export type MediaOptions = ({ readonly root: string } | { readonly storage: StorageDriver }) &
  MediaLimits

/**
 * The application's own frontend — what the builder canvas frames (SPEC.md §59).
 *
 * Only the application knows where its bundle was built, and the canvas has to render
 * the real renderer rather than a second implementation of it.
 */
export type FrontendOptions = {
  /** The built bundle. Absolute. */
  readonly root: string
  /**
   * Where it is served, at the origin root. `/preview` by default.
   *
   * It has to match the base the bundle was built with, and `/` is worth avoiding:
   * it registers a catch-all that the API's own routes only outrank by being more
   * specific.
   */
  readonly path?: string
  /**
   * The origins whose Studio may frame this frontend (SPEC.md §59, §85).
   *
   * Empty by default, and empty is right for the ordinary deployment: Studio is
   * served beside the API, so the canvas frames `/preview` from this very origin and
   * `'self'` already covers it. A split-origin development setup — Studio on its own
   * dev server — names that server here.
   *
   * It is deliberately not `origins`. Who may *call* this API and who may *frame* it
   * are different permissions, and an origin allowed to fetch JSON has not thereby
   * been allowed to put the logged-in admin UI inside an iframe of its own.
   */
  readonly framedBy?: readonly string[]
}

/**
 * A worker, as the umbrella has to see one (SPEC.md §82).
 *
 * One method, because one is all a lifecycle needs from here: this package starts a
 * worker when a process asks to be one and stops it before the modules and the
 * database go, and everything between those two moments belongs to the adapter.
 *
 * Nothing in the type names a queue, which is what keeps `@assemora/queue-bullmq` out
 * of this package's dependencies — the bargain Studio already makes. An adapter is the
 * application's choice, and a hard edge would install Redis into every project that
 * does not use one (ADR-0022, ADR-0023). `queue.work()` there answers with exactly
 * this shape, structurally, without either package importing the other.
 */
export type JobWorker = {
  /** Stops taking new work and waits for what is already running. */
  stop(): Promise<void> | void
}

/**
 * Where dispatched work goes, and how this process becomes one of the things that
 * runs it (SPEC.md §82, ADR-0023).
 *
 * Leaving it out is not "no jobs". Core's default runs them in this process, awaited,
 * so a job never silently vanishes in development — what it is not is *durable*: a
 * restart loses whatever was in flight, and a slow job slows the request that
 * scheduled it. `queue` is what fixes both, and there is deliberately no way to ask
 * for a third answer where a dispatched job is quietly dropped.
 */
export type JobsOptions = {
  /** The adapter every dispatched job is handed to. */
  readonly queue: QueuePort
  /**
   * How to build the worker, for a process that calls `work()`.
   *
   * A function rather than a worker, and both halves of that matter. It is a function
   * because `assemora()` runs whenever the config file is merely imported — which is
   * what `assemora routes` does — and a worker built there would open a connection and
   * start consuming production jobs to answer a question about routes (ADR-0021).
   * It is separate from `queue` because one application definition has to serve two
   * process shapes, and which one this process is belongs to its entry point.
   */
  readonly worker?: () => JobWorker | Promise<JobWorker>
}

/**
 * Where failures go, and when a slow query is written down (SPEC.md §88).
 *
 * §88's other halves need nothing here. The structured log is `logger`, the health and
 * readiness endpoints are mounted whether or not anybody asks for them, and command
 * and query timing is already in the audit row every application writes.
 */
export type ObservabilityOptions = {
  /**
   * Where an unexpected failure is reported.
   *
   * ```ts
   * observability: { errors: sentry() }
   * ```
   *
   * Defaults to the application's own structured log — core's `logErrors`, which is a
   * floor rather than a switch: nothing disappears because nothing was registered. One
   * port serves the command pipeline, the Query Bus and the server in front of them,
   * so an incident is reported once however it was reached — a failure that passed two
   * of those layers on its way out reaches this once, not twice.
   *
   * What reaches it is an incident and not a caller's mistake, and it never carries a
   * command's input or an unredacted message — `captureError` in `@assemora/core` is
   * where both of those are decided, once, for every layer.
   */
  readonly errors?: ErrorTrackingPort
  /**
   * A query at least this slow is logged, with its shape and never its values. 200ms.
   *
   * On, because §88 lists it among the minimum for v1 and an application that
   * configured nothing should still be able to find out why a page is slow. It is not
   * a firehose: the threshold sits above the whole-request budget of §89, so a healthy
   * process writes nothing at all, and when it stops being healthy that is the thing
   * worth knowing. `false` switches it off; `0` writes down every query, which is
   * occasionally useful while looking at one endpoint and never in production.
   */
  readonly slowQueryMs?: number | false
  /**
   * How long a request may take before its line is a warning rather than information.
   * A second.
   *
   * Every request writes one line whatever this is set to — method, route, status,
   * duration — because §88 lists request timing among the minimum. This is what stops
   * that from being a log nobody reads: the one request that took too long is written
   * at a level somebody is alerted on. `false` stops the lines altogether.
   */
  readonly slowRequestMs?: number | false
}

export type SessionOptions = {
  /**
   * `Secure` on the session and CSRF cookies (SPEC.md §85).
   *
   * On, and it does not consult the environment: a security default decided by
   * `NODE_ENV` is not a default, and the container started with `node dist/server.js`
   * behind a TLS-terminating proxy is exactly the deployment that would then send its
   * session cookie in cleartext without anything saying so.
   *
   * `false` is the deliberate opt-out, and it belongs in the project's own source
   * where it is visible — the same bargain `permitAll()` makes. Plain http on
   * `localhost` is a secure context in current browsers, so development usually does
   * not need it; a development server on a plain-http hostname does.
   */
  readonly secure?: boolean
  /** `strict` by default. `lax` for a deployment whose Studio is reached by link. */
  readonly sameSite?: 'strict' | 'lax'
}

export type AssemoraOptions = {
  /** The adapter every model reaches through (SPEC.md §31). */
  readonly database: DatabaseAdapter
  readonly modules?: readonly ModuleBuilder[]
  readonly project?: ProjectOptions
  readonly api?: boolean | ApiOptions
  /**
   * Serves Studio at `/studio`, beside the API and on one origin, so its session
   * cookie is first-party (SPEC.md §58).
   */
  readonly studio?: boolean | StudioOptions
  /** Mounts the MCP endpoint and registers the module its tools introspect. */
  readonly mcp?: boolean | McpOptions
  readonly media?: MediaOptions
  /**
   * Durable background work (SPEC.md §82).
   *
   * Absent, jobs run in this process, awaited — the default core chose, because a job
   * that vanishes in development and works in production is the worst of the answers
   * available (ADR-0023). Naming a `queue` makes them durable; naming a `worker` as
   * well is what lets `work()` turn a process into one that runs them.
   */
  readonly jobs?: JobsOptions
  readonly frontend?: FrontendOptions
  /**
   * Browser origins other than this one that may *call* this application (SPEC.md §85).
   *
   * Empty by default, because Studio is served beside the API and nothing else needs
   * to. A split-origin development setup lists Studio's dev server here. It is a
   * list, it is never `*`, and every entry is checked to be an origin and nothing
   * else before it reaches a header.
   *
   * It says nothing about who may frame this application: that is `frontend.framedBy`,
   * because they are different permissions (SPEC.md §59).
   */
  readonly origins?: readonly string[]
  readonly session?: SessionOptions
  readonly observability?: ObservabilityOptions
  readonly logger?: Logger
  /**
   * Content history (SPEC.md §64). On, and a developer should not have to ask.
   *
   * Switching it off removes the module *and* the port, so nothing writes to a table
   * that is no longer part of the schema.
   */
  readonly revisions?: boolean
  /** Who did what (SPEC.md §67). On, including for the attempts that were refused. */
  readonly audit?: boolean
  /** What an agent proposes and a person applies (SPEC.md §73). On. */
  readonly changeSets?: boolean
  /**
   * The theme, as tokens a person and an agent may edit (SPEC.md §62). On.
   *
   * Switching it off removes the model and the two operations, and leaves the
   * stylesheet exactly where it was: `<prefix>/theme.css` then renders the defaults,
   * which is what a site that never opened Design looked like anyway (ADR-0024). It
   * is the answer for a project whose design belongs to the developers who wrote it —
   * not a way to stop serving one.
   */
  readonly theme?: boolean
  /**
   * The languages this deployment serves (SPEC.md §131).
   *
   * ```ts
   * assemora({ locales: ['uk', 'en', 'ru'], defaultLocale: 'uk' })
   * ```
   *
   * One option and not two configurations: it reaches `createApplication`, so every
   * read is scoped to the language of the operation, *and* `createHttpServer`, so a
   * language is a path segment. Told twice, the two would eventually disagree, and a
   * deployment serving an address it does not scope reads is the disagreement that
   * matters.
   *
   * Left out, the application is in one language and nothing changes.
   */
  readonly locales?: readonly string[]
  /** Which of `locales` a missing translation falls back to. Defaults to the first. */
  readonly defaultLocale?: string
}

/**
 * Where uploaded bytes go when the application says nothing (SPEC.md §9, §63).
 *
 * SPEC.md §9 lists `media()` among the modules and passes no second option, so that
 * has to be a working application: local storage is mandatory in v1, and a directory
 * in the project is where a CMS keeps it. Read at call time rather than at import,
 * because it is relative to the project the process was started in.
 *
 * It is a disk this process happens to have, which a container replaces on the next
 * deploy — `assemora()` says so out loud, once, so an application that meant S3 can
 * see that it did not get it.
 */
export const defaultMediaRoot = (): string => resolvePath(process.cwd(), 'storage', 'media')

export const DEFAULT_PREFIX = '/api'
export const DEFAULT_STUDIO_PATH = '/studio'
export const DEFAULT_PREVIEW_PATH = '/preview'
export const DEFAULT_MCP_PATH = '/mcp'
export const DEFAULT_PORT = 3000

/** 600 a minute. Generous for a person, and a ceiling for everybody else. */
const API_RATE_LIMIT: RateWindow = { max: 600, windowMs: 60_000 }

/** Tool calls are heavier than requests, and an agent is faster than a person. */
const MCP_RATE_LIMIT: RateWindow = { max: 120, windowMs: 60_000 }

/** 16 MiB: base64 of a file of about 12 MB, and a phone photograph is 2–5 MB. */
export const DEFAULT_MAX_UPLOAD_BYTES = 16 * 1024 * 1024

/** What `media.upload` accepts, which is the one endpoint sized for a file. */
export const uploadLimitOf = (media: MediaOptions | undefined): number =>
  media?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES

export type ResolvedApi = {
  readonly prefix: string
  readonly rateLimit: RateWindow
  readonly bodyLimit: number
  readonly crud: boolean
  readonly documentation: boolean
  readonly introspection: 'authenticated' | 'public'
  readonly versions: Readonly<Record<string, (api: ApiVersion) => VersionDeclaration>>
}

export type ResolvedStudio = {
  readonly root: string | undefined
  readonly path: string
}

export type ResolvedMcp = {
  readonly path: string
  readonly mutations: MutationMode
  readonly rateLimit: RateWindow
}

export type ResolvedFrontend = {
  readonly root: string
  readonly path: string
  readonly framedBy: readonly string[]
}

export type ResolvedSession = {
  readonly secure: boolean
  readonly sameSite: 'strict' | 'lax'
}

export type ResolvedObservability = {
  /**
   * What the application named, and nothing when it named nothing.
   *
   * The default is `logErrors(logger)`, which needs the logger — and the logger is
   * built where the application is, not here. So this is the one resolved value whose
   * default is applied by `assemora()` rather than by `resolve()`.
   */
  readonly errors: ErrorTrackingPort | undefined
  readonly slowQueryMs: number | false
  readonly slowRequestMs: number | false
}

export type ResolvedProject = {
  readonly name: string
  readonly version: string
  readonly description: string | undefined
}

/** Every option, with its default applied and its switch already read. */
export type Settings = {
  readonly project: ResolvedProject
  readonly api: ResolvedApi | undefined
  readonly studio: ResolvedStudio | undefined
  readonly mcp: ResolvedMcp | undefined
  readonly frontend: ResolvedFrontend | undefined
  readonly session: ResolvedSession
  readonly observability: ResolvedObservability
  readonly origins: readonly string[]
  /** What `media.upload` accepts, resolved whether or not media was configured. */
  readonly uploadBytes: number
  readonly revisions: boolean
  readonly audit: boolean
  readonly changeSets: boolean
  readonly theme: boolean
}

const apiOf = (value: AssemoraOptions['api']): ResolvedApi | undefined => {
  if (value === false) return undefined

  const given: ApiOptions = value === undefined || value === true ? {} : value

  return {
    prefix: given.prefix ?? DEFAULT_PREFIX,
    rateLimit: given.rateLimit ?? API_RATE_LIMIT,
    bodyLimit: given.bodyLimit ?? DEFAULT_BODY_LIMIT,
    crud: given.crud ?? true,
    documentation: given.documentation ?? true,
    introspection: given.introspection ?? 'authenticated',
    versions: given.versions ?? {},
  }
}

const studioOf = (value: AssemoraOptions['studio']): ResolvedStudio | undefined => {
  if (value === undefined || value === false) return undefined

  const given: StudioOptions = value === true ? {} : value

  return { root: given.root, path: given.path ?? DEFAULT_STUDIO_PATH }
}

const mcpOf = (value: AssemoraOptions['mcp']): ResolvedMcp | undefined => {
  if (value === undefined || value === false) return undefined

  const given: McpOptions = value === true ? {} : value

  return {
    path: given.path ?? DEFAULT_MCP_PATH,
    mutations: given.mutations ?? 'change-set',
    rateLimit: given.rateLimit ?? MCP_RATE_LIMIT,
  }
}

/**
 * `api` is the one switch that is on when nothing is said.
 *
 * An application built by this function is a server; `studio` and `mcp` are answers
 * to SPEC.md §78's questions, and a project that never asked for them should not
 * publish them.
 */
export const resolve = (options: AssemoraOptions): Settings => ({
  project: {
    name: options.project?.name ?? 'assemora',
    version: options.project?.version ?? '0.0.0',
    description: options.project?.description,
  },
  api: apiOf(options.api),
  studio: studioOf(options.studio),
  mcp: mcpOf(options.mcp),
  frontend:
    options.frontend === undefined
      ? undefined
      : {
          root: options.frontend.root,
          path: options.frontend.path ?? DEFAULT_PREVIEW_PATH,
          framedBy: options.frontend.framedBy ?? [],
        },
  session: {
    secure: options.session?.secure ?? true,
    sameSite: options.session?.sameSite ?? 'strict',
  },
  observability: {
    errors: options.observability?.errors,
    slowQueryMs: options.observability?.slowQueryMs ?? DEFAULT_SLOW_QUERY_MS,
    slowRequestMs: options.observability?.slowRequestMs ?? SLOW_REQUEST_MS,
  },
  origins: options.origins ?? [],
  uploadBytes: uploadLimitOf(options.media),
  revisions: options.revisions ?? true,
  audit: options.audit ?? true,
  changeSets: options.changeSets ?? true,
  theme: options.theme ?? true,
})
