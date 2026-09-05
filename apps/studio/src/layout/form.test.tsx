/**
 * A form drawn from its arrangement (ADR-0033): what a read-only field looks like.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { FieldDescriptor } from '../api/introspection.ts'
import { EntryFields } from './form.tsx'
import { arrange } from './resolve.ts'

const field = (over: Partial<FieldDescriptor> & { name: string }): FieldDescriptor => ({
  kind: 'text',
  required: false,
  searchable: false,
  sortable: false,
  filterable: false,
  hidden: false,
  readOnly: false,
  ...over,
})

const draw = (fields: readonly FieldDescriptor[], draft: Record<string, unknown>): string =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <EntryFields
        arranged={arrange(fields, {
          sections: [{ key: 'all', fields: fields.map((f) => f.name) }],
        })}
        draft={draft}
        onChange={() => undefined}
      />
    </QueryClientProvider>,
  )

describe('a read-only field on the form', () => {
  it('is drawn with its value and disabled, rather than left off the form', () => {
    const html = draw(
      [field({ name: 'code' }), field({ name: 'total', kind: 'integer', readOnly: true })],
      { code: 'PC-1', total: 145 },
    )

    expect(html).toContain('value="145"')
    expect(html).toMatch(/<fieldset disabled[^>]*>[\s\S]*value="145"/)
    expect(html).not.toMatch(/<fieldset disabled[^>]*>[\s\S]*value="PC-1"/)
  })

  it('says it is the application’s to set, where the field has no help of its own', () => {
    const html = draw([field({ name: 'total', kind: 'integer', readOnly: true })], { total: 1 })

    expect(html).toContain('Set by the application, not by hand')
  })
})
