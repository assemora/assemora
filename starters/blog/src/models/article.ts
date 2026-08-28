/**
 * The one model this project ships (SPEC.md §9).
 *
 * Every column is declared once, here. The PostgreSQL table, the runtime validation,
 * the TypeScript record type, the Studio form, the REST payloads, the OpenAPI schema,
 * the generated SDK and what an agent may see over MCP are all derived from it —
 * there is no second description of an article anywhere in the project.
 *
 * `typeof Article.$infer` is the record type, so adding a column below changes it
 * without anything else being written.
 */
import { boolean, model, string, text, timestamp, uuid } from '@assemora/data'

export const Article = model('articles', {
  id: uuid().primary().defaultRandom(),
  title: string(),
  /** Unique because it is how a visitor addresses the article. */
  slug: string().unique(),
  body: text(),
  published: boolean().default(false),
  createdAt: timestamp().created(),
  updatedAt: timestamp().updated(),
})
