/**
 * `assemora console` (SPEC.md §77).
 *
 * The REPL is driven through two streams rather than a terminal, which is what makes
 * every claim below checkable: the session is typed into a `PassThrough`, and what
 * it answered is read back out of a sink. The application is a real one from
 * `@assemora/core` with a recording `run` and `shutdown` around it, because the two
 * questions worth asking of a console are what it puts in scope and whether it
 * closes what it opened.
 */
import { PassThrough, Writable } from 'node:stream'

import { type Application, type ContextInit, createApplication } from '@assemora/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type CapturedOutput, captureOutput } from '../output.js'
import { type ConsoleApplication, openConsole } from './console.js'

type Session = {
  readonly app: ConsoleApplication
  readonly stopped: () => number
  readonly lastContext: () => ContextInit | undefined
}

const sink = (): { readonly stream: Writable; readonly text: () => string } => {
  const chunks: string[] = []

  return {
    stream: new Writable({
      write(chunk: unknown, _encoding, done) {
        chunks.push(String(chunk))
        done()
      },
    }),
    text: () => chunks.join(''),
  }
}

const session = async (): Promise<Session> => {
  const application: Application = await createApplication().boot()

  let stopped = 0
  let lastContext: ContextInit | undefined

  return {
    app: {
      commands: application.commands,
      queries: application.queries,
      registry: application.registry,
      run: (init, operation) => {
        lastContext = init

        return application.run(init, operation)
      },
      shutdown: async () => {
        stopped += 1
        await application.shutdown()
      },
    },
    stopped: () => stopped,
    lastContext: () => lastContext,
  }
}

/** Everything the operator types, including the newline that submits each line. */
const typed = (...lines: readonly string[]): PassThrough => {
  const input = new PassThrough()
  for (const text of lines) input.write(`${text}\n`)

  return input
}

let output: CapturedOutput

beforeEach(() => {
  output = captureOutput()
})

afterEach(() => {
  output.restore()
})

describe('what the console puts in scope', () => {
  it('evaluates against the booted application', async () => {
    const { app } = await session()
    const written = sink()

    await openConsole(app, {
      input: typed('typeof registry.describe', '.exit'),
      output: written.stream,
      terminal: false,
    })

    expect(written.text()).toContain("'function'")
  })

  it('names all four doors, and the helper, before the first prompt', async () => {
    const { app } = await session()

    await openConsole(app, { input: typed('.exit'), output: sink().stream, terminal: false })

    for (const name of ['app', 'commands', 'queries', 'registry', 'as']) {
      expect(output.stdout).toContain(name)
    }
  })

  it('runs an operation as the user `as` was given, from the CLI', async () => {
    const { app, lastContext } = await session()

    await openConsole(app, {
      input: typed("as('ada', () => 42)", '.exit'),
      output: sink().stream,
      terminal: false,
    })

    expect(lastContext()).toEqual({ source: 'cli', actor: { type: 'user', id: 'ada' } })
  })

  it('ignores an assignment over one of the names rather than losing the session', async () => {
    const { app } = await session()
    const written = sink()

    await openConsole(app, {
      input: typed('app = null', 'typeof registry.describe', '.exit'),
      output: written.stream,
      terminal: false,
    })

    expect(written.text()).toContain("'function'")
  })

  it('puts the names back after .clear, which builds a fresh context', async () => {
    const { app } = await session()
    const written = sink()

    await openConsole(app, {
      input: typed('.clear', 'typeof commands.execute', '.exit'),
      output: written.stream,
      terminal: false,
    })

    expect(written.text()).toContain("'function'")
  })
})

describe('leaving', () => {
  it('returns on .exit rather than holding the input it was reading', async () => {
    const { app } = await session()

    // The stream is never ended: if `.exit` did not close the REPL, or the REPL did
    // not release its input, this await would never finish and the process running
    // `assemora console` would keep the terminal.
    await openConsole(app, { input: typed('.exit'), output: sink().stream, terminal: false })
  })

  it('closes the application, so the pool it opened goes with it', async () => {
    const { app, stopped } = await session()

    await openConsole(app, { input: typed('.exit'), output: sink().stream, terminal: false })

    expect(stopped()).toBe(1)
  })

  it('closes just as well when the input simply ends', async () => {
    const { app, stopped } = await session()
    const input = typed('1 + 1')
    input.end()

    await openConsole(app, { input, output: sink().stream, terminal: false })

    expect(stopped()).toBe(1)
  })
})
