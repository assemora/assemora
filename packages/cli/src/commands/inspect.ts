/**
 * `assemora routes | models | resources | blocks | agents` (SPEC.md §77).
 *
 * Four of these read the Schema Registry, and by the time the CLI sees it, it is
 * plain data: `describe()` hands back entries typed as a name and nothing more,
 * because `@assemora/cli` cannot import the packages that declare what a route or a
 * block *is* (ADR-0021). Every column below therefore reads a field it has checked
 * for itself, and a descriptor missing one prints an empty cell rather than taking
 * the whole listing down.
 *
 * `agents` is the odd one, and the reason is worth stating: an agent identity is
 * data, not a declaration. It comes through the Query Bus, so listing agents is
 * validated, authorized and audited exactly as it is from Studio or from an agent
 * asking about itself (SPEC.md §72, §76).
 */
import { type Actor, type Application, AssemoraError, type ContextInit } from '@assemora/core'

import { bool, flag, type ParsedArgs } from '../args.js'
import { loadConfig } from '../config.js'
import { type Column, detail, fail, json, line, table } from '../output.js'
import { loadApplication } from '../project.js'
import { type CommandHandler, defineCommand, register } from '../registry.js'

/** A registry entry, as this package is able to see one (ADR-0021). */
type Entry = Readonly<Record<string, unknown>>

const isEntry = (value: unknown): value is Entry => typeof value === 'object' && value !== null

const sectionsOf = (app: Application): Readonly<Record<string, readonly Entry[]>> =>
  app.registry.describe() as Readonly<Record<string, readonly Entry[]>>

