/**
 * The little content modelling a marketing site needs (SPEC.md §17).
 *
 * Two lists that outgrow a page tree the moment somebody joins or a role closes.
 * Everything else on this site is blocks, which is the point of the example.
 */
import { boolean, enumOf, integer, model, string, text, timestamp, uuid } from '@assemora/data'

export const TeamMember = model(
  'team',
  {
    id: uuid().primary().defaultRandom(),
    name: string(),
    title: string(),
    bio: text().nullable(),
    /**
     * A path into this site's own bundle, or an absolute URL — not a media id.
     *
     * The media library is reachable through `GET /api/media/*`, which runs the
     * `media.get` query and therefore the policy for `media` (SPEC.md §51). That is
     * right for an editor's uploads and wrong for a logo: a visitor with no session
     * would get a 403 where an image belongs. Marketing images ship with the bundle.
     */
    photo: string().nullable(),
    position: integer().default(0),
    published: boolean().default(true),
    createdAt: timestamp().created(),
    updatedAt: timestamp().updated(),
  },
  { scopes: { onTheSite: (query) => query.where('published', true) } },
)

export const Opening = model(
  'openings',
  {
    id: uuid().primary().defaultRandom(),
    title: string(),
    slug: string().unique(),
    team: string(),
    location: string(),
    employment: enumOf('full-time', 'part-time', 'contract').default('full-time'),
    description: text(),
    status: enumOf('open', 'closed').default('open'),
    createdAt: timestamp().created(),
    updatedAt: timestamp().updated(),
  },
  { scopes: { open: (query) => query.where('status', 'open') } },
)
