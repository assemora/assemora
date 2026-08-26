/**
 * Terminal output (SPEC.md §77).
 *
 * Two things are being held to: the answer goes to stdout and nothing else does, so
 * `--json` and `--stdout` stay pipeable; and terminal formatting only happens for a
 * terminal.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type CapturedOutput,
  captureOutput,
  detail,
  fail,
  json,
  line,
  ok,
  style,
  table,
  warn,
} from './output.js'

const ESC = '\u001b'

let output: CapturedOutput
let previousNoColor: string | undefined

beforeEach(() => {
  previousNoColor = process.env.NO_COLOR
  // The environment the suite happens to run in must not decide whether the colour
  // tests mean anything, so it is taken out of the picture and put back afterwards.
  delete process.env.NO_COLOR
  output = captureOutput()
})

afterEach(() => {
  output.restore()
  if (previousNoColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = previousNoColor
})

describe('where a line goes', () => {
  it('writes the answer to stdout and everything else to stderr', () => {
    line('the answer')
    ok('done')
    warn('careful')
    fail('no')

    expect(output.stdout).toBe('the answer\ndone\n')
    expect(output.stderr).toBe('warning: careful\nerror: no\n')
  })

  it('labels a warning and an error in words, so the label survives no colour', () => {
    warn('this drops a column')
    fail('that did not happen')

    expect(output.stderr).toContain('warning: this drops a column')
    expect(output.stderr).toContain('error: that did not happen')
  })

  it('writes an aside to stderr without a label', () => {
    detail('at somewhere.ts:1:1')

    expect(output.stdout).toBe('')
    expect(output.stderr).toBe('at somewhere.ts:1:1\n')
  })

  it('writes a bare newline when a command asks for a blank line', () => {
    line()

    expect(output.stdout).toBe('\n')
  })
})

describe('colour', () => {
  it('leaves text unpainted when the stream is not a terminal', () => {
    output.restore()
    output = captureOutput({ tty: false })

    ok('done')

    expect(output.stdout).toBe('done\n')
    expect(style.dim('quiet')).toBe('quiet')
  })

  it('paints when the stream is a terminal', () => {
    output.restore()
    output = captureOutput({ tty: true })

    fail('no')

    expect(output.stderr).toBe(`${ESC}[31merror: no${ESC}[0m\n`)
    expect(style.cyan('x')).toBe(`${ESC}[36mx${ESC}[0m`)
  })

  it('obeys NO_COLOR even on a terminal', () => {
    output.restore()
    process.env.NO_COLOR = '1'
    output = captureOutput({ tty: true })

    fail('no')

    expect(output.stderr).toBe('error: no\n')
  })
})

type Row = { readonly name: string; readonly note: string }

const columns = [
  { header: 'name', value: (row: Row) => row.name },
  { header: 'note', value: (row: Row) => row.note },
]

describe('a listing as a grid', () => {
  it('writes nothing at all when there are no rows', () => {
    output.restore()
    output = captureOutput({ tty: true })

    table([], columns)

    expect(output.stdout).toBe('')
  })

  it('joins cells without padding when the output is piped', () => {
    output.restore()
    output = captureOutput({ tty: false })

    table(
      [
        { name: 'a', note: 'first' },
        { name: 'bbbb', note: 'second' },
      ],
      columns,
    )

    expect(output.stdout).toBe('name  note\na  first\nbbbb  second\n')
  })

  it('aligns the columns and dims the header on a terminal', () => {
    output.restore()
    output = captureOutput({ tty: true, width: 80 })

    table([{ name: 'a', note: 'first' }], columns)

    const lines = output.stdout.split('\n')

    expect(lines[0]).toBe(`${ESC}[2mname  note${ESC}[0m`)
    expect(lines[1]).toBe('a     first')
  })

  it('truncates the widest column to the terminal width rather than wrapping', () => {
    output.restore()
    output = captureOutput({ tty: true, width: 20 })

    table([{ name: 'articles', note: 'a very long description indeed' }], columns)

    const written = output.stdout.split('\n')[1] ?? ''

    expect(written).toContain('…')
    expect(written).not.toContain('description')
    expect(written.length).toBeLessThanOrEqual(20)
  })

  it('takes the characters off the widest column, not off every column', () => {
    output.restore()
    output = captureOutput({ tty: true, width: 20 })

    table([{ name: 'articles', note: 'a very long description indeed' }], columns)

    expect(output.stdout.split('\n')[1]).toContain('articles')
  })

  it('right-aligns a column that asks for it', () => {
    output.restore()
    output = captureOutput({ tty: true, width: 80 })

    table(
      [{ name: 'a', note: '7' }],
      [
        { header: 'count', value: (row: Row) => row.note, align: 'right' as const },
        { header: 'name', value: (row: Row) => row.name },
      ],
    )

    expect(output.stdout.split('\n')[1]).toBe('    7  a')
  })

  it('keeps a cell on one line when its value contains a newline', () => {
    output.restore()
    output = captureOutput({ tty: false })

    table([{ name: 'a', note: 'two\nlines' }], columns)

    expect(output.stdout).toBe('name  note\na  two lines\n')
  })
})

describe('the --json half of a listing', () => {
  it('prints two-space JSON to stdout with a trailing newline', () => {
    json({ routes: [{ name: 'health' }] })

    expect(output.stdout).toBe('{\n  "routes": [\n    {\n      "name": "health"\n    }\n  ]\n}\n')
  })
})
