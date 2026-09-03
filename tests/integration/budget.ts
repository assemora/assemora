/**
 * How long a test in this directory is given before it is called hung.
 *
 * There are two kinds of test in this repository and they were running on one budget.
 * A unit test holds nothing open, and five seconds — Vitest's default — is already
 * generous: a short deadline is the point, so a deadlock is reported while somebody is
 * still watching.
 *
 * A test in this directory is a different animal. It applies a schema, starts an
 * application and drives whole commands through a real PostgreSQL, and the heaviest of
 * them spends six and a half seconds doing it on an idle machine. So the suite passed
 * on CI and failed on a developer's — on whichever of the heavy tests lost the race for
 * the database while a hundred and fifty other files ran beside it. A budget a *passing*
 * test already spends 130% of is not a deadline, it is a coin toss, and the failure it
 * produces names the unlucky test rather than the load that caused it.
 *
 * Every file here has known this since it was written: they raise `beforeAll` and
 * `afterAll` by hand, to 15, 20, 30, 60 and 180 seconds. Only the test bodies were left
 * on the unit budget, which is the one place the number could not be written as an
 * argument.
 *
 * Hooks are deliberately not touched. Where a hook needs longer it already says so in
 * its own call, and those numbers were chosen against what that particular hook does.
 *
 * It is a *ceiling*, not a target: nothing here waits for it, and a test that reaches it
 * has hung. Vitest is what enforces this, so it cannot live in `vitest.config.ts` — the
 * per-directory form of that is `projects`, and a project swallows `--typecheck.only`,
 * which is the whole of `pnpm test:types`.
 */
import { vi } from 'vitest'

const AGAINST_REAL_INFRASTRUCTURE = 60_000

/** Called at the top of a file, before anything declares a test. */
export const realInfrastructure = (): void => {
  vi.setConfig({ testTimeout: AGAINST_REAL_INFRASTRUCTURE })
}
