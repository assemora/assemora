/**
 * Who may change what (SPEC.md §50, §51).
 *
 * Authorization asks twice (ADR-0015). First: does this actor hold `articles.update`
 * at all? An editor whose role grants it never reaches the rules below. Only when the
 * permission is missing is the *record* loaded and a rule asked about it — which is
 * why "an author may edit their own article" can be expressed here at all, and why it
 * costs a query on exactly the requests that need one.
 *
 * The same rules answer Studio, REST, the SDK, the CLI and MCP, because all five
 * arrive through the same buses.
 */
import { type PolicyActor, type PolicyContext, policy } from '@assemora/auth'

import { type Article, Author } from './models.ts'

type ArticleRow = typeof Article.$infer

/**
 * Is this actor the author of this article?
 *
 * A rule may be asynchronous, which is what lets this one answer a question the actor
 * alone cannot: an actor is an account, an article names an author profile, and
 * `Author.userId` is the link between them.
 */
const writesAs = async (actor: PolicyActor, authorId: string): Promise<boolean> => {
  if (actor?.type !== 'user') return false

  const profile = await Author.where('userId', actor.id).first()

  return profile !== null && profile.id === authorId
}

export const ArticlePolicy = policy<ArticleRow>('articles', {
  /**
   * Reading the collection — drafts included, because a policy cannot see the filter
   * a caller asked for and so cannot say "published ones only".
   *
   * That is what `src/routes.ts` is for: a visitor reads the blog through routes that
   * write the filter themselves. Opening this rule to everybody instead would put
   * every unfinished draft on `GET /api/articles`.
   */
  read: ({ actor }) => actor !== undefined,
  create: ({ actor }) => actor?.type === 'user',
  update: ({ actor, record }) => writesAs(actor, record.authorId),
  delete: ({ actor, record }) => writesAs(actor, record.authorId),
})

/** Authors and categories are reference data: readable, and edited by whoever may. */
const reference = { read: ({ actor }: PolicyContext) => actor !== undefined }

export const AuthorPolicy = policy('authors', reference)
export const CategoryPolicy = policy('categories', reference)
