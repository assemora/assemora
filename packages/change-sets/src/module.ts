/**
 * The `changeSets()` module (SPEC.md §73, §74).
 *
 * Registering it is what makes a proposal storable. `@assemora/mcp` needs no
 * dependency on this package: an MCP tool reaches `changesets.propose` the way it
 * reaches everything else, by dispatching a name through the Command Bus (ADR-0019).
 */
import { type ModuleBuilder, module } from '@assemora/core'

import { changeSetCommands, changeSetQueries } from './commands.js'
import { changeSetModels } from './models.js'

export const changeSets = (): ModuleBuilder =>
  module('changesets')
    .models(...changeSetModels)
    .commands(...changeSetCommands)
    .queries(...changeSetQueries)
