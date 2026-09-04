/**
 * What the umbrella tells the settings screen (ADR-0031).
 *
 * Every row here is a fact only this file knows: the project's name is an option of
 * `assemora()`, the API prefix is where this file mounted everything, the MCP address
 * is where it mounted that. Studio reads the registry and draws what it
 * finds; `assemora.describe` answers an agent from the same section. Nothing about a
 * deployment is described twice.
 *
 * Every block is `locked`, and says the same sentence: these values were declared in
 * the project's own source, and a screen that offered a control for one would be
 * offering to change a file it cannot reach. A setting a person changes at run time is
 * a command (SPEC.md §14), and the day one exists it is declared as one.
 *
 * Every sentence is written in the three languages Studio reads. Studio picks and never
 * translates (ADR-0030): these stay the framework's words, written more than once.
 */
import type { LocaleDescriptor, Said, SettingBlock, SettingsGroupDescriptor } from '@assemora/core'
import { megabytes, settingsGroup } from '@assemora/core'

import type { RateWindow, Settings } from './options.js'

const DECLARED = {
  en: 'Declared in assemora.config.ts. Changing it is a deploy, not a setting.',
  uk: 'Оголошено в assemora.config.ts. Зміна — це розгортання, а не налаштування.',
  ru: 'Объявлено в assemora.config.ts. Изменение — это развёртывание, а не настройка.',
}

/** `600 per minute`, `10 per 5 minutes`, `5 per 30 seconds` — in each language. */
export const perWindow = (window: RateWindow): Said => {
  const seconds = window.windowMs / 1000

  if (seconds === 60) {
    return {
      en: `${window.max} per minute`,
      uk: `${window.max} на хвилину`,
      ru: `${window.max} в минуту`,
    }
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60

    return {
      en: `${window.max} per ${minutes} minutes`,
      uk: `${window.max} за ${minutes} хв`,
      ru: `${window.max} за ${minutes} мин`,
    }
  }

  return {
    en: `${window.max} per ${seconds} seconds`,
    uk: `${window.max} за ${seconds} с`,
    ru: `${window.max} за ${seconds} с`,
  }
}

const locked = (title: Said, rows: SettingBlock['rows']): SettingBlock => ({
  title,
  note: DECLARED,
  locked: true,
  rows,
})

const general = (settings: Settings): SettingsGroupDescriptor =>
  settingsGroup({
    name: 'general',
    section: 'workspace',
    label: { en: 'General', uk: 'Загальні', ru: 'Общие' },
    icon: 'settings-2',
    blurb: {
      en: 'What this application is called, and what it serves.',
      uk: 'Як називається цей застосунок і що він обслуговує.',
      ru: 'Как называется это приложение и что оно обслуживает.',
    },
    blocks: [
      locked({ en: 'Identity', uk: 'Ідентичність', ru: 'Идентичность' }, [
        {
          key: 'project.name',
          kind: 'value',
          label: { en: 'Name', uk: 'Назва', ru: 'Название' },
          help: {
            en: 'The OpenAPI title, and what an agent is told this project is.',
            uk: 'Заголовок OpenAPI і те, як цей проєкт представляється агентові.',
            ru: 'Заголовок OpenAPI и то, как этот проект представляется агенту.',
          },
          value: settings.project.name,
        },
        {
          key: 'project.version',
          kind: 'value',
          label: { en: 'Version', uk: 'Версія', ru: 'Версия' },
          help: {
            en: 'What the OpenAPI document and the MCP server announce.',
            uk: 'Те, що оголошують документ OpenAPI і сервер MCP.',
            ru: 'То, что объявляют документ OpenAPI и сервер MCP.',
          },
          value: settings.project.version,
        },
        ...(settings.project.description === undefined
          ? []
          : [
              {
                key: 'project.description',
                kind: 'value' as const,
                label: { en: 'Description', uk: 'Опис', ru: 'Описание' },
                help: {
                  en: 'One line about the project, for the same two readers.',
                  uk: 'Один рядок про проєкт для тих самих двох читачів.',
                  ru: 'Одна строка о проекте для тех же двух читателей.',
                },
                value: settings.project.description,
              },
            ]),
        ...(settings.frontend === undefined
          ? []
          : [
              {
                key: 'frontend.path',
                kind: 'value' as const,
                label: { en: 'Frontend', uk: 'Фронтенд', ru: 'Фронтенд' },
                help: {
                  en: 'Where this application serves its own site, and what the builder canvas frames.',
                  uk: 'Де цей застосунок обслуговує власний сайт і що вбудовує полотно конструктора.',
                  ru: 'Где это приложение обслуживает собственный сайт и что встраивает холст конструктора.',
                },
                value: settings.frontend.path,
              },
            ]),
      ]),
    ],
  })

