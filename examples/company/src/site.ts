/**
 * The module (SPEC.md §13).
 *
 * The blocks are not listed here: a block reaches the builder through
 * `pages({ blocks })` in `src/app.ts`, because it is the pages module that offers
 * them. Everything else this site declares is registered below.
 */
import { module } from '@assemora/core'

import { Opening, TeamMember } from './models.ts'
import { Openings, Team } from './resources.ts'
import { siteRoutes } from './routes.ts'

export const site = () =>
  module('site')
    .models(TeamMember, Opening)
    .resources(Team, Openings)
    .routes(...siteRoutes)
