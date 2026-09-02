/**
 * The second block, so that a page is a tree rather than a single thing.
 *
 * The type name is what a tree stores and what an agent asks for by name, so it is
 * worth choosing once: `blocks.add` with `type: 'richText'` is what Studio sends and
 * what an MCP proposal carries.
 */
import { block } from '@assemora/pages'
import { richText } from '@assemora/resources'

export const RichText = block(
  'richText',
  { body: richText().required().label('Text') },
  { label: 'Rich text', description: 'A paragraph or two of prose', icon: 'text-align-start' },
)
