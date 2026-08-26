/**
 * Writing to a terminal (SPEC.md §77).
 *
 * Two rules run through everything here. Anything that is not the answer — a
 * warning, an error, a stack — goes to stderr, so `assemora api:openapi --stdout`
 * and `assemora routes --json` stay pipeable. And terminal formatting is for a
 * terminal: colour needs a TTY with `NO_COLOR` unset, and column alignment needs a
 * TTY at all, because a pipe wants the data rather than the padding.
 *
 * The write target is a module-level seam rather than a parameter every command
 * would have to thread. `captureOutput()` is what a test installs in its place.
 */

/** What this module writes to. `process.stdout` and `process.stderr` satisfy it. */
export type OutputStream = {
  write(text: string): unknown
  readonly isTTY?: boolean
  readonly columns?: number
}

export type OutputTarget = {
  readonly stdout: OutputStream
  readonly stderr: OutputStream
}

const processTarget = (): OutputTarget => ({ stdout: process.stdout, stderr: process.stderr })

let target: OutputTarget = processTarget()

/** Sends output somewhere else. Tests use `captureOutput()`; this is the raw seam. */
export const useOutput = (next: OutputTarget): void => {
  target = next
}

export const resetOutput = (): void => {
  target = processTarget()
}

export type CapturedOutput = {
  /** Everything written to stdout so far. */
  readonly stdout: string
  /** Everything written to stderr so far. */
  readonly stderr: string
  restore(): void
}

/**
 * Records output instead of printing it.
 *
 * `tty` decides whether the captured run believes it is talking to a terminal, so a
 * test can assert both the aligned form and the piped one; it defaults to `false`,
 * which is the form assertions are written against.
 */
export const captureOutput = (
  options: { readonly tty?: boolean; readonly width?: number } = {},
): CapturedOutput => {
  const previous = target
  const out: string[] = []
  const err: string[] = []

  const stream = (sink: string[]): OutputStream => ({
    write: (text: string) => sink.push(text),
    isTTY: options.tty ?? false,
    columns: options.width ?? 80,
  })

  target = { stdout: stream(out), stderr: stream(err) }

  return {
    get stdout() {
      return out.join('')
    },
    get stderr() {
      return err.join('')
    },
    restore: () => {
      target = previous
    },
  }
}

const RESET = '\u001b[0m'

const CODES = {
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
} as const

export type StyleName = keyof typeof CODES

/**
 * `NO_COLOR` set to anything non-empty turns colour off everywhere, which is the
 * whole of https://no-color.org — the value is never inspected.
 */
const colourAllowed = (stream: OutputStream): boolean =>
  stream.isTTY === true && (process.env.NO_COLOR ?? '') === ''

const paint = (stream: OutputStream, name: StyleName, text: string): string =>
  colourAllowed(stream) ? `${CODES[name]}${text}${RESET}` : text

/**
 * Colour for text a command writes to stdout itself.
 *
 * Each call asks at the moment it is made, so installing a capture target before it
 * runs is enough to turn colour off — nothing is decided at import time.
 */
export const style: Readonly<Record<StyleName, (text: string) => string>> = {
  bold: (text) => paint(target.stdout, 'bold', text),
  dim: (text) => paint(target.stdout, 'dim', text),
  red: (text) => paint(target.stdout, 'red', text),
  green: (text) => paint(target.stdout, 'green', text),
  yellow: (text) => paint(target.stdout, 'yellow', text),
  cyan: (text) => paint(target.stdout, 'cyan', text),
}

/** One line to stdout. This is the answer; everything else is commentary. */
export const line = (text = ''): void => {
  target.stdout.write(`${text}\n`)
}

/** A line that reports success. */
export const ok = (text: string): void => {
  target.stdout.write(`${paint(target.stdout, 'green', text)}\n`)
}

/**
 * Something the command did anyway, and the reader has to know about — a
 * destructive column drop, a skipped file (SPEC.md §34).
 *
 * The `warning:` word is not decoration: it is the only part of the classification
 * that survives colour being unavailable.
 */
