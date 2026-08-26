/**
 * What a scaffold refuses with.
 *
 * `@assemora/core` owns `AssemoraError` and this package cannot reach it: it runs
 * through `pnpm create` before anything is installed, so it has no dependencies at
 * all (ADR-0021). The distinction the class carries is still worth having — the
 * executable prints a `ScaffoldError` as one sentence and anything else as a bug,
 * with its stack.
 */
export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScaffoldError'
  }
}
