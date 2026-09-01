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
import { useT } from '../i18n/translate.tsx'
import { Button, Card, Empty, Failure, Spinner } from '../ui/index.tsx'

const Details = ({ item, onClose }: { item: MediaItem; onClose(): void }) => {
  const remove = useDeleteMedia()
  const t = useT()

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
          <dt className="text-sm text-ink-faint">{t('media.filename')}</dt>
          <dd className="break-all">{item.filename}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-faint">{t('media.type')}</dt>
          <dd>{item.mimeType}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-faint">{t('media.sizeLabel')}</dt>
          <dd>
            {readableSize(item.size, t)}
            {item.width !== null && ` · ${item.width}×${item.height}`}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-faint">{t('media.url')}</dt>
          <dd className="break-all font-mono text-sm">{item.url}</dd>
        </div>
      </dl>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(t('media.confirmDelete', { name: item.filename }))) {
              remove.mutate(item.id, { onSuccess: onClose })
            }
          }}
        >
          {t('common.delete')}
        </Button>
      </div>
    </aside>
  )
}

export const MediaLibrary = () => {
  const t = useT()
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
          title={t('nav.media')}
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
                {uploading.isPending ? t('media.uploading') : t('media.upload')}
              </Button>
            </>
          }
        >
          {media.isError && <Failure error={media.error} />}
          {uploading.isError && <Failure error={uploading.error} />}

          <Card className="p-5">
            {media.isPending && <Spinner />}

            {media.data?.data.length === 0 && (
              <Empty title={t('media.empty')}>{t('media.emptyBody')}</Empty>
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
                      {item.mimeType.split('/')[1] ?? t('media.file')}
                    </span>
                  )}
                  <span className="block truncate text-sm font-medium">{item.filename}</span>
                  <span className="block text-sm text-ink-faint">{readableSize(item.size, t)}</span>
                </button>
              ))}
            </div>
          </Card>

          {media.data !== undefined && media.data.lastPage > 1 && (
            <div className="mt-4 flex items-center justify-between text-base text-ink-soft">
              <span>{t('paging.page', { page: media.data.page, last: media.data.lastPage })}</span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  {t('paging.previous')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= media.data.lastPage}
                  onClick={() => setPage((current) => current + 1)}
                >
                  {t('paging.next')}
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
