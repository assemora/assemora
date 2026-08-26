/**
 * The `revisions()` module (SPEC.md §114).
 *
 * Registering it is what replaces `discardRevisions()`: every content mutation starts
 * leaving a row behind, and §3.6 — any content mutation is reversible — stops being
 * an aspiration.
 */
import { type ModuleBuilder, module } from '@assemora/core'

import { revisionCommands, revisionQueries } from './commands.js'
import { revisionModels } from './models.js'

export const revisionsModule = (): ModuleBuilder =>
  module('revisions')
    .models(...revisionModels)
    .commands(...revisionCommands)
    .queries(...revisionQueries)
