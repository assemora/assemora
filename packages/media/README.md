# `@assemora/media`

Media library and storage adapters.

**Implementation phase:** 7 — implemented, apart from the S3 driver.

```ts
useStorage(localStorage({ root: './storage/media' }))

await app.commands.execute('media.upload', { filename, mimeType, data })
```

The storage interface names no vendor. The local disk driver ships here and refuses
a path that would climb out of its root — a filename arrives from an upload, and
`../../etc/passwd` is a filename.

The S3-compatible driver of SPEC.md §63 needs a signing client and credential
handling that belong with deployment; it arrives with the CLI in phase 10.

## Workspace dependencies

- `@assemora/schema`
- `@assemora/core`
- `@assemora/data`
