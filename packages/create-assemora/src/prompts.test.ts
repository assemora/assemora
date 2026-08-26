import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { ask } from './prompts.js'
import { collector, conversation } from './streams.fixture.js'

const answering = async (
  typed: readonly string[],
  given: Parameters<typeof ask>[0] = {},
): Promise<{ readonly answers: Awaited<ReturnType<typeof ask>>; readonly out: string }> => {
  const terminal = conversation(typed)
  const answers = await ask(given, {
    input: terminal.input,
    output: terminal.output,
    interactive: true,
  })

  return { answers, out: terminal.text() }
}

describe('ask', () => {
  it('asks the five questions of SPEC.md §78, in order', async () => {
    const { out } = await answering(['demo', '', '', '', ''])

    const asked = [
      'Project name',
      'Database URL',
      'Include Studio?',
      'Include Pages?',
      'Include MCP?',
    ]
    const positions = asked.map((question) => out.indexOf(question))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toStrictEqual([...positions].sort((left, right) => left - right))
  })

  it('takes the defaults SPEC.md §78 fixes when every answer is empty', async () => {
    const { answers } = await answering(['demo', '', '', '', ''])

    expect(answers).toStrictEqual({
      name: 'demo',
      database: undefined,
      studio: true,
      pages: true,
      mcp: true,
    })
  })

  it('reads yes and no in the spellings people type', async () => {
    const { answers } = await answering(['demo', '', 'n', 'No', 'YES'])

    expect(answers.studio).toBe(false)
    expect(answers.pages).toBe(false)
    expect(answers.mcp).toBe(true)
  })

  it('asks again when the answer is neither', async () => {
    const { answers, out } = await answering(['demo', '', 'maybe', 'y', '', ''])

    expect(out).toContain('Answer y or n.')
    expect(answers.studio).toBe(true)
  })

  it('does not ask what a flag already settled', async () => {
    const { answers, out } = await answering([], {
      name: 'demo',
      database: 'postgres://localhost/demo',
      studio: false,
      pages: false,
      mcp: false,
    })

    expect(out).toBe('')
    expect(answers).toStrictEqual({
      name: 'demo',
      database: 'postgres://localhost/demo',
      studio: false,
      pages: false,
      mcp: false,
    })
  })

  it('asks nothing at all when there is nobody there, and says what it assumed', async () => {
    const output = collector()
    const answers = await ask(
      { name: 'demo' },
      { input: Readable.from([]), output: output.stream, interactive: false },
    )

    expect(answers).toStrictEqual({
      name: 'demo',
      database: undefined,
      studio: true,
      pages: true,
      mcp: true,
    })
    expect(output.text()).toBe('Studio yes, Pages yes, MCP yes, no DATABASE_URL.\n')
  })

  it('gives up rather than waiting for an answer that can never come', async () => {
    const terminal = conversation()

    await expect(
      ask({}, { input: terminal.input, output: terminal.output, interactive: true }),
    ).rejects.toThrow(/input closed/)
  })
})
