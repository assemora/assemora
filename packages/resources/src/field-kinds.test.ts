/**
 * The kinds SPEC.md §39 left out, and the two shapes it named but never registered.
 *
 * Every case here is asserted through the *field*, not through a Studio control or a
 * renderer: a field is what the SDK, OpenAPI, MCP and a raw `entries.create` all pass
 * through, so a rule that lives anywhere else is a rule three of the four skip.
 */
import { ValidationError } from '@assemora/core'
import { describe, expect, it } from 'vitest'

import { describeField } from './descriptor.js'
import {
  array,
  checkboxes,
  code,
  color,
  image,
  integer,
  link,
  markdown,
  media,
  object,
  select,
  slug,
  table,
  text,
  time,
  video,
} from './fields.js'

const parsed = <T>(field: { schema: { parse(value: unknown): unknown } }, value: unknown) =>
  field.schema.parse(value) as { ok: boolean; value?: T; issues?: readonly { message: string }[] }

describe('integer', () => {
  it('is the whole number `number` is not', () => {
    expect(integer().schema.parse(3).ok).toBe(true)
    expect(integer().schema.parse(-3).ok).toBe(true)
    expect(integer().schema.parse(3.5).ok).toBe(false)
  })

  it('says so in the schema every other layer reads', () => {
    expect(integer().schema.toJsonSchema()).toMatchObject({ type: 'integer' })
  })
})

describe('checkboxes', () => {
  it('takes several of a fixed list, where select takes one', () => {
    const tags = checkboxes('news', 'guide', 'release')

    expect(tags.schema.parse(['news', 'guide']).ok).toBe(true)
    expect(tags.schema.parse([]).ok).toBe(true)
    expect(tags.schema.parse(['nope']).ok).toBe(false)
    expect(tags.schema.parse('news').ok).toBe(false)
  })

  it('refuses the same choice twice, because the value is a set', () => {
    const result = parsed(checkboxes('news', 'guide'), ['news', 'news'])

    expect(result.ok).toBe(false)
    expect(result.issues?.[0]?.message).toContain('twice')
  })

  it('offers its values the way select does, so one control draws both', () => {
    expect(describeField('tags', checkboxes('news', 'guide')).options).toEqual([
      { value: 'news', label: 'news' },
      { value: 'guide', label: 'guide' },
    ])
    expect(checkboxes('news').schema.toJsonSchema()).toMatchObject({ uniqueItems: true })
  })
})

describe('color', () => {
  it('takes hex in the four lengths CSS accepts', () => {
    for (const value of ['#fff', '#ffff', '#4a5ed6', '#4a5ed6ff']) {
      expect(color().schema.parse(value).ok).toBe(true)
    }
  })

  /**
   * The lesson §62 already paid for, one layer down. A colour that can carry a `;` is a
   * stylesheet, and the four shapes below are the ones an attack takes.
   */
  it('refuses anything that could carry a stylesheet', () => {
    for (const value of [
      'red; background: url(https://evil.example/x)',
      '#fff; }',
      'rgb(1,2,3)',
      'var(--brand)',
      'url(https://evil.example/x)',
      'expression(alert(1))',
      '#fff</style><script>alert(1)</script>',
      'currentColor',
      '',
    ]) {
      expect(color().schema.parse(value).ok, value).toBe(false)
    }
  })
})

describe('markdown', () => {
  it('is its own kind, so a control and a renderer can tell it from richText', () => {
    expect(markdown().kind).toBe('markdown')
    expect(markdown().schema.parse('# Title').ok).toBe(true)
  })

  /**
   * Stored as written, raw HTML included. Nothing in this repository renders it, and
   * stripping here would damage legitimate content on the way *into* the database — the
   * decision belongs to whatever eventually turns it into markup.
   */
  it('stores what was written', () => {
    const source = '<script>alert(1)</script>'
    const result = parsed<string>(markdown(), source)

    expect(result.ok).toBe(true)
    expect(result.value).toBe(source)
  })
})