const languages = (locales: readonly LocaleDescriptor[]): SettingsGroupDescriptor | undefined => {
  if (locales.length === 0) return undefined

  const source = locales.find((locale) => locale.default) ?? locales[0]

  return settingsGroup({
    name: 'languages',
    section: 'content',
    label: { en: 'Languages', uk: 'Мови', ru: 'Языки' },
    icon: 'languages',
    badge: String(locales.length),
    blurb: {
      en: 'A slug and a block tree per language. One of them is the source the others fall back to.',
      uk: 'Slug і дерево блоків для кожної мови. Одна з них — джерело, до якого повертаються інші.',
      ru: 'Slug и дерево блоков для каждого языка. Один из них — источник, к которому возвращаются остальные.',
    },
    blocks: [
      locked({ en: 'Languages', uk: 'Мови', ru: 'Языки' }, [
        {
          key: 'locales',
          kind: 'value',
          label: {
            en: 'Languages served',
            uk: 'Мови, що обслуговуються',
            ru: 'Обслуживаемые языки',
          },
          help: {
            en: 'In the order they were declared. Each is a path segment: /api/ru/articles is /api/articles read in Russian.',
            uk: 'У порядку оголошення. Кожна — сегмент шляху: /api/ru/articles — це /api/articles, прочитане російською.',
            ru: 'В порядке объявления. Каждый — сегмент пути: /api/ru/articles — это /api/articles, прочитанное по-русски.',
          },
          value: locales.map((locale) => locale.name).join(' · '),
        },
        ...(source === undefined
          ? []
          : [
              {
                key: 'locales.default',
                kind: 'value' as const,
                label: { en: 'Source language', uk: 'Мова-джерело', ru: 'Язык-источник' },
                help: {
                  en: 'What a missing translation falls back to, and what an unmarked row is in.',
                  uk: 'До неї повертається відсутній переклад, і нею написаний непозначений рядок.',
                  ru: 'К нему возвращается отсутствующий перевод, и на нём написана непомеченная строка.',
                },
                value: source.name,
              },
            ]),
      ]),
    ],
  })
}

const api = (settings: Settings): SettingsGroupDescriptor | undefined => {
  if (settings.api === undefined) return undefined

  const versions = Object.keys(settings.api.versions)

  return settingsGroup({
    name: 'api',
    section: 'platform',
    label: 'API',
    icon: 'plug',
    blurb: {
      en: 'How the content layer is read without a browser.',
      uk: 'Як шар вмісту читають без браузера.',
      ru: 'Как слой содержимого читают без браузера.',
    },
    blocks: [
      locked({ en: 'Addresses', uk: 'Адреси', ru: 'Адреса' }, [
        {
          key: 'api.prefix',
          kind: 'value',
          label: { en: 'Prefix', uk: 'Префікс', ru: 'Префикс' },
          help: {
            en: 'Everything the application serves over HTTP lives below it.',
            uk: 'Усе, що застосунок обслуговує по HTTP, живе під ним.',
            ru: 'Всё, что приложение обслуживает по HTTP, живёт под ним.',
          },
          value: settings.api.prefix,
        },
        ...(versions.length === 0
          ? []
          : [
              {
                key: 'api.versions',
                kind: 'value' as const,
                label: { en: 'Versions', uk: 'Версії', ru: 'Версии' },
                help: {
                  en: 'Published beside the bare addresses, as a path segment.',
                  uk: 'Опубліковані поряд із простими адресами, як сегмент шляху.',
                  ru: 'Опубликованы рядом с простыми адресами, как сегмент пути.',
                },
                value: versions.join(' · '),
              },
            ]),
        {
          key: 'api.rate-limit',
          kind: 'value',
          label: { en: 'Rate limit', uk: 'Обмеження частоти', ru: 'Ограничение частоты' },
          help: {
            en: 'Per client, counted in this process only.',
            uk: 'На клієнта, рахується лише в цьому процесі.',
            ru: 'На клиента, считается только в этом процессе.',
          },
          value: perWindow(settings.api.rateLimit),
        },
        {
          key: 'api.body-limit',
          kind: 'value',
          label: { en: 'Largest request', uk: 'Найбільший запит', ru: 'Наибольший запрос' },
          help: {
            en: 'The ceiling every address shares. The media upload has one of its own.',
            uk: 'Стеля, спільна для всіх адрес. У завантаження медіа — своя.',
            ru: 'Потолок, общий для всех адресов. У загрузки медиа — свой.',
          },
          value: megabytes(settings.api.bodyLimit),
        },
      ]),
      ...(settings.api.documentation
        ? [
            {
              title: { en: 'Documentation', uk: 'Документація', ru: 'Документация' },
              rows: [
                {
                  key: 'api.openapi',
                  kind: 'link' as const,
                  label: { en: 'OpenAPI document', uk: 'Документ OpenAPI', ru: 'Документ OpenAPI' },
                  help: {
                    en: 'Every route this application serves, generated from the registry.',
                    uk: 'Кожен маршрут, який обслуговує цей застосунок, згенерований із реєстру.',
                    ru: 'Каждый маршрут, который обслуживает это приложение, сгенерированный из реестра.',
                  },
                  href: `${settings.api.prefix}/openapi.json`,
                  action: { en: 'Open', uk: 'Відкрити', ru: 'Открыть' },
                },
              ],
            },
          ]
        : []),
    ],
  })
}

