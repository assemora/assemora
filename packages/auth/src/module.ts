/**
 * The `auth()` module (SPEC.md §9, §113).
 *
 * ```ts
 * export default assemora({ modules: [auth(), blog()] })
 * ```
 *
 * Registering it is what replaces `permitAll()`: the authorization port core has
 * declared since phase 1 finally has an implementation, and every command and query
 * starts passing roles, permissions and policies (ADR-0008).
 */
import { defineModuleFacet, type ModuleBuilder, module } from '@assemora/core'

import { authCommands, publicAuthPolicy } from './commands.js'
import { authModels } from './models.js'
import { type Policy, registerPolicy } from './policies.js'
import { authQueries } from './queries.js'

declare module '@assemora/core' {
  interface ModuleBuilder {
    /** Registers policies for this module's subjects (SPEC.md §51). */
    policies(...policies: Policy<never>[]): ModuleBuilder
  }
}

let defined = false

export const definePolicyFacet = (): void => {
  if (defined) return

  defineModuleFacet('policies', (internals, args) => {
    internals.addRegistration(() => {
      for (const candidate of args) {
        const declared = candidate as Policy<never>

        if (declared?.node === 'policy') registerPolicy(declared)
      }
    })
  })

  defined = true
}

definePolicyFacet()

export type AuthModuleOptions = {
  /** Extra policies to register alongside the module's own. */
  readonly policies?: readonly Policy<never>[]
}

export const auth = (options: AuthModuleOptions = {}): ModuleBuilder =>
  module('auth')
    .models(...authModels)
    .commands(...authCommands)
    .queries(...authQueries)
    .policies(publicAuthPolicy, ...(options.policies ?? []))