describe('code', () => {
  it('holds the source and the language, which `text` loses', () => {
    const result = parsed<{ language: string; source: string }>(code(), {
      language: 'sql',
      source: 'select 1',
    })

    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ language: 'sql', source: 'select 1' })
  })

  it('needs both halves', () => {
    expect(code().schema.parse({ source: 'select 1' }).ok).toBe(false)
    expect(code().schema.parse('select 1').ok).toBe(false)
  })

  /** The language becomes `language-<name>` in somebody's renderer. */
  it('refuses a language name that is not one', () => {
    for (const language of ['Ts', 'js script', '"><script>', '../etc/passwd', '']) {
      expect(code().schema.parse({ language, source: '' }).ok, language).toBe(false)
    }

    expect(code().schema.parse({ language: 'objective-c', source: '' }).ok).toBe(true)
    expect(code().schema.parse({ language: 'c++', source: '' }).ok).toBe(true)
  })

  it('narrows the language to a list, published as the options a picker draws', () => {
    const snippet = code('sql', 'ts')

    expect(snippet.schema.parse({ language: 'sql', source: '' }).ok).toBe(true)
    expect(snippet.schema.parse({ language: 'rb', source: '' }).ok).toBe(false)
    expect(describeField('snippet', snippet).options).toEqual([
      { value: 'sql', label: 'sql' },
      { value: 'ts', label: 'ts' },
    ])
  })

  it('refuses a language list that is not made of language names', () => {
    expect(() => code('C#')).toThrow(ValidationError)
  })

  it('describes both halves, so the SDK prints a shape rather than unknown', () => {
    expect(code().schema.toJsonSchema()).toMatchObject({
      type: 'object',
      properties: { language: { type: 'string' }, source: { type: 'string' } },
      required: ['language', 'source'],
    })
  })
})

describe('time', () => {
  it('is a time of day and carries no date', () => {
    expect(time().schema.parse('09:30').ok).toBe(true)
    expect(time().schema.parse('23:59').ok).toBe(true)
    expect(time().schema.parse('00:00').ok).toBe(true)
  })

  it('has exactly one spelling, so a stored time sorts as text', () => {
    for (const value of ['9:30', '09:30:00', '24:00', '09:60', '9.30am', '2026-08-27T09:30']) {
      expect(time().schema.parse(value).ok, value).toBe(false)
    }
  })
})

