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
import { clearRestorers, createLogger, silentWriter } from '@assemora/core'
import { createMemoryAdapter } from '@assemora/database'
import { clearRouteRegistry } from '@assemora/http'
import { clearStorage, media } from '@assemora/media'
import { clearBlockRegistry } from '@assemora/pages'
import { clearResourceRegistry } from '@assemora/resources'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AssemoraApplication, assemora } from './assemora.js'
import type { AssemoraOptions } from './options.js'
import { megabytes, perWindow } from './settings-groups.js'

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

  it('gains a group for each thing the application declares, in sidebar order', () => {
    const built = build({
      modules: [auth(), media()],
      locales: ['uk', 'en'],
      mcp: true,
      project: { name: 'Shop', version: '2.0.0' },
    })

    expect(groupsOf(built).map((group) => group.name)).toEqual([
      'general',
      'security',
      'languages',
      'media',
      'api',
      'agents',
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

  it('states the upload ceiling the upload route was actually sized to', () => {
    // A root is required beside the ceiling, and never written to: nothing here boots.
    const built = build({
      modules: [auth(), media()],
      media: { root: join(tmpdir(), 'assemora-settings-groups'), maxUploadBytes: 4 * 1_048_576 },
    })
    const row = rowOf(built, 'media', 'media.max-upload')

    expect(row?.kind === 'value' && row.value).toBe('4 MB')
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
    const open = blocks.filter((block) => block.locked !== true).map((block) => block.title)

    expect(open).toEqual(['Documentation'])
  })
})

describe('how a number is written', () => {
  it('prints whole megabytes without a decimal and a fraction with one', () => {
    expect(megabytes(16 * 1_048_576)).toBe('16 MB')
    expect(megabytes(1_500_000)).toBe('1.4 MB')
  })

  it('names a minute as a minute, and anything else in the unit it has', () => {
    expect(perWindow({ max: 600, windowMs: 60_000 })).toBe('600 per minute')
    expect(perWindow({ max: 10, windowMs: 300_000 })).toBe('10 per 5 minutes')
    expect(perWindow({ max: 5, windowMs: 30_000 })).toBe('5 per 30 seconds')
  })
})
