# Placeholders

Two packages whose only job is to hold a name.

npm has no reservation: an unscoped name belongs to whoever publishes to it first, and
`assemora` and `create-assemora` are both unscoped. So until the first real release
there is a window in which somebody else can take either one, and the way to close it
is to publish something.

These are that something. They are deliberately minimal and deliberately honest: each
one installs, and each one prints where the real thing is rather than pretending to be
it. `pnpm create assemora my-project` then answers with a sentence instead of a 404,
which is the same thing the repository's own scaffolder already says.

```bash
npm publish docs/placeholders/assemora --access public
npm publish docs/placeholders/create-assemora --access public
```

They carry `0.0.1` so that the first real release — `0.1.0-alpha.0`, see
[`../releasing.md`](../releasing.md) — is an ordinary upgrade over them rather than a
version that has to be argued with.

Delete this directory once that release is out. A placeholder that outlives the thing
it was holding a place for is a package somebody will eventually install by accident.
