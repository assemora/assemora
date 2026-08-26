/**
 * The five questions of SPEC.md §78, asked with `node:readline/promises` and nothing
 * else.
 *
 * Every question has a flag that answers it, and `--yes` answers all of them, so the
 * command runs unattended. The rule that matters is the one about a pipeline: when
 * stdin is not a terminal nothing is asked at all, because a scaffolder that blocks
 * for ever waiting for an answer nobody can type is a scaffolder that hangs a build.
 * It says which defaults it took instead — silence there would leave somebody reading
 * a generated project wondering where the answers came from.
 */
import { createInterface } from 'node:readline/promises'

export type Answers = {
  readonly name: string
  /** Undefined means "not now": no `.env` is written, and none is invented. */
  readonly database: string | undefined
  readonly studio: boolean
  readonly pages: boolean
  readonly mcp: boolean
}

/** Whatever the invocation already settled. Anything missing is asked for. */
export type Given = {
  readonly name?: string | undefined
  readonly database?: string | undefined
  readonly studio?: boolean | undefined
  readonly pages?: boolean | undefined
  readonly mcp?: boolean | undefined
}

export type PromptSession = {
  readonly input: NodeJS.ReadableStream
  readonly output: NodeJS.WritableStream
  /** Whether there is somebody there to answer. `--yes` makes this false. */
  readonly interactive: boolean
}

/** SPEC.md §78: Studio, Pages and MCP are all in unless the answer is no. */
export const DEFAULT_ANSWERS = { studio: true, pages: true, mcp: true } as const

const YES = new Set(['y', 'yes'])
const NO = new Set(['n', 'no'])

type Ask = (question: string) => Promise<string>

/**
 * `rl.question`, but it also settles when the input goes away.
 *
 * Ctrl-D closes the interface without answering, and the promise `question()` handed
 * back would otherwise never settle — the command would sit there having asked
 * something nobody can now answer.
 */
const asking = (
  rl: ReturnType<typeof createInterface>,
): { readonly ask: Ask; readonly done: () => void } => {
  let abandon: (() => void) | undefined
  const closed = new Promise<never>((_, reject) => {
    abandon = (): void => {
      reject(new Error('The input closed before the questions were answered.'))
    }
  })

  rl.once('close', () => abandon?.())

  return {
    ask: (question) => Promise.race([rl.question(question), closed]),
    // Nothing awaits `closed` once the questions are over, and an unobserved
    // rejection is a warning printed over the "Next" lines.
    done: () => {
      closed.catch(() => {})
    },
  }
}

const text = async (ask: Ask, question: string, fallback: string): Promise<string> => {
  const shown = fallback === '' ? `${question}: ` : `${question} (${fallback}): `
  const answer = (await ask(shown)).trim()

  return answer === '' ? fallback : answer
}

const confirm = async (
  ask: Ask,
  output: NodeJS.WritableStream,
  question: string,
  fallback: boolean,
): Promise<boolean> => {
  for (;;) {
    const answer = (await ask(`${question} ${fallback ? '(Y/n) ' : '(y/N) '}`)).trim().toLowerCase()

    if (answer === '') return fallback
    if (YES.has(answer)) return true
    if (NO.has(answer)) return false

    output.write('Answer y or n.\n')
  }
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')

/**
 * The answers, asked for or assumed.
 *
 * A `name` that arrived as an argument is not asked for again, and neither is
 * anything a flag already settled — the minimum SPEC.md §78 asks for is the minimum
 * that is still unknown.
 */
export const ask = async (given: Given, session: PromptSession): Promise<Answers> => {
  const defaults: Answers = {
    name: given.name ?? '',
    database: given.database,
    studio: given.studio ?? DEFAULT_ANSWERS.studio,
    pages: given.pages ?? DEFAULT_ANSWERS.pages,
    mcp: given.mcp ?? DEFAULT_ANSWERS.mcp,
  }

  if (!session.interactive) {
    session.output.write(
      `Studio ${yesNo(defaults.studio)}, Pages ${yesNo(defaults.pages)}, MCP ${yesNo(defaults.mcp)}` +
        `${defaults.database === undefined ? ', no DATABASE_URL' : ''}.\n`,
    )

    return defaults
  }

  const rl = createInterface({ input: session.input, output: session.output })
  const { ask: question, done } = asking(rl)

  try {
    const name = given.name ?? (await text(question, 'Project name', ''))
    // An empty answer is "not now" rather than an empty URL: no `.env` is written,
    // and nothing is invented to put in one.
    const answered = given.database ?? (await text(question, 'Database URL', ''))

    return {
      name,
      database: answered === '' ? undefined : answered,
      studio: given.studio ?? (await confirm(question, session.output, 'Include Studio?', true)),
      pages: given.pages ?? (await confirm(question, session.output, 'Include Pages?', true)),
      mcp: given.mcp ?? (await confirm(question, session.output, 'Include MCP?', true)),
    }
  } finally {
    rl.close()
    done()
  }
}
