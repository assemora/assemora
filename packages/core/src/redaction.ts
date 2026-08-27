/**
 * What an error may carry across the boundary to a third party (SPEC.md §85, §88).
 *
 * An error tracker is somebody else's server by definition, so an error is stripped
 * on the way *in* to the port rather than trusted to whoever implements it. The rule
 * this repository already follows is that values never travel in a message — a driver
 * error is translated with its parameter list removed
 * (`@assemora/database-postgres/src/errors.ts`) — and this is the floor underneath
 * that rule, for every message nobody wrote with a reporter in mind.
 *
 * It redacts; it does not decrypt. A secret written as ordinary prose still gets
 * through, so the rule remains "never put a secret in a message". What this
 * guarantees is that the shapes secrets actually arrive in — a connection string, a
 * keyed value, a session cookie, a bearer credential, a JWT — do not, and that
 * everything that was not a message or a stack frame is dropped rather than judged.
 *
 * It also runs synchronously on the failure path of every request, which makes its
 * cost the whole process's cost. Two rules keep it there: every pattern is linear in
 * the length of what it is given, and there is a ceiling on how much it is given at
 * all. Both are load-bearing, and the comments below say which is which.
 */

/**
 * `postgres://ada:hunter2@db:5432/app` — the credentials go, the host stays.
 *
 * The user name goes with the password: it is half of a credential, and knowing
 * which database host was unreachable is the part that makes the message useful.
 *
 * `(?<![\w+.-])` rather than `\b`, because `.` and `-` are not word characters: a
 * word boundary let the scheme start again after every dot, and `[a-z0-9+.-]*` then
 * walked the rest of the run from each of those starts. `'ab.'.repeat(13_000)` cost
 * 895 ms for that reason. Anchored to the start of a run it is one walk.
 */
