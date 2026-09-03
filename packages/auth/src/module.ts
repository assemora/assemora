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
import { ConfigurationError, defineModuleFacet, type ModuleBuilder, module } from '@assemora/core'

import { authCommands, publicAuthPolicy } from './commands.js'
import { authModels } from './models.js'
import { foreignSubject, ownsSubject, unattributedSubject } from './ownership.js'
import {
  APPLICATION,
  describedPolicies,
  describePolicy,
  type Policy,
  policySources,
  registerModulePolicy,
} from './policies.js'
import { authQueries } from './queries.js'

declare module '@assemora/core' {
  interface ModuleBuilder {
    /** Registers policies for this module's subjects (SPEC.md §51). */
    policies(...policies: Policy<never>[]): ModuleBuilder
  }
}

let defined = false

/**
 * The policies the application passed to `auth({ policies })`, by identity.
 *
 * They travel through the same facet as a module's own — so they are registered at the
 * same moment, and an application that is created and never booted has them, which is
 * what a module's `.policies()` has always given. What differs is only the attribution,
 * and it cannot be a second builder method: a facet is a method on *every* module, and
 * "register a policy for a subject you do not own" is precisely what no module may have.
 *
 * Weak, and private to this file. A package cannot reach it, which is what makes the
 * exemption the application's rather than anybody's.
 */
const applicationOwned = new WeakSet<Policy<never>>()

export const definePolicyFacet = (): void => {
  if (defined) return

  defineModuleFacet('policies', (internals, args) => {
    internals.addRegistration((context) => {
      for (const candidate of args) {
        const declared = candidate as Policy<never>

        if (declared?.node !== 'policy') continue

        const application = applicationOwned.has(declared)

        registerModulePolicy(declared, application ? APPLICATION : context.module)

        // Described where it is registered, by the module that registered it. A policy
        // grants access, so the one thing the single source must not be silent about
        // is which package put one there (ADR-0002, ADR-0027). The application's carry
        // no module, which is what "not a package" has looked like since the section
        // existed.
        context.registry.register(
          'policies',
          application ? describePolicy(declared) : describePolicy(declared, context.module),
        )
      }
    })
  })

  defined = true
}

definePolicyFacet()

export type AuthModuleOptions = {
  /**
   * The application's own policies (SPEC.md §51, ADR-0027).
   *
   * A module may only write a policy for a subject it declares, because a policy is a
   * grant and an installed package must not be able to open the application with one.
   * This is the other door, and it is the application's: it is written at the
   * composition root, by whoever assembled the modules, so it speaks for the whole
   * application and is held to no ownership rule.
   *
   * A policy over a module's own subject belongs on that module —
   * `module('blog').resources(Articles).policies(ArticlePolicy)`. Use this for a policy
   * over somebody else's, which is a decision the application is entitled to make and
   * a package is not.
   */
  readonly policies?: readonly Policy<never>[]
}

export const auth = (options: AuthModuleOptions = {}): ModuleBuilder => {
  // Marked before the module is built, so the facet knows which of the policies it is
  // handed speak for the application rather than for `auth`.
  for (const declared of options.policies ?? []) applicationOwned.add(declared)

  return (
    module('auth')
      .models(...authModels)
      .commands(...authCommands)
      .queries(...authQueries)
      .policies(publicAuthPolicy, ...(options.policies ?? []))
      /**
       * Every policy, held to the rule that a module speaks only for what it declared.
       *
       * At boot rather than at registration, and that is not a detail: ownership is
       * decided against what the module *registered*, and a facet runs in the order the
       * builder was written. `.policies(P).resources(Articles)` would be refused and
       * `.resources(Articles).policies(P)` allowed, for one declaration. By boot every
       * module has registered everything, so the answer no longer depends on the order
       * somebody typed two lines in.
       *
       * The sweep for what got in through no module at all stays, and is now a refusal
       * rather than a note: an unattributed policy is exactly the registration nothing
       * else records, and describing it only ever made it visible.
       */
      .boot((context) => {
        const described = new Set(context.registry.section('policies').map((entry) => entry.name))
        const sources = policySources()

        for (const descriptor of describedPolicies()) {
          const source = sources.get(descriptor.name)

          if (source === undefined)
            throw new ConfigurationError(unattributedSubject(descriptor.name))

          if (source !== APPLICATION && !ownsSubject(context.registry, source, descriptor.name)) {
            throw new ConfigurationError(foreignSubject(source, descriptor.name))
          }

          if (described.has(descriptor.name)) continue

          context.registry.register('policies', descriptor)
        }
      })
  )
}
