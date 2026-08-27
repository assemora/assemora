import { describe, expect, it } from 'vitest'

import { generateSdk, toTypeScript } from './generate.js'

/**
 * The five addresses a mounted resource is described at (SPEC.md §43).
 *
 * Written out here because that is what the registry holds: `server.mountResources()`
 * describes each generated endpoint as it mounts it, and a resource with none of these
 * is one nothing serves.
 */
const crud = (name: string, only?: readonly string[]) =>
  [
    { name: `get /${name}`, method: 'get', path: `/${name}` },
    { name: `get /${name}/:id`, method: 'get', path: `/${name}/:id` },
    { name: `post /${name}`, method: 'post', path: `/${name}` },
    { name: `patch /${name}/:id`, method: 'patch', path: `/${name}/:id` },
    { name: `delete /${name}/:id`, method: 'delete', path: `/${name}/:id` },
  ].filter((entry) => only === undefined || only.includes(entry.name))

const snapshot = {
  resources: [
    {
      name: 'articles',
      label: 'Articles',
      fields: [
        { name: 'title', required: true, schema: { type: 'string' } },
        {
          name: 'status',
          required: false,
          schema: { type: 'string', enum: ['draft', 'published'] },
        },
        { name: 'views', required: false, schema: { type: 'number' } },
        { name: 'passwordHash', required: false, hidden: true, schema: { type: 'string' } },
      ],
    },
  ],
  routes: [
    {
      name: 'post /auth/login',
      method: 'post',
      path: '/auth/login',
      description: 'Exchanges credentials for a token',
      body: {
        type: 'object',
        properties: { email: { type: 'string' }, password: { type: 'string' } },
        required: ['email', 'password'],
      },
      response: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
    },
    ...crud('articles'),
  ],
}

describe('JSON Schema as TypeScript', () => {
  it('maps the scalars', () => {
    expect(toTypeScript({ type: 'string' })).toBe('string')
    expect(toTypeScript({ type: 'number' })).toBe('number')
    expect(toTypeScript({ type: 'integer' })).toBe('number')
    expect(toTypeScript({ type: 'boolean' })).toBe('boolean')
    expect(toTypeScript(undefined)).toBe('unknown')
  })

  it('keeps an enum as a union of literals', () => {
    expect(toTypeScript({ type: 'string', enum: ['draft', 'published'] })).toBe(
      "'draft' | 'published'",
    )
  })

  it('maps arrays and objects', () => {
    expect(toTypeScript({ type: 'array', items: { type: 'string' } })).toBe('readonly string[]')
    expect(
      toTypeScript({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a'],
      }),
    ).toBe('{\n  readonly a: string\n  readonly b?: number\n}')
  })

  it('reads a date as what actually arrives: a string', () => {
    expect(toTypeScript({ type: 'string', format: 'date-time' })).toBe('string')
  })
})

