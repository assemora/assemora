import { describe, expect, it } from 'vitest'

import { said } from './said.ts'

describe('a sentence said in several languages', () => {
  it('is read in the language on screen when the application wrote it', () => {
    expect(said({ en: 'Largest file', uk: 'Найбільший файл' }, 'uk')).toBe('Найбільший файл')
  })

  it('falls back to the first language written, not to English by name', () => {
    expect(said({ uk: 'Найбільший файл', en: 'Largest file' }, 'de')).toBe('Найбільший файл')
  })

  it('reads a plain string as the one every reader gets', () => {
    expect(said('/api/mcp', 'uk')).toBe('/api/mcp')
  })
})
