/**
 * The page list (SPEC.md §53, §115).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { LayoutTemplate, Search } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { ApiError, api } from '../api/client.ts'
import { type PageSummary, usePages } from '../api/pages.ts'
import type { MessageKey } from '../i18n/messages.ts'
import { useDates, useT } from '../i18n/translate.tsx'
import { NoPages } from '../ui/blank.tsx'
import { Button, Failure, Field, Input, Select, Spinner, StatusChip } from '../ui/index.tsx'
import {
  Mono,
  Screen,
  ScreenBody,
  ScreenFoot,
  ScreenHead,
  ScreenTitle,
  Table,
  Td,
  Th,
  Toolbar,
  Tr,
} from '../ui/layout.tsx'
import { Dialog } from '../ui/overlay.tsx'

const TONE = {
  published: 'positive',
  draft: 'neutral',
  archived: 'danger',
} as const

/** The three states a page can be in, which are Studio's words rather than the API's. */
const STATUS = {
  published: 'pages.status.published',
  draft: 'pages.status.draft',
  archived: 'pages.status.archived',
} as const satisfies Record<PageSummary['status'], MessageKey>

const NewPage = ({ onClose }: { onClose(): void }) => {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const t = useT()

  const create = useMutation({
    mutationFn: () => api.command<{ id: string }>('pages.create', { title, slug }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ['pages'] })
      await navigate({ to: '/pages/$id', params: { id: created.id } })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <Dialog
      open
      title={t('pages.new')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="new-page" busy={create.isPending}>
            {t('pages.create')}
          </Button>
        </>
      }
    >
      <form id="new-page" className="space-y-4 text-ink" onSubmit={submit}>
        <Field label={t('pages.title')} required>
          <Input
            required
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setSlug(
                event.target.value
                  .toLowerCase()
                  .normalize('NFKD')
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, ''),
              )
            }}
          />
        </Field>

        <Field label={t('pages.slug')} help={t('pages.slugHelp')} required>
          <Input required value={slug} onChange={(event) => setSlug(event.target.value)} />
        </Field>

        {create.isError && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-base text-danger">
            {create.error instanceof ApiError ? create.error.message : t('pages.createFailed')}
          </p>
        )}
      </form>
    </Dialog>
  )
}

const Row = ({ page }: { page: PageSummary }) => {
  const t = useT()
  const dates = useDates()

  return (
    <Tr>
      <Td className="max-w-[26rem]">
        <Link
          to="/pages/$id"
          params={{ id: page.id }}
          className="block truncate font-[550] text-ink hover:underline hover:decoration-ink-disabled hover:underline-offset-2"
        >
          {page.title}
        </Link>
      </Td>
      <Td>
        <Mono>
          {page.locale === undefined || page.locale === '' ? '' : `/${page.locale}`}/{page.slug}
        </Mono>
      </Td>
      <Td>
        <StatusChip tone={TONE[page.status]}>{t(STATUS[page.status])}</StatusChip>
      </Td>
      <Td>
        <Mono>v{page.version}</Mono>
      </Td>
      <Td className="text-ink-soft">{dates.date(page.updatedAt)}</Td>
      <Td align="right">
        <Link
          to="/pages/$id"
          params={{ id: page.id }}
          className="text-base font-[550] text-link hover:text-link-hover hover:underline"
        >
          {t('pages.openBuilder')}
        </Link>
      </Td>
    </Tr>
  )
}

export const Pages = () => {
  const t = useT()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const listing = usePages({
    ...(status === '' ? {} : { status }),
    ...(search === '' ? {} : { search }),
    page,
  })

  const filtered = search !== '' || status !== ''
  /**
   * Whether there is anything at all here, as opposed to nothing matching.
   *
   * A search box and a status filter over an empty application are two controls that
   * can only ever return what is already on screen, and they crowd out the one
   * sentence that is worth reading. They come back the moment a page exists — a filter
   * that found nothing keeps them, or there would be no way to undo it.
   */
  const blank = listing.data !== undefined && listing.data.data.length === 0 && !filtered

  return (
    <Screen>
      <ScreenHead>
        <ScreenTitle
          icon={<LayoutTemplate className="size-5" />}
          title={t('nav.pages')}
          count={blank ? undefined : listing.data?.total}
          // Not beside the title while the empty state is offering the same button under
          // the sentence that explains it.
          actions={!blank && <Button onClick={() => setCreating(true)}>{t('pages.new')}</Button>}
        />

        {!blank && (
          <Toolbar>
            <div className="relative max-w-[400px] flex-1">
              <Search
                aria-hidden
                className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-subdued"
              />
              <input
                type="search"
                aria-label={t('pages.search')}
                placeholder={t('collection.searchPlaceholder')}
                value={search}
                onChange={(event) => {
                  setPage(1)
                  setSearch(event.target.value)
                }}
                className="ring-field h-8 w-full rounded-lg border border-line bg-surface pr-3 pl-10 text-base hover:border-line-strong"
              />
            </div>
            <Select
              size="panel"
              aria-label={t('pages.statusLabel')}
              className="w-40"
              value={status}
              onChange={(event) => {
                setPage(1)
                setStatus(event.target.value)
              }}
            >
              <option value="">{t('pages.anyStatus')}</option>
              <option value="draft">{t('pages.status.draft')}</option>
              <option value="published">{t('pages.status.published')}</option>
              <option value="archived">{t('pages.status.archived')}</option>
            </Select>
          </Toolbar>
        )}
      </ScreenHead>

      <ScreenBody>
        {listing.isError && (
          <div className="pt-2 pb-4">
            <Failure error={listing.error} />
          </div>
        )}

        {listing.isPending && (
          <div className="py-16">
            <Spinner />
          </div>
        )}

        {listing.data !== undefined &&
          (listing.data.data.length === 0 ? (
            <NoPages filtered={filtered} onCreate={() => setCreating(true)} />
          ) : (
            <Table>
              <thead>
                <tr className="border-b border-line">
                  <Th>{t('pages.title')}</Th>
                  <Th>{t('pages.slug')}</Th>
                  <Th>{t('pages.statusLabel')}</Th>
                  <Th>{t('pages.version')}</Th>
                  <Th>{t('pages.updated')}</Th>
                  <Th width="140px" />
                </tr>
              </thead>
              <tbody>
                {listing.data.data.map((entry) => (
                  <Row key={entry.id} page={entry} />
                ))}
              </tbody>
            </Table>
          ))}
      </ScreenBody>

      {listing.data !== undefined && listing.data.data.length > 0 && (
        <ScreenFoot>
          <span className="tabular-nums">
            {`${t('paging.page', {
              page: listing.data.page,
              last: listing.data.lastPage,
            })} · ${t('pages.pageCount', { count: listing.data.total })}`}
          </span>
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
              disabled={page >= listing.data.lastPage}
              onClick={() => setPage((current) => current + 1)}
            >
              {t('paging.next')}
            </Button>
          </div>
        </ScreenFoot>
      )}

      {creating && <NewPage onClose={() => setCreating(false)} />}
    </Screen>
  )
}
