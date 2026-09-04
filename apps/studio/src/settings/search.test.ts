/**
 * A search that read only the open group would never find the setting somebody could
 * not name the group of. This pins that it reads every group, and how it counts.
 */
import { describe, expect, it } from 'vitest'

import { hitsOf, matches } from './search.ts'

const GROUPS = [
  {
    key: 'general',
    label: 'General',
    rows: [
      { label: 'Name', help: 'The OpenAPI title, and what an agent is told this project is.' },
      { label: 'Studio language', help: 'Every word Studio writes, in the language you read.' },
    ],
  },
  {
    key: 'media',
    label: 'Media',
    rows: [{ label: 'Largest file', help: 'Per file, as it arrives.' }],
  },
  {
    key: 'agents',
    label: 'Agents',
    rows: [{ label: 'MCP address', help: 'What an agent connects to.' }],
  },
]

describe('searching the settings', () => {
  it('matches on the help as well as the label, because the help is where a setting says what it does', () => {
    expect(matches({ label: 'Name', help: 'what an agent is told' }, 'agent')).toBe(true)
    expect(matches({ label: 'Name', help: '' }, 'agent')).toBe(false)
  })

  it('treats an empty query, and one that is only spaces, as no query at all', () => {
    expect(matches({ label: 'Name', help: '' }, '')).toBe(true)
    expect(matches({ label: 'Name', help: '' }, '   ')).toBe(true)
    expect(hitsOf(GROUPS, '  ').size).toBe(0)
  })

  it('counts hits in every group, not only the one that is open', () => {
    expect([...hitsOf(GROUPS, 'agent').entries()]).toEqual([
      ['general', 1],
      ['agents', 1],
    ])
  })

  it('finds a group by its own name with a count of zero rows, so "media" reaches Media before any row in it', () => {
    expect([...hitsOf(GROUPS, 'media').entries()]).toEqual([['media', 0]])
  })

  it('is not case sensitive, because nobody searches in the case a label was written in', () => {
    expect(hitsOf(GROUPS, 'LARGEST').get('media')).toBe(1)
  })
})