export const warn = (text: string): void => {
  target.stderr.write(`${paint(target.stderr, 'yellow', `warning: ${text}`)}\n`)
}

/** Something the command did not do. */
export const fail = (text: string): void => {
  target.stderr.write(`${paint(target.stderr, 'red', `error: ${text}`)}\n`)
}

/** Secondary context on stderr — a stack under `--debug`, a hint under an error. */
export const detail = (text: string): void => {
  target.stderr.write(`${paint(target.stderr, 'dim', text)}\n`)
}

/** The `--json` half of every listing. Two-space indent, because a human reads it too. */
export const json = (value: unknown): void => {
  target.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export type Column<Row> = {
  readonly header: string
  readonly value: (row: Row) => string
  readonly align?: 'left' | 'right'
}

const GAP = '  '

/** Below this a truncated column shows more ellipsis than content. */
const MIN_WIDTH = 6

const cellText = (text: string): string => text.replace(/[\r\n\t]+/g, ' ')

const truncate = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}…`

const pad = (text: string, width: number, align: 'left' | 'right'): string =>
  align === 'right' ? text.padStart(width) : text.padEnd(width)

/**
 * Shrinks the widest column, one character at a time, until the row fits.
 *
 * Taking it off the widest column is what keeps a listing readable: an over-long
 * description loses characters while the name and the method beside it keep all of
 * theirs, which is the opposite of what shrinking everything proportionally does.
 */
const fit = (widths: readonly number[], available: number): number[] => {
  const fitted = [...widths]
  const gaps = GAP.length * Math.max(fitted.length - 1, 0)

  let total = fitted.reduce((sum, width) => sum + width, 0) + gaps

  while (total > available) {
    let widest = 0

    for (let index = 1; index < fitted.length; index += 1) {
      if ((fitted[index] ?? 0) > (fitted[widest] ?? 0)) widest = index
    }

    if ((fitted[widest] ?? 0) <= MIN_WIDTH) break

    fitted[widest] = (fitted[widest] ?? 0) - 1
    total -= 1
  }

  return fitted
}

/**
 * A listing, as a grid.
 *
 * A long cell is truncated rather than wrapped. A wrapped cell turns a forty-row
 * listing into a paragraph and destroys the one thing a grid is for — reading down a
 * column — and nothing is lost by it, because every listing also answers `--json`,
 * which is what the next command in the pipe wanted anyway (ADR-0021).
 *
 * No rows means no output. An empty grid says less than the sentence the command can
 * write instead, so the command writes it.
 */
export const table = <Row>(rows: readonly Row[], columns: readonly Column<Row>[]): void => {
  if (rows.length === 0 || columns.length === 0) return

  const header = columns.map((column) => cellText(column.header))
  const body = rows.map((row) => columns.map((column) => cellText(column.value(row))))

  const aligned = target.stdout.isTTY === true

  if (!aligned) {
    // Piped: the separator is all the structure a reader downstream can use, and
    // padding a column to a width nobody can see only adds trailing whitespace.
    target.stdout.write(`${[header, ...body].map((cells) => cells.join(GAP)).join('\n')}\n`)
    return
  }

  const natural = columns.map((_, index) =>
    Math.max(header[index]?.length ?? 0, ...body.map((cells) => cells[index]?.length ?? 0)),
  )

  const available = typeof target.stdout.columns === 'number' ? target.stdout.columns : 80
  const widths = fit(natural, available)

  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => {
        const width = widths[index] ?? cell.length
        const shown = truncate(cell, width)

        // The last column is never padded: trailing spaces are invisible until
        // somebody copies the line out of the terminal.
        return index === cells.length - 1 && (columns[index]?.align ?? 'left') === 'left'
          ? shown
          : pad(shown, width, columns[index]?.align ?? 'left')
      })
      .join(GAP)

  target.stdout.write(`${paint(target.stdout, 'dim', render(header))}\n`)

  for (const cells of body) target.stdout.write(`${render(cells)}\n`)
}
