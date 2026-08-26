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

export const currentStorage = (): StorageDriver => {
  if (current === undefined) {
    throw new AssemoraError('CONFIGURATION_ERROR', 'No media storage is registered', {
      status: 500,
    })
  }

  return current
}

export const clearStorage = (): void => {
  current = undefined
}
