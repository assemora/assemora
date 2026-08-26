/**
 * The two Studio screens this site has (SPEC.md §35).
 */
import {
  number,
  resource,
  richText,
  select,
  slug,
  text,
  textarea,
  toggle,
} from '@assemora/resources'

import { Opening, TeamMember } from './models.ts'

export const Team = resource(
  TeamMember,
  {
    name: text().required().searchable().sortable().label('Name'),
    title: text().required().searchable().label('Title'),
    bio: textarea().label('Biography'),
    photo: text().label('Photo').help('A path in this site’s bundle, or an absolute URL'),
    position: number().sortable().label('Order').help('Lower comes first'),
    published: toggle().filterable().label('On the site'),
  },
  { label: 'Team', defaultSort: 'position', perPage: 50 },
)

export const Openings = resource(
  Opening,
  {
    title: text().required().searchable().sortable().label('Title'),
    slug: slug('title').label('Slug'),
    team: text().required().searchable().filterable().label('Team'),
    location: text().required().filterable().label('Location'),
    employment: select('full-time', 'part-time', 'contract')
      .required()
      .filterable()
      .label('Employment'),
    description: richText().required().label('Description'),
    status: select('open', 'closed').required().filterable().sortable().label('Status'),
  },
  { label: 'Open roles', defaultSort: 'title', perPage: 25 },
)
