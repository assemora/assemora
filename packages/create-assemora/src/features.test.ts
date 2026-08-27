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

  /*
   * A marker owns its line.
   *
   * Both cases here are real. The unbalanced one is why `--template nextjs` failed
   * outright: `next build` inlines a starter's source into a source map, so one line
   * of JSON quoted `// assemora:if pages` and nothing ever closed it. The balanced one
   * is worse for being quiet — a bundle that quotes both halves used to have the
   * quoting lines deleted out of it, and nothing said so.
   */
  it('leaves a marker that shares its line with content alone', () => {
    const map = '{"sourcesContent":["// assemora:if pages\\nimport { hero }"]}'

    expect(applyFeatures(map, all, 'chunk.js.map')).toBe(map)
    expect(applyFeatures(map, none, 'chunk.js.map')).toBe(map)
  })

  it('does not quietly cut the middle out of a line that quotes both halves', () => {
    const bundle = 'const a=1;/* assemora:if mcp */const b=2;/* assemora:end */const c=3'

    expect(applyFeatures(bundle, none, 'vendor.min.js')).toBe(bundle)
  })

  it('reads a marker beside comment punctuation, in every syntax a starter uses', () => {
    for (const line of [
      '// assemora:if studio',
      '# assemora:if studio',
      '<!-- assemora:if studio -->',
      ' * assemora:if studio',
      '{/* assemora:if studio */}',
    ]) {
      expect(applyFeatures([line, 'kept', '// assemora:end'].join('\n'), all, 'x')).toBe('kept')
    }
  })

  /*
   * The escape.
   *
   * A document that explains this mechanism has to be able to print it. Without an
   * escape the explanation deletes itself — which is exactly what would happen to a
   * starter README with a section on how the questions work.
   */
  it('does not read an escaped marker, and writes it into the project unescaped', () => {
    const text = [
      'Fence a few lines with:',
      '',
      '    // assemora:\\if studio',
      "    import { studio } from './studio.js'",
      '    // assemora:\\end',
    ].join('\n')

    expect(applyFeatures(text, none, 'README.md')).toBe(
      [
        'Fence a few lines with:',
        '',
        '    // assemora:if studio',
        "    import { studio } from './studio.js'",
        '    // assemora:end',
      ].join('\n'),
    )
  })

  it('unescapes inside a region that survives, and takes one that does not with it', () => {
    const text = [
      '// assemora:if studio',
      'Write `assemora:\\if pages` to fence a region.',
      '// assemora:end',
    ].join('\n')

    expect(applyFeatures(text, all, 'README.md')).toBe(
      'Write `assemora:if pages` to fence a region.',
    )
    expect(applyFeatures(text, none, 'README.md')).toBe('')
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