describe('link', () => {
  it('carries a URL under a tag that says so', () => {
    const result = parsed<{ type: string; url: string }>(link(), {
      type: 'url',
      url: 'https://assemora.dev/docs',
      label: 'Docs',
      newTab: true,
    })

    expect(result.ok).toBe(true)
    expect(result.value).toEqual({
      type: 'url',
      url: 'https://assemora.dev/docs',
      label: 'Docs',
      newTab: true,
    })
  })

  it('carries a reference to an entry under the same tag', () => {
    const entry = { resource: 'articles', id: '11111111-1111-4111-8111-111111111111' }
    const result = parsed<{ type: string }>(link(), { type: 'entry', entry })

    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ type: 'entry', entry })
  })

  it('refuses a value that claims one variant and carries the other', () => {
    expect(link().schema.parse({ type: 'url', entry: { resource: 'a', id: 'b' } }).ok).toBe(false)
    expect(link().schema.parse({ type: 'entry', url: 'https://x.io' }).ok).toBe(false)
    expect(link().schema.parse({ type: 'url' }).ok).toBe(false)
    expect(link().schema.parse({ url: 'https://x.io' }).ok).toBe(false)
  })

  /**
   * The heart of it. A link ends up in an `href`, and a renderer is one reader of many —
   * so the refusal is here, where the SDK, an export, MCP and a generated email all pass.
   *
   * The list is an allowlist, which is why every spelling below fails without any of
   * them being named: casing, the tab a browser strips before reading the scheme, the
   * leading space it also strips, and the protocol-relative form that has no scheme at
   * all.
   */
  it('refuses every URL that is not one of the four schemes', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'JAVASCRIPT:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java script:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/x',
      '/about',
      'about:blank',
      'https:',
      'https://',
    ]) {
      expect(link().schema.parse({ type: 'url', url }).ok, url).toBe(false)
    }
  })

  /**
   * The whitespace guard, on its own account.
   *
   * Every case above is refused by the scheme allowlist before the guard is reached, so
   * neutering `UNSAFE_IN_URL` left them all green — the one control the field's comment
   * calls load-bearing had no test of its own. These four are what only it refuses: the
   * scheme is `https:` or `mailto:` and the rest of the address carries a space, a tab, a
   * trailing space or a NUL.
   *
   * It matters because a browser strips exactly these before it reads a URL, so a stored
   * value holding one can resolve to an address that is not the one a reader parsed. The
   * whole class goes, rather than being stripped the same way twice and hoping.
   */
  it('refuses whitespace inside a URL the scheme check would accept', () => {
    for (const url of [
      'https://exa mple.com/',
      'https://good.example/a\tb',
      'https://good.example/x ',
      'mailto:ada@assemora.dev ',
    ]) {
      expect(link().schema.parse({ type: 'url', url }).ok, JSON.stringify(url)).toBe(false)
    }
  })

  /**
   * The two length caps, hard-coded rather than imported.
   *
   * Reading the constant back would make this test agree with whatever the constant says,
   * which is how both of them came to be raisable to 100000000 with nothing going red. A
   * URL is an address and a label is a caption; neither is a place to put a document, and
   * a `link` field ends up in every listing, every export and every agent's read.
   */
  it('caps a URL at 2048 characters, because a link is an address and not a payload', () => {
    const head = 'https://good.example/'
    const fits = head + 'a'.repeat(2048 - head.length)

    expect(fits).toHaveLength(2048)
    expect(link().schema.parse({ type: 'url', url: fits }).ok).toBe(true)
    expect(link().schema.parse({ type: 'url', url: `${fits}a` }).ok).toBe(false)
  })

  it('caps a label at 255 characters, in a link and in a table heading alike', () => {
    const url = 'https://good.example/'
    const fits = 'a'.repeat(255)

    expect(link().schema.parse({ type: 'url', url, label: fits }).ok).toBe(true)
    expect(link().schema.parse({ type: 'url', url, label: `${fits}a` }).ok).toBe(false)

    expect(table().schema.parse({ columns: [fits], rows: [] }).ok).toBe(true)
    expect(table().schema.parse({ columns: [`${fits}a`], rows: [] }).ok).toBe(false)
  })

  it('takes the four schemes a CMS link actually needs', () => {
    for (const url of [
      'https://assemora.dev',
      'HTTPS://assemora.dev',
      'http://localhost:4000/api',
      'mailto:ada@assemora.dev',
      'tel:+441234567890',
    ]) {
      expect(link().schema.parse({ type: 'url', url }).ok, url).toBe(true)
    }
  })

  it('describes itself as an object, so the SDK prints more than unknown', () => {
    const json = link().schema.toJsonSchema() as {
      type: string
      required: readonly string[]
      properties: Record<string, unknown>
    }

    expect(json.type).toBe('object')
    expect(json.required).toEqual(['type'])
    expect(Object.keys(json.properties)).toEqual(['type', 'url', 'entry', 'label', 'newTab'])
  })
})

describe('table', () => {
  it('holds columns the author chose and rows under them', () => {
    const value = { columns: ['Plan', 'Price'], rows: [['Free', '$0']] }
    const result = parsed<typeof value>(table(), value)

    expect(result.ok).toBe(true)
    expect(result.value).toEqual(value)
  })

  it('refuses a row that is not as wide as the table', () => {
    const result = parsed(table(), { columns: ['Plan', 'Price'], rows: [['Free']] })

    expect(result.ok).toBe(false)
    expect(result.issues?.[0]?.message).toContain('2 columns')
  })

  it('refuses two columns of the same name, which no reader can key by', () => {
    expect(table().schema.parse({ columns: ['Plan', 'Plan'], rows: [] }).ok).toBe(false)
  })

  it('needs a column, and takes an empty body', () => {
    expect(table().schema.parse({ columns: [], rows: [] }).ok).toBe(false)
    expect(table().schema.parse({ columns: ['Plan'], rows: [] }).ok).toBe(true)
  })

  it('bounds what a grid can be, and the bound is in the schema every layer reads', () => {
    const columns = Array.from({ length: 33 }, (_, index) => `c${index}`)

    expect(table().schema.parse({ columns, rows: [] }).ok).toBe(false)
    expect(table().schema.toJsonSchema()).toMatchObject({
      properties: { columns: { maxItems: 32 }, rows: { maxItems: 1000 } },
    })
  })

  it('holds text and not a union every renderer has to branch on', () => {
    expect(table().schema.parse({ columns: ['n'], rows: [[1]] }).ok).toBe(false)
  })
})

