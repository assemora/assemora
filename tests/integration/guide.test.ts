/**
 * The guide, held to the packages it documents (docs/rules/testing.md).
 *
 * "A public API change ships with … a documentation example that actually compiles" is
 * a rule with nothing enforcing it, and `docs/guide/05-resources.md` is what that costs:
 * eight field kinds landed and the page still listed the old seventeen, and `object()`'s
 * argument changed from a shape of schemas to a record of fields with the page saying
 * neither. Nothing was red, because nothing looks at the guide.
 *
 * Three things are checked, and between them they cover the ways that page rots.
 *
 * The **list** is compared to the registry, because a hand-maintained list of kinds is
 * precisely what drifted. The **builder names** are looked up in the package, so a
 * rename cannot survive in print. The **example** is not compared to a fixture — it is
 * written out below as real code, so `pnpm typecheck` compiles it the way it compiles
 * any test file and a changed signature stops the build; the guide is then asserted to
 * print that same source, which is what keeps the compiled half and the printed half
 * from becoming two.
 *
 * It lives here rather than in `packages/resources` for a boundary reason:
 * `@assemora/resources` compiles against `es2023` and no platform types on purpose, so
 * a test inside it may not read a file. `tests/` is where a contract over the repository
 * belongs, beside `starters.test.ts`.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createApplication, module } from '@assemora/core'
import * as resources from '@assemora/resources'
import {
  array,
  describeField,
  object,
  registeredFieldKinds,
  richText,
  text,
  url,
} from '@assemora/resources'
import { beforeAll, describe, expect, it } from 'vitest'

const PAGE = fileURLToPath(new URL('../../docs/guide/05-resources.md', import.meta.url))

let guide = ''

/** The rows of the kinds table: `| \`kind\` | builders | what it holds |`. */
let rows: readonly RegExpMatchArray[] = []

/** Indentation is the one difference a fence and a source file are allowed to have. */
const flattened = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')

beforeAll(async () => {
  guide = await readFile(PAGE, 'utf8')
  rows = [...guide.matchAll(/^\| `([a-zA-Z]+)` \| (.+?) \| .+ \|$/gm)]
})

describe('docs/guide/05-resources.md', () => {
  it('lists every field kind the registry has, and no kind it does not', () => {
    expect(rows.map((row) => row[1]).sort()).toEqual([...registeredFieldKinds()])
  })

  it('names builders that exist, so a renamed one cannot survive in print', () => {
    const named = new Set(
      rows.flatMap((row) => [...(row[2] ?? '').matchAll(/`([a-zA-Z]+)\(/g)].map((call) => call[1])),
    )

    expect(named.size).toBeGreaterThan(0)

    for (const name of named) {
      const exported = (resources as unknown as Record<string, unknown>)[String(name)]

      expect(typeof exported, String(name)).toBe('function')
    }
  })

  /**
   * The compiled half. `object()` takes fields rather than schemas — the breaking change
   * the page used to describe the other way round — and the only way that claim stays
   * true is for the example to be built by the compiler rather than read by a person.
   */
  it("compiles the guide's group and repeater, and prints what it compiled", () => {
    const author = object({
      name: text().required().label('Full name'),
      site: url(),
    })

    const sections = array(object({ heading: text().required(), body: richText() }))

    expect(describeField('author', author).fields?.map((field) => field.name)).toEqual([
      'name',
      'site',
    ])
    expect(describeField('sections', sections).element?.kind).toBe('object')

    expect(flattened(guide)).toContain(
      flattened(`
        const author = object({
          name: text().required().label('Full name'),
          site: url(),
        })

        const sections = array(object({ heading: text().required(), body: richText() }))
      `),
    )
  })
})

/**
 * The settings chapter, held the same way (ADR-0031). The group below is the one the
 * page opens with, compiled here and booted into a real registry — so a field the
 * descriptor loses, or a check `settingsGroup()` gains, breaks the build before it
 * breaks the page.
 */
const SETTINGS_PAGE = fileURLToPath(new URL('../../docs/guide/15-settings.md', import.meta.url))

describe('docs/guide/15-settings.md', () => {
  it("compiles the guide's group, registers it under its module, and prints what it compiled", async () => {
    const search = module('search').settings({
      name: 'search',
      section: 'platform',
      label: { en: 'Search', uk: 'Пошук', ru: 'Поиск' },
      icon: 'gauge',
      blurb: 'What the index holds, and where it is rebuilt.',
      blocks: [
        {
          title: 'Index',
          locked: true,
          note: 'Declared in assemora.config.ts. Changing it is a deploy, not a setting.',
          rows: [
            { key: 'search.engine', kind: 'value', label: 'Engine', value: 'Meilisearch' },
            {
              key: 'search.rebuild',
              kind: 'link',
              label: 'Rebuild',
              help: 'Every document, from scratch. Takes a minute.',
              href: '/api/queries/search.status',
              action: 'Open',
            },
          ],
        },
      ],
    })

    const app = createApplication({ modules: [search] })

    await app.boot()

    expect(app.registry.section('settings').map((group) => group.name)).toEqual(['search'])
    expect(app.registry.registeredBy('settings', 'search')).toBe('search')

    const page = await readFile(SETTINGS_PAGE, 'utf8')

    expect(flattened(page)).toContain(
      flattened(`
        export const search = module('search').settings({
          name: 'search',
          section: 'platform',
          label: { en: 'Search', uk: 'Пошук', ru: 'Поиск' },
          icon: 'gauge',
          blurb: 'What the index holds, and where it is rebuilt.',
          blocks: [
            {
              title: 'Index',
              locked: true,
              note: 'Declared in assemora.config.ts. Changing it is a deploy, not a setting.',
              rows: [
                { key: 'search.engine', kind: 'value', label: 'Engine', value: 'Meilisearch' },
                {
                  key: 'search.rebuild',
                  kind: 'link',
                  label: 'Rebuild',
                  help: 'Every document, from scratch. Takes a minute.',
                  href: '/api/queries/search.status',
                  action: 'Open',
                },
              ],
            },
          ],
        })
      `),
    )
  })
})
