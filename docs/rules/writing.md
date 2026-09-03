# Writing rules

Commit subjects, ADR titles and test names. Reference: SPEC.md §126, and the
existing rule files it sits beside.

The bodies in this repository are excellent, and none of this is about them. It
is about the one line that gets read *without* them — in `git log --oneline`, on
a GitHub commit list, in a pull request title, in a failing-test summary. Those
places truncate, and a truncated line loses whichever half was doing the work.

## Commit subjects

**Fit the subject in 72 characters.** GitHub truncates past that in every list
view, so the words after it are written for nobody. 30 of the 96 subjects here
are longer, and they are not bad sentences — they are good sentences that arrive
cut in half.

The body has no limit and is where the reasoning belongs. Nothing below asks for
less explanation; it asks for the explanation to be one line lower.

The house style is `type(scope): what changed`, in the imperative, and the good
version of it is already common here:

```
fix: a fresh clone builds, and the install stops linking nothing
feat: one command starts the demo, and the origin root answers
```

Both say a whole thing and both fit. The pattern they share is worth naming: a
subject that survives truncation leads with the **outcome**, and leaves the
qualifier to the body.

### Before and after

Long, because the whole argument is on the subject line:

```
feat(theme): the theme is a stored document, and a stylesheet is its output (SPEC.md §62)
```

The `(SPEC.md §62)` is the part a reader most wants, and it is the part GitHub
drops first. Move it, and the second clause with it:

```
feat(theme): the theme is a stored document

SPEC.md §62. A stylesheet is its output, rendered by `themeCss()` and served by
the umbrella, so nothing anywhere accepts CSS.
```

Same, from a docs commit:

```
docs: pages are translatable, and the one-language deployment is the rule not the exception
```

Two claims, and the second is the surprising one — so it is the one that must not
be cut:

```
docs: a one-language deployment is the ordinary case

Pages are translatable, and core no longer refuses a translatable model where
`locales` names nothing: that broke SPEC.md §9 and §124.
```

## ADR titles

An ADR title is read in a directory listing and in `docs/adr/`'s index, both of
which are narrow. **Say the decision, not its consequences** — the consequences
are the document.

Most are already right:

```
0001. Query AST as the internal contract
0004. The Command Bus is the only mutation path
```

Where they run long it is because a second clause has been appended:

```
0026. A module reports that it did not start; the process that serves decides what that means
```

The decision is the first clause; the second is what the ADR spends its body on:

```
0026. A module reports that it did not start
```

**Keep the filename slug short and stable.** `0026-module-cannot-start.md` is a
filename people type and link to; it does not have to mirror the title, and it
should not grow when the title is edited.

## Test names

A test name is read in a failure summary with no file, no line and no code
around it. It has to say what broke on its own — which is why the convention
here is a sentence about behaviour rather than a restatement of the function
name.

The existing ones set the bar:

```ts
it('reports a required field named after a prototype key as missing, not as mistyped')
it('says neither when neither was said, so a palette that grouped nothing looks as it did')
```

Both name the wrong behaviour as well as the right one, which is what makes a
red line actionable before anyone opens the file.

Two rules follow from that:

- **Say the behaviour, not the method.** `it('validates props')` tells a reader
  nothing a failing assertion has not already told them.
- **Where a test exists because of a specific bug, name the bug.** `not as
  mistyped` above is the whole value of that name: it says which of two
  plausible outcomes is the wrong one.

There is no length limit here. A failure summary does not truncate the way a
commit list does, and a long name that says what broke beats a short one that
does not.

## Not a history rewrite

This is a rule going forward. The 30 long subjects already in the history stay
as they are — rewriting them would break every hash anyone has linked to, to fix
lines nobody is reading again.
