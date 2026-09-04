/**
 * What the media library says about itself on the settings screen (ADR-0031).
 *
 * Declared by this module rather than by the process that serves it, because this is
 * the module that holds the bytes: it is the one that knows which driver it was handed
 * and where that driver keeps things.
 */
import { createApplication } from '@assemora/core'
import { afterEach, describe, expect, it } from 'vitest'

import { media } from './index.js'
import { s3Storage } from './s3-storage.js'
import { clearStorage, localStorage, useStorage, useUploadLimit } from './storage.js'

afterEach(() => {
  clearStorage()
})

const rows = async () => {
  const app = createApplication({ modules: [media()] })

  await app.boot()

  const group = app.registry.section('settings').find((entry) => entry.name === 'media')

  return {
    group,
    row: (key: string) =>
      group?.blocks.flatMap((block) => block.rows).find((row) => row.key === key),
    by: app.registry.registeredBy('settings', 'media'),
  }
}

describe('the media group', () => {
  it('is declared by this module, at boot, once the driver is known', async () => {
    useStorage(localStorage({ root: '/srv/files' }))

    const { group, by } = await rows()

    expect(group?.section).toBe('content')
    expect(by).toBe('media')
  })

  it('says the ceiling it was told, and the default when it was told nothing', async () => {
    useStorage(localStorage({ root: '/srv/files' }))

    const before = await rows()
    const told = before.row('media.max-upload')

    expect(told?.kind === 'value' && told.value).toBe('16 MB')

    clearStorage()
    useStorage(localStorage({ root: '/srv/files' }))
    useUploadLimit(2 * 1_048_576)

    const after = await rows()
    const changed = after.row('media.max-upload')

    expect(changed?.kind === 'value' && changed.value).toBe('2 MB')
  })

  it('names the local directory the originals live in', async () => {
    useStorage(localStorage({ root: '/srv/files' }))

    const { row } = await rows()
    const driver = row('media.driver')
    const where = row('media.where')

    expect(driver?.kind === 'value' && driver.value).toBe('local')
    expect(where?.kind === 'value' && where.value).toBe('/srv/files')
  })

  it('names the bucket and never the key pair that opens it', async () => {
    useStorage(
      s3Storage({
        bucket: 'photos',
        region: 'auto',
        endpoint: 'https://r2.example.com',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      }),
    )

    const { group, row } = await rows()
    const where = row('media.where')

    expect(where?.kind === 'value' && where.value).toBe('photos at https://r2.example.com')
    expect(JSON.stringify(group)).not.toContain('AKIAEXAMPLE')
    expect(JSON.stringify(group)).not.toContain('wJalrXUtnFEMI')
  })

  it('states the ceiling alone when no driver was registered, rather than refusing to boot', async () => {
    const { group, row } = await rows()

    expect(group?.blocks.map((block) => block.title)).toEqual(['Uploads'])
    expect(row('media.max-upload')).toBeDefined()
  })

  it('locks both blocks: the driver and the ceiling are in the project source', async () => {
    useStorage(localStorage({ root: '/srv/files' }))

    const { group } = await rows()

    expect(group?.blocks.map((block) => block.locked)).toEqual([true, true])
  })
})
