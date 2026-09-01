/**
 * What Studio says before anything has been made (SPEC.md §58, §115).
 *
 * A fresh install is the one screen every person who ever tries Assemora sees, and it
 * used to be four panels saying a variation of "nothing yet". An empty list is not a
 * failure state: it is the first instruction, and often the only one somebody reads
 * before deciding whether the thing works.
 *
 * So these say three things and stop: what the thing is, what it becomes once it
 * exists, and how to start one. Where Studio cannot do the making — a block is a
 * TypeScript declaration — they say that too, and name the command that can. An empty
 * panel with no explanation reads as broken software.
 *
 * Presentation only. Studio holds no rule the application does not (docs/rules/
 * studio.md), so nothing here decides who may create anything; it is handed the
 * answer and chooses the words for it.
 */
import { FileText, FolderPlus, LayoutTemplate } from 'lucide-react'
import type { ReactNode } from 'react'

import { useT, useWoven } from '../i18n/translate.tsx'
import { Button, Empty, Snippet } from './index.tsx'

/**
 * The first screen of a fresh install, and the answer to "what is this for?".
 *
 * `Testimonials` rather than `Article`: the example has to be something the framework
 * would never have declared for you, or it reads as a feature you already have.
 */
export const NoCollections = ({
  canCreate,
  onCreate,
}: {
  canCreate: boolean
  onCreate(): void
}) => {
  const t = useT()

  return (
    <Empty
      icon={<FolderPlus className="size-[22px]" />}
      title={canCreate ? t('collections.blank.first') : t('collections.blank.none')}
      action={canCreate ? <Button onClick={onCreate}>{t('collections.new')}</Button> : undefined}
    >
      <p>{t('collections.blank.what')}</p>
      <p>{canCreate ? t('collections.blank.then') : t('collections.blank.forbidden')}</p>
    </Empty>
  )
}

/**
 * Two different silences, which the one sentence used to cover.
 *
 * A list emptied by a search is not a list with nothing in it, and inviting somebody
 * to make their first page while they are looking at a filter is how a person comes to
 * believe the search box deleted their work.
 */
export const NoPages = ({ filtered, onCreate }: { filtered: boolean; onCreate(): void }) => {
  const t = useT()
  const woven = useWoven()

  if (filtered) {
    return (
      <Empty icon={<LayoutTemplate className="size-[22px]" />} title={t('pages.blank.noMatch')}>
        <p>{t('pages.blank.tryAnother')}</p>
      </Empty>
    )
  }

  return (
    <Empty
      icon={<LayoutTemplate className="size-[22px]" />}
      title={t('pages.blank.first')}
      action={<Button onClick={onCreate}>{t('pages.new')}</Button>}
    >
      <p>
        {woven('pages.blank.what', {
          about: <code className="font-mono">/about</code>,
          pricing: <code className="font-mono">/pricing</code>,
        })}
      </p>
      <p>{t('pages.blank.then')}</p>
    </Empty>
  )
}

/**
 * A collection with no entries in it — the screen right after somebody made one.
 *
 * The second sentence is the one worth saying here and nowhere else: a stored
 * definition is only fully editable while nothing is stored against it, and this is
 * the last moment that is true. It is said to a collection and not to a resource
 * declared in TypeScript, whose fields are in a file and are not this screen's to
 * discuss (SPEC.md §37, §39).
 */
export const NoEntries = ({
  singular,
  editable,
  onCreate,
}: {
  /** What one of these is called, singular — `Create Testimonial` uses the same word. */
  singular: string
  /** Whether this resource's fields are a stored definition, changeable from here. */
  editable: boolean
  onCreate?: (() => void) | undefined
}) => {
  const t = useT()

  return (
    <Empty
      title={t('entries.blank.title', { name: singular.toLowerCase() })}
      icon={<FileText className="size-[22px]" />}
      action={
        onCreate === undefined ? undefined : (
          <Button onClick={onCreate}>{t('entries.blank.create', { name: singular })}</Button>
        )
      }
    >
      <p>{t('entries.blank.what', { name: singular.toLowerCase() })}</p>
      {editable && <p>{t('entries.blank.cheapest')}</p>}
    </Empty>
  )
}

