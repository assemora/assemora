/**
 * The `collections()` module (SPEC.md §37, §38).
 *
 * Registering it is what turns the machinery of a dynamic resource into a feature: the
 * two system tables become part of the schema, `resources.*` becomes callable — and
 * therefore an MCP tool — and every collection stored in the database is registered
 * while the application boots.
 *
 * ```ts
 * assemora({ modules: [auth(), blog(), collections()] })
 * ```
 */
import { type ModuleBuilder, module } from '@assemora/core'

import { collectionCommands, collectionQueries } from './collection-commands.js'
import { loadCollections } from './collections.js'
import { ResourceDefinitionModel, systemModels } from './system-models.js'
// The `.resources()` facet below is contributed by this import, not by `core`.
import './module.js'

export const collections = (): ModuleBuilder =>
  module('collections')
    .models(...systemModels)
    // Deliberately empty. `.resources()` is what registers `entries.create`,
    // `entries.update`, `entries.delete`, `entries.list` and `entries.get` — the
    // commands every resource is reached through — and it does so once, whether or not
    // any resource is passed. An application whose only resources are collections has
    // none to pass at registration time, and without this it would boot with a
    // collection nobody could write to.
    .resources()
    .commands(...collectionCommands)
    .queries(...collectionQueries)
    // Boot rather than registration: reading a table is asynchronous, and registration
    // is not allowed to be. Everything a source file declares is already registered by
    // now, which is exactly what makes a collision with a static resource visible here.
    //
    // This is the only boot hook in the framework that reads the database, and the
    // invariant it has to keep belongs to every hook that ever joins it:
    //
    //   **An application must be able to boot against a schema that is not applied
    //   yet, so a boot hook that reads data has to tolerate its own table not existing
    //   yet.**
    //
    // Not a nicety. `assemora db:generate` boots the real application to read its
    // registry rather than parse the source (ADR-0021), and the schema it then writes
    // is the one containing this table — so a hook that insisted on reading it made
    // the first migration of every project that registers `collections()`
    // ungeneratable. What must *not* be tolerated is anything else: `loadCollections`
    // survives a missing table and nothing wider, because a refused connection turned
    // into an empty boot is a working application that has quietly lost its content.
    .boot(async (context) => {
      const { pending } = await loadCollections(context.registry, context.logger)

      // Tolerating the missing table is what lets `db:generate` run; saying nothing
      // afterwards is what let a server listen, serve Studio and answer `/api/ready`
      // with 200 while every data request answered 503. This module registered and
      // did not start, and `cannotStart` is where that fact goes so a readiness probe
      // can act on it (SPEC.md §88). It is still not a decision — the module says what
      // happened, and whoever booted the application decides what it means.
      if (pending) {
        context.cannotStart(
          `${ResourceDefinitionModel.table} does not exist, so no collection this application has stored was registered.`,
          { remedy: 'Run assemora db:migrate.' },
        )
      }
    })
