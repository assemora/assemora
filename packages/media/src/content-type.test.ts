import { describe, expect, it } from 'vitest'

import { safeContentType } from './content-type.js'

describe('what a browser is told a stored file is (SPEC.md §85)', () => {
  it('lets an image be an image', () => {
    expect(safeContentType('image/png')).toBe('image/png')
    expect(safeContentType('IMAGE/PNG')).toBe('image/png')
    expect(safeContentType('application/pdf')).toBe('application/pdf')
  })

  it('refuses to call an upload a document, whoever asked', () => {
    // Otherwise the media library is a way to run a script on this origin.
    for (const dangerous of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/javascript',
      'application/javascript',
      'text/xml',
    ]) {
      expect(safeContentType(dangerous)).toBe('application/octet-stream')
    }
  })

  it('refuses anything it does not recognise', () => {
    expect(safeContentType('application/x-invented')).toBe('application/octet-stream')
    expect(safeContentType('')).toBe('application/octet-stream')
  })
})