const agents = (settings: Settings): SettingsGroupDescriptor | undefined => {
  if (settings.mcp === undefined || settings.api === undefined) return undefined

  return settingsGroup({
    name: 'agents',
    section: 'platform',
    label: { en: 'Agents', uk: 'Агенти', ru: 'Агенты' },
    icon: 'sparkles',
    blurb: {
      en: 'An agent runs the same commands a person does. This is the door it comes through.',
      uk: 'Агент виконує ті самі команди, що й людина. Це двері, через які він заходить.',
      ru: 'Агент выполняет те же команды, что и человек. Это дверь, через которую он заходит.',
    },
    blocks: [
      locked({ en: 'Endpoint', uk: 'Точка доступу', ru: 'Точка доступа' }, [
        {
          key: 'mcp.path',
          kind: 'value',
          label: { en: 'MCP address', uk: 'Адреса MCP', ru: 'Адрес MCP' },
          help: {
            en: 'What an agent connects to. Its token is issued on the Users screen.',
            uk: 'Куди під’єднується агент. Його токен видають на екрані користувачів.',
            ru: 'Куда подключается агент. Его токен выдают на экране пользователей.',
          },
          value: `${settings.api.prefix}${settings.mcp.path}`,
        },
        {
          key: 'mcp.mutations',
          kind: 'value',
          label: { en: 'Mutations', uk: 'Зміни', ru: 'Изменения' },
          help: {
            en: 'Whether an agent writes production state, or proposes and a person applies.',
            uk: 'Чи агент пише робочий стан, чи пропонує, а людина застосовує.',
            ru: 'Пишет ли агент рабочее состояние или предлагает, а человек применяет.',
          },
          value:
            settings.mcp.mutations === 'direct'
              ? {
                  en: 'Direct: an agent writes production state',
                  uk: 'Напряму: агент пише робочий стан',
                  ru: 'Напрямую: агент пишет рабочее состояние',
                }
              : {
                  en: 'Proposals: an agent proposes, a person applies',
                  uk: 'Пропозиції: агент пропонує, людина застосовує',
                  ru: 'Предложения: агент предлагает, человек применяет',
                },
        },
        {
          key: 'mcp.rate-limit',
          kind: 'value',
          label: { en: 'Rate limit', uk: 'Обмеження частоти', ru: 'Ограничение частоты' },
          help: {
            en: 'Tool calls per agent, counted in this process only.',
            uk: 'Виклики інструментів на агента, рахуються лише в цьому процесі.',
            ru: 'Вызовы инструментов на агента, считаются только в этом процессе.',
          },
          value: perWindow(settings.mcp.rateLimit),
        },
      ]),
    ],
  })
}

const security = (settings: Settings): SettingsGroupDescriptor =>
  settingsGroup({
    name: 'security',
    section: 'workspace',
    label: { en: 'Security', uk: 'Безпека', ru: 'Безопасность' },
    icon: 'shield',
    blurb: {
      en: 'How a session travels.',
      uk: 'Як подорожує сесія.',
      ru: 'Как путешествует сессия.',
    },
    blocks: [
      locked({ en: 'Sessions', uk: 'Сесії', ru: 'Сессии' }, [
        {
          key: 'session.secure',
          kind: 'value',
          label: { en: 'Session cookie', uk: 'Cookie сесії', ru: 'Cookie сессии' },
          help: {
            en: 'Secure means it never travels over plain http. Off is for development.',
            uk: 'Secure означає, що вона ніколи не йде відкритим http. Вимкнено — для розробки.',
            ru: 'Secure означает, что она никогда не идёт по открытому http. Выключено — для разработки.',
          },
          value: settings.session.secure
            ? 'Secure'
            : {
                en: 'Plain http allowed',
                uk: 'Дозволено відкритий http',
                ru: 'Разрешён открытый http',
              },
        },
        {
          key: 'session.same-site',
          kind: 'value',
          label: { en: 'Cross-site requests', uk: 'Міжсайтові запити', ru: 'Межсайтовые запросы' },
          help: {
            en: 'SameSite on the cookie: strict sends it to nothing another site started.',
            uk: 'SameSite у cookie: strict не надсилає її нікуди, що почав інший сайт.',
            ru: 'SameSite у cookie: strict не отправляет её никуда, что начал другой сайт.',
          },
          value: settings.session.sameSite,
        },
      ]),
    ],
  })

/**
 * The groups this deployment has, in the order the sidebar draws them.
 *
 * A group nothing backs is not declared: a deployment in one language has no
 * Languages group, one with `mcp: false` has no Agents group. The registry decides what
 * Studio draws, the way it does for the sidebar. The Media group is not here at all:
 * the module that holds the bytes declares it (`@assemora/media`), and this file only
 * tells that module the ceiling it sized the upload route to.
 */
export const settingsGroups = (
  settings: Settings,
  locales: readonly LocaleDescriptor[],
): readonly SettingsGroupDescriptor[] =>
  [
    general(settings),
    security(settings),
    languages(locales),
    api(settings),
    agents(settings),
  ].filter((group): group is SettingsGroupDescriptor => group !== undefined)
