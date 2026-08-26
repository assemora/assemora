/**
 * A terminal, for a test.
 *
 * `readline` reads lines as they arrive: a stream that hands over every answer at
 * once and then ends drops the lot, because nothing had asked yet. So this models
 * what a person does — it answers a question only once the question has been asked,
 * which it tells apart from a message by the fact that a prompt is written without a
 * newline behind it.
 *
 * Running out of answers ends the input, which is what Ctrl-D does. That is
 * deliberate: a test that asks one question too many should fail the way a person
 * walking away from the terminal does.
 */
import { PassThrough, Writable } from 'node:stream'

export type Conversation = {
  readonly input: PassThrough
  readonly output: Writable
  /** Everything written to the output, prompts included. */
  text: () => string
}

export const conversation = (answers: readonly string[] = []): Conversation => {
  const input = new PassThrough()
  const written: string[] = []
  const queue = [...answers]

  const output = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      const text = String(chunk)
      written.push(text)

      if (!text.endsWith('\n')) {
        const next = queue.shift()

        // `setImmediate` so that the answer arrives after `question()` has begun
        // waiting for it, which is the order a terminal produces.
        setImmediate(() => {
          if (next === undefined) input.end()
          else input.write(`${next}\n`)
        })
      }

      done()
    },
  })

  return { input, output, text: () => written.join('') }
}

/** An output stream that only collects. */
export const collector = (): { readonly stream: Writable; text: () => string } => {
  const written: string[] = []
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      written.push(String(chunk))
      done()
    },
  })

  return { stream, text: () => written.join('') }
}
