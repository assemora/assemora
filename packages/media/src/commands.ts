/**
 * Media commands (SPEC.md §14, §63).
 */
import { command, NotFoundError } from '@assemora/core'
import { binary, json, number, string, uuid } from '@assemora/schema'

import { Media } from './models.js'
import { currentStorage } from './storage.js'

declare module '@assemora/core' {
  interface AssemoraEventPayloads {
    'media.uploaded': { readonly mediaId: string }
    'media.deleted': { readonly mediaId: string }
  }
}

/**
 * Types a browser may be told to render (SPEC.md §85).
 *
 * A content type is chosen by whoever uploads, and `text/html` would make the media
 * library a way to run a script on the application's own origin. Anything not on this
 * list is stored and served as a download rather than as a page.
 */
const RENDERABLE = new Set([
  'image/apng',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'text/plain',
])

/** What a browser may be told this file is. */
export const safeContentType = (mimeType: string): string =>
  RENDERABLE.has(mimeType.toLowerCase()) ? mimeType.toLowerCase() : 'application/octet-stream'

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

export const DeleteMedia = command('media.delete', {
  description: 'Removes a file and its record',
  /** The file is gone from storage before the transaction has a say. */
  previewable: false,
  input: { id: uuid() },
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

export const mediaCommands = [UploadMedia, DeleteMedia] as const