const URL_CREDENTIALS = /(?<![\w+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

/**
 * `password=hunter2`, `"token": "abc"`, `Authorization: Bearer eyJ…`, and the shape
 * that reached a reporter verbatim: `cookie: assemora_session=ses_…`.
 *
 * The pattern matches *every* `key = value` pair and the decision about the key is
 * made in `namesASecret` rather than inside the pattern. That is the fix for a real
 * denial of service, not a refactor. The rule this replaces was
 * `[\w.-]*(?:password|…)[\w.-]*`, which makes the engine consume a run of key
 * characters and then walk back over all of it looking for the keyword — at every
 * starting position, and again for every position where the keyword did match. A
 * message carrying an upstream response body is one such run: 80 000 characters of
 * it cost 13.6 seconds of blocked event loop, and 10 000 characters of `token`
 * repeated cost 131 seconds. Here the run is consumed once, left to right, and
 * nothing searches backwards.
 *
 * The value still runs to the end of its field rather than to the next space,
 * because in `Authorization: Bearer x` the secret is one word further along than a
 * space-terminated match would reach. Over-redaction is the safe direction here: a
 * sentence swallowed by an over-eager match costs a debugging session, and a token
 * that got through costs an incident.
 */
const KEYED_PAIR = /(?<![\w.-])([\w.-]+)(["']?\s*[:=]>?\s*["']?)[^\n,;&)}\]"']*/g

/**
 * A key whose value is a credential, matched anywhere inside the key.
 *
 * *Containing* one of these words rather than being one, because the names secrets
 * actually arrive under are `DATABASE_PASSWORD`, `PGPASSWORD`, `x-api-key`,
 * `access_token`, `set-cookie` and `assemora_session`, and a rule anchored on the
 * bare word would have matched none of them.
 *
 * `cookie`, `session` and `csrf` are here because `assemora_session` is not one
 * secret among many: it is minted by `@assemora/auth` on every login and it is the
 * credential the whole application runs on, so a `Cookie` header in a message is a
 * live credential in a message.
 */
const SECRET_KEY =
  /password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|credentials?|authorization|cookie|session|sessid|csrf|xsrf/i

/**
 * `sid` is the one word that has to be a whole segment of a key rather than any part
 * of one: as a substring it lives inside `inside`, `resident` and `subsidiary`, and a
 * redactor that eats `inside=true` is one nobody believes about the rest of the line.
 */
const SID_KEY = /(?:^|[^a-z])sid(?:[^a-z]|$)/i

const namesASecret = (key: string): boolean => SECRET_KEY.test(key) || SID_KEY.test(key)

const withoutKeyedSecrets = (text: string): string => {
  KEYED_PAIR.lastIndex = 0

  let redacted = ''
  let copiedTo = 0
  let match = KEYED_PAIR.exec(text)

  while (match !== null) {
    const key = match[1] ?? ''
    const separator = match[2] ?? ''

    if (namesASecret(key)) {
      redacted += `${text.slice(copiedTo, match.index)}${key}${separator}***`
      copiedTo = match.index + match[0].length
    } else {
      // Only the key and its separator are stepped over, never the value. A value
      // runs to the end of its field, so `user=ada password=hunter2` is a single
      // match whose key names nothing — and skipping past all of it would carry the
      // password out of reach. At least one character either way: a step that stood
      // still would loop forever, and the groups are only optional to TypeScript.
      KEYED_PAIR.lastIndex = match.index + Math.max(key.length + separator.length, 1)
    }

    match = KEYED_PAIR.exec(text)
  }

  return redacted + text.slice(copiedTo)
}

/** A credential that names its own scheme, with no key in front of it. */
const BEARER = /\b(bearer|basic)\s+[\w.+/=-]+/gi

/** A JWT is a secret wherever it appears, and its first three characters say so. */
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g

/**
 * A credential this framework minted itself.
 *
 * `@assemora/auth` issues `ses_`, `ast_` and `agt_` followed by 256 url-safe bits
 * (`packages/auth/src/credentials.ts`), and that is a shape in exactly the sense a
 * JWT is one: a secret wherever it turns up, key or no key. The keyed rule above
 * covers `sessionId=ses_…`; this covers `no actor for ses_…`, which is how a session
 * id actually ends up in a message somebody wrote by hand.
 *
 * Three literals rather than an import: core may not depend on `auth` (SPEC.md §8),
 * and it already knows what a connection string and a JWT look like without owning
 * either.
 */
const ASSEMORA_CREDENTIAL = /\b(?:ses|ast|agt)_[A-Za-z0-9_-]{20,}/g

const scrub = (text: string): string =>
  withoutKeyedSecrets(text.replace(URL_CREDENTIALS, '$1***@'))
    .replace(BEARER, '$1 ***')
    .replace(JWT, '***')
    .replace(ASSEMORA_CREDENTIAL, '***')

/**
 * An error message is one line by convention, and what follows a newline is a dump.
 *
 * The driver error of `@assemora/database-postgres` is the worked example: the
 * statement is on the first line and the parameter values — an email, a token digest,
 * a password on its way to be compared — are on the second.
 */
const firstLine = (text: string): string => {
  const newline = text.indexOf('\n')

  return newline === -1 ? text : text.slice(0, newline)
}

/**
 * The ceiling on what is scrubbed at all, and the other half of the fix above.
 *
 * A linear pattern is still linear in something an attacker chooses: any handler that
 * interpolates an upstream response body into its message decides how much text the
 * redactor is handed, on a path that is synchronous and that runs once per failure —
 * so the size of the input is not something to leave open. Two thousand characters is
 * past the length of any message a person wrote, and fifty frames is past the depth
 * anybody reads; together with `MAX_CAUSE_DEPTH` they put a fixed ceiling on the work
 * one incident can cost, whatever it was carrying.
 *
 * The truncation is announced rather than silent. A message that simply stops reads
 * as the whole message, and a stack that simply stops reads as the bottom of the call.
 */
const MAX_CHARACTERS = 2_000
const MAX_FRAMES = 50

const capped = (text: string): string =>
  text.length <= MAX_CHARACTERS
    ? text
    : `${text.slice(0, MAX_CHARACTERS)} … (${text.length - MAX_CHARACTERS} more characters)`

/** Cut down to size first, then scrubbed — never the other way round. */
const clean = (text: string): string => scrub(capped(text))

const FRAME = /^\s+at\s/

/** Never throws: a value with a hostile `toString` must not become the incident. */
const describe = (value: unknown): string => {
  try {
    return String(value)
  } catch {
    return 'Something that cannot be described was thrown'
  }
}

/**
 * A stack rebuilt from its frames alone.
 *
 * V8 writes `<name>: <message>` and then the frames, so anything else in there came
 * from a message that was more than a message. Rebuilding rather than editing means
 * a dump cannot survive by being shaped in a way no pattern anticipated.
 */
const stackFrom = (stack: string, name: string, message: string): string => {
  const frames = stack.split('\n').filter((line) => FRAME.test(line))
  const dropped = frames.length - MAX_FRAMES

  return [
    message === '' ? name : `${name}: ${message}`,
    ...frames.slice(0, MAX_FRAMES).map((line) => clean(line)),
    ...(dropped > 0 ? [`    … (${dropped} more frames)`] : []),
  ].join('\n')
}

/**
 * How deep a cause chain is followed.
 *
 * A cycle is the reason there is a limit at all — `a.cause = b; b.cause = a` is legal
 * and would recurse forever — and five is past the depth any real chain reaches.
 */
const MAX_CAUSE_DEPTH = 5

const rebuild = (thrown: unknown, depth: number): Error => {
  const source = thrown instanceof Error ? thrown : undefined
  const name = source?.name ?? 'Error'
  const message = clean(firstLine(source === undefined ? describe(thrown) : source.message))

  const redacted = new Error(message)
  redacted.name = name

  if (source?.stack === undefined) {
    // `new Error()` collected a stack pointing at this function, which would name
    // redaction as the origin of every error somebody threw as a string.
    delete redacted.stack
  } else {
    redacted.stack = stackFrom(source.stack, name, message)
  }

  const cause = source?.cause
  if (cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH) {
    redacted.cause = rebuild(cause, depth + 1)
  }

  return redacted
}

/**
 * The error a reporter is allowed to see: name, first line of the message, stack
 * frames, and the same again for every cause.
 *
 * Deliberately *not* the error that was thrown. Handing the original over beside the
 * redacted one would make redaction advisory, and an `AssemoraError`'s `details` is
 * `unknown` — core cannot know what a policy or a handler put in there, and a
 * redactor that walks an arbitrary object and guesses is one that will one day guess
 * wrong. The code and the status, which are constants, travel on the report instead.
 */
export const redactError = (thrown: unknown): Error => rebuild(thrown, 0)
