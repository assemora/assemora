import { describe, expect, it } from 'vitest'

import {
  dependencyRange,
  isUnreleased,
  packageVersion,
  projectPackageJson,
} from './package-json.js'

const template = `${JSON.stringify(
  {
    name: '@assemora/starter-bare',
    version: '0.0.0',
    private: true,
    dependencies: {
      assemora: 'workspace:*',
      '@assemora/pages': 'workspace:^',
      zod: '^3.0.0',
      local: 'file:../local',
    },
    devDependencies: { typescript: '7.0.2', '@assemora/mcp': 'workspace:*' },
  },
  null,
  2,
)}\n`

const rewritten = (drop: readonly string[] = []): Record<string, unknown> =>
  JSON.parse(
    projectPackageJson(template, 'package.json', { name: 'my-project', range: '^0.4.2', drop }),
  ) as Record<string, unknown>

describe('projectPackageJson', () => {
  it('gives the project its own name', () => {
    expect(rewritten().name).toBe('my-project')
  })

  it('leaves it private, because a generated application is nobody publishes it', () => {
    expect(rewritten().private).toBe(true)
  })

  it('turns every workspace range into one a package manager can resolve', () => {
    const manifest = rewritten()

    expect(manifest.dependencies).toStrictEqual({
      assemora: '^0.4.2',
      '@assemora/pages': '^0.4.2',
      zod: '^3.0.0',
      local: 'file:../local',
    })
    expect(manifest.devDependencies).toStrictEqual({
      typescript: '7.0.2',
      '@assemora/mcp': '^0.4.2',
    })
  })

  it('removes a dependency the answers turned off, wherever it is declared', () => {
    const manifest = rewritten(['@assemora/pages', '@assemora/mcp'])

    expect(manifest.dependencies).toStrictEqual({
      assemora: '^0.4.2',
      zod: '^3.0.0',
      local: 'file:../local',
    })
    expect(manifest.devDependencies).toStrictEqual({ typescript: '7.0.2' })
  })

  it('keeps the name a package.json below the root already had', () => {
    const nested = projectPackageJson('{"name":"frontend"}', 'app/package.json', {
      range: '^0.4.2',
      drop: [],
    })

    expect(JSON.parse(nested)).toStrictEqual({ name: 'frontend' })
  })

  it('refuses a package.json that is not JSON', () => {
    expect(() => projectPackageJson('nope', 'package.json', { range: '^1.0.0', drop: [] })).toThrow(
      /not JSON/,
    )
  })
})

describe('dependencyRange', () => {
  it('pins a generated project to the minor line the scaffolder was built beside', () => {
    expect(dependencyRange('0.4.2')).toBe('^0.4.2')
  })

  it('is honest that nothing is published yet', async () => {
    expect(isUnreleased(await packageVersion())).toBe(true)
    expect(isUnreleased('0.1.0')).toBe(false)
  })
})
