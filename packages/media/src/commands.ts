/**
 * Media commands (SPEC.md §14, §63).
 */
import { command, NotFoundError } from '@assemora/core'
import { binary, json, nullable, number, optional, string, uuid } from '@assemora/schema'

import { Media } from './models.js'
import { currentStorage } from './storage.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'media.uploaded': { readonly mediaId: string }
    'media.updated': { readonly mediaId: string }
    'media.deleted': { readonly mediaId: string }
  }
}

/** `photo.png` → `2026/08/<uuid>.png`, so nothing collides and nothing is guessable. */
const storagePath = (filename: string): string => {
  const now = new Date()
  const extension = filename.includes('.') ? `.${filename.split('.').pop()}` : ''

  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}${extension}`
}

export const UploadMedia = command('media.upload', {
  description: 'Stores a file and records it in the library',
  // The bytes are written to storage, and no transaction can take them back
  // (SPEC.md §73, ADR-0019).
  previewable: false,
  input: {
    filename: string().min(1),
    mimeType: string().min(1),
    data: binary(),
    alt: string().optional(),
    width: number().integer().optional(),
    height: number().integer().optional(),
    metadata: json<Record<string, unknown>>().optional(),
  },
  output: { id: uuid(), url: string(), size: number().integer() },
  handle: async (input, context) => {
    const storage = currentStorage()
    const path = storagePath(input.filename)
    const stored = await storage.put(path, input.data, input.mimeType)

    const item = await Media.create({
      disk: storage.name,
      path: stored.path,
      filename: input.filename,
      mimeType: input.mimeType,
      size: stored.size,
      width: input.width ?? null,
      height: input.height ?? null,
      alt: input.alt ?? null,
      metadata: input.metadata ?? {},
      createdBy: context.actor?.id ?? null,
    })

    context.revise({
      entityType: 'media',
      entityId: item.id,
      before: null,
      after: item.toJSON(),
    })
    context.emit('media.uploaded', { mediaId: item.id })

    return { id: item.id, url: storage.url(stored.path), size: stored.size }
  },
})

/**
 * What a caller may say about a stored file, as against the file itself.
 *
 * `alt` is the whole reason this command exists: it is what an image says to somebody
 * who cannot see it, and the column has held `null` since the library was written
 * because there was no command between upload and delete.
 *
 * The dimensions are here because they are *facts* rather than editorial text, and a
 * fact recorded wrongly has to be correctable — a library imported before anything
 * measured it, or a driver that reported nothing. Studio measures them in the browser
 * at upload and does not offer them as a form field, because a person typing an
 * image's height is a person entering a number that is wrong.
 *
 * Each is optional and each is nullable, and the two mean different things: an absent
 * key leaves the column alone, and an explicit `null` clears it. Without the
 * distinction there is no way to *remove* alt text, and "" is not the same claim — an
 * empty `alt` tells a screen reader the image is decorative, which is an assertion
 * somebody has to make on purpose.
 */
const EDITABLE = {
  alt: optional(nullable(string())),
  width: optional(nullable(number().integer())),
  height: optional(nullable(number().integer())),
} as const

export const UpdateMedia = command('media.update', {
  description: 'Changes what the library records about a file',
  input: { id: uuid(), ...EDITABLE },
  output: {
    id: uuid(),
    alt: string().nullable(),
    width: number().integer().nullable(),
    height: number().integer().nullable(),
  },
  handle: async ({ id, ...changes }, context) => {
    const item = await Media.find(id)

    if (item === null) throw new NotFoundError('media', id)

    const before = item.toJSON()

    // The second question, with the record in hand (ADR-0015). The first — may this
    // actor update media at all — the bus asked before the handler ran.
    await context.authorize('media', 'update', before)

    for (const [field, value] of Object.entries(changes)) {
      // `undefined` is the key nobody sent. Assigning it would write the column's
      // absence over its value, which is the one thing a partial update must not do.
      if (value !== undefined) Object.assign(item, { [field]: value })
    }

    await item.save()

    const after = item.toJSON()

    context.revise({ entityType: 'media', entityId: id, before, after })
    context.emit('media.updated', { mediaId: id })

    return { id, alt: item.alt, width: item.width, height: item.height }
  },
})

export const DeleteMedia = command('media.delete', {
  description: 'Removes a file and its record',
  /** The file is gone from storage before the transaction has a say. */
  previewable: false,
  input: { id: uuid() },
  output: { id: uuid() },
  handle: async ({ id }, context) => {
    const item = await Media.find(id)

    if (item === null) throw new NotFoundError('media', id)

    const before = item.toJSON()

    await context.authorize('media', 'delete', before)
    await currentStorage().remove(item.path)
    await item.delete()

    context.revise({ entityType: 'media', entityId: id, before, after: null })
    context.emit('media.deleted', { mediaId: id })

    return { id }
  },
})

export const mediaCommands = [UploadMedia, UpdateMedia, DeleteMedia] as const
