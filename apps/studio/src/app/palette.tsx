/**
 * ⌘K: everywhere Studio can go, as one list.
 *
 * Built from the Schema Registry rather than from a list kept here, for the reason the
 * sidebar is: a `resource()` an application adds has to be reachable without Studio
 * being edited. The palette is navigation only — a mutation is a command, and a command
 * that runs from a search box with no form in front of it is a command nobody read.
 */

import type { LinkProps } from '@tanstack/react-router'
import {
  FileText,
  Image as ImageIcon,
  Network,
  Palette as PaletteIcon,
  Search,
  Sparkles,
  Terminal,
  Users,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useIntrospection } from '../api/introspection.ts'
import { useT } from '../i18n/translate.tsx'
import { ResourceIcon } from '../ui/icons.tsx'
import { join } from '../ui/index.tsx'
import { useDismiss } from '../ui/overlay.tsx'

type Destination = {
  readonly key: string
  readonly label: string
  readonly where: string
  readonly icon: React.ReactNode
  readonly to: LinkProps
}

export const Palette = ({
  open,
  onDismiss,
  onGo,
}: {
  open: boolean
  onDismiss(): void
  onGo(to: LinkProps): void
}) => {
  const introspection = useIntrospection()
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  useDismiss(open, onDismiss, panel)

  /*
   * Opening the palette puts the caret in it. The focus is moved rather than declared,
   * because an `autoFocus` attribute fires once per mount and this dialog is mounted and
   * unmounted every time — the second ⌘K would open a box nobody was typing into.
   */
  useEffect(() => {
    if (open) {
      box.current?.focus()
      return
    }

    setQuery('')
    setCursor(0)
  }, [open])

  const destinations = useMemo<Destination[]>(() => {
    const resources = introspection.data?.resources ?? []

    return [
      {
        key: 'dashboard',
        label: t('nav.dashboard'),
        where: t('palette.overview'),
        icon: <Zap className="size-5" />,
        to: { to: '/' },
      },
      ...resources.map((resource) => ({
        key: `resource:${resource.name}`,
        label: resource.label,
        where: t('nav.content'),
        icon: <ResourceIcon name={resource.icon} className="size-5" />,
        to: { to: '/content/$resource', params: { resource: resource.name } } as LinkProps,
      })),
      {
        key: 'collections',
        label: t('nav.manageCollections'),
        where: t('nav.content'),
        icon: <Network className="size-5" />,
        to: { to: '/collections' },
      },
      {
        key: 'pages',
        label: t('nav.allPages'),
        where: t('nav.pages'),
        icon: <FileText className="size-5" />,
        to: { to: '/pages' },
      },
      {
        key: 'media',
        label: t('nav.media'),
        where: t('palette.library'),
        icon: <ImageIcon className="size-5" />,
        to: { to: '/media' },
      },
      {
        key: 'design',
        label: t('nav.theme'),
        where: t('nav.design'),
        icon: <PaletteIcon className="size-5" />,
        to: { to: '/design' },
      },
      {
        key: 'proposals',
        label: t('nav.proposals'),
        where: t('nav.ai'),
        icon: <Sparkles className="size-5" />,
        to: { to: '/proposals' },
      },
      {
        key: 'users',
        label: t('nav.users'),
        where: t('nav.settings'),
        icon: <Users className="size-5" />,
        to: { to: '/users' },
      },
      {
        key: 'developer',
        label: t('nav.developer'),
        where: t('nav.settings'),
        icon: <Terminal className="size-5" />,
        to: { to: '/developer' },
      },
    ]
  }, [introspection.data, t])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return destinations

    return destinations.filter(
      (destination) =>
        destination.label.toLowerCase().includes(needle) ||
        destination.where.toLowerCase().includes(needle),
    )
  }, [destinations, query])

  if (!open) return null

  const go = (index: number) => {
    const destination = matches[index]
    if (destination !== undefined) onGo(destination.to)
  }

  return (
    <div className="fixed inset-0 z-60 flex justify-center bg-[rgb(17_18_38/0.32)] p-4 pt-[12vh] backdrop-blur-[2px]">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.label')}
        className="rise h-fit w-full max-w-[560px] overflow-hidden rounded-[18px] bg-surface shadow-dialog"
      >
        <div className="flex h-14 items-center gap-3 border-b border-hairline px-4">
          <Search aria-hidden className="size-5 text-ink-soft" />
          <input
            ref={box}
            value={query}
            placeholder={t('palette.placeholder')}
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCursor((at) => Math.min(at + 1, matches.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCursor((at) => Math.max(at - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                go(cursor)
              }
            }}
            className="flex-1 border-0 bg-transparent text-base outline-none placeholder:text-ink-faint"
          />
          <span className="rounded-md bg-canvas px-1.5 py-[3px] font-mono text-xs text-ink-soft">
            esc
          </span>
        </div>

        <div className="max-h-[50vh] overflow-auto p-2">
          {matches.length === 0 ? (
            <p className="px-2.5 py-8 text-center text-base text-ink-soft">
              {t('palette.nothing', { query })}
            </p>
          ) : (
            matches.map((destination, index) => (
              <button
                key={destination.key}
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(index)}
                className={join(
                  'flex h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-base',
                  index === cursor ? 'bg-canvas' : 'hover:bg-canvas',
                )}
              >
                <span aria-hidden className="text-ink-soft">
                  {destination.icon}
                </span>
                {destination.label}
                <span className="ml-auto text-sm text-ink-soft">{destination.where}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
