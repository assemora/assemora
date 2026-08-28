import { afterEach, describe, expect, it } from 'vitest'
import { remove, temporaryDirectory, write, writeTemplate } from './template.fixture.js'
import { listTemplates, readManifest, resolveTemplate } from './template.js'

const directories: string[] = []

const temporary = async (): Promise<string> => {
  const directory = await temporaryDirectory()
  directories.push(directory)

  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(remove))
})

describe('resolveTemplate', () => {
  it('finds the packed copy a published install carries', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    expect(await resolveTemplate('bare', { from: root })).toBe(template)
  })

  it('finds the workspace starter, which is what a checkout has', async () => {
    const root = await temporary()
    await write(root, 'starters/bare/package.json', '{}\n')

    expect(await resolveTemplate('bare', { from: root })).toBe(`${root}/starters/bare`)
  })

  it('prefers the packed copy, because that is the one a published install reads', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)
    await write(root, 'starters/bare/package.json', '{}\n')

    expect(await resolveTemplate('bare', { from: root })).toBe(template)
  })

  it('walks up, so it works from src/ under a test runner and from dist/ after a build', async () => {
    const root = await temporary()
    await write(root, 'starters/bare/package.json', '{}\n')
    await write(root, 'packages/create-assemora/src/marker', '')

    expect(await resolveTemplate('bare', { from: `${root}/packages/create-assemora/src` })).toBe(
      `${root}/starters/bare`,
    )
  })

  it('takes an absolute path as the template itself', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    expect(await resolveTemplate(template)).toBe(template)
  })

  it('names both places it looked', async () => {
    const root = await temporary()
    await write(root, 'starters/nextjs/package.json', '{}\n')

    const failure = await resolveTemplate('sveltekit', { from: root }).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    )

    expect(failure).toContain(`${root}/starters/sveltekit`)
    expect(failure).toContain('templates')
    expect(failure).toContain('"sveltekit"')
  })

  it('names the templates that do exist, because a misspelling is the likely cause', async () => {
    const root = await temporary()
    await write(root, 'starters/bare/package.json', '{}\n')
    await write(root, 'starters/blog/package.json', '{}\n')

    const failure = await resolveTemplate('blogg', { from: root }).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    )

    expect(failure).toContain('The templates here are: bare, blog.')
  })

  it('says so when an absolute path is not a directory', async () => {
    const root = await temporary()

    await expect(resolveTemplate(`${root}/nowhere`)).rejects.toThrow(/no template directory/)
  })

  it('refuses a directory that is not a package, rather than scaffolding nothing', async () => {
    const root = await temporary()
    await write(root, 'starters/bare/.gitkeep', '')

    await expect(resolveTemplate('bare', { from: root })).rejects.toThrow(/no package\.json/)
  })
})

describe('readManifest', () => {
  it('reads what each feature owns', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)
    const manifest = await readManifest(template)

    expect(manifest.features.studio).toStrictEqual({
      files: ['src/studio.ts'],
      dependencies: ['@assemora/studio'],
      scripts: [],
    })
    expect(manifest.features.pages.files).toStrictEqual(['src/blocks'])
  })

  it('reads the line the template says about itself', async () => {
    const root = await temporary()
    const template = await writeTemplate(root)

    expect((await readManifest(template)).description).toBe('the template every test copies')
  })

  it('treats a template with no manifest as one with nothing optional', async () => {
    const root = await temporary()
    await write(root, 'templates/plain/package.json', '{}\n')

    expect(await readManifest(`${root}/templates/plain`)).toStrictEqual({
      description: undefined,
      features: {
        studio: { files: [], dependencies: [], scripts: [] },
        pages: { files: [], dependencies: [], scripts: [] },
        mcp: { files: [], dependencies: [], scripts: [] },
      },
    })
  })

  it('refuses a description that is not a string', async () => {
    const root = await temporary()
    await write(root, 'templates/plain/template.json', '{"description":["a","b"]}')

    await expect(readManifest(`${root}/templates/plain`)).rejects.toThrow(
      /"description" must be a string/,
    )
  })

  it('refuses a feature this scaffolder never asks about', async () => {
    const root = await temporary()
    await write(root, 'templates/plain/template.json', '{"features":{"auth":{"files":[]}}}')

    await expect(readManifest(`${root}/templates/plain`)).rejects.toThrow(/"features\.auth"/)
  })

  it('refuses a manifest that is not JSON', async () => {
    const root = await temporary()
    await write(root, 'templates/plain/template.json', 'features:')

    await expect(readManifest(`${root}/templates/plain`)).rejects.toThrow(/is not JSON/)
  })

  it('refuses a file list that is not a list of strings', async () => {
    const root = await temporary()
    await write(root, 'templates/plain/template.json', '{"features":{"mcp":{"files":"src"}}}')

    await expect(readManifest(`${root}/templates/plain`)).rejects.toThrow(
      /must be a list of strings/,
    )
  })
})

describe('listTemplates', () => {
  it('lists every template, by name, with the line each one says about itself', async () => {
    const root = await temporary()
    await writeTemplate(root)
    await write(root, 'templates/plain/package.json', '{}\n')

    expect(await listTemplates({ from: root })).toStrictEqual([
      { name: 'bare', description: 'the template every test copies' },
      { name: 'plain', description: undefined },
    ])
  })

  it('merges the packed copy and the workspace one, preferring the packed', async () => {
    const root = await temporary()
    await writeTemplate(root)
    await write(root, 'starters/bare/package.json', '{}\n')
    await write(root, 'starters/nextjs/package.json', '{}\n')

    expect((await listTemplates({ from: root })).map((entry) => entry.name)).toStrictEqual([
      'bare',
      'nextjs',
    ])
    expect((await listTemplates({ from: root }))[0]?.description).toBe(
      'the template every test copies',
    )
  })

  it('skips a directory that is not a package, as resolving one would', async () => {
    const root = await temporary()
    await write(root, 'starters/bare/package.json', '{}\n')
    await write(root, 'starters/notes/README.md', 'mine\n')

    expect((await listTemplates({ from: root })).map((entry) => entry.name)).toStrictEqual(['bare'])
  })

  it('never throws over a manifest a sibling template got wrong', async () => {
    const root = await temporary()
    await write(root, 'starters/broken/package.json', '{}\n')
    await write(root, 'starters/broken/template.json', 'not json at all')

    expect(await listTemplates({ from: root })).toStrictEqual([
      { name: 'broken', description: undefined },
    ])
  })
})
