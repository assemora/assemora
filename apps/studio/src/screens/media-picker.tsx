/**
 * Choosing a file for a `media()` field (SPEC.md §39, §63).
 *
 * The same list the Media section shows, in a dialog. Uploading from here runs the
 * `media.upload` command, so a file added mid-edit is recorded and audited exactly
 * like one added from the library.
 */
import { useRef, useState } from 'react'

import { isImage, type MediaItem, readableSize, useMedia, useUpload } from '../api/media.ts'
import { Button, Empty, Failure, Spinner } from '../ui/index.tsx'

export const MediaPicker = ({
  onPick,
  onClose,
}: {
  onPick(item: MediaItem): void
  onClose(): void
}) => {
  const [page, setPage] = useState(1)
  const media = useMedia(page)
  const uploading = useUpload()
  const input = useRef<HTMLInputElement>(null)

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a file"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="flex max-h-[80dvh] w-full max-w-3xl flex-col rounded-xl bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Choose a file</h2>
          <div className="flex items-center gap-2">
            <input
              ref={input}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]

                if (file !== undefined) uploading.mutate(file)
                event.target.value = ''
              }}
            />
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
              {uploading.isPending ? 'Uploading…' : 'Upload'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {media.isPending && <Spinner />}
          {media.isError && <Failure error={media.error} />}
          {uploading.isError && <Failure error={uploading.error} />}

          {media.data?.data.length === 0 && (
            <Empty title="The library is empty">Upload a file to use it here.</Empty>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
            {media.data?.data.map((item) => (
              <button
                key={item.id}
                type="button"
                className="group space-y-1.5 rounded-lg border border-line p-2 text-left transition hover:border-accent"
                onClick={() => onPick(item)}
              >
                {isImage(item) ? (
                  <img
                    src={item.url}
                    alt={item.alt ?? ''}
                    className="aspect-square w-full rounded object-cover"
                  />
                ) : (
                  <span className="grid aspect-square w-full place-items-center rounded bg-surface-sunken text-xs text-ink-faint">
                    {item.mimeType.split('/')[1] ?? 'file'}
                  </span>
                )}
                <span className="block truncate text-xs font-medium">{item.filename}</span>
                <span className="block text-xs text-ink-faint">{readableSize(item.size)}</span>
              </button>
            ))}
          </div>
        </div>

        {media.data !== undefined && media.data.lastPage > 1 && (
          <footer className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-ink-soft">
            <span>
              Page {media.data.page} of {media.data.lastPage}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= media.data.lastPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}
