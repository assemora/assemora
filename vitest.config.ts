import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      // `@assemora/react` is the one package that ships components, so it is the one
      // whose tests are .tsx.
      'packages/*/src/**/*.test.tsx',
      // Studio is an app rather than a package, but its builder helpers are real
      // mechanism and are tested like anything else.
      'apps/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.tsx',
      // A starter is a template, so its frontend is the one place in this repository
      // where "what a project with nothing in it shows a visitor" is decided. The
      // test belongs to this repository rather than to the template: `create-assemora`
      // leaves it behind, because a scaffolded project depends on no test runner.
      'starters/*/app/**/*.test.tsx',
      'scripts/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    // esbuild has to be told which factory to use; the package's own tsconfig says
    // `react-jsx`, and Vitest does not read it.
    esbuild: { jsx: 'automatic' },
    typecheck: {
      include: ['packages/*/src/**/*.test-d.ts', 'packages/*/src/**/*.test-d.tsx'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
})
