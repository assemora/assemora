# 0030. Studio speaks a language, and it is not the one it edits

Status: accepted
Date: 2026-09-01

## Context

ADR-0028 and SPEC.md §131 made *content* translatable: a row per language, a language
in the address, a fallback that says which language it is actually in, and a Studio
that switches between them. What none of that touched is the surface those controls
are drawn on. Every word Studio says about itself — `Save changes`, `Delete 3
entries?`, `This is the uk original, not a ru translation.` — was an English literal in
a `.tsx` file.

The gap is not cosmetic. A Ukrainian restaurant's menu is filled in by the person who
cooks, and the sentence that has to be understood before pressing a button is the one
Studio wrote, not the one the application declared. Half a screen in Ukrainian under a
toolbar in English is the state §131 calls out for content — *never present a fallback
as though it were a translation* — arriving one layer up.

Three questions had to be answered.

**Whose language is it?** The deployment's `locales` are a fact about the *content*:
they decide which rows a listing holds and they come from the Schema Registry. The
language the interface is in is a fact about the *person reading it*. A Ukrainian shop
whose developer reads English, and an English shop whose editor reads Ukrainian, are
both ordinary — so the two cannot be one control, and the interface language cannot
come from the registry.

**Where do the words live?** Studio is a closed, pre-built artifact (ADR-0027): an
application cannot add a language to a bundle it did not build. So the set is the
bundle's, and it is short and deliberate rather than an open door.

**What happens to a missing translation?** §131 answers this for content with a
fallback that announces itself. A fallback in the chrome cannot announce itself —
there is nowhere to put the badge — so it would be an English button in a Ukrainian
form that nobody notices until a person does.

## Decision

**The interface language is a preference, remembered per browser.** `localStorage`,
guessed on a first visit from `navigator.languages`, changed from the account menu and
from the sign-in screen. Not a column on the user: the login screen is the first screen
somebody reads and there is no viewer yet to read a column off, so a per-person setting
would need this mechanism underneath it anyway. Not configuration, because a deployment
does not know who will open Studio.

**Both languages live on one menu, and are named apart.** `Editing in` names the
content locale (§131); `Studio language` names this one. They sit next to each other so
that the difference can be seen, and Studio's own is present even in an application
that serves one language, where the other has nothing to switch.

**Changing it sends no request.** Nothing the application holds depends on it, so this
is a React context and the content locale is not: switching the interface re-renders,
and switching the content language invalidates every answer in the cache
(`api/locale.tsx` says why in its own words).

**A key holds every language at once, and the compiler enforces it.**
`Readonly<Record<Language, string>>` means a key with English and nothing else does not
compile. The price is stated rather than hidden: adding a fourth language does not build
until every message is written in it. That is the intended shape — a half-translated
admin panel is the failure this file exists to make impossible.

**The parameters of a message are read off its English reading.** `t('entry.savedAt',
{ when })` does not compile without `when`, and does not compile with a `where` the
sentence has no hole for; a plural's forms must each contain `{count}`, in the type. A
translation may use *fewer* holes than the English — Ukrainian and Russian cannot
decline a foreign noun into a sentence, so `No {name} yet` becomes `Тут ще немає жодного
запису` and leaves the name to the heading — and never more, which a test asserts.

**Counting is per language, not one rule.** English takes the first form at 1 and the
second everywhere else; Ukrainian and Russian take three forms on the ...1/...2–4/rest
rule. Sharing one rule makes `21 item` out of a correct `21 запис`, so the table is
keyed by language and a test pins 21.

**Numbers and dates are written by the language on screen.** `12 480` and `31.12.2025`
in Ukrainian, `12,480` and `12/31/2025` in English. `toLocaleDateString()` with no
argument follows the *browser*, which is a different question and was silently wrong for
anybody whose machine disagreed with their reading.

**Studio translates what Studio says, and nothing else.** A resource's label, a field's
label, a block's description, a select's options and a refusal the application wrote are
the *application's* words, in the language its developer wrote them in. They are carried
by the registry and left exactly as they arrive. Where such a word lands inside a
sentence, the sentence puts it where its grammatical case cannot be wrong: quoted, after
a colon, or left to the heading above.

## Consequences

- A person who reads Ukrainian can use Studio in Ukrainian while the shop it edits is in
  English, and the reverse. The two switchers are on one menu and never disagree,
  because they are answers to different questions.
- `document.documentElement.lang` follows the choice, so a screen reader picks a voice
  and a browser stops offering to translate a page it is already reading correctly.
- The three catalogues are one object assembled from eight slices, and a test proves the
  merge lost nothing: a key written into two slices would silently be one key.
- A table of message keys has to declare which keys it holds. `t` asks for a message's
  parameters at the call site, so a variable typed as the whole `MessageKey` union is
  not callable — `kindOf` in the history screen and `TokenGroup.title` both name their
  own narrow unions instead. That is the machinery working rather than a wart.
- **A refusal the application wrote is still English.** `Issue` carries its `code` and
  its `params` to the client (ADR-0028), and Studio ignores both and renders `message`.
  Translating them by code is the obvious next step and is a decision of its own: the
  codes live in four packages, several carry parameters, and a wrong translation of a
  validation message is worse than an English one. Studio's own transport failure —
  a response that was not our error shape at all — *is* translated, because there is no
  sentence to pass on.
- Adding a language is one column in `LANGUAGES` and one reading per key, and the build
  says exactly which ones are missing. Nothing else has to be found.

## Alternatives

**One switcher for both languages.** Fewer controls, and it is what a reader expects
until they think about it. Rejected: it makes "show me the Russian rows" and "talk to me
in Russian" the same act, so an English-reading developer cannot look at the Russian
menu without their own interface changing under them, and a Ukrainian editor cannot edit
the English site at all.

**The preference on the user row.** It would follow a person between machines, which is
better. Rejected for v1 because the sign-in screen has no viewer to read it from and
would need the browser mechanism regardless; adding the column later changes where the
value is read and nothing else.

**One file per language.** `en.ts`, `uk.ts`, `ru.ts` is the usual shape and each file
stays short. Rejected: the three readings of one key have to be looked at together —
that is how a missing one is seen at all, and it is what makes an English string sitting
next to a Russian one obviously wrong rather than three files away.

**English fallback for a missing translation.** No build would ever break on a
half-written language. Rejected because the failure is invisible: an English button in a
Ukrainian form is noticed by the person using it, months later, and not by anybody who
could fix it. The compiler is the only reader guaranteed to look.

**A message catalogue stored in the database, editable in Studio.** It would let an
application reword Studio without a build. Rejected: Studio is a pre-built artifact
(ADR-0027) and its words are part of it, the same way its components are — and a CMS
whose own labels are content is a CMS with no fixed vocabulary to write documentation
against.
