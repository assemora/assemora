/**
 * What a deployment says about itself on the settings screen (ADR-0031).
 *
 * Asserted against a built application's registry rather than against the function:
 * the claim is that Studio finds the section, and a section the umbrella computed and
 * forgot to register would pass a unit test of the computation.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { auth, clearPolicies } from '@assemora/auth'
import { clearRestorers, createLogger, said, silentWriter } from '@assemora/core'
import { createMemoryAdapter } from '@assemora/database'
import { clearRouteRegistry } from '@assemora/http'
import { clearStorage, media } from '@assemora/media'
import { clearBlockRegistry } from '@assemora/pages'
import { clearResourceRegistry } from '@assemora/resources'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'
import type { AssemoraOptions } from './options.js'
import { perWindow } from './settings-groups.js'

const running: AssemoraApplication[] = []

// The registries below are process-global, and every `assemora()` fills them; the
// umbrella's own suite resets them the same way.
beforeEach(() => {
  clearPolicies()
  clearResourceRegistry()
  clearRouteRegistry()
  clearRestorers()
  clearBlockRegistry()
  clearStorage()
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((built) => built.shutdown()))
})

const build = (options: Partial<AssemoraOptions> = {}): AssemoraApplication => {
  const built = assemora({
    modules: [auth()],
    database: createMemoryAdapter(),
    logger: createLogger(silentWriter),
    ...options,
  })

  running.push(built)

  return built
}

const groupsOf = (built: AssemoraApplication) => built.app.registry.section('settings')

const rowOf = (built: AssemoraApplication, group: string, key: string) =>
  groupsOf(built)
    .find((entry) => entry.name === group)
    ?.blocks.flatMap((block) => block.rows)
    .find((row) => row.key === key)

describe('the settings section', () => {
  it('describes an application with nothing configured as General, Security and API', () => {
    expect(groupsOf(build()).map((group) => group.name)).toEqual(['general', 'security', 'api'])
  })

  it('gains a group for each thing the application declares', async () => {
    const built = build({
      modules: [auth(), media()],
      locales: ['uk', 'en'],
      mcp: true,
      project: { name: 'Shop', version: '2.0.0' },
    })

    // Media declares its own at boot, after the umbrella's; Studio orders by section,
    // so where it lands in the registry does not decide where it is drawn.
    await built.boot()

    expect(groupsOf(built).map((group) => group.name)).toEqual([
      'general',
      'security',
      'languages',
      'api',
      'agents',
      'media',
    ])
  })

  it('names the project the way OpenAPI and the MCP server do', () => {
    const built = build({ project: { name: 'Shop', version: '2.0.0', description: 'A shop' } })
    const row = rowOf(built, 'general', 'project.name')

    expect(row?.kind === 'value' && row.value).toBe('Shop')
    expect(rowOf(built, 'general', 'project.description')).toBeDefined()
  })

  it('has no Description row for a project that wrote none, rather than an empty one', () => {
    expect(rowOf(build(), 'general', 'project.description')).toBeUndefined()
  })

  it('tells the media module the ceiling the upload route was sized to, and the module says it', async () => {
    const root = join(tmpdir(), 'assemora-settings-groups')
    const built = build({
      modules: [auth(), media()],
      media: { root, maxUploadBytes: 4 * 1_048_576 },
    })

    await built.boot()

    const ceiling = rowOf(built, 'media', 'media.max-upload')
    const where = rowOf(built, 'media', 'media.where')

    expect(ceiling?.kind === 'value' && said(ceiling.value, 'en')).toBe('4 MB')
    expect(ceiling?.kind === 'value' && said(ceiling.value, 'uk')).toBe('4 МБ')
    expect(where?.kind === 'value' && where.value).toBe(root)
    expect(built.app.registry.registeredBy('settings', 'media')).toBe('media')
  })

  it('states where an agent connects, under the API prefix it was mounted below', () => {
    const built = build({ mcp: true })
    const row = rowOf(built, 'agents', 'mcp.path')

    expect(row?.kind === 'value' && row.value).toBe('/api/mcp')
  })

  it('marks the source language the registry marked, not the first one listed', () => {
    const built = build({ locales: ['en', 'uk'], defaultLocale: 'uk' })
    const row = rowOf(built, 'languages', 'locales.default')

    expect(row?.kind === 'value' && row.value).toBe('uk')
    expect(groupsOf(built).find((group) => group.name === 'languages')?.badge).toBe('2')
  })

  it('links the OpenAPI document', () => {
    expect(rowOf(build(), 'api', 'api.openapi')?.kind).toBe('link')
  })

  it('does not link a document the application switched off', () => {
    expect(rowOf(build({ api: { documentation: false } }), 'api', 'api.openapi')).toBeUndefined()
  })

  it('locks every block the umbrella declares, because every value is in the project source', () => {
    const blocks = groupsOf(build({ mcp: true, locales: ['uk'] })).flatMap((group) => group.blocks)
    const open = blocks
      .filter((block) => block.locked !== true)
      .map((block) => said(block.title, 'en'))

    expect(open).toEqual(['Documentation'])
  })
})

describe('how a number is written', () => {
  it('names a minute as a minute, and anything else in the unit it has', () => {
    expect(said(perWindow({ max: 600, windowMs: 60_000 }), 'en')).toBe('600 per minute')
    expect(said(perWindow({ max: 10, windowMs: 300_000 }), 'en')).toBe('10 per 5 minutes')
    expect(said(perWindow({ max: 5, windowMs: 30_000 }), 'en')).toBe('5 per 30 seconds')
    expect(said(perWindow({ max: 600, windowMs: 60_000 }), 'uk')).toBe('600 на хвилину')
  })
})