describe('the emitted client', () => {
  const source = generateSdk(snapshot)

  it('declares a record type per resource', () => {
    expect(source).toContain('export type Articles = {')
    expect(source).toContain('  readonly id: string')
    expect(source).toContain('  readonly title: string')
    expect(source).toContain("  readonly status?: 'draft' | 'published'")
  })

  it('leaves hidden fields out of the client as well (SPEC.md §85)', () => {
    expect(source).not.toContain('passwordHash')
  })

  it('exposes each resource on the API type', () => {
    expect(source).toContain('readonly articles: ResourceClient<Articles>')
  })

  /**
   * The bug this covers: the accessors were read off the `resources` section, which
   * says what content an application *has*, not what it *serves*. A collection made in
   * Studio, a resource with its `api` flags off and a resource published only under a
   * version were all named on the client and all answered 404 (SPEC.md §37, §43, §47).
   */
  it('names no resource this application does not serve (SPEC.md §98)', () => {
    const unmounted = generateSdk({
      resources: [
        { name: 'testimonials', fields: [{ name: 'quote', schema: { type: 'string' } }] },
      ],
      routes: [{ name: 'post /auth/login', method: 'post', path: '/auth/login' }],
    })

    // The shape is still there, because the entries are: it is the accessor that would
    // have been a promise of five requests that all 404.
    expect(unmounted).toContain('export type Testimonials = {')
    expect(unmounted).not.toContain('readonly testimonials: ResourceClient<Testimonials>')
    expect(unmounted).toContain('This application serves no REST endpoint for this resource')
    // And `ResourceClient` is not imported when nothing names it: a project compiling
    // its own SDK with `noUnusedLocals` would be handed an error by the generator.
    // Asserted on the line rather than on the whole file, because an assertion holding
    // a whole import statement is one `pnpm boundaries` reads as a real import.
    const imports = unmounted.split('\n').find((line) => line.startsWith('import '))

    expect(imports).toContain('createClient')
    expect(imports).not.toContain('ResourceClient')
  })

  it('keeps the accessor for a resource published only under a version (SPEC.md §47)', () => {
    // A version is a path segment on the server and a base URL to a caller, so
    // `api.testimonials.list()` from a client pointed at `/api/v1` reaches this.
    const versioned = generateSdk({
      resources: [{ name: 'testimonials', fields: [] }],
      routes: crud('testimonials').map((entry) => ({
        ...entry,
        name: `${entry.method} /v1${entry.path}`,
        path: `/v1${entry.path}`,
      })),
    })

    expect(versioned).toContain('readonly testimonials: ResourceClient<Testimonials>')
  })

  it('is not fooled by a deeper path that only opens with the name', () => {
    const nested = generateSdk({
      resources: [{ name: 'articles', fields: [] }],
      routes: [
        { name: 'get /articles/:id/revisions', method: 'get', path: '/articles/:id/revisions' },
      ],
    })

    expect(nested).not.toContain('readonly articles: ')
  })

  it('offers only the operations that are served, not all five (SPEC.md §43)', () => {
    const readOnly = generateSdk({
      resources: [{ name: 'reports', fields: [{ name: 'title', schema: { type: 'string' } }] }],
      routes: crud('reports', ['get /reports', 'get /reports/:id']),
    })

    expect(readOnly).toContain("readonly reports: Pick<ResourceClient<Reports>, 'list' | 'get'>")
  })

  it('gives a custom route a method of its own (SPEC.md §121)', () => {
    expect(source).toContain('export type Endpoints = {')
    expect(source).toContain('/** Exchanges credentials for a token */')
    expect(source).toContain('postAuthLogin(input: {')
    expect(source).toContain('readonly token: string')
  })

  it('names the factory the application will call', () => {
    expect(source).toContain(
      'export const createTypedClient = (options: ClientOptions): AssemoraApi =>',
    )
  })

  it('says it is generated and must not be edited', () => {
    expect(source.split('\n')[0]).toContain('Generated by Assemora')
  })

  it('emits something usable even for an empty application', () => {
    const empty = generateSdk({})

    expect(empty).toContain('export type AssemoraApi = Client & {')
    expect(empty).not.toContain('undefined')
  })
})

describe('a type that has to be bracketed before it can be an array', () => {
  it('groups a union, which would otherwise bind to the last member alone', () => {
    expect(toTypeScript({ type: 'array', items: { enum: ['mobile', 'tablet'] } })).toBe(
      "readonly ('mobile' | 'tablet')[]",
    )
  })

  it('groups an array of arrays, which TypeScript refuses ungrouped', () => {
    expect(
      toTypeScript({ type: 'array', items: { type: 'array', items: { type: 'string' } } }),
    ).toBe('readonly (readonly string[])[]')
  })

  it('leaves a plain element alone rather than bracketing every line', () => {
    expect(toTypeScript({ type: 'array', items: { type: 'string' } })).toBe('readonly string[]')
  })

  it('leaves an object literal alone, whatever its properties hold', () => {
    expect(
      toTypeScript({
        type: 'array',
        items: { type: 'object', properties: { size: { enum: ['sm', 'lg'] } } },
      }),
    ).toContain('readonly {')
  })
})

