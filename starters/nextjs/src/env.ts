/**
 * Where this project keeps a secret, and where it does not (SPEC.md §85).
 *
 * `.env` is the answer to both. It is gitignored, it is the file `.env.example`
 * documents, and both halves of this project read it back on the next boot —
 * `src/app.ts` for the application and Next.js for itself — so a credential written
 * here survives a restart without ever being typed twice.
 *
 * The place a credential must *not* go is a stream. `assemora start` inherits the
 * stdout and stderr of whatever supervises it, so a password or an API token printed
 * on boot is a password or an API token in the log aggregator, in the terminal
 * scrollback and in whatever CI keeps. `docs/rules/security.md` is unambiguous about
 * that, and a starter is the worst possible place to set the other example.
 */
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The project's own `.env`, by path rather than by working directory.
 *
 * `assemora dev` runs the server from the project root and `pnpm seed` from wherever
 * you typed it; both have to mean the same file.
 */
export const ENV_FILE = join(import.meta.dirname, '../.env')

const current = async (): Promise<string> => {
  try {
    return await readFile(ENV_FILE, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Writes `name=value` into `.env`, replacing whatever that name said before.
 *
 * Replacing rather than appending is what keeps `pnpm dev` honest: the in-memory
 * database is empty again after every restart, so the seed runs again and mints a new
 * token — and a file that grew a line each time would end up with a column of dead
 * credentials and no way to tell which one is live.
 *
 * Every other line is carried through untouched, so a `.env` written by hand keeps
 * its comments and its order.
 */
export const remember = async (name: string, value: string): Promise<void> => {
  const kept = (await current())
    .split('\n')
    .filter((line) => !line.startsWith(`${name}=`))
    .join('\n')
    .trimEnd()

  try {
    await writeFile(ENV_FILE, `${kept === '' ? '' : `${kept}\n`}${name}=${value}\n`, {
      mode: 0o600,
    })
    // `writeFile`'s mode applies only to a file it creates, so an existing `.env`
    // keeps whatever permissions it had. Narrow it either way: it holds a credential.
    await chmod(ENV_FILE, 0o600)
  } catch (cause) {
    // Loudly, rather than carrying on. The caller is about to create an account with
    // this credential, and one that went nowhere is an account nobody can sign in as.
    throw new Error(
      `${name} could not be written to ${ENV_FILE}. Set it in the environment instead.`,
      { cause },
    )
  }
}
