/**
 * Choosing a file for a `media()` field (SPEC.md §39, §63).
 *
 * The same list the Media section shows, in a dialog. Uploading from here runs the
 * `media.upload` command, so a file added mid-edit is recorded and audited exactly
 * like one added from the library.
 */
import { ImagePlus } from 'lucide-react'
import { useRef, useState } from 'react'

import { isImage, type MediaItem, readableSize, useMedia, useUpload } from '../api/media.ts'
import { useT } from '../i18n/translate.tsx'
import { Button, Empty, Failure, Spinner } from '../ui/index.tsx'
import { useDismiss } from '../ui/overlay.tsx'

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
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // Escape and a click on the scrim, the way every other overlay in Studio closes.
  useDismiss(true, onClose, panel)

  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-[rgb(17_18_38/0.32)] p-6 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('media.choose')}
        className="rise flex max-h-[80dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[18px] bg-surface shadow-dialog"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-hairline px-5 py-3">
          <h2 className="text-section font-[650]">{t('media.choose')}</h2>
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
            <Button
              variant="secondary"
              busy={uploading.isPending}
              onClick={() => input.current?.click()}
            >
              {uploading.isPending ? t('media.uploading') : t('media.upload')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {media.isPending && <Spinner />}
          {media.isError && <Failure error={media.error} />}
          {uploading.isError && <Failure error={uploading.error} />}

          {media.data?.data.length === 0 && (
            <Empty icon={<ImagePlus className="size-[22px]" />} title={t('media.empty')}>
              {t('media.pickerEmptyBody')}
            </Empty>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
            {media.data?.data.map((item) => (
              <button
                key={item.id}
                type="button"
                className="group space-y-1.5 rounded-[10px] border border-line p-2 text-left hover:border-line-strong hover:bg-surface-sunken"
                onClick={() => onPick(item)}
              >
                {isImage(item) ? (
                  <img
                    src={item.url}
                    alt={item.alt ?? ''}
                    className="aspect-square w-full rounded object-cover"
                  />
                ) : (
                  <span className="grid aspect-square w-full place-items-center rounded bg-surface-sunken text-sm text-ink-faint">
                    {item.mimeType.split('/')[1] ?? t('media.file')}
                  </span>
                )}
                <span className="block truncate text-sm font-semibold">{item.filename}</span>
                <span className="block font-mono text-xs text-ink-faint">
                  {readableSize(item.size, t)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {media.data !== undefined && media.data.lastPage > 1 && (
          <footer className="flex shrink-0 items-center justify-between border-t border-hairline px-5 py-3 text-base text-ink-soft">
            <span>{t('paging.page', { page: media.data.page, last: media.data.lastPage })}</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('paging.previous')}
              </Button>
              <Button
                variant="secondary"
                disabled={page >= media.data.lastPage}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('paging.next')}
              </Button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}
