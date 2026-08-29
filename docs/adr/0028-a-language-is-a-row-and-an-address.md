# 0028. A language is a row and an address

Status: accepted
Date: 2026-08-30

## Context

SPEC.md §131 is one of the five sections ADR-0025 added, and it opens by naming what
was already there and not working:

> A site with two languages is most of the commercial work, and v1 has none of it:
> `AssemoraContext` has carried a `locale` since phase 1 and nothing reads it.

It fixes the storage — one row per language, `locale` and `translationOf` — and the
principle that the context decides and the query obeys. It does not say where a
request's language comes from beyond *"the address"*, what the fallback does to a page
of results, how the set of languages is configured, or which layer refuses a language
nobody serves. Those are the decisions.

## Decision

**Configured, not stored.** `assemora({ locales, defaultLocale })`, validated at
`createApplication()` and registered as a Schema Registry section of its own. Which
languages a site is in decides its addresses, what a migration has to hold and what a
translator is asked for; none of that can change by writing a row while the process
runs. Registering the set means Studio, OpenAPI, the SDK and `assemora.describe` read
it from the single source rather than each being told, which is how four consumers come
to disagree about what a site is in.

**A language travels in the context, as the whole settings object.** `context.locale`
is the language of the operation and `context.locales` is what the deployment serves.
Not a module-level global, because a job replaying an actor's work and a request being
served are two operations at once and a global would let the second decide for the
first. The settings and not the fallback alone, because everything that checks a
language against the set — a command taking one as an argument, a tool an agent calls —
would otherwise need a second way to reach it.

**A language is a path segment, stripped before routing.** `/api/ru/articles` is
`/api/articles` read in Russian. It is Fastify's `rewriteUrl`, the one hook that runs
before the router, because a language decided after routing could only ever be a header
and the point of §131 is that a page in Russian has an address of its own. Every route
is therefore declared once and **described** once: with three languages, describing a
route per language trebles every endpoint in the document whose whole purpose is to be
read. A first segment that is not a configured language is untouched, so `/api/v1/…`
still means what ADR-0022's versioning made it mean.

**A read is scoped without a caller asking, and falls back in one query.** The query
builder adds `locale = <the operation's>` to a translatable model, and `inLocale`,
`allLocales` and `withoutFallback` are the ways to mean something else. The fallback is
folded into the same query rather than run as a second one and appended: `order`,
`limit` and `offset` decide what a page *is*, and two appended result sets put every
untranslated row after every translated one — page two of a menu would be a different
menu. Building it costs one extra read, which gathers the groups already written in
this language under the caller's own `where`.

**A translation is a command.** `entries.translate` creates the row, starting from a
copy of the original and overlaid with what the translator changed. It is therefore
validated, authorized, revised and audited, and an agent reaches it as a generated tool
— which is §131's own requirement that AI must not need a second surface for the case
it is best at.

**The answer says which language it is in by carrying it.** A resource read projects
`locale` beside `id`. Nothing else was needed: §131's own shape — one row per language,
the row keeps its fields — makes the language a field, so a fallback is distinguishable
from a translation without a flag being invented for it.

## Consequences

- A model that is translatable in a deployment serving one language is refused at
  `createApplication()`. By the first read its columns are in the schema and every row
  has been written in no language in particular, which no migration undoes.
- `locale` and `translationOf` are not fields a resource declares and must not become
  them. An editor does not fill in which language they are typing in, and
  `translationOf` is how the rows of one entry are tied together.
- A translation of a translation hangs off the original, because the fallback groups by
  `translationOf` and would otherwise see two entries where the site has one.
- The fallback costs one extra read per query on a translatable model in a non-default
  language. The alternative is `distinct on` or a window function, which is a Query AST
  change every adapter would have to implement (ADR-0013).
- **A collection (SPEC.md §37) is not translatable.** Its entries share one JSONB table,
  so one row per language would be one row per language of every collection at once, and
  a stored definition has nowhere to say which of its fields are worth translating. It is
  the one gap in §131's "every layer, or none", and `@assemora/resources` says so where
  it is asked rather than answering silently.
- Pages are not translatable yet. §131 asks for a slug and a block tree per locale and
  the mechanism above is what that will be built on; nothing about it is decided here.
- Validation messages had to be made translatable first, and were (`Issue` carries its
  `code` and its `params` to the caller). A translated copy of a row inherits the same
  untranslatable English, so doing it afterwards would have meant doing it twice —
  `site-kits.md` item 2.5 says so in its own words.

## Alternatives

**A field becomes a map keyed by language.** `title: { en: '…', ru: '…' }` is how most
CMSes store it and it is one column instead of a table of rows. Rejected by §131 itself,
and the reason is §2: one declaration feeds the record type, the column, the form, the
OpenAPI schema, the SDK and the MCP tool. A map breaks all six at once, and
`Article.where('title', …)` stops being expressible.

**A route per language in the registry.** It would make `a resource's paths are
per-locale` literally true in the description as well as on the wire. Rejected because
the description exists to be read: three languages would treble `/api/openapi.json`, the
API Explorer and the generated SDK, to say the same thing three times.

**The fallback in the read layer instead of the query builder.** `entries.list` knows
about pagination and could merge two answers itself. Rejected because then
`Article.published().get()` — the call §131 uses as its example — would not fall back,
and every application would reimplement it at a different level of care.

**Creating a row in every language when an entry is created.** No fallback would be
needed, because there would be no missing translation. Rejected: it turns "which of
these has not been translated yet" into an unanswerable question, and a site would
publish empty pages in every language it serves the moment an editor saves.
