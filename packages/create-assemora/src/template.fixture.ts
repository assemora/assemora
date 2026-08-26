/**
 * A template, built in a temporary directory.
 *
 * `starters/bare` is the real one and it lands next (ADR-0021), so nothing here waits
 * for it: a template is a directory with a manifest and some files, and a test can
 * write one. What the tests are proving is the copier's behaviour, and a synthetic
 * template exercises the awkward parts — a dotfile, a binary file, a nested
 * `package.json`, every marker — more thoroughly than a real starter would.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const temporaryDirectory = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'create-assemora-'))

export const remove = (directory: string): Promise<void> =>
  rm(directory, { recursive: true, force: true })

/** Writes a file and whatever directories it needs. */
export const write = async (
  directory: string,
  path: string,
  contents: string | Uint8Array,
): Promise<void> => {
  const file = join(directory, ...path.split('/'))

  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, contents)
}

/**
 * The template every scaffolding test copies.
 *
 * It is deliberately the hard case: each feature owns a file, a dependency and a
 * region inside a shared file, so a project is only correct if all three mechanisms
 * agree — which is what "no dangling import and no dead dependency, in all eight
 * combinations" actually asks.
 */
export const writeTemplate = async (directory: string): Promise<string> => {
  const template = join(directory, 'templates', 'bare')

  await write(
    template,
    'template.json',
    `${JSON.stringify(
      {
        features: {
          studio: { files: ['src/studio.ts'], dependencies: ['@assemora/studio'] },
          pages: { files: ['src/blocks'], dependencies: ['@assemora/pages'] },
          mcp: { files: ['src/mcp-routes.ts'], dependencies: ['@assemora/mcp'] },
        },
      },
      null,
      2,
    )}\n`,
  )

  await write(
    template,
    'package.json',
    `${JSON.stringify(
      {
        name: '@assemora/starter-bare',
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: { dev: 'node --watch src/server.ts' },
        dependencies: {
          assemora: 'workspace:*',
          '@assemora/studio': 'workspace:*',
          '@assemora/pages': 'workspace:*',
          '@assemora/mcp': 'workspace:*',
          zod: '^3.0.0',
        },
      },
      null,
      2,
    )}\n`,
  )

  await write(
    template,
    'src/app.ts',
    [
      "import { assemora } from 'assemora'",
      '// assemora:if studio',
      "import { studio } from './studio.js'",
      '// assemora:end',
      '// assemora:if pages',
      "import { hero } from './blocks/hero.js'",
      '// assemora:end',
      '// assemora:if mcp',
      "import { mcpRoutes } from './mcp-routes.js'",
      '// assemora:end',
      '',
      'export const createApp = () =>',
      '  assemora({',
      '    modules: [',
      '      // assemora:if studio',
      '      studio(),',
      '      // assemora:end',
      '      // assemora:if pages',
      '      hero(),',
      '      // assemora:end',
      '      // assemora:if mcp',
      '      mcpRoutes(),',
      '      // assemora:end',
      '    ],',
      '  })',
      '',
    ].join('\n'),
  )

  await write(template, 'src/studio.ts', 'export const studio = () => undefined\n')
  await write(template, 'src/blocks/hero.ts', 'export const hero = () => undefined\n')
  await write(template, 'src/mcp-routes.ts', 'export const mcpRoutes = () => undefined\n')

  await write(template, '_gitignore', 'node_modules/\ndist/\n.env\n')
  await write(template, '_npmrc', 'strict-peer-dependencies=false\n')
  await write(
    template,
    '.env.example',
    ['# The database this project talks to.', 'DATABASE_URL=', ''].join('\n'),
  )

  await write(
    template,
    'README.md',
    [
      '# Starter',
      '',
      '<!-- assemora:if studio -->',
      'Studio is at /studio.',
      '<!-- assemora:end -->',
      '<!-- assemora:if !pages -->',
      'This project has no page builder.',
      '<!-- assemora:end -->',
      '',
    ].join('\n'),
  )

  // A byte a text file cannot hold, so the copier has to leave this one alone.
  await write(template, 'public/logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]))

  // A package.json below the root keeps its own name and still loses the ranges.
  await write(
    template,
    'app/package.json',
    `${JSON.stringify({ name: 'frontend', private: true, dependencies: { assemora: 'workspace:*' } }, null, 2)}\n`,
  )

  await write(template, 'database/migrations/.gitkeep', '')

  return template
}
