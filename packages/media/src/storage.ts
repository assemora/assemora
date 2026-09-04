/**
 * Where the bytes live (SPEC.md §63).
 *
 * The interface names no vendor. Both drivers SPEC.md §63 makes mandatory implement
 * it: the local disk one below, and the S3-compatible one in `s3-storage.ts`.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'

import { AssemoraError } from '@assemora/core'

export type StoredObject = {
  readonly path: string
  readonly size: number
}

export type StorageDriver = {
  readonly name: string
  /**
   * Where the bytes live, for a person: a directory, a bucket. Shown on the settings
   * screen beside the driver's name, so it must never carry a credential.
   */
  readonly where?: string
  put(path: string, data: Uint8Array, contentType: string): Promise<StoredObject>
  get(path: string): Promise<Uint8Array>
  remove(path: string): Promise<void>
  /** Where a browser fetches it from. */
  url(path: string): string
}

export type LocalStorageOptions = {
  readonly root: string
  /** Prefix the files are served under. `/media` by default. */
  readonly baseUrl?: string
}

/**
 * Refuses a path that would climb out of the root.
 *
 * A filename arrives from an upload, and `../../etc/passwd` is a filename
 * (SPEC.md §85).
 */
const safeJoin = (root: string, path: string): string => {
  const resolvedRoot = resolve(root)
  const target = resolve(join(resolvedRoot, normalize(path)))

  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw new AssemoraError('INVALID_PATH', 'That path leaves the media root', { status: 422 })
  }

  return target
}

export const localStorage = (options: LocalStorageOptions): StorageDriver => {
  const baseUrl = options.baseUrl ?? '/media'

  return {
    name: 'local',
    where: resolve(options.root),

    async put(path, data) {
      const target = safeJoin(options.root, path)

      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)

      return { path, size: data.byteLength }
    },

    async get(path) {
      return new Uint8Array(await readFile(safeJoin(options.root, path)))
    },

    async remove(path) {
      await rm(safeJoin(options.root, path), { force: true })
    },

    url(path) {
      return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    },
  }
}

let current: StorageDriver | undefined

export const useStorage = (driver: StorageDriver): void => {
  current = driver
}

/** Whether a driver was registered at all — an application may boot before deciding. */
export const hasStorage = (): boolean => current !== undefined

export const currentStorage = (): StorageDriver => {
  if (current === undefined) {
    throw new AssemoraError('CONFIGURATION_ERROR', 'No media storage is registered', {
      status: 500,
    })
  }

  return current
}

/**
 * The largest file `media.upload` accepts, in bytes (SPEC.md §85).
 *
 * 16 MiB by default: a file reaches the command as base64 inside its input, four bytes
 * on the wire for every three stored, so this admits a file of about 12 MB — and a
 * phone photograph is 2–5 MB. Sized here because this module is what the number is
 * about; the process that serves reads it to size the one route that carries a file,
 * and the settings screen reads it to say so.
 */
export const DEFAULT_UPLOAD_BYTES = 16 * 1024 * 1024

let uploadLimit = DEFAULT_UPLOAD_BYTES

export const useUploadLimit = (bytes: number): void => {
  uploadLimit = bytes
}

export const currentUploadLimit = (): number => uploadLimit

/** Forgets the driver and the ceiling, for a test that builds more than one application. */
export const clearStorage = (): void => {
  current = undefined
  uploadLimit = DEFAULT_UPLOAD_BYTES
}
