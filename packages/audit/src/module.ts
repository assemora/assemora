/**
 * The `auditModule()` module (SPEC.md §67).
 *
 * Registering it is what replaces `discardAudit()`. Until something does, every
 * command is audited into nothing.
 */
import { type ModuleBuilder, module } from '@assemora/core'

import { auditModels } from './models.js'
import { auditQueries } from './queries.js'

export const auditModule = (): ModuleBuilder =>
  module('audit')
    .models(...auditModels)
    .queries(...auditQueries)
