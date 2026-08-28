/**
 * The module that ties the declarations together (SPEC.md §99).
 *
 * This is the whole of the framework code a feature needs. Listing a model gives it
 * a table and a migration; listing a resource gives it the `entries.*` commands, REST
 * CRUD, an OpenAPI path, an SDK method, a Studio screen and an MCP tool. Nothing
 * below repeats anything the model and the resource already said.
 *
 * A second feature is a second file beside this one, listed in `src/app.ts`.
 */
import { module } from '@assemora/core'

import { Article } from '../models/article.ts'
import { Articles } from '../resources/articles.ts'
// assemora:if pages
import { readPage } from '../routes.ts'
// assemora:end

export const content = () =>
  module('content')
    .models(Article)
    .resources(Articles)
    // assemora:if pages
    // The one thing this project serves to somebody who is not signed in.
    .routes(readPage)
// assemora:end
