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
 */
import type { LocaleDescriptor, SettingBlock, SettingsGroupDescriptor } from '@assemora/core'
import { megabytes, settingsGroup } from '@assemora/core'

import type { RateWindow, Settings } from './options.js'

const DECLARED = 'Declared in assemora.config.ts. Changing it is a deploy, not a setting.'

/** `600 per minute`, `120 per 30 seconds`. */
export const perWindow = (window: RateWindow): string => {
  const seconds = window.windowMs / 1000

  if (seconds === 60) return `${window.max} per minute`
  if (seconds % 60 === 0) return `${window.max} per ${seconds / 60} minutes`

  return `${window.max} per ${seconds} seconds`
}

const locked = (title: string, rows: SettingBlock['rows']): SettingBlock => ({
  title,
  note: DECLARED,
  locked: true,
  rows,
})

const general = (settings: Settings): SettingsGroupDescriptor =>
  settingsGroup({
    name: 'general',
    section: 'workspace',
    label: 'General',
    icon: 'settings-2',
    blurb: 'What this application is called, and what it serves.',
    blocks: [
      locked('Identity', [
        {
          key: 'project.name',
          kind: 'value',
          label: 'Name',
          help: 'The OpenAPI title, and what an agent is told this project is.',
          value: settings.project.name,
        },
        {
          key: 'project.version',
          kind: 'value',
          label: 'Version',
          help: 'What the OpenAPI document and the MCP server announce.',
          value: settings.project.version,
        },
        ...(settings.project.description === undefined
          ? []
          : [
              {
                key: 'project.description',
                kind: 'value' as const,
                label: 'Description',
                help: 'One line about the project, for the same two readers.',
                value: settings.project.description,
              },
            ]),
        ...(settings.frontend === undefined
          ? []
          : [
              {
                key: 'frontend.path',
                kind: 'value' as const,
                label: 'Frontend',
                help: 'Where this application serves its own site, and what the builder canvas frames.',
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
    label: 'Languages',
    icon: 'languages',
    badge: String(locales.length),
    blurb:
      'A slug and a block tree per language. One of them is the source the others fall back to.',
    blocks: [
      locked('Languages', [
        {
          key: 'locales',
          kind: 'value',
          label: 'Languages served',
          help: 'In the order they were declared. Each is a path segment: /api/ru/articles is /api/articles read in Russian.',
          value: locales.map((locale) => locale.name).join(' · '),
        },
        ...(source === undefined
          ? []
          : [
              {
                key: 'locales.default',
                kind: 'value' as const,
                label: 'Source language',
                help: 'What a missing translation falls back to, and what an unmarked row is in.',
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
    blurb: 'How the content layer is read without a browser.',
    blocks: [
      locked('Addresses', [
        {
          key: 'api.prefix',
          kind: 'value',
          label: 'Prefix',
          help: 'Everything the application serves over HTTP lives below it.',
          value: settings.api.prefix,
        },
        ...(versions.length === 0
          ? []
          : [
              {
                key: 'api.versions',
                kind: 'value' as const,
                label: 'Versions',
                help: 'Published beside the bare addresses, as a path segment.',
                value: versions.join(' · '),
              },
            ]),
        {
          key: 'api.rate-limit',
          kind: 'value',
          label: 'Rate limit',
          help: 'Per client, counted in this process only.',
          value: perWindow(settings.api.rateLimit),
        },
        {
          key: 'api.body-limit',
          kind: 'value',
          label: 'Largest request',
          help: 'The ceiling every address shares. The media upload has one of its own.',
          value: megabytes(settings.api.bodyLimit),
        },
      ]),
      ...(settings.api.documentation
        ? [
            {
              title: 'Documentation',
              rows: [
                {
                  key: 'api.openapi',
                  kind: 'link' as const,
                  label: 'OpenAPI document',
                  help: 'Every route this application serves, generated from the registry.',
                  href: `${settings.api.prefix}/openapi.json`,
                  action: 'Open',
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
    label: 'Agents',
    icon: 'sparkles',
    blurb: 'An agent runs the same commands a person does. This is the door it comes through.',
    blocks: [
      locked('Endpoint', [
        {
          key: 'mcp.path',
          kind: 'value',
          label: 'MCP address',
          help: 'What an agent connects to. Its token is issued on the Users screen.',
          value: `${settings.api.prefix}${settings.mcp.path}`,
        },
        {
          key: 'mcp.mutations',
          kind: 'value',
          label: 'Mutations',
          help: 'Whether an agent writes production state, or proposes and a person applies.',
          value:
            settings.mcp.mutations === 'direct'
              ? 'Direct: an agent writes production state'
              : 'Proposals: an agent proposes, a person applies',
        },
        {
          key: 'mcp.rate-limit',
          kind: 'value',
          label: 'Rate limit',
          help: 'Tool calls per agent, counted in this process only.',
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
    label: 'Security',
    icon: 'shield',
    blurb: 'How a session travels.',
    blocks: [
      locked('Sessions', [
        {
          key: 'session.secure',
          kind: 'value',
          label: 'Session cookie',
          help: 'Secure means it never travels over plain http. Off is for development.',
          value: settings.session.secure ? 'Secure' : 'Plain http allowed',
        },
        {
          key: 'session.same-site',
          kind: 'value',
          label: 'Cross-site requests',
          help: 'SameSite on the cookie: strict sends it to nothing another site started.',
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
