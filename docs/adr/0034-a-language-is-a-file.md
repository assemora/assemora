# 0034. A language is a file

Status: accepted
Date: 2026-09-10

Amends ADR-0030, which decided the opposite about where the words live.

## Context

ADR-0030 gave Studio a language of its own and answered three questions to do it. Two
have held. The third was:

> **Where do the words live?** Studio is a closed, pre-built artifact (ADR-0027): an
> application cannot add a language to a bundle it did not build. So the set is the
> bundle's, and it is short and deliberate rather than an open door.

That is a derivation, and the premise it derives from is about the wrong thing.
ADR-0027's argument is that a **function** does not survive `JSON.stringify`, which is
why a predicate written into a declared action is erased rather than rejected. A
translation is not a function. It is a string, and a string survives JSON exactly.

So what shipped was `LANGUAGES = ['en', 'uk', 'ru']`, compiled into every bundle. The
three languages its author happened to write became the three languages every Assemora
deployment on earth offers: a Brazilian shop could not add Portuguese, a German agency
could not add German, and nobody could remove Ukrainian or Russian. The set was not
short and deliberate. It was a ceiling, and it was the author's own locale imposed on
everyone downstream.

There was one thing in the subsystem that genuinely could not travel as data, and it is
worth naming because it is what made the ceiling look necessary. Plural selection was a
table of functions — `Record<Language, (count: number) => 0 | 1 | 2>` — one rule per
language, with Ukrainian and Russian sharing theirs and English deliberately not. That
is precisely the ADR-0027 shape. A pack could not have carried it, so a hand-written
rule would have pinned the set shut no matter what happened to the strings.

It does not need to travel. `Intl.PluralRules` knows the rule for every language the
browser knows, which is every language CLDR has — the same table the translator was
reading from when they wrote the forms. Asking the platform dissolves the one real
obstacle.

Asking it also exposed a second ceiling nobody had noticed. `Plural` was
`Record<Language, readonly [Counted, Counted, Counted]>`: three forms, because Ukrainian
and Russian need three, with English written as three to save a mechanism. Arabic takes
six and Japanese takes one, so the *arity of every language's plural* was a Slavic
assumption baked into the type. CLDR's category names remove it.

## Decision

**English is compiled in. Every other language is a file.** The catalogue holds the
English reading of every key and nothing else. It is the source in three senses: it is
what a key is drafted in, it is what the call-site types are read off, and it is what a
language missing that key falls back to. A bundle without it could not draw a screen, so
it is not a pack and never appears in a manifest.

**A pack is JSON, and the ones this bundle ships are not privileged.** `public/i18n/uk.json`
is copied beside the bundle by the build, and a pack a deployment writes is the same kind
of file read from the same place. That sameness is the decision rather than a
convenience: a first-party language with a representation of its own would mean the set
was still closed, with a courtesy extended to outsiders.

**A deployment decides what is offered**, through `studio: { languages }` to narrow the
set and `studio: { languagePacks }` to add to it. Both are facts about the people who
open Studio, which is why they sit beside `path` and not beside `locales` — `locales` is
about the rows a screen is about (SPEC.md §131), and the two have never been one
question. A project's pack shadows a shipped one of the same tag, so a deployment can
correct a translation without waiting for a release.

**The manifest is computed by the umbrella and served from memory.** Three facts decide
the offer — what the bundle ships, what the project added, what the deployment narrowed
to — and the bundle knows only the first, months before the others were said. So
`mountAssets` grew `documents`: paths answered from memory, checked before the disk. The
bundle's own manifest becomes a default that the deployment's answer shadows.

**A tag named that nothing answers refuses the boot**, naming what the deployment does
have. Dropping it silently would mean believing you offer German and finding out from
whoever opened the switcher looking for it.

**Plural selection is `Intl.PluralRules`, and a plural's forms are CLDR's categories.**
`other` is required, because it is the one every language has and the one every fallback
lands on; the rest are whatever the language takes.

**The manifest and the packs are static assets, not endpoints.** This is what the sign-in
screen needs and could not otherwise have: it is read before anybody has a session, and
`/api/_introspection` answers 401 there. No new authentication surface was opened to make
the switcher on the login screen tell the truth.

## Consequences

**The compiler no longer refuses an incomplete shipped pack.** That guarantee was the
best thing about ADR-0030 and it is not given up, only moved: `packs.test.ts` holds every
shipped pack against the English catalogue for completeness, for invented holes, and for
the plural categories its own language takes — asked of `Intl`, so a Ukrainian pack
missing `few` fails. It runs in `pnpm verify`, which is what CI runs.

**A pack a deployment adds is checked by nothing, and degrades per key.** A key it lacks
is answered in English. Per key rather than per pack, deliberately: a pack written
against an older Studio is then a screen in its own language with the newest sentence in
English, where falling back wholesale would turn one missing key into an English admin
panel.

**A language now costs a fetch.** The provider holds the first paint until the manifest
and the initial pack settle — a few milliseconds for static files on the origin the
bundle came from — rather than drawing in English and changing under the reader. A
manifest that never answers draws English after 1500ms, so the failure is a legible
Studio rather than none.

**`Language` is `string`.** A union was a list, and a list was the thing that could not be
added to. Nothing is lost at the call site, because no call site ever passed a language:
`t('common.save')` names a key and the language comes from the context around it. A tag
arriving from outside is checked by `Intl.getCanonicalLocales`, which is the same library
that will be handed it.

## Alternatives

**Keep the set closed and add `studio: { languages }` to narrow it.** This is the small
half of what was built, and it answers the cosmetic complaint — a public demo showing a
Ukrainian toggle to English-speaking readers — without answering the real one. A German
agency still could not have German. Narrowing alone would have been a deployment
choosing between the author's three.

**Ship English only, and make Ukrainian and Russian downloads.** The same mechanism with
the first-party work thrown away. The packs are good and maintained; there is no reason
for a Ukrainian deployment to fetch one from somewhere else.

**Let the application supply Studio's strings through the registry.** This would make the
words the application's, which ADR-0030 was right to refuse: what a resource is called is
the application's to say and Studio leaves it as it arrives, and what a *button* says is
Studio's. A pack is Studio's own vocabulary in another language, not the application's.
