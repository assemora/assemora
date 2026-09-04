/**
 * A settings group is data that has to be drawable, and the declaration is where a
 * mistake in it is refused (ADR-0031).
 */
import { describe, expect, it } from 'vitest'

import { createApplication } from './application.js'
import { module } from './module.js'
import { type SettingsGroupDescriptor, settingsGroup } from './settings.js'

const GROUP: SettingsGroupDescriptor = {
  name: 'search',
  section: 'platform',
  label: 'Search',
  icon: 'gauge',
  blocks: [
    {
      title: 'Index',
      rows: [
        { key: 'search.index', kind: 'value', label: 'Documents', value: '1 204' },
        {
          key: 'search.rebuild',
          kind: 'link',
          label: 'Rebuild',
          href: '/api/search',
          action: 'Open',
        },
      ],
    },
  ],
}

describe('settingsGroup', () => {
  it('answers with the group it was given when nothing about it is wrong', () => {
    expect(settingsGroup(GROUP)).toBe(GROUP)
  })

  it('refuses a name that is not kebab-case, because it becomes an address', () => {
    expect(() => settingsGroup({ ...GROUP, name: 'Search Index' })).toThrow(/kebab-case/)
  })

  it('refuses a section the sidebar does not have', () => {
    expect(() =>
      settingsGroup({ ...GROUP, section: 'billing' as SettingsGroupDescriptor['section'] }),
    ).toThrow(/workspace, content, platform/)
  })

  it('refuses an icon that is not a name, the way a resource does', () => {
    expect(() => settingsGroup({ ...GROUP, icon: 'CreditCard' })).toThrow(/icon name/)
  })

  it('refuses a group with nothing in it rather than drawing an empty screen', () => {
    expect(() => settingsGroup({ ...GROUP, blocks: [] })).toThrow(/no blocks/)
    expect(() => settingsGroup({ ...GROUP, blocks: [{ title: 'Index', rows: [] }] })).toThrow(
      /no rows/,
    )
  })

  it('refuses two blocks with one title, because a reader could not tell the decisions apart', () => {
    const block = GROUP.blocks[0]

    if (block === undefined) throw new Error('the fixture lost its block')

    expect(() =>
      settingsGroup({
        ...GROUP,
        blocks: [block, { ...block, rows: [{ ...block.rows[0], key: 'search.other' } as never] }],
      }),
    ).toThrow(/used twice/)
  })

  it('refuses a row key used twice, because a search would count two rows as one', () => {
    const row = GROUP.blocks[0]?.rows[0]

    if (row === undefined) throw new Error('the fixture lost its row')

    expect(() =>
      settingsGroup({ ...GROUP, blocks: [{ title: 'Index', rows: [row, row] }] }),
    ).toThrow(/used twice/)
  })

  it('refuses a row key that is not a dotted path of names', () => {
    const row = GROUP.blocks[0]?.rows[0]

    if (row === undefined) throw new Error('the fixture lost its row')

    expect(() =>
      settingsGroup({
        ...GROUP,
        blocks: [{ title: 'Index', rows: [{ ...row, key: 'Search Index' }] }],
      }),
    ).toThrow(/dotted path/)
  })
})

describe('module().settings()', () => {
  it('registers the group under the module that declared it, in the settings section', async () => {
    const app = createApplication({ modules: [module('search').settings(GROUP)] })

    await app.boot()

    expect(app.registry.section('settings').map((group) => group.name)).toEqual(['search'])
    expect(app.registry.registeredBy('settings', 'search')).toBe('search')
  })

  it('calls a group given as a function at boot, for values that are not known before', async () => {
    let known = 'nothing yet'
    const app = createApplication({
      modules: [
        module('search').settings(() => ({
          ...GROUP,
          blocks: [
            {
              title: 'Index',
              rows: [{ key: 'search.index', kind: 'value', label: 'Documents', value: known }],
            },
          ],
        })),
      ],
    })

    known = '1 204'
    await app.boot()

    const row = app.registry.section('settings')[0]?.blocks[0]?.rows[0]

    expect(row?.kind === 'value' && row.value).toBe('1 204')
    expect(app.registry.registeredBy('settings', 'search')).toBe('search')
  })

  it('refuses a wrong group where it was written, not when the application boots', () => {
    expect(() => module('search').settings({ ...GROUP, blocks: [] })).toThrow(/no blocks/)
  })
})
