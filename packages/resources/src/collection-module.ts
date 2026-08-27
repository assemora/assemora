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
import { systemModels } from './system-models.js'
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
    .boot(async (context) => {
      await loadCollections(context.registry, context.logger)
    })