describe('media, narrowed by type rather than by a new kind', () => {
  it('is the same field and the same stored value either way', () => {
    expect(image().kind).toBe('media')
    expect(video().kind).toBe('media')
    expect(image().schema.parse('11111111-1111-4111-8111-111111111111').ok).toBe(true)
  })

  it('publishes what the picker offers', () => {
    expect(describeField('cover', image()).accept).toEqual(['image/*'])
    expect(describeField('brochure', media('application/pdf')).accept).toEqual(['application/pdf'])
    expect(describeField('anything', media()).accept).toBeUndefined()
  })

  it('refuses an accept that is not a media type', () => {
    expect(() => media('image')).toThrow(ValidationError)
    expect(() => media('image/*; drop table')).toThrow(ValidationError)
  })
})

describe('a group and a repeater', () => {
  it('describes its inner fields, so a nested form is built from the same data', () => {
    const described = describeField(
      'author',
      object({ name: text().required().label('Full name'), site: text() }),
    )

    expect(described.kind).toBe('object')
    expect(described.fields?.map((field) => [field.name, field.label, field.required])).toEqual([
      ['name', 'Full name', true],
      ['site', 'Site', false],
    ])
  })

  it('describes what a repeater repeats', () => {
    const described = describeField('tags', array(select('news', 'guide')))

    expect(described.element?.kind).toBe('select')
    expect(described.element?.name).toBe('element')
  })

  it('requires an inner field that says it is required, and lets the rest be absent', () => {
    const author = object({ name: text().required(), site: text() })

    expect(author.schema.parse({ name: 'Ada' }).ok).toBe(true)
    expect(author.schema.parse({ name: 'Ada', site: null }).ok).toBe(true)
    expect(author.schema.parse({ site: 'x' }).ok).toBe(false)
  })

  it('says a required inner field is missing, not that it is the wrong type', () => {
    const result = parsed(object({ name: text().required() }), {})

    expect(result.issues?.[0]?.message).toBe('This field is required')
  })

  it('drops a key the group never declared, rather than carrying it through', () => {
    const result = parsed<Record<string, unknown>>(object({ name: text() }), {
      name: 'Ada',
      isAdmin: true,
    })

    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ name: 'Ada' })
  })

  it('publishes the nested shape, so the SDK prints it instead of unknown', () => {
    expect(array(object({ name: text().required() })).schema.toJsonSchema()).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    })
  })

  /**
   * The flags a resource enforces one field at a time do not reach inside a value, so a
   * field declaring one inside a group is refused rather than accepted and ignored.
   */
  it('refuses a modifier nothing inside a group can enforce', () => {
    expect(() => object({ secret: text().hidden() })).toThrow(ValidationError)
    expect(() => object({ id: text().readOnly() })).toThrow(ValidationError)
    expect(() => object({ note: text().agentAccess({ write: false }) })).toThrow(ValidationError)
    expect(() => object({ title: text().searchable() })).toThrow(ValidationError)
    expect(() => object({ title: text().sortable() })).toThrow(ValidationError)
    expect(() => object({ title: text().filterable() })).toThrow(ValidationError)
    expect(() => array(text().hidden())).toThrow(ValidationError)
  })

  it('names the offending key and the field it is on', () => {
    try {
      object({ secret: text().hidden() })
      expect.unreachable('a hidden field inside a group is refused')
    } catch (error) {
      expect((error as ValidationError).issues[0]?.path).toEqual(['secret', 'hidden'])
    }
  })

  it('refuses a slug inside a group, because its source names a field it cannot reach', () => {
    expect(() => object({ path: slug('title') })).toThrow(ValidationError)
  })
})
