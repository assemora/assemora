/**
 * The media library (SPEC.md §63, §115).
 */
import { Image as ImageIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import {
  isImage,
  type MediaItem,
  readableSize,
  useDeleteMedia,
  useMedia,
  useUpload,
} from '../api/media.ts'
import { Page } from '../app/shell.tsx'
import { Button, Card, Empty, Failure, Spinner } from '../ui/index.tsx'

const Details = ({ item, onClose }: { item: MediaItem; onClose(): void }) => {
  const remove = useDeleteMedia()

  return (
    <aside className="w-72 shrink-0 space-y-4 border-l border-line bg-surface p-5">
      {isImage(item) ? (
        <img src={item.url} alt={item.alt ?? ''} className="w-full rounded-lg border border-line" />
      ) : (
        <div className="grid aspect-video place-items-center rounded-lg bg-surface-sunken text-base text-ink-faint">
          {item.mimeType}
        </div>
      )}

      <dl className="space-y-2 text-base">
        <div>
          <dt className="text-sm text-ink-faint">Filename</dt>
          <dd className="break-all">{item.filename}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-faint">Type</dt>
          <dd>{item.mimeType}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-faint">Size</dt>
          <dd>
            {readableSize(item.size)}
            {item.width !== null && ` · ${item.width}×${item.height}`}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-faint">URL</dt>
          <dd className="break-all font-mono text-sm">{item.url}</dd>
        </div>
      </dl>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${item.filename}?`)) {
              remove.mutate(item.id, { onSuccess: onClose })
            }
          }}
        >
          Delete
        </Button>
      </div>
    </aside>
  )
}

export const MediaLibrary = () => {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<MediaItem>()
  const media = useMedia(page)
  const uploading = useUpload()
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className="flex min-h-dvh">
      <div className="min-w-0 flex-1">
        <Page
          icon={<ImageIcon className="size-5" />}
          title="Media"
          count={media.data?.total}
          actions={
            <>
              <input
                ref={input}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  for (const file of event.target.files ?? []) uploading.mutate(file)
                  event.target.value = ''
                }}
              />
              <Button onClick={() => input.current?.click()} disabled={uploading.isPending}>
                {uploading.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </>
          }
        >
          {media.isError && <Failure error={media.error} />}
          {uploading.isError && <Failure error={uploading.error} />}

          <Card className="p-5">
            {media.isPending && <Spinner />}

            {media.data?.data.length === 0 && (
              <Empty title="The library is empty">
                Upload an image and it becomes available to every `media()` field.
              </Empty>
            )}

            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
              {media.data?.data.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    'space-y-1.5 rounded-lg border p-2 text-left transition',
                    selected?.id === item.id
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-line hover:border-ink-faint',
                  ].join(' ')}
                  onClick={() => setSelected(item)}
                >
                  {isImage(item) ? (
                    <img
                      src={item.url}
                      alt={item.alt ?? ''}
                      className="aspect-square w-full rounded object-cover"
                    />
                  ) : (
                    <span className="grid aspect-square w-full place-items-center rounded bg-surface-sunken text-sm text-ink-faint">
                      {item.mimeType.split('/')[1] ?? 'file'}
                    </span>
                  )}
                  <span className="block truncate text-sm font-medium">{item.filename}</span>
                  <span className="block text-sm text-ink-faint">{readableSize(item.size)}</span>
                </button>
              ))}
            </div>
          </Card>

          {media.data !== undefined && media.data.lastPage > 1 && (
            <div className="mt-4 flex items-center justify-between text-base text-ink-soft">
              <span>
                Page {media.data.page} of {media.data.lastPage}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= media.data.lastPage}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Page>
      </div>

      {selected !== undefined && <Details item={selected} onClose={() => setSelected(undefined)} />}
    </div>
  )
}
