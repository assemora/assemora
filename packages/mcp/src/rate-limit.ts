/**
 * How often one agent may call (SPEC.md §76).
 *
 * A sliding window per actor, in memory. §76 lists rate limits among the checks a
 * tool call must pass and does not say where the counter lives; this one is
 * per-process, so two instances behind a load balancer give an agent twice its
 * allowance. A shared store belongs with deployment.
 */
export type RateLimit = {
  /** Throws when this actor has called too often, and records the call when it has not. */
  check(actor: string): void
}

export type RateLimitOptions = {
  readonly max?: number
  readonly windowMs?: number
}

export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED'
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super(`Too many calls. Try again in ${Math.ceil(retryAfterMs / 1000)}s`)
    this.name = 'RateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}

export const rateLimit = (options: RateLimitOptions = {}): RateLimit => {
  const max = options.max ?? 120
  const windowMs = options.windowMs ?? 60_000
  const calls = new Map<string, number[]>()

  return {
    check(actor) {
      const now = Date.now()
      const recent = (calls.get(actor) ?? []).filter((at) => now - at < windowMs)

      if (recent.length >= max) {
        const oldest = recent[0] ?? now

        throw new RateLimitedError(windowMs - (now - oldest))
      }

      recent.push(now)
      calls.set(actor, recent)
    },
  }
}
