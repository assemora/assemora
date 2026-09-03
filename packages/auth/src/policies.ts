/**
 * Policies (SPEC.md §51).
 *
 * A policy answers one question — may this actor do this to this thing — and the
 * same answer is given to Studio, REST, the SDK, the CLI and MCP, because they all
 * arrive through the same Command Bus and the same Query Bus.
 */
import { type Actor, type AssemoraContext, AssemoraError } from '@assemora/core'

export type PolicyActor = Actor | undefined

export type PolicyContext<R = unknown> = {
  readonly actor: PolicyActor
  /** The row being acted on, once it has been read. `undefined` before that. */
  readonly record: R
  readonly context: AssemoraContext
  /** Whether the actor holds a named permission (SPEC.md §50). */
  can(permission: string): boolean
}

export type PolicyRule<R = unknown> = (context: PolicyContext<R>) => boolean | Promise<boolean>

/**
 * Rules by action. `read`, `create`, `update` and `delete` are the ones the CRUD
 * commands ask about; any other name is asked for by whoever defines it.
 */
export type PolicyRules<R = unknown> = Readonly<Record<string, PolicyRule<R>>>

export type Policy<R = unknown> = {
  readonly node: 'policy'
  readonly subject: string
  readonly rules: PolicyRules<R>
}

/**
 * ```ts
 * export const ArticlePolicy = policy('articles', {
 *   read: () => true,
 *   update: ({ actor, record }) => actor?.id === record.authorId,
 *   delete: ({ can }) => can('articles.delete'),
 * })
 * ```
 *
 * SPEC.md §51 spells the record argument after the model — `{ actor, article }`.
 * It is named `record` here because the key would have to be derived from a literal
 * table name that `model()` does not preserve; naming it after the subject would be
 * a runtime-only convenience with no type behind it.
 */
export const policy = <R = Record<string, unknown>>(
  subject: string,
  rules: PolicyRules<R>,
): Policy<R> => ({ node: 'policy', subject, rules })

/**
 * What the Schema Registry is told about a policy (SPEC.md §51, ADR-0002).
 *
 * The rules themselves are functions and stay here: a function does not survive
 * `JSON.stringify`, so a descriptor that carried one would arrive at Studio as an empty
 * object and be worse than saying nothing (ADR-0027). What travels is the shape of the
 * thing — which subject, which actions it answers for, and which module put it there.
 *
 * That last field is the reason this section exists at all. `registerPolicy` grants
 * access, and until now it wrote nothing anywhere: an installed package could open
 * `pages.create` to everybody in twelve lines and the application's single source of
 * truth described the rest of the system perfectly while saying nothing about that.
 */
export type PolicyDescriptor = {
  /** The subject the policy is about, which is what it is addressed by. */
  readonly name: string
  /** The actions it answers for, in declaration order. */
  readonly actions: readonly string[]
  /**
   * The module that registered it, when a module did.
   *
   * Absent means `registerPolicy` was called outside module registration — which is
   * legal, and is exactly the case worth being able to see.
   */
  readonly module?: string
}

declare module '@assemora/core' {
  interface RegistrySections {
    policies: PolicyDescriptor
  }
}

export const describePolicy = (definition: Policy<never>, module?: string): PolicyDescriptor => ({
  name: definition.subject,
  actions: Object.keys(definition.rules),
  ...(module === undefined ? {} : { module }),
})

const registered = new Map<string, Policy<never>>()

/** Which module registered which subject, for the check at boot to be able to say. */
const sources = new Map<string, PolicySource>()

/**
 * What the application's own policies are attributed to.
 *
 * A policy passed as `auth({ policies: [...] })` is written at the composition root by
 * the person who assembled the application, so it speaks for the whole of it and is
 * held to no ownership rule — the application *is* the trust boundary the rule exists
 * to protect. A symbol rather than a name so that no module can be called this, and so
 * that a descriptor never carries it: the section shows such a policy with no `module`,
 * which is what "the application, not a package" has looked like since #5.
 */
export const APPLICATION: unique symbol = Symbol('assemora.application')

export type PolicySource = string | typeof APPLICATION

/**
 * Puts a rule in the map, attributed to whoever is registering it.
 *
 * Deliberately *not* exported from this package. The source is what the ownership rule
 * is checked against, so a caller able to supply one is a caller able to claim to be
 * `pages` — and a package outside this file cannot reach this function to try
 * (ADR-0027). The two callers are the module facet, which passes the module the
 * builder is registering, and `auth({ policies })`, which passes `APPLICATION`.
 */
export const registerModulePolicy = (definition: Policy<never>, module: PolicySource): void => {
  registerPolicy(definition)
  sources.set(definition.subject, module)
}

/**
 * Puts a rule in the map, attributed to nobody.
 *
 * Exported, because a test of the authorization port needs a policy in front of it and
 * never boots an application. An application *does* boot, and refuses to start on a
 * policy nothing declares — so this is a harness seam rather than a way in: a package
 * that calls it at import time takes the application down at boot, naming the subject
 * and itself (`ownership.ts`).
 */
export const registerPolicy = (definition: Policy<never>): void => {
  if (registered.has(definition.subject)) {
    throw new AssemoraError(
      'CONFIGURATION_ERROR',
      `A policy for "${definition.subject}" is already registered`,
      { status: 500 },
    )
  }

  registered.set(definition.subject, definition)
}

/**
 * Who registered each policy, including the ones the application registered itself.
 *
 * `describedPolicies` cannot answer this: a descriptor carries a module *name*, and
 * the application is deliberately not one. The check at boot needs the difference.
 */
export const policySources = (): ReadonlyMap<string, PolicySource> => sources

export const policyFor = (subject: string): Policy<never> | undefined => registered.get(subject)

export const registeredPolicies = (): readonly Policy<never>[] => [...registered.values()]

/** Every policy as the registry describes it, whoever registered it and however. */
export const describedPolicies = (): readonly PolicyDescriptor[] =>
  [...registered.values()].map((definition) => {
    const source = sources.get(definition.subject)

    // The application's policies are described with no module, which is the shape a
    // registration outside any module has always had — and the right one: naming a
    // module there would claim a package wrote what the application wrote.
    return describePolicy(definition, typeof source === 'string' ? source : undefined)
  })

export const clearPolicies = (): void => {
  registered.clear()
  sources.clear()
}
