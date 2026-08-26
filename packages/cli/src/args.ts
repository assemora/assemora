/**
 * argv, parsed by hand (SPEC.md §77).
 *
 * `node:util`'s `parseArgs` was the obvious alternative and it wants every option
 * declared before the first token is read, so that it knows which ones take a value.
 * The command table here is assembled by seven independent modules that know nothing
 * about each other's flags (ADR-0021), so the parser has to work without that table.
 * A third-party parser was never a candidate: the CLI is a framework's front door and
 * has to install instantly, which is the same reason it has no dependencies at all.
 */

export type ParsedArgs = {
  /** The first token that is not a flag — `make:model`, `db:migrate`, `routes`. */
  readonly command: string | undefined
  /** Everything else that is not a flag, in order, with the command removed. */
  readonly positionals: readonly string[]
  /**
   * Flags by their written name, `--dry-run` included: no camel-casing happens, so
   * what a handler asks for is what the user typed. A repeated flag keeps the last
   * value, because that is what a shell alias plus an override is meant to do.
   */
  readonly flags: Readonly<Record<string, string | boolean>>
  /** Everything after `--`, untouched. `dev` forwards it to node. */
  readonly passthrough: readonly string[]
}

/**
 * Whether a token is a flag rather than a value.
 *
 * This is the whole answer to "how does `--out value` know that `value` is not the
 * next flag": a token starting with `-` is a flag and never a value. `-` alone is a
 * value, because that is what it conventionally means, and `-1` is a value too — no
 * short flag is a digit, and `--limit -1` is far more common than a flag named `1`.
 * Anything genuinely ambiguous is written `--flag=value`, which never guesses.
 *
 * The price of having no option table is that a value-taking flag written *before*
 * the command would swallow it: `assemora --out x routes` leaves no command behind.
 * Flags follow the command — which is how the help prints every usage line, and how
 * anybody types it — so the case is documented rather than guessed at.
 */
const isFlagToken = (token: string | undefined): boolean =>
  token !== undefined && token.length > 1 && token.startsWith('-') && !/^-\d/.test(token)

export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  let passthrough: readonly string[] = []

  let index = 0

  while (index < argv.length) {
    const token = argv[index]
    index += 1

    if (token === undefined) continue

    // The first `--` ends the parse. A second one is somebody else's argument.
    if (token === '--') {
      passthrough = argv.slice(index)
      break
    }

    if (!isFlagToken(token)) {
      positionals.push(token)
      continue
    }

    const long = token.startsWith('--')
    const body = token.slice(long ? 2 : 1)
    const separator = body.indexOf('=')

    if (separator >= 0) {
      const name = body.slice(0, separator)
      // `--=value` names nothing; treat it as text rather than inventing an empty key.
      if (name === '') positionals.push(token)
      else flags[name] = body.slice(separator + 1)
      continue
    }

    // A cluster is `-fj`, and only its last letter can take the following value —
    // the earlier letters have nowhere to put one.
    const names = long ? [body] : [...body]
    const last = names.length - 1

    names.forEach((name, position) => {
      if (position < last) {
        flags[name] = true
        return
      }

      const next = argv[index]

      if (next !== undefined && !isFlagToken(next)) {
        flags[name] = next
        index += 1
      } else {
        flags[name] = true
      }
    })
  }

  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    flags,
    passthrough,
  }
}

/**
 * A flag's value, or the fallback.
 *
 * A flag written without a value has no string to give, so `--out --json` answers
 * the fallback rather than the word `true`: a handler that wanted a path should ask
 * for one, not receive a plausible-looking lie.
 */
export const flag = (args: ParsedArgs, name: string, fallback?: string): string | undefined => {
  const value = args.flags[name]

  return typeof value === 'string' ? value : fallback
}

/** What a scripted `--force=$SOMETHING` means when `$SOMETHING` is empty or a denial. */
const DENIALS = new Set(['', 'false', '0', 'no', 'off'])

export const bool = (args: ParsedArgs, name: string): boolean => {
  const value = args.flags[name]

  if (value === undefined) return false
  if (typeof value === 'boolean') return value

  return !DENIALS.has(value.toLowerCase())
}