/**
 * The line somebody selects, and has to get a block out of.
 *
 * `npx`, not `assemora` and not `pnpm assemora`. The executable is a dependency rather
 * than a global one, so it lives in `node_modules/.bin` and the bare name resolves to
 * nothing; and the package manager that put it there is the one thing Studio cannot
 * see — it is served by an application, on a machine it knows nothing else about. The
 * project's README is written by a scaffolder that *did* know, and says `pnpm assemora`
 * because it chose pnpm. This is the form that runs whichever one it was: `npx` ships
 * with the Node the project already requires, and prefers the local binary over the
 * registry.
 */
const MAKE_BLOCK = 'npx assemora make:block hero'

/**
 * The empty block palette, which is the one thing on this list Studio cannot fix.
 *
 * A block is a TypeScript declaration — its fields are the form, the validation, the
 * JSON Schema and what an agent may set, all from the one place (SPEC.md §55). That is
 * exactly why Studio may not invent one, and why saying nothing here would be a lie by
 * omission: the panel is empty because of a rule, not because of a fault.
 *
 * The command is real and its output is checked against these words: `make:block hero`
 * writes `src/blocks/hero.ts` and prints the registration line named here. It writes no
 * view — a declaration and its component are deliberately separate (SPEC.md §57) — so
 * the third step is the one that is easiest to forget and is therefore said.
 */
export const NoBlocks = () => {
  const t = useT()
  const woven = useWoven()

  return (
    <div className="space-y-2 px-1 py-2 text-base text-ink-soft">
      <p className="font-medium text-ink">{t('blocks.blank.title')}</p>
      <p>{t('blocks.blank.declared')}</p>
      <Snippet>{MAKE_BLOCK}</Snippet>
      <p>
        {woven('blocks.blank.register', {
          file: <code className="font-mono text-sm">src/blocks/hero.ts</code>,
          call: <code className="font-mono text-sm">pages({'{ blocks: [Hero] }'})</code>,
        })}
      </p>
    </div>
  )
}

const Step = ({ title, body, action }: { title: string; body: string; action: ReactNode }) => (
  <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-4">
    <p className="font-medium">{title}</p>
    <p className="flex-1 text-base text-ink-soft">{body}</p>
    <div className="pt-1">{action}</div>
  </div>
)

/**
 * The dashboard of an application that has nothing of its own yet.
 *
 * Counts are the right first screen for an application with content in it and the
 * wrong one for an application without: `0 Resources · 0 Blocks · 84 Endpoints` boasts
 * about the framework and says nothing about what to do. The counts move below this
 * rather than away — a developer wanting to know what is already wired up is asking a
 * fair question, just not the first one.
 */
export const GettingStarted = ({
  canCreateCollection,
  onCreateCollection,
  onCreatePage,
}: {
  /** Whether this application has `collections()` at all, and this account the right. */
  canCreateCollection: boolean
  onCreateCollection(): void
  onCreatePage(): void
}) => {
  const t = useT()

  return (
    <div className={`grid gap-3 ${canCreateCollection ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {canCreateCollection && (
        <Step
          title={t('start.collection.title')}
          body={t('start.collection.body')}
          action={
            <Button size="sm" onClick={onCreateCollection}>
              {t('collections.new')}
            </Button>
          }
        />
      )}

      {/* "Go to pages" rather than "New page": making one is a dialog on that screen,
          and a button that lands you somewhere else having promised a form is the small
          lie people stop trusting a product over. */}
      <Step
        title={t('start.page.title')}
        body={t('start.page.body')}
        action={
          <Button size="sm" variant="secondary" onClick={onCreatePage}>
            {t('start.page.go')}
          </Button>
        }
      />

      <Step
        title={t('start.block.title')}
        body={t('start.block.body')}
        action={<Snippet>{MAKE_BLOCK}</Snippet>}
      />
    </div>
  )
}
