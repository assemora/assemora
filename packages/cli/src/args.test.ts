/**
 * argv parsing (SPEC.md §77).
 *
 * The parser has no option table, so what is under test is mostly the one rule that
 * replaces it: a token starting with `-` is a flag and never the value of the flag
 * before it.
 */
import { describe, expect, it } from 'vitest'

import { bool, flag, parseArgs } from './args.js'

describe('the command and what follows it', () => {
  it('takes the first token that is not a flag as the command', () => {
    const args = parseArgs(['make:model', 'Post', '--force'])

    expect(args.command).toBe('make:model')
    expect(args.positionals).toEqual(['Post'])
  })

  it('has no command when only flags were given', () => {
    expect(parseArgs(['--help']).command).toBeUndefined()
    expect(parseArgs([]).command).toBeUndefined()
  })

  it('keeps positionals in the order they were written', () => {
    expect(parseArgs(['db:generate', 'add', 'products']).positionals).toEqual(['add', 'products'])
  })
})

describe('flags', () => {
  it('reads --flag=value without looking at the next token', () => {
    const args = parseArgs(['api:openapi', '--out=api.json', 'ignored'])

    expect(args.flags.out).toBe('api.json')
    expect(args.positionals).toEqual(['ignored'])
  })

  it('reads --flag value when what follows is not itself a flag', () => {
    expect(parseArgs(['agents', '--actor', 'u_1']).flags.actor).toBe('u_1')
  })

  it('leaves a flag boolean when what follows is another flag', () => {
    const args = parseArgs(['routes', '--json', '--debug'])

    expect(args.flags).toEqual({ json: true, debug: true })
  })

  it('leaves a flag boolean when nothing follows it at all', () => {
    expect(parseArgs(['routes', '--json']).flags.json).toBe(true)
  })

  it('keeps the last value when the same flag is written twice', () => {
    expect(parseArgs(['sdk:generate', '--out', 'a.ts', '--out', 'b.ts']).flags.out).toBe('b.ts')
  })

  it('takes a negative number as a value, because no short flag is a digit', () => {
    expect(parseArgs(['entries', '--limit', '-1']).flags.limit).toBe('-1')
  })

  it('takes a lone dash as a value, because that is what it conventionally means', () => {
    expect(parseArgs(['api:openapi', '--out', '-']).flags.out).toBe('-')
  })

  it('splits a cluster of short flags, and only its last letter takes the value', () => {
    const args = parseArgs(['inspect', '-fo', 'out.json'])

    expect(args.flags).toEqual({ f: true, o: 'out.json' })
  })

  it('does not invent an empty key for a flag with no name', () => {
    const args = parseArgs(['routes', '--=value'])

    expect(args.flags).toEqual({})
    expect(args.positionals).toEqual(['--=value'])
  })

  it('keeps an explicitly empty value rather than turning it into true', () => {
    expect(parseArgs(['routes', '--out=']).flags.out).toBe('')
  })
})

describe('the end of the parse', () => {
  it('hands everything after -- to passthrough, flags included', () => {
    const args = parseArgs(['dev', '--debug', '--', '--inspect', '--port=3000'])

    expect(args.command).toBe('dev')
    expect(args.flags).toEqual({ debug: true })
    expect(args.passthrough).toEqual(['--inspect', '--port=3000'])
  })

  it('leaves a second -- inside the passthrough, where it belongs to somebody else', () => {
    expect(parseArgs(['dev', '--', '--watch', '--', 'x']).passthrough).toEqual([
      '--watch',
      '--',
      'x',
    ])
  })

  it('passes nothing through when -- is the last token', () => {
    expect(parseArgs(['dev', '--']).passthrough).toEqual([])
  })
})

describe('reading a flag back', () => {
  it('answers the fallback for a flag nobody passed', () => {
    expect(flag(parseArgs(['routes']), 'out', 'openapi.json')).toBe('openapi.json')
    expect(flag(parseArgs(['routes']), 'out')).toBeUndefined()
  })

  it('answers the fallback for a flag written without a value', () => {
    // `--out --json` gives `out` no string, and answering "true" would be a lie a
    // handler would happily write a file to.
    expect(flag(parseArgs(['api:openapi', '--out', '--json']), 'out', 'api.json')).toBe('api.json')
  })

  it('is false for a flag nobody passed', () => {
    expect(bool(parseArgs(['db:migrate']), 'force')).toBe(false)
  })

  it('reads --force=false as a denial, because a script writes it that way', () => {
    for (const written of ['false', '0', 'no', 'off', '']) {
      expect(bool(parseArgs(['db:migrate', `--force=${written}`]), 'force')).toBe(false)
    }
  })

  it('reads any other value as agreement', () => {
    expect(bool(parseArgs(['db:migrate', '--force=yes']), 'force')).toBe(true)
    expect(bool(parseArgs(['db:migrate', '--force']), 'force')).toBe(true)
  })
})
