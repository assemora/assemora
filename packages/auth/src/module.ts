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
import { describedPolicies, describePolicy, type Policy, registerPolicy } from './policies.js'
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
    internals.addRegistration((context) => {
      for (const candidate of args) {
        const declared = candidate as Policy<never>

        if (declared?.node !== 'policy') continue

        registerPolicy(declared, context.module)

        // Described where it is registered, by the module that registered it. A policy
        // grants access, so the one thing the single source must not be silent about
        // is which package put one there (ADR-0002, ADR-0027).
        context.registry.register('policies', describePolicy(declared, context.module))
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
    /**
     * Anything that got in without going through a module.
     *
     * `registerPolicy` is exported, so a package can call it at import time and never
     * declare a facet — and that is precisely the registration worth being able to see,
     * because it is the one nothing else records. Such a policy is described here with
     * no `module`, and the absence is the signal.
     *
     * At boot rather than at registration: every module has registered by then, so what
     * is left in the map and not yet in the section got there some other way.
     */
    .boot((context) => {
      const described = new Set(context.registry.section('policies').map((entry) => entry.name))

      for (const descriptor of describedPolicies()) {
        if (described.has(descriptor.name)) continue

        context.registry.register('policies', descriptor)
      }
    })