/** A string field, or an empty cell where the descriptor carries none. */
const text = (entry: Entry, key: string): string => {
  const value = entry[key]

  return typeof value === 'string' ? value : ''
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** The `name` of every member of a list of descriptors — fields, relations, columns. */
const namesIn = (value: unknown): string =>
  (Array.isArray(value) ? value.filter(isEntry) : []).map((entry) => text(entry, 'name')).join(', ')

const countIn = (value: unknown): string => String(Array.isArray(value) ? value.length : 0)

const byName = (left: Entry, right: Entry): number =>
  text(left, 'name').localeCompare(text(right, 'name'))

const routeColumns: readonly Column<Entry>[] = [
  { header: 'Method', value: (entry) => text(entry, 'method').toUpperCase() },
  { header: 'Path', value: (entry) => text(entry, 'path') },
  { header: 'Summary', value: (entry) => text(entry, 'description') },
  {
    // Tags are what a route was filed under; the module is where it was declared.
    // Both answer "where did this come from", and the tags are the more specific
    // answer, so a route carrying them is described by them.
    header: 'From',
    value: (entry) => {
      const tags = strings(entry.tags)

      return tags.length === 0 ? text(entry, 'module') : tags.join(', ')
    },
  },
]

/**
 * Routes read by path rather than in the order they were mounted.
 *
 * Mount order is an accident of module order, and somebody running this is looking
 * for one URL — which puts every method on it next to each other.
 */
const byPath = (left: Entry, right: Entry): number =>
  text(left, 'path').localeCompare(text(right, 'path')) ||
  text(left, 'method').localeCompare(text(right, 'method'))

const tableOf = (entry: Entry): Entry => (isEntry(entry.table) ? entry.table : {})

/** `author (belongsTo), comments (hasMany)` — the kind says which side holds the key. */
const relationsOf = (entry: Entry): string => {
  const declared = tableOf(entry).relations

  return (Array.isArray(declared) ? declared.filter(isEntry) : [])
    .map((relation) => `${text(relation, 'name')} (${text(relation, 'kind')})`)
    .join(', ')
}

const modelColumns: readonly Column<Entry>[] = [
  { header: 'Model', value: (entry) => text(entry, 'name') },
  { header: 'Table', value: (entry) => text(tableOf(entry), 'name') },
  { header: 'Columns', value: (entry) => countIn(tableOf(entry).columns), align: 'right' },
  { header: 'Relations', value: relationsOf },
]

const resourceColumns: readonly Column<Entry>[] = [
  { header: 'Resource', value: (entry) => text(entry, 'name') },
  { header: 'Model', value: (entry) => text(entry, 'model') },
  // A hidden field is listed here. This is a developer reading their own
  // declarations, and what SPEC.md §85 keeps out of a published document is the
  // value — no value is read by any of these commands.
  { header: 'Fields', value: (entry) => namesIn(entry.fields) },
]

/**
 * `no`, `any`, or the block types it will take.
 *
 * "Whether it accepts children" is the question; naming what it accepts answers that
 * and says more, at no cost in width for the blocks that accept nothing.
 */
const childrenOf = (entry: Entry): string => {
  if (entry.acceptsChildren !== true) return 'no'

  const allowed = strings(entry.allowedChildren)

  return allowed.length === 0 ? 'any' : allowed.join(', ')
}

const blockColumns: readonly Column<Entry>[] = [
  { header: 'Block', value: (entry) => text(entry, 'name') },
  { header: 'Fields', value: (entry) => namesIn(entry.fields) },
  { header: 'Children', value: childrenOf },
]

/**
 * The shape all four registry listings share.
 *
 * `--json` prints the section exactly as the registry holds it, fields the table
 * leaves out included: the next thing anybody does with a listing is pipe it, and a
 * pipe wants the data rather than the layout (ADR-0021).
 */
const registryListing = (options: {
  readonly section: string
  readonly columns: readonly Column<Entry>[]
  readonly order: (left: Entry, right: Entry) => number
  readonly empty: string
}): CommandHandler => {
  return async ({ args, cwd }) => {
    const app = await loadApplication(await loadConfig(cwd))
    const entries = sectionsOf(app)[options.section] ?? []

    if (bool(args, 'json')) {
      json(entries)
      return 0
    }

    // A grid with a header and no rows says less than one sentence does.
    if (entries.length === 0) {
      line(options.empty)
      return 0
    }

    table([...entries].sort(options.order), options.columns)

    return 0
  }
}

export const Routes = defineCommand({
  name: 'routes',
  group: 'inspect',
  summary: 'the HTTP routes this application registers',
  usage: 'assemora routes [--json]',
  handler: registryListing({
    section: 'routes',
    columns: routeColumns,
    order: byPath,
    empty: 'No routes are registered.',
  }),
})

export const Models = defineCommand({
  name: 'models',
  group: 'inspect',
  summary: 'the models it declares, with their tables and relations',
  usage: 'assemora models [--json]',
  handler: registryListing({
    section: 'models',
    columns: modelColumns,
    order: byName,
    empty: 'No models are declared.',
  }),
})

export const Resources = defineCommand({
  name: 'resources',
  group: 'inspect',
  summary: 'the resources it declares, and the models behind them',
  usage: 'assemora resources [--json]',
  handler: registryListing({
    section: 'resources',
    columns: resourceColumns,
    order: byName,
    empty: 'No resources are declared.',
  }),
})

export const Blocks = defineCommand({
  name: 'blocks',
  group: 'inspect',
  summary: 'the block types a page can be assembled from',
  usage: 'assemora blocks [--json]',
  handler: registryListing({
    section: 'blocks',
    columns: blockColumns,
    order: byName,
    empty: 'No block types are declared.',
  }),
})

/** The query `@assemora/auth` registers, named rather than imported (ADR-0021). */
const AGENTS_QUERY = 'auth.agents.list'

const agentColumns: readonly Column<Entry>[] = [
  { header: 'Agent', value: (entry) => text(entry, 'name') },
  { header: 'Enabled', value: (entry) => (entry.enabled === true ? 'yes' : 'no') },
  { header: 'Permissions', value: (entry) => strings(entry.permissions).join(', ') },
]

type Count = { readonly ok: true; readonly value: number | undefined } | { readonly ok: false }

/**
 * A count typed on the command line.
 *
 * `--page two` is a wrong invocation rather than a command that failed, and those are
 * different exit codes (SPEC.md §77), so this reports the refusal instead of throwing
 * and letting `run()` call it a failure.
 */
const countOf = (args: ParsedArgs, name: string): Count => {
  const written = flag(args, name)

  if (written === undefined) return { ok: true, value: undefined }

  const value = Number(written)

  return Number.isInteger(value) && value >= 1 ? { ok: true, value } : { ok: false }
}

const numberIn = (value: unknown, key: string): number | undefined => {
  const found = isEntry(value) ? value[key] : undefined

  return typeof found === 'number' ? found : undefined
}

const rowsIn = (answer: unknown): Entry[] => {
  const data = isEntry(answer) ? answer.data : undefined

  return Array.isArray(data) ? data.filter(isEntry) : []
}

/** What the authorizer raises, whichever package registered it (SPEC.md §83). */
const isRefusal = (error: unknown): boolean =>
  error instanceof AssemoraError && error.code === 'FORBIDDEN'

/**
 * The one sentence a refused listing is missing.
 *
 * The authorizer names the subject and the action, because that is all it knows — it
 * has never heard of a command line. Running as nobody is the commonest way to meet
 * it, and `--actor` is the thing to type next, so the CLI says so rather than leaving
 * a reader to find it in the guide.
 */
const refusalHint = (actorId: string | undefined): string =>
  actorId === undefined
    ? 'Reading agent identities is authorized like every other query, and no actor was named. ' +
      'Pass --actor <user id> — a user allowed to read auth.agents.'
    : `${actorId} is not allowed to read auth.agents. Pass --actor with a user who holds that ` +
      'permission, or grant it to this one.'

export const Agents = defineCommand({
  name: 'agents',
  group: 'inspect',
  summary: 'the agent identities this application knows',
  usage: 'assemora agents [--actor <id>] [--page <n>] [--per-page <n>] [--json]',
  handler: async ({ args, cwd }) => {
    const app = await loadApplication(await loadConfig(cwd))

    // An application built without `@assemora/auth` has no agents at all, which is a
    // truthful answer and a more useful one than the unknown-query error it would
    // otherwise throw. It is still a failure: the question could not be asked, which
    // is not the same as it being answered with nothing.
    if (!app.queries.has(AGENTS_QUERY)) {
      fail(
        `This application registers no "${AGENTS_QUERY}", so it knows no agent identities. ` +
          'They come with @assemora/auth (SPEC.md §72).',
      )

      return 1
    }

    const page = countOf(args, 'page')
    const perPage = countOf(args, 'per-page')

    if (!page.ok || !perPage.ok) {
      fail('--page and --per-page each take a whole number of 1 or more.')

      return 2
    }

    const named = flag(args, 'actor')
    const actor: Actor | undefined = named === undefined ? undefined : { type: 'user', id: named }

    // `cli` is a source of its own so the audit log can tell a terminal from Studio
    // (SPEC.md §12). No actor means no permissions: running as nobody is refused, and
    // that refusal is the correct answer rather than a fault in this command.
    const context: ContextInit = { source: 'cli', ...(actor === undefined ? {} : { actor }) }

    let answer: unknown

    try {
      answer = await app.run(context, () =>
        app.queries.execute(AGENTS_QUERY, {
          ...(page.value === undefined ? {} : { page: page.value }),
          ...(perPage.value === undefined ? {} : { perPage: perPage.value }),
        }),
      )
    } catch (error) {
      // Everything else is `run()`'s to report: a query that could not run is a
      // failure of the application, and only the refusal has a next step to offer.
      if (!isRefusal(error)) throw error

      fail(error instanceof Error ? error.message : String(error))
      detail(refusalHint(named))

      return 1
    }

    // The whole answer, not just its rows: a page carries the total and where in it
    // this page sits, and a pipe that asked for JSON wants to know both.
    if (bool(args, 'json')) {
      json(answer)
      return 0
    }

    const rows = rowsIn(answer)

    if (rows.length === 0) {
      line('No agent identities exist.')
      return 0
    }

    table(rows, agentColumns)

    const total = numberIn(answer, 'total')

    // A page of twenty that says nothing about the other eighty is a lie a listing
    // can tell in silence, so it does not.
    if (total !== undefined && total > rows.length) {
      detail(`Showing ${rows.length} of ${total}. Pass --page to see the rest.`)
    }

    return 0
  },
})

/** In the order SPEC.md §77 lists them, which is the order the help prints them in. */
export const inspectCommands = [Routes, Models, Resources, Blocks, Agents] as const

register(...inspectCommands)
