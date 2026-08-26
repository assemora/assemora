import { describe, expect, it } from 'vitest'

import { applyFeatures, FEATURES, type Features, isFeature } from './features.js'

const all: Features = { studio: true, pages: true, mcp: true }
const none: Features = { studio: false, pages: false, mcp: false }

describe('applyFeatures', () => {
  it('keeps a region whose feature is included, without its markers', () => {
    const text = ['before', '// assemora:if studio', 'studio()', '// assemora:end', 'after'].join(
      '\n',
    )

    expect(applyFeatures(text, all, 'app.ts')).toBe('before\nstudio()\nafter')
  })

  it('removes a region whose feature is declined', () => {
    const text = ['before', '// assemora:if studio', 'studio()', '// assemora:end', 'after'].join(
      '\n',
    )

    expect(applyFeatures(text, none, 'app.ts')).toBe('before\nafter')
  })

  it('reads a marker out of any comment syntax, because the whole line goes', () => {
    const text = ['# assemora:if mcp', 'MCP_TOKEN=', '# assemora:end'].join('\n')

    expect(applyFeatures(text, all, '.env.example')).toBe('MCP_TOKEN=')
    expect(applyFeatures(text, none, '.env.example')).toBe('')
  })

  it('inverts a region marked with "!"', () => {
    const text = ['<!-- assemora:if !pages -->', 'No page builder.', '<!-- assemora:end -->'].join(
      '\n',
    )

    expect(applyFeatures(text, all, 'README.md')).toBe('')
    expect(applyFeatures(text, none, 'README.md')).toBe('No page builder.')
  })

  it('nests, so a line can depend on two answers', () => {
    const text = [
      '// assemora:if studio',
      'studio()',
      '// assemora:if pages',
      'builder()',
      '// assemora:end',
      '// assemora:end',
    ].join('\n')

    expect(applyFeatures(text, all, 'app.ts')).toBe('studio()\nbuilder()')
    expect(applyFeatures(text, { ...all, pages: false }, 'app.ts')).toBe('studio()')
    expect(applyFeatures(text, { ...all, studio: false }, 'app.ts')).toBe('')
  })

  it('leaves a file with no marker exactly as it was', () => {
    const text = 'one\n\n\n\n\ntwo\n'

    expect(applyFeatures(text, all, 'app.ts')).toBe(text)
  })

  it('closes the hole a removed region leaves', () => {
    const text = ['one', '', '// assemora:if mcp', 'mcp()', '// assemora:end', '', 'two'].join('\n')

    expect(applyFeatures(text, none, 'app.ts')).toBe('one\n\ntwo')
  })

  it('refuses a feature nobody is asked about, naming the line', () => {
    const text = ['// assemora:if studios', 'studio()', '// assemora:end'].join('\n')

    expect(() => applyFeatures(text, all, 'app.ts')).toThrow(/app\.ts:1: "studios"/)
  })

  it('refuses a region that is never closed', () => {
    const text = ['one', '// assemora:if mcp', 'mcp()'].join('\n')

    expect(() => applyFeatures(text, all, 'app.ts')).toThrow(/on line 2 is never closed/)
  })

  it('refuses an end that closes nothing', () => {
    expect(() => applyFeatures('// assemora:end', all, 'app.ts')).toThrow(/never opened/)
  })

  it('does not mistake a longer word for the end marker', () => {
    const text = ['// assemora:if mcp', '// assemora:endpoint is not a marker', 'mcp()'].join('\n')

    expect(() => applyFeatures(text, all, 'app.ts')).toThrow(/never closed/)
  })
})

describe('FEATURES', () => {
  it('is the three questions SPEC.md §78 asks', () => {
    expect(FEATURES).toStrictEqual(['studio', 'pages', 'mcp'])
  })

  it('recognises only those', () => {
    expect(isFeature('studio')).toBe(true)
    expect(isFeature('auth')).toBe(false)
  })
})
