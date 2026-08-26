/**
 * Three models that reference each other (SPEC.md §17, §23, §25).
 *
 * They share a file because they share relations: a relation names the other side
 * through a thunk, so declaration order does not matter and a mutual reference costs
 * nothing (ADR-0010). One model per file works identically — the starter does that.
 */
import {
  belongsTo,
  boolean,
  enumOf,
  hasMany,
  model,
  string,
  text,
  timestamp,
  uuid,
} from '@assemora/data'

export const Author = model('authors', {
  id: uuid().primary().defaultRandom(),
  name: string(),
  slug: string().unique(),
  bio: text().nullable(),
  /**
   * The account that writes as this author, when there is one.
   *
   * An author profile is content and a user is a credential, and keeping them apart
   * is what makes both cases expressible: a guest writer has a profile and no login,
   * and an editor has a login and writes as nobody. `src/policies.ts` is the one
   * place that joins them back up.
   */
  userId: uuid().nullable(),
  articles: hasMany(() => Article),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})

export const Category = model('categories', {
  id: uuid().primary().defaultRandom(),
  name: string(),
  slug: string().unique(),
  /**
   * An unstated foreign key is derived by dropping a trailing `s` from the owning
   * table, which turns `categories` into `categorieId`. Every irregular plural has to
   * say the column itself — `authors` above does not, because `authorId` is right.
   */
  articles: hasMany(() => Article, { foreignKey: 'categoryId' }),
  createdAt: timestamp().created(),
})

export const Article = model(
  'articles',
  {
    id: uuid().primary().defaultRandom(),
    title: string(),
    slug: string().unique(),
    excerpt: text().nullable(),
    body: text(),
    status: enumOf('draft', 'published').default('draft'),
    featured: boolean().default(false),
    publishedAt: timestamp().nullable(),
    authorId: uuid(),
    categoryId: uuid().nullable(),
    // `belongsTo` reads a key on *this* table, named after the relation: `author` is
    // `authorId` and `category` is `categoryId`, both declared above.
    author: belongsTo(() => Author),
    category: belongsTo(() => Category),
    createdAt: timestamp().created(),
    updatedAt: timestamp().updated(),
  },
  {
    /**
     * A scope is a named piece of a query (SPEC.md §25).
     *
     * `Article.published()` hands back the same builder, so it composes with
     * everything after it — and what "published" means is decided here once instead
     * of being spelled out again in the route, the block and the seed. Change the
     * definition and every caller changes with it.
     */
    scopes: {
      published: (query) => query.where('status', 'published'),
      drafts: (query) => query.where('status', 'draft'),
      featured: (query) => query.where('featured', true),
    },
  },
)
