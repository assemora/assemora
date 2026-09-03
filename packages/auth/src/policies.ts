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

/** Which module registered which subject, for the sweep at boot to be able to say. */
const sources = new Map<string, string>()

export const registerPolicy = (definition: Policy<never>, module?: string): void => {
  if (registered.has(definition.subject)) {
    throw new AssemoraError(
      'CONFIGURATION_ERROR',
      `A policy for "${definition.subject}" is already registered`,
      { status: 500 },
    )
  }

  registered.set(definition.subject, definition)

  if (module !== undefined) sources.set(definition.subject, module)
}

export const policyFor = (subject: string): Policy<never> | undefined => registered.get(subject)

export const registeredPolicies = (): readonly Policy<never>[] => [...registered.values()]

/** Every policy as the registry describes it, whoever registered it and however. */
export const describedPolicies = (): readonly PolicyDescriptor[] =>
  [...registered.values()].map((definition) =>
    describePolicy(definition, sources.get(definition.subject)),
  )

export const clearPolicies = (): void => {
  registered.clear()
  sources.clear()
}
