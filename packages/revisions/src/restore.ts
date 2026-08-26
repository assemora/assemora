/**
 * Putting a state back (SPEC.md §65).
 *
 * The registry itself lives in `@assemora/core`, next to the other ports: a package
 * that owns an entity registers how to restore it without depending on this one
 * (SPEC.md §8, ADR-0008). What is here is the refusal when nobody did.
 */
import { AssemoraError, restorerFor as lookup, type Restorer } from '@assemora/core'

export type { Restorer }

export const restorerFor = (entityType: string): Restorer => {
  const found = lookup(entityType)

  if (found === undefined) {
    throw new AssemoraError(
      'NOT_RESTORABLE',
      `Nothing knows how to restore a ${entityType}. The package that owns it registers a restorer.`,
      { status: 422 },
    )
  }

  return found
}

export { clearRestorers, registerRestorer } from '@assemora/core'
