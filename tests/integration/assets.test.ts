/**
 * What a browser is told about the bundle this repository actually builds (SPEC.md §85).
 *
 * The rules for serving a directory are tested where they live, against a fixture.
 * This file exists because the fixture was the whole problem: the caching rule used
 * to look for a hexadecimal hash, `apps/studio` is built by Rollup, Rollup writes
 * base64url — and the unit test asserted the rule against `main-8f3a1c2b.js`, a name
 * nothing in this repository has ever produced. Both agreed with each other and
 * neither agreed with the build, so every one of the 27 files Studio ships was served
 * `no-cache` and nobody found out.
 *
 * So the claim here is made against the real `dist`, through a real server, and it is
 * checked by reading the directory rather than by naming a file in it.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApplication, createLogger, permitAll, silentWriter } from '@assemora/core'
import { createHttpServer, type HttpServer } from '@assemora/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { realInfrastructure } from './budget.ts'

realInfrastructure()

/** What `vite build` wrote. `pnpm verify` builds before it tests. */
const DIST = fileURLToPath(new URL('../../apps/studio/dist/', import.meta.url))

let server: HttpServer
let built: string[]

/**
 * Loud rather than skipped.
 *
 * A suite that quietly passes when the thing it is about is missing is how this got
 * here in the first place.
 */
const require = (built: readonly string[]): void => {
  if (built.length === 0) {
    throw new Error(
      `${DIST} holds no assets. This suite is about the built bundle — run \`pnpm build\` first.`,
    )
  }
}

beforeAll(async () => {
  built = await readdir(join(DIST, 'assets')).catch(() => [])

  require(built)

  // Nothing is asked of the application here: a stylesheet is not an endpoint, and
  // this mount is the one part of the HTTP layer that answers without the registry.
  const app = createApplication({ authorization: permitAll(), logger: createLogger(silentWriter) })

  server = createHttpServer({
    registry: app.registry,
    commands: app.commands,
    queries: app.queries,
    logger: app.logger,
  })

  server.mountAssets({ path: '/studio', root: DIST })

  await server.ready()
}, 60_000)

afterAll(async () => {
  await server?.close()
})

describe('the bundle this repository ships', () => {
  it('is fingerprinted, and every one of those files is kept for a year', async () => {
    const answers = await Promise.all(
      built.map(async (name) => ({
        name,
        cacheControl: (await server.inject({ method: 'GET', url: `/studio/assets/${name}` }))
          .headers['cache-control'],
      })),
    )

    const wrong = answers.filter(
      (answer) => answer.cacheControl !== 'public, max-age=31536000, immutable',
    )

    expect(wrong).toEqual([])
    // Said out loud, because the failure this replaces was a rule that matched zero
    // files and an assertion that never counted them.
    expect(answers.length).toBeGreaterThan(20)
  })

  it('never keeps the entry document, which is the file that names all the others', async () => {
    const answered = await server.inject({ method: 'GET', url: '/studio' })

    expect(answered.statusCode).toBe(200)
    expect(answered.headers['cache-control']).toBe('no-cache')
  })

  it('sends the shell compressed, which is most of what a first visit downloads', async () => {
    const shell = built.find((name) => name.endsWith('.js'))

    expect(shell).toBeDefined()

    const url = `/studio/assets/${shell}`
    const onDisk = (await stat(join(DIST, 'assets', String(shell)))).size

    const whole = await server.inject({ method: 'GET', url })
    const small = await server.inject({
      method: 'GET',
      url,
      headers: { 'accept-encoding': 'br, gzip' },
    })

    expect(whole.rawBody.length).toBe(onDisk)
    expect(small.headers['content-encoding']).toBe('br')
    // The number in the issue: 202,723 bytes against 63,732 gzipped. Brotli does
    // better still, and the assertion is loose because the bundle changes weekly —
    // what must not change is that it is compressed at all.
    expect(small.rawBody.length).toBeLessThan(onDisk / 2)
  })

  it('answers a second visit with a header instead of the file', async () => {
    const shell = `/studio/assets/${built.find((name) => name.endsWith('.css')) ?? built[0]}`

    const first = await server.inject({ method: 'GET', url: shell })
    const again = await server.inject({
      method: 'GET',
      url: shell,
      headers: { 'if-none-match': String(first.headers.etag) },
    })

    expect(first.statusCode).toBe(200)
    expect(again.statusCode).toBe(304)
    expect(again.rawBody.length).toBe(0)
  })
})
