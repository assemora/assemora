/**
 * The module your declarations go in (SPEC.md §99).
 *
 * A module is the registration unit, and this one holds nothing of yours yet: a new
 * project has no content model, and shipping somebody else's is how a framework
 * decides what you are building before you do.
 *
 * It is here rather than left for you to write because every generator ends by naming
 * it. `assemora make:model Post` finishes with *"Register it on a module with
 * .models(Post)"*, and this is the module it means — already listed in `src/app.ts`,
 * so a declaration reaches the database, the API, Studio and MCP by being added to one
 * line here and nowhere else:
 *
 * ```ts
 * module('content').models(Post).resources(Posts)
 * ```
 *
 * A second feature is a second file beside this one, listed in `src/app.ts` too.
 */
import { module } from '@assemora/core'

// assemora:if pages
import { readPage } from '../routes.ts'

// assemora:end
export const content = () =>
  module('content')
    // assemora:if pages
    // The one thing this project serves to somebody who is not signed in.
    .routes(readPage)
// assemora:end
