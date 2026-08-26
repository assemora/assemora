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

const registered = new Map<string, Policy<never>>()

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

export const policyFor = (subject: string): Policy<never> | undefined => registered.get(subject)

export const registeredPolicies = (): readonly Policy<never>[] => [...registered.values()]

export const clearPolicies = (): void => {
  registered.clear()
}
