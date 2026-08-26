/**
 * The module (SPEC.md §13, §99).
 *
 * Everything above this line is declarations; this is the whole of the framework code
 * a feature needs. The tables, the migrations, the `entries.*` commands, REST CRUD,
 * the OpenAPI paths, the SDK methods, the Studio screens and the MCP tools all follow
 * from what is listed here, and none of it is written twice.
 */
import { module } from '@assemora/core'

import { Article, Author, Category } from './models.ts'
import { ArticlePolicy, AuthorPolicy, CategoryPolicy } from './policies.ts'
import { Articles, Authors, Categories } from './resources.ts'
import { blogRoutes } from './routes.ts'

export const blog = () =>
  module('blog')
    .models(Author, Category, Article)
    .resources(Authors, Categories, Articles)
    .routes(...blogRoutes)
    // A policy belongs to the module that owns the subject, not to the application
    // that assembles the modules. `auth({ policies: [...] })` is the other place it
    // can go, and is for a policy over somebody else's subject.
    .policies(ArticlePolicy, AuthorPolicy, CategoryPolicy)