describe('a name TypeScript will not accept written bare', () => {
  const keyed = (key: string): string =>
    toTypeScript({ type: 'object', properties: { [key]: { type: 'string' } }, required: [key] })

  it('answers the same question the same way twice', () => {
    // The check was a `/g` regex, and `test` on one is stateful: a match leaves
    // `lastIndex` past it and the next call resumes from there. So the first
    // `content-type` was quoted and the second was not — from the same generator, in
    // the same run.
    expect(keyed('content-type')).toBe(keyed('content-type'))
  })

  it('quotes every key that needs it, not every other one', () => {
    expect(
      toTypeScript({
        type: 'object',
        properties: {
          'content-type': { type: 'string' },
          'x-total': { type: 'number' },
          ok: { type: 'boolean' },
        },
        required: ['content-type', 'x-total', 'ok'],
      }),
    ).toBe(
      [
        '{',
        "  readonly 'content-type': string",
        "  readonly 'x-total': number",
        '  readonly ok: boolean',
        '}',
      ].join('\n'),
    )
  })

  it('quotes a key that starts with a digit, which is no identifier either', () => {
    expect(keyed('2fa')).toContain("readonly '2fa': string")
  })

  it('quotes every resource whose name needs it (SPEC.md §121)', () => {
    const source = generateSdk({
      resources: [
        { name: 'blog-posts', fields: [] },
        { name: 'help-articles', fields: [] },
      ],
      routes: [...crud('blog-posts'), ...crud('help-articles')],
    })

    expect(source).toContain("readonly 'blog-posts': ResourceClient<BlogPosts>")
    expect(source).toContain("readonly 'help-articles': ResourceClient<HelpArticles>")
  })

  it('gives a resource a type name TypeScript accepts, whatever it is called', () => {
    const source = generateSdk({
      resources: [{ name: '2fa-tokens', fields: [] }],
      routes: crud('2fa-tokens'),
    })

    // `pascal` only cases the words it is handed, so the name arrived as `2faTokens`.
    expect(source).toContain('export type _2faTokens = {')
    expect(source).toContain("readonly '2fa-tokens': ResourceClient<_2faTokens>")
  })

  it('quotes a literal in the same style as the rest of the file', () => {
    expect(toTypeScript({ type: 'string', enum: ['draft', "it's out"] })).toBe(
      "'draft' | 'it\\'s out'",
    )
  })
})

/**
 * A registry whose every name is awkward on purpose.
 *
 * Hyphens in a resource name and in a field name, a name that starts with a digit, an
 * enum, an array of a union, a hidden field and a route with both a parameter and a
 * quoted response key — one of each thing that has ever made this generator emit
 * something TypeScript refuses.
 *
 * All three accessor shapes are here too, on the awkward names rather than the easy
 * ones: `blog-posts` is served whole, `help-articles` is read-only, and `2fa-tokens` is
 * served at no address at all.
 */
const awkward = {
  resources: [
    {
      name: 'blog-posts',
      fields: [
        { name: 'title', required: true, schema: { type: 'string' } },
        { name: 'status', schema: { type: 'string', enum: ['draft', 'published'] } },
        { name: 'x-legacy-id', schema: { type: 'string' } },
        { name: 'tags', schema: { type: 'array', items: { enum: ['news', 'guide'] } } },
        { name: 'passwordHash', hidden: true, schema: { type: 'string' } },
      ],
    },
    {
      name: 'help-articles',
      fields: [{ name: 'body', required: true, schema: { type: 'string' } }],
    },
    {
      name: '2fa-tokens',
      fields: [{ name: 'code', required: true, schema: { type: 'string' } }],
    },
  ],
  routes: [
    {
      name: 'get /reports/:id',
      method: 'get',
      path: '/reports/:id',
      description: 'One report, rendered',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      response: {
        type: 'object',
        properties: {
          'content-type': { type: 'string' },
          rows: { type: 'array', items: { type: 'number' } },
        },
        required: ['content-type'],
      },
    },
    ...crud('blog-posts'),
    ...crud('help-articles', ['get /help-articles', 'get /help-articles/:id']),
  ],
}

describe('the emitted client, as the compiler reads it', () => {
  /**
   * The failure mode of a generator is a file that does not parse, and no assertion on
   * its text sees that: `readonly help-articles: ResourceClient<HelpArticles>` contains
   * every substring a `toContain` would look for and is not TypeScript. Compiling from
   * inside a unit test would mean spawning `tsc`, which the integration suite already
   * does for the reference application — and that application has no awkward name in
   * it, which is why two of these bugs shipped.
   *
   * So the awkward client is written to disk instead. This test keeps the file equal to
   * what the generator emits, and `pnpm typecheck` compiles it with the rest of the
   * package: the two together fail whenever the generator starts emitting something
   * that is not TypeScript. Run `vitest -u` to regenerate it after a deliberate change,
   * and let the compiler have the last word on the new output.
   */
  it('is a file that compiles, awkward names and all', async () => {
    await expect(generateSdk(awkward, { clientModule: './client.js' })).toMatchFileSnapshot(
      './generated-client.fixture.ts',
    )
  })
})
