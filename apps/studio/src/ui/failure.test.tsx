/**
 * The box a screen puts a refusal in (SPEC.md §84).
 *
 * Rendered rather than reasoned about, because the defect was in the rendering: the
 * component was handed a whole `ApiError` and drew one line of it.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/client.ts'
import { Failure } from './index.tsx'

const invalid = (fields: Record<string, readonly string[]>): ApiError =>
  new ApiError(422, { code: 'VALIDATION_ERROR', message: 'Validation failed', fields })

const draw = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element)

describe('a refusal, drawn', () => {
  /**
   * The bug this covers: choosing an option in a collection's sort dropdown replaced
   * the list with a box saying "Validation failed" and nothing else, while the
   * application had sent the sentence explaining what was wrong.
   */
  it('shows what the application said, not only that it said no', () => {
    const markup = draw(
      <Failure error={invalid({ sort: ['Dynamic entries sort by createdAt, updatedAt only'] })} />,
    )

    expect(markup).toContain('Validation failed')
    expect(markup).toContain('sort: Dynamic entries sort by createdAt, updatedAt only')
  })

  it('leaves out a message the form is already showing against its own input', () => {
    const markup = draw(
      <Failure error={invalid({ title: ['This field is required'] })} except={['title']} />,
    )

    expect(markup).toContain('Validation failed')
    expect(markup).not.toContain('This field is required')
  })

  it('draws an ordinary failure exactly as before', () => {
    expect(draw(<Failure error={new Error('The network went away')} />)).toContain(
      'The network went away',
    )
    expect(draw(<Failure error={'not an error at all'} />)).toContain('Something went wrong')
  })
})
