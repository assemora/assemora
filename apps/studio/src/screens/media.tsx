/**
 * The media library (SPEC.md §63, §115).
 */
import { Image as ImageIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  isImage,
  type MediaItem,
  readableSize,
  useDeleteMedia,
  useMedia,
  useUpdateMedia,
  useUpload,
} from '../api/media.ts'
import { Page } from '../app/shell.tsx'
import { useT } from '../i18n/translate.tsx'
import { Button, Card, Empty, Failure, Field, Spinner, Textarea } from '../ui/index.tsx'

const Details = ({ item, onClose }: { item: MediaItem; onClose(): void }) => {
  const remove = useDeleteMedia()
  const save = useUpdateMedia()
  const t = useT()
  const [alt, setAlt] = useState(item.alt ?? '')

  // Selecting another file replaces what this panel is about, and the box has to
  // follow — otherwise one image's description sits in the field over the next one
  // and is saved onto it by the button underneath.
  useEffect(() => {
    setAlt(item.alt ?? '')
  }, [item.alt])

  const stored = item.alt ?? ''
  const changed = alt !== stored

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

      {/*
       * Only for an image, because that is what alt text is for. A PDF or a video
       * offered one would be asking for a description nothing renders.
       */}
      {isImage(item) && (
        <div className="space-y-2">
          <Field label={t('media.alt')} help={t('media.altHelp')}>
            <Textarea
              rows={3}
              value={alt}
              placeholder={t('media.altPlaceholder')}
              onChange={(event) => setAlt(event.target.value)}
            />
          </Field>

          {save.isError && <Failure error={save.error} />}

          <Button
            size="sm"
            disabled={!changed || save.isPending}
            onClick={() =>
              // An empty box means "this image is decorative", which is a claim a
              // screen reader acts on — so it is stored as the empty string it was
              // typed as, and never as the `null` that means nobody has said yet.
              save.mutate({ id: item.id, alt })
            }
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      )}

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
  // The id rather than the item. Holding the object means holding a snapshot: saving
  // alt text invalidates the listing and the grid redraws, while the panel goes on
  // showing what was true when it was opened — and its Save button stays lit, because
  // it is comparing the box against a value that has already been written.
  const [selectedId, setSelectedId] = useState<string>()
  const media = useMedia(page)
  const selected = media.data?.data.find((item) => item.id === selectedId)
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
                    selectedId === item.id
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-line hover:border-ink-faint',
                  ].join(' ')}
                  onClick={() => setSelectedId(item.id)}
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
                  {/*
                   * Said on the card, because finding the images nobody has described
                   * is the reason somebody opens this screen after the fact — and an
                   * absence is invisible unless something draws it.
                   */}
                  {isImage(item) && (item.alt === null || item.alt === '') && (
                    <span className="block text-sm text-warning">{t('media.altMissing')}</span>
                  )}
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

      {selected !== undefined && (
        <Details item={selected} onClose={() => setSelectedId(undefined)} />
      )}
    </div>
  )
}
